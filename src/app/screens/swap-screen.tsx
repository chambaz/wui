import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Link from "ink-link";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import UnlockPrompt from "../../components/unlock-prompt.js";
import {
  getActiveWalletEntry,
  getActiveWalletSigner,
  unlockWallet,
  WalletLockedError,
  WalletPassphraseError,
} from "../../wallet/index.js";
import { fetchAllBalances } from "../../portfolio/index.js";
import { fetchTokenMetadata, searchTokens } from "../../pricing/index.js";
import { DEFAULT_SLIPPAGE_PCT, getSwapQuote, executeSwap } from "../../swap/index.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import { truncateAddress, formatAmount, parseDecimalAmount, timeAgo } from "../../lib/format.js";
import type { TokenBalance, TokenMetadata } from "../../types/portfolio.js";
import type { SwapQuote, SwapResult } from "../../types/swap.js";

const SOLSCAN_TX_URL = "https://solscan.io/tx/";

type SwapStep =
  | "select-source"
  | "select-dest"
  | "enter-amount"
  | "enter-slippage"
  | "preview"
  | "unlock"
  | "executing"
  | "result";

interface SwapScreenProps {
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
  /** Called when a swap completes successfully. */
  onTransactionComplete: () => void;
}

export default function SwapScreen({
  walletAddress,
  rpc,
  jupiterApiKey,
  isActive,
  onCapturingInputChange,
  preSelectedMint,
  onPreSelectedMintConsumed,
  refreshKey,
  onTransactionComplete,
}: SwapScreenProps) {
  // --- State ---
  const [step, setStep] = useState<SwapStep>("select-source");
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [metadata, setMetadata] = useState<Map<string, TokenMetadata>>(new Map());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sourceToken, setSourceToken] = useState<TokenBalance | null>(null);
  const [destMint, setDestMint] = useState<string>("");
  const [destToken, setDestToken] = useState<TokenMetadata | null>(null);
  const [destSearch, setDestSearch] = useState("");
  const [destResults, setDestResults] = useState<TokenMetadata[]>([]);
  const [destSearchIndex, setDestSearchIndex] = useState(0);
  const [amountInput, setAmountInput] = useState("");
  const [slippageInput, setSlippageInput] = useState(DEFAULT_SLIPPAGE_PCT);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [swapStatus, setSwapStatus] = useState("Preparing...");
  const [swapResult, setSwapResult] = useState<SwapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockInput, setUnlockInput] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockWalletId, setUnlockWalletId] = useState<string | null>(null);
  const [unlockWalletLabel, setUnlockWalletLabel] = useState("Active Wallet");
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [searchingTokens, setSearchingTokens] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const fetchInFlight = useRef(false);

  // Notify parent when text input capture state changes.
  const isCapturing =
    step === "select-dest" ||
    step === "enter-amount" ||
    step === "enter-slippage" ||
    step === "unlock";
  useEffect(() => {
    onCapturingInputChange(isCapturing);
  }, [isCapturing, onCapturingInputChange]);

  // --- Data loading ---

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

  // Auto-load balances when entering the source selection step.
  useEffect(() => {
    if (step === "select-source" && balances.length === 0 && !loadingBalances && !error && walletAddress) {
      loadBalances();
    }
  }, [step, balances.length, loadingBalances, error, walletAddress, loadBalances]);

  // Handle pre-selected mint from portfolio.
  useEffect(() => {
    if (preSelectedMint && balances.length > 0 && step === "select-source") {
      const token = balances.find((b) => b.mint === preSelectedMint);
      if (token) {
        setSourceToken(token);
        setStep("select-dest");
      }
      onPreSelectedMintConsumed();
    }
  }, [preSelectedMint, balances, step, onPreSelectedMintConsumed]);

  // External refresh trigger (e.g. after a swap, transfer, or stake).
  useEffect(() => {
    if (isActive && refreshKey > 0 && step === "select-source") {
      loadBalances();
    }
  }, [isActive, refreshKey, step, loadBalances]);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, []);

  const searchDestToken = useCallback((query: string) => {
    if (searchDebounce.current) {
      clearTimeout(searchDebounce.current);
    }

    if (query.length < 2) {
      setDestResults([]);
      return;
    }

    searchDebounce.current = setTimeout(async () => {
      setSearchingTokens(true);
      try {
        const results = await searchTokens(query, jupiterApiKey);
        setDestResults(results);
        setDestSearchIndex(0);
      } catch {
        // Silently fail — user can retry.
      } finally {
        setSearchingTokens(false);
      }
    }, 300);
  }, [jupiterApiKey]);

  const fetchQuote = useCallback(async () => {
    if (!sourceToken || !destMint || !amountInput) return;

    setLoadingQuote(true);
    setError(null);
    try {
      // Parse amount to raw units using string math to avoid floating-point errors.
      let amountNum: bigint;
      if (amountInput === "max") {
        amountNum = sourceToken.rawBalance;
      } else {
        amountNum = parseDecimalAmount(amountInput, sourceToken.decimals) ?? 0n;
        if (amountNum <= 0n) {
          setError("Enter a valid amount greater than 0.");
          setLoadingQuote(false);
          return;
        }
      }

      // Multiply by 10 twice to avoid IEEE 754 floating-point errors (e.g. 0.1 * 100 = 10.000...02).
      const slippagePct = parseFloat(slippageInput || DEFAULT_SLIPPAGE_PCT);
      const slippageBps = Math.round(slippagePct * 10) * 10;

      const q = await getSwapQuote(
        {
          inputMint: sourceToken.mint,
          outputMint: destMint,
          amount: String(amountNum),
          slippageBps,
        },
        jupiterApiKey,
      );
      setQuote(q);
      setStep("preview");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to get quote");
    } finally {
      setLoadingQuote(false);
    }
  }, [sourceToken, destMint, amountInput, slippageInput, jupiterApiKey]);

  const doSwap = useCallback(async () => {
    if (!quote) return;

    try {
      const signer = await getActiveWalletSigner();
      if (!signer) {
        throw new Error("No active wallet signer available.");
      }

      setStep("executing");
      setSwapStatus("Preparing...");
      const result = await executeSwap(quote, signer, rpc, jupiterApiKey, setSwapStatus);
      setSwapResult(result);
      setStep("result");
      if (result.success) onTransactionComplete();
    } catch (err: unknown) {
      if (err instanceof WalletLockedError) {
        const activeWallet = getActiveWalletEntry();
        setUnlockWalletId(activeWallet?.id ?? null);
        setUnlockWalletLabel(activeWallet?.label ?? "Active Wallet");
        setUnlockInput("");
        setUnlockError(null);
        setUnlocking(false);
        setStep("unlock");
        return;
      }

      setSwapResult({
        success: false,
        signature: null,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        error: err instanceof Error ? err.message : "Unknown swap error",
      });
      setStep("result");
    }
  }, [quote, rpc, jupiterApiKey, onTransactionComplete]);

  const submitUnlock = useCallback(async () => {
    if (!unlockWalletId || unlocking || !quote) {
      return;
    }

    setUnlocking(true);
    setUnlockError(null);

    try {
      await unlockWallet(unlockWalletId, unlockInput);
      setUnlockInput("");
      setUnlocking(false);
      setStep("preview");
      void doSwap();
    } catch (err: unknown) {
      if (err instanceof WalletPassphraseError || (err instanceof Error && err.message === "Incorrect passphrase.")) {
        setUnlockError("Incorrect passphrase.");
        setUnlocking(false);
        return;
      }

      setUnlocking(false);
      setUnlockInput("");
      setSwapResult({
        success: false,
        signature: null,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        error: err instanceof Error ? err.message : "Failed to unlock wallet.",
      });
      setStep("result");
    }
  }, [unlockWalletId, unlocking, quote, unlockInput, doSwap]);

  // --- Reset ---

  const resetSwap = useCallback(() => {
    setStep("select-source");
    setSourceToken(null);
    setDestMint("");
    setDestToken(null);
    setDestSearch("");
    setDestResults([]);
    setDestSearchIndex(0);
    setAmountInput("");
    setSlippageInput(DEFAULT_SLIPPAGE_PCT);
    setQuote(null);
    setSwapResult(null);
    setError(null);
    setUnlockInput("");
    setUnlockError(null);
    setUnlocking(false);
    setUnlockWalletId(null);
    setUnlockWalletLabel("Active Wallet");
    setSelectedIndex(0);
    setBalances([]);
    setMetadata(new Map());
  }, []);

  // Reset stale state when switching wallets.
  useEffect(() => {
    resetSwap();
  }, [walletAddress, resetSwap]);

  // --- Input handling ---

  useInput(
    (input, key) => {
      if (!isActive) return;

      // Global escape — go back one step or reset.
      if (key.escape) {
        if (step === "unlock") {
          setUnlockInput("");
          setUnlockError(null);
          setUnlocking(false);
          setStep("preview");
        } else if (step === "result") {
          resetSwap();
        } else if (step === "preview") {
          setStep("enter-slippage");
          setQuote(null);
          // Preserve the user's slippage value — do not reset here.
        } else if (step === "enter-slippage") {
          setStep("enter-amount");
          setSlippageInput(DEFAULT_SLIPPAGE_PCT);
        } else if (step === "enter-amount") {
          setStep("select-dest");
          setAmountInput("");
        } else if (step === "select-dest") {
          setStep("select-source");
          setDestSearch("");
          setDestResults([]);
          setDestMint("");
          setDestToken(null);
        }
        return;
      }

       if (step === "unlock") {
        if (key.return && unlockInput.length > 0) {
          void submitUnlock();
          return;
        }
        if (key.backspace || key.delete) {
          if (!unlocking) {
            setUnlockInput((v) => v.slice(0, -1));
            setUnlockError(null);
          }
          return;
        }
        if (input && !key.ctrl && !key.meta && !unlocking) {
          setUnlockInput((v) => v + input);
          setUnlockError(null);
          return;
        }
        return;
      }

      // --- Select source token ---
      if (step === "select-source") {
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
          setStep("select-dest");
          return;
        }
        return;
      }

      // --- Select destination token ---
      if (step === "select-dest") {
        const maxVisible = Math.min(destResults.length, 10);
        if (key.upArrow && maxVisible > 0) {
          setDestSearchIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow && maxVisible > 0) {
          setDestSearchIndex((i) => Math.min(maxVisible - 1, i + 1));
          return;
        }
        if (key.return && maxVisible > 0) {
          const selected = destResults[destSearchIndex];
          setDestMint(selected.mint);
          setDestToken(selected);
          setStep("enter-amount");
          return;
        }
        if (key.backspace || key.delete) {
          const next = destSearch.slice(0, -1);
          setDestSearch(next);
          searchDestToken(next);
          return;
        }
        // Printable characters for search (supports paste).
        if (input && !key.ctrl && !key.meta) {
          const next = destSearch + input;
          setDestSearch(next);
          searchDestToken(next);
          return;
        }
        return;
      }

      // --- Enter amount ---
      if (step === "enter-amount") {
        if (key.return && amountInput.length > 0) {
          setStep("enter-slippage");
          return;
        }
        if (key.backspace || key.delete) {
          setAmountInput((v) => v.slice(0, -1));
          return;
        }
        // Allow digits, dot (once), and "max".
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

      // --- Enter max slippage ---
      if (step === "enter-slippage") {
        if (key.return) {
          const val = parseFloat(slippageInput);
          if (isNaN(val) || val < 0.01 || val > 50) {
            setError("Enter a slippage between 0.01% and 50%.");
            return;
          }
          setError(null);
          fetchQuote();
          return;
        }
        if (key.backspace || key.delete) {
          setSlippageInput((v) => v.slice(0, -1));
          setError(null);
          return;
        }
        if (input && !key.ctrl && !key.meta && input.length === 1) {
          if (/\d/.test(input) || (input === "." && !slippageInput.includes("."))) {
            setSlippageInput((v) => v + input);
          }
          return;
        }
        return;
      }

      // --- Preview ---
      if (step === "preview") {
        if (input === "c" || key.return) {
          doSwap();
          return;
        }
        return;
      }

      // --- Result ---
      if (step === "result") {
        if (input === "y" && swapResult?.signature) {
          if (copyToClipboard(swapResult.signature)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
          return;
        }
        if (key.return || input === "n") {
          resetSwap();
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
        <Text bold>Swap</Text>
        <Box marginTop={1}>
          <Text color="yellow">No wallet configured. Press [w] to manage wallets.</Text>
        </Box>
      </Box>
    );
  }

  // --- Render by step ---

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold>Swap</Text>
        {lastUpdated && step === "select-source" && <Text dimColor>updated {timeAgo(lastUpdated)}</Text>}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Step: Select source token */}
      {step === "select-source" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Select token to swap from:</Text>
          {!loadingBalances && balances.length === 0 && !error && (
            <Box marginTop={1}>
              <Text dimColor>No tokens found.</Text>
            </Box>
          )}
          {balances.map((b, i) => {
            const isSelected = i === selectedIndex;
            const meta = metadata.get(b.mint);
            const symbol = meta?.symbol ?? truncateAddress(b.mint);
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

      {/* Step: Select destination token */}
      {step === "select-dest" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>From: </Text>
            <Text color="cyan">
              {metadata.get(sourceToken!.mint)?.symbol ?? truncateAddress(sourceToken!.mint)}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Search destination token: </Text>
            <Text>{destSearch}</Text>
            <Text dimColor>_</Text>
          </Box>
          {searchingTokens && (
            <Box marginTop={1}>
              <Text dimColor>Searching...</Text>
            </Box>
          )}
          {destResults.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {destResults.slice(0, 10).map((token, i) => {
                const isSelected = i === destSearchIndex;
                return (
                  <Box key={token.mint}>
                    <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                      {isSelected ? "> " : "  "}
                      {token.symbol.padEnd(10)}
                      <Text dimColor>{token.name}</Text>
                    </Text>
                  </Box>
                );
              })}
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>[type] search  [up/down] navigate  [enter] select  [esc] back</Text>
          </Box>
        </Box>
      )}

      {/* Step: Enter amount */}
      {step === "enter-amount" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>From: </Text>
            <Text color="cyan">
              {metadata.get(sourceToken!.mint)?.symbol ?? truncateAddress(sourceToken!.mint)}
            </Text>
          </Box>
          <Box>
            <Text dimColor>To: </Text>
            <Text color="cyan">
              {destToken?.symbol ?? truncateAddress(destMint)}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Available: </Text>
            <Text>
              {sourceToken!.balance.toLocaleString("en-US", { maximumFractionDigits: 6 })}
              {" "}
              {metadata.get(sourceToken!.mint)?.symbol ?? ""}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Amount: </Text>
            <Text>{amountInput || " "}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[type] amount or &quot;max&quot;  [enter] next  [esc] back</Text>
          </Box>
        </Box>
      )}

      {/* Step: Enter max slippage */}
      {step === "enter-slippage" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>From: </Text>
            <Text color="cyan">
              {metadata.get(sourceToken!.mint)?.symbol ?? truncateAddress(sourceToken!.mint)}
            </Text>
          </Box>
          <Box>
            <Text dimColor>To: </Text>
            <Text color="cyan">
              {destToken?.symbol ?? truncateAddress(destMint)}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Max slippage (%): </Text>
            <Text>{slippageInput}</Text>
            <Text dimColor>_</Text>
          </Box>
          {loadingQuote && (
            <Box marginTop={1}>
              <Text dimColor>Fetching quote...</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>[enter] get quote  [esc] back</Text>
          </Box>
        </Box>
      )}

      {/* Step: Preview quote */}
      {step === "preview" && quote && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Swap Preview</Text>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text dimColor>{"Sell:      "}</Text>
              <Text>
                {formatAmount(quote.inAmount, sourceToken!.decimals)}{" "}
                {metadata.get(quote.inputMint)?.symbol ?? truncateAddress(quote.inputMint)}
              </Text>
            </Box>
            <Box>
              <Text dimColor>{"Receive:   "}</Text>
              <Text color="green">
                {formatAmount(quote.outAmount, destToken?.decimals ?? 6)}{" "}
                {destToken?.symbol ?? truncateAddress(quote.outputMint)}
              </Text>
            </Box>
            <Box>
              <Text dimColor>{"Min out:   "}</Text>
              <Text>
                {formatAmount(quote.otherAmountThreshold, destToken?.decimals ?? 6)}
              </Text>
            </Box>
            <Box>
              <Text dimColor>{"Max slip:  "}</Text>
              <Text>{(quote.slippageBps / 100).toFixed(2)}%</Text>
            </Box>
            <Box>
              <Text dimColor>{"Impact:    "}</Text>
              <Text
                color={Number(quote.priceImpactPct) > 1 ? "red" : Number(quote.priceImpactPct) > 0.1 ? "yellow" : undefined}
              >
                {Number(quote.priceImpactPct).toFixed(4)}%
              </Text>
            </Box>
            {quote.routePlan.length > 0 && (
              <Box marginTop={1} flexDirection="column">
                <Text dimColor>Route:</Text>
                {quote.routePlan.map((hop, i) => (
                  <Box key={i} paddingLeft={2}>
                    <Text dimColor>
                      {hop.ammLabel} ({hop.percent}%)
                    </Text>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[c/enter] confirm swap  [esc] back</Text>
          </Box>
        </Box>
      )}

      {/* Step: Executing */}
      {step === "executing" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>{swapStatus}</Text>
        </Box>
      )}

      {step === "unlock" && (
        <UnlockPrompt
          walletLabel={unlockWalletLabel}
          value={unlockInput}
          error={unlockError}
          submitting={unlocking}
        />
      )}

      {/* Step: Result */}
      {step === "result" && swapResult && (
        <Box flexDirection="column" marginTop={1}>
          {swapResult.success ? (
            <>
              <Text color="green" bold>Swap successful!</Text>
              <Box marginTop={1} flexDirection="column">
                <Box>
                  <Text dimColor>{"Sold:     "}</Text>
                  <Text>
                    {formatAmount(swapResult.inAmount, sourceToken?.decimals ?? 9)}{" "}
                    {metadata.get(swapResult.inputMint)?.symbol ?? truncateAddress(swapResult.inputMint)}
                  </Text>
                </Box>
                <Box>
                  <Text dimColor>{"Received: "}</Text>
                  <Text color="green">
                    {formatAmount(swapResult.outAmount, destToken?.decimals ?? 6)}{" "}
                    {destToken?.symbol ?? truncateAddress(swapResult.outputMint)}
                  </Text>
                </Box>
                <Box>
                  <Text dimColor>{"Tx:       "}</Text>
                  <Link url={`${SOLSCAN_TX_URL}${swapResult.signature!}`}>
                    <Text>{truncateAddress(swapResult.signature!)}</Text>
                  </Link>
                </Box>
              </Box>
            </>
          ) : (
            <>
              <Text color="red" bold>Swap failed</Text>
              <Box marginTop={1}>
                <Text color="red">{swapResult.error}</Text>
              </Box>
            </>
          )}
          <Box marginTop={1} gap={2}>
            <Text dimColor>
              [enter/n] new swap{swapResult.success ? "  [y] copy tx" : ""}  [esc] back
            </Text>
            {copied && <Text color="green">copied!</Text>}
          </Box>
        </Box>
      )}
    </Box>
  );
}
