import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Link from "ink-link";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { getActiveWalletSigner, WalletLockedError } from "../../wallet/index.js";
import { fetchAllBalances } from "../../portfolio/index.js";
import { fetchTokenMetadata } from "../../pricing/index.js";
import { executeTransfer, isValidSolanaAddress, maxSendableSol } from "../../transfer/index.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import { truncateAddress, formatAmount, parseDecimalAmount, timeAgo } from "../../lib/format.js";
import type { TokenBalance, TokenMetadata } from "../../types/portfolio.js";
import type { TransferResult } from "../../types/transfer.js";

const SOLSCAN_TX_URL = "https://solscan.io/tx/";

type SendStep =
  | "select-token"
  | "enter-recipient"
  | "enter-amount"
  | "preview"
  | "executing"
  | "result";

interface SendScreenProps {
  walletAddress: string | null;
  rpc: Rpc<SolanaRpcApi>;
  jupiterApiKey: string;
  isActive: boolean;
  onCapturingInputChange: (capturing: boolean) => void;
  /** Pre-selected mint from portfolio screen. */
  preSelectedMint: string | null;
  onPreSelectedMintConsumed: () => void;
  /** Increment to trigger a balances refresh from outside the component. */
  refreshKey: number;
  /** Called when a transfer completes successfully. */
  onTransactionComplete: () => void;
}

export default function SendScreen({
  walletAddress,
  rpc,
  jupiterApiKey,
  isActive,
  onCapturingInputChange,
  preSelectedMint,
  onPreSelectedMintConsumed,
  refreshKey,
  onTransactionComplete,
}: SendScreenProps) {
  const [step, setStep] = useState<SendStep>("select-token");
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [metadata, setMetadata] = useState<Map<string, TokenMetadata>>(new Map());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sourceToken, setSourceToken] = useState<TokenBalance | null>(null);
  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [sendStatus, setSendStatus] = useState("Preparing...");
  const [sendResult, setSendResult] = useState<TransferResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const fetchInFlight = useRef(false);

  // Notify parent about text input capture.
  const isCapturing = step === "enter-recipient" || step === "enter-amount";
  useEffect(() => {
    onCapturingInputChange(isCapturing);
  }, [isCapturing, onCapturingInputChange]);

  // Load balances.
  const loadBalances = useCallback(async () => {
    if (!walletAddress || fetchInFlight.current) return;
    fetchInFlight.current = true;
    setLoadingBalances(true);
      try {
        const bals = await fetchAllBalances(rpc, walletAddress);
        const mints = bals.map((b) => b.mint);
        const meta = await fetchTokenMetadata(mints, jupiterApiKey);
        setBalances(bals);
        setMetadata(meta);
        setSelectedIndex((prev) => Math.min(prev, Math.max(0, bals.length - 1)));
        setLastUpdated(new Date());
        setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load balances");
    } finally {
      setLoadingBalances(false);
      fetchInFlight.current = false;
    }
  }, [walletAddress, rpc, jupiterApiKey]);

  // Auto-load balances on select-token step.
  useEffect(() => {
    if (step === "select-token" && balances.length === 0 && !loadingBalances && !error && walletAddress) {
      loadBalances();
    }
  }, [step, balances.length, loadingBalances, error, walletAddress, loadBalances]);

  // Handle pre-selected mint from portfolio.
  useEffect(() => {
    if (preSelectedMint && balances.length > 0 && step === "select-token") {
      const token = balances.find((b) => b.mint === preSelectedMint);
      if (token) {
        setSourceToken(token);
        setStep("enter-recipient");
      }
      // Always consume — don't let a stale mint hang around.
      onPreSelectedMintConsumed();
    }
  }, [preSelectedMint, balances, step, onPreSelectedMintConsumed]);

  // External refresh trigger (e.g. after a swap, transfer, or stake).
  useEffect(() => {
    if (isActive && refreshKey > 0 && step === "select-token") {
      loadBalances();
    }
  }, [isActive, refreshKey, step, loadBalances]);

  /** Get symbol for a mint. */
  function mintSymbol(mint: string): string {
    return metadata.get(mint)?.symbol ?? truncateAddress(mint);
  }

  function previewAmount(): string {
    if (!sourceToken) return amountInput;
    if (amountInput !== "max") return amountInput;

    if (sourceToken.isNative) {
      const maxAmount = Number(maxSendableSol(sourceToken.rawBalance)) / 10 ** sourceToken.decimals;
      return maxAmount.toLocaleString("en-US", { maximumFractionDigits: 6 });
    }

    return sourceToken.balance.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  const sendInFlight = useRef(false);

  /** Execute the send. */
  const doSend = useCallback(async () => {
    if (!sourceToken || sendInFlight.current) return;
    sendInFlight.current = true;

    setStep("executing");
    setSendStatus("Preparing...");
    try {
      const signer = await getActiveWalletSigner();
      if (!signer) {
        throw new Error("No active wallet signer available.");
      }

      // Parse amount to raw units.
      let rawAmount: bigint;
      if (amountInput === "max") {
        rawAmount = sourceToken.isNative
          ? maxSendableSol(sourceToken.rawBalance)
          : sourceToken.rawBalance;
      } else {
        rawAmount = parseDecimalAmount(amountInput, sourceToken.decimals) ?? 0n;
      }

      if (rawAmount <= 0n) {
        throw new Error("Amount must be greater than 0.");
      }

      if (rawAmount > sourceToken.rawBalance) {
        throw new Error("Amount exceeds available balance.");
      }

      const result = await executeTransfer(
        {
          mint: sourceToken.mint,
          recipient: recipientInput,
          amount: rawAmount,
          decimals: sourceToken.decimals,
          isNative: sourceToken.isNative,
        },
        signer,
        rpc,
        setSendStatus,
      );
      setSendResult(result);
      setStep("result");
      if (result.success) onTransactionComplete();
    } catch (err: unknown) {
      const message = err instanceof WalletLockedError
        ? "Wallet locked. Open Wallets [w] and press [u] to unlock it."
        : err instanceof Error
          ? err.message
          : "Unknown error";
      setSendResult({
        success: false,
        signature: null,
        mint: sourceToken.mint,
        recipient: recipientInput,
        amount: 0n,
        decimals: sourceToken.decimals,
        error: message,
      });
      setStep("result");
    } finally {
      sendInFlight.current = false;
    }
  }, [sourceToken, amountInput, recipientInput, rpc, onTransactionComplete]);

  /** Reset to initial state. */
  const resetSend = useCallback(() => {
    setStep("select-token");
    setSourceToken(null);
    setRecipientInput("");
    setAmountInput("");
    setSendResult(null);
    setError(null);
    setSelectedIndex(0);
    setBalances([]);
    setMetadata(new Map());
  }, []);

  // Reset stale state when switching wallets.
  useEffect(() => {
    resetSend();
  }, [walletAddress, resetSend]);

  // Input handling.
  useInput(
    (input, key) => {
      if (!isActive) return;

      // Escape — go back one step.
      if (key.escape) {
        if (step === "result") {
          resetSend();
        } else if (step === "preview") {
          setStep("enter-amount");
        } else if (step === "enter-amount") {
          setStep("enter-recipient");
          setAmountInput("");
        } else if (step === "enter-recipient") {
          setStep("select-token");
          setRecipientInput("");
          setSourceToken(null);
        }
        return;
      }

      // --- Select token ---
      if (step === "select-token") {
        if (input === "r") {
          loadBalances();
          return;
        }
        if (key.upArrow && balances.length > 0) {
          setSelectedIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow && balances.length > 0) {
          setSelectedIndex((i) => Math.min(balances.length - 1, i + 1));
          return;
        }
        if (key.return && balances.length > 0) {
          setSourceToken(balances[selectedIndex]);
          setSelectedIndex(0);
          setStep("enter-recipient");
          return;
        }
        return;
      }

      // --- Enter recipient ---
      if (step === "enter-recipient") {
        if (key.return && recipientInput.length > 0) {
          if (!isValidSolanaAddress(recipientInput)) {
            setError("Invalid Solana address.");
            return;
          }
          if (recipientInput === walletAddress) {
            setError("Cannot transfer to yourself.");
            return;
          }
          setError(null);
          setStep("enter-amount");
          return;
        }
        if (key.backspace || key.delete) {
          setRecipientInput((v) => v.slice(0, -1));
          setError(null);
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setRecipientInput((v) => v + input);
          return;
        }
        return;
      }

      // --- Enter amount ---
      if (step === "enter-amount") {
        if (key.return && amountInput.length > 0) {
          setStep("preview");
          return;
        }
        if (key.backspace || key.delete) {
          setAmountInput((v) => v.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta && input.length === 1) {
          if (/\d/.test(input) || (input === "." && !amountInput.includes(".")) || (input === "m" && amountInput === "")) {
            setAmountInput((v) => v + input);
          } else if (input === "a" && amountInput === "m") {
            setAmountInput("ma");
          } else if (input === "x" && amountInput === "ma") {
            setAmountInput("max");
          }
          return;
        }
        return;
      }

      // --- Preview ---
      if (step === "preview") {
        if (input === "c" || key.return) {
          doSend();
          return;
        }
        return;
      }

      // --- Result ---
      if (step === "result") {
        if (input === "y" && sendResult?.signature) {
          if (copyToClipboard(sendResult.signature)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
          return;
        }
        if (key.return || input === "n") {
          resetSend();
          return;
        }
        return;
      }
    },
    { isActive },
  );

  // Tick every 10s so the "updated X ago" label stays fresh.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  // --- No wallet ---
  if (!walletAddress) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Transfer</Text>
        <Box marginTop={1}>
          <Text color="yellow">No wallet configured. Press [w] to manage wallets.</Text>
        </Box>
      </Box>
    );
  }

  // --- Render ---
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold>Transfer</Text>
        {lastUpdated && step === "select-token" && <Text dimColor>updated {timeAgo(lastUpdated)}</Text>}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Step: Select token */}
      {step === "select-token" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Select token to transfer:</Text>
          {!loadingBalances && balances.length === 0 && !error && (
            <Box marginTop={1}><Text dimColor>No tokens found.</Text></Box>
          )}
          {balances.map((b, i) => {
            const isSelected = i === selectedIndex;
            const symbol = mintSymbol(b.mint);
            return (
              <Box key={b.mint}>
                <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                  {isSelected ? "> " : "  "}
                  {symbol.padEnd(10)}
                  {b.balance.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                </Text>
              </Box>
            );
          })}
          {balances.length > 0 && (
            <Box marginTop={1}>
              <Text dimColor>[up/down] navigate  [enter] select</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Step: Enter recipient */}
      {step === "enter-recipient" && sourceToken && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Token: </Text>
            <Text color="cyan">{mintSymbol(sourceToken.mint)}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Recipient address: </Text>
            <Text>{recipientInput}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] next  [esc] back</Text>
          </Box>
        </Box>
      )}

      {/* Step: Enter amount */}
      {step === "enter-amount" && sourceToken && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Token: </Text>
            <Text color="cyan">{mintSymbol(sourceToken.mint)}</Text>
          </Box>
          <Box>
            <Text dimColor>To: </Text>
            <Text>{truncateAddress(recipientInput)}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Available: </Text>
            <Text>
              {sourceToken.balance.toLocaleString("en-US", { maximumFractionDigits: 6 })}
              {" "}{mintSymbol(sourceToken.mint)}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Amount: </Text>
            <Text>{amountInput || " "}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[type] amount or &quot;max&quot;  [enter] preview  [esc] back</Text>
          </Box>
        </Box>
      )}

      {/* Step: Preview */}
      {step === "preview" && sourceToken && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Transfer Preview</Text>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text dimColor>{"Token:     "}</Text>
              <Text>{mintSymbol(sourceToken.mint)}</Text>
            </Box>
            <Box>
              <Text dimColor>{"Amount:    "}</Text>
              <Text color="green">
                {previewAmount()}
                {" "}{mintSymbol(sourceToken.mint)}
              </Text>
            </Box>
            <Box>
              <Text dimColor>{"To:        "}</Text>
              <Text>{recipientInput}</Text>
            </Box>
            {sourceToken.isNative && amountInput === "max" && (
              <Box marginTop={1}>
                <Text dimColor>Note: 0.005 SOL reserved for rent and fees.</Text>
              </Box>
            )}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[c/enter] confirm transfer  [esc] back</Text>
          </Box>
        </Box>
      )}

      {/* Step: Executing */}
      {step === "executing" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>{sendStatus}</Text>
        </Box>
      )}

      {/* Step: Result */}
      {step === "result" && sendResult && (
        <Box flexDirection="column" marginTop={1}>
          {sendResult.success ? (
            <>
              <Text color="green" bold>Transfer successful!</Text>
              <Box marginTop={1} flexDirection="column">
                <Box>
                  <Text dimColor>{"Sent:     "}</Text>
                  <Text>
                    {formatAmount(String(sendResult.amount), sendResult.decimals)}{" "}
                    {mintSymbol(sendResult.mint)}
                  </Text>
                </Box>
                <Box>
                  <Text dimColor>{"To:       "}</Text>
                  <Text>{truncateAddress(sendResult.recipient)}</Text>
                </Box>
                <Box>
                  <Text dimColor>{"Tx:       "}</Text>
                  <Link url={`${SOLSCAN_TX_URL}${sendResult.signature!}`}>
                    <Text>{truncateAddress(sendResult.signature!)}</Text>
                  </Link>
                </Box>
              </Box>
            </>
          ) : (
            <>
              <Text color="red" bold>Transfer failed</Text>
              <Box marginTop={1}>
                <Text color="red">{sendResult.error}</Text>
              </Box>
            </>
          )}
          <Box marginTop={1} gap={2}>
            <Text dimColor>
              [enter/n] new transfer{sendResult.success ? "  [y] copy tx" : ""}  [esc] back
            </Text>
            {copied && <Text color="green">copied!</Text>}
          </Box>
        </Box>
      )}
    </Box>
  );
}
