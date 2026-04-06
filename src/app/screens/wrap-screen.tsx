import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import Link from "ink-link";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import UnlockPrompt from "../../components/unlock-prompt.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import { formatAmount, formatBalance, parseDecimalAmount, timeAgo, truncateAddress } from "../../lib/format.js";
import type { SelectedAssetRef } from "../../types/portfolio.js";
import type { WrapAction, WrapAvailability, WrapRequest, WrapResult } from "../../types/wrap.js";
import { getActiveWalletEntry, getActiveWalletSigner, unlockWallet, WalletLockedError, WalletPassphraseError } from "../../wallet/index.js";
import { executeWrapAction, getMaxWrappableLamports, getWrapAvailability } from "../../wrap/index.js";

const SOLSCAN_TX_URL = "https://solscan.io/tx/";

type WrapStep =
  | "choose-action"
  | "enter-amount"
  | "preview"
  | "unlock"
  | "executing"
  | "result";

interface WrapScreenProps {
  walletAddress: string | null;
  rpc: Rpc<SolanaRpcApi>;
  isActive: boolean;
  entryAsset: SelectedAssetRef | null;
  onCapturingInputChange: (capturing: boolean) => void;
  onTransactionComplete: () => void;
  onExit: () => void;
}

function preferredAction(entryAsset: SelectedAssetRef | null): WrapAction {
  return entryAsset?.assetKind === "wrapped-sol" ? "unwrap" : "wrap";
}

function actionLabel(action: WrapAction): string {
  return action === "wrap" ? "Wrap SOL" : "Unwrap WSOL";
}

function resultVerb(action: WrapAction): string {
  return action === "wrap" ? "Wrapped" : "Unwrapped";
}

function missingStandardWrapMessage(availability: WrapAvailability): string {
  if (availability.extraWrappedSolRawBalance > 0n) {
    return "Unwrap here only supports the standard Wrapped SOL account. This wallet's Wrapped SOL is held in a different token account.";
  }

  return "No standard Wrapped SOL account found.";
}

export default function WrapScreen({
  walletAddress,
  rpc,
  isActive,
  entryAsset,
  onCapturingInputChange,
  onTransactionComplete,
  onExit,
}: WrapScreenProps) {
  const [step, setStep] = useState<WrapStep>("choose-action");
  const [action, setAction] = useState<WrapAction>(preferredAction(entryAsset));
  const [availability, setAvailability] = useState<WrapAvailability | null>(null);
  const [loading, setLoading] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [status, setStatus] = useState("Preparing...");
  const [result, setResult] = useState<WrapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockInput, setUnlockInput] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockWalletId, setUnlockWalletId] = useState<string | null>(null);
  const [unlockWalletLabel, setUnlockWalletLabel] = useState("Active Wallet");
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const fetchInFlight = useRef(false);
  const executeInFlight = useRef(false);

  const isCapturing = step === "enter-amount" || step === "unlock";
  useEffect(() => {
    onCapturingInputChange(isCapturing);
  }, [isCapturing, onCapturingInputChange]);

  const resetFlow = useCallback((nextAction: WrapAction) => {
    setStep("choose-action");
    setAction(nextAction);
    setAmountInput("");
    setStatus("Preparing...");
    setResult(null);
    setError(null);
    setUnlockInput("");
    setUnlockError(null);
    setUnlocking(false);
    setUnlockWalletId(null);
    setUnlockWalletLabel("Active Wallet");
    setCopied(false);
  }, []);

  const loadAvailability = useCallback(async (options?: {
    autoRedirectToWrap?: boolean;
    preferredAction?: WrapAction;
  }) => {
    if (!walletAddress || fetchInFlight.current) return;
    fetchInFlight.current = true;
    setLoading(true);

    try {
      const nextAvailability = await getWrapAvailability(rpc, walletAddress);
      setAvailability(nextAvailability);
      setLastUpdated(new Date());
      setError(null);

      if (
        options?.autoRedirectToWrap
        && !nextAvailability.wrappedSolAccountExists
        && options.preferredAction !== "unwrap"
      ) {
        setAction("wrap");
        setStep("enter-amount");
      }
    } catch (err: unknown) {
      setAvailability(null);
      setError(err instanceof Error ? err.message : "Failed to load wrap balances.");
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, [rpc, walletAddress]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    resetFlow(preferredAction(entryAsset));
    const nextPreferredAction = preferredAction(entryAsset);
    void loadAvailability({
      autoRedirectToWrap: true,
      preferredAction: nextPreferredAction,
    });
  }, [isActive, entryAsset, loadAvailability, resetFlow]);

  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  const resolveRequest = useCallback((): WrapRequest | null => {
    if (!availability) {
      setError("Wrap balances are still loading.");
      return null;
    }

      if (action === "unwrap") {
        if (!availability.wrappedSolAccountExists) {
          setError(missingStandardWrapMessage(availability));
          return null;
        }
        if (availability.wrappedSolRawBalance <= 0n) {
          setError("No Wrapped SOL available in the standard account.");
        return null;
      }

      return { action, amount: availability.wrappedSolRawBalance };
    }

    let amount: bigint | null;
    if (amountInput === "max") {
      amount = getMaxWrappableLamports(availability);
    } else {
      amount = parseDecimalAmount(amountInput, 9);
    }

    if (amount === null || amount <= 0n) {
      setError("Enter a valid amount greater than 0.");
      return null;
    }

    const maxWrappableLamports = getMaxWrappableLamports(availability);
    if (amount > maxWrappableLamports) {
      setError("Amount exceeds available SOL after reserve requirements.");
      return null;
    }

    return { action, amount };
  }, [action, amountInput, availability]);

  const openUnlockPrompt = useCallback(() => {
    const activeWallet = getActiveWalletEntry();
    setUnlockWalletId(activeWallet?.id ?? null);
    setUnlockWalletLabel(activeWallet?.label ?? "Active Wallet");
    setUnlockInput("");
    setUnlockError(null);
    setUnlocking(false);
    setStep("unlock");
  }, []);

  const executeAction = useCallback(async () => {
    if (executeInFlight.current) return;
    const request = resolveRequest();
    if (!request) return;

    executeInFlight.current = true;

    try {
      const signer = await getActiveWalletSigner();
      if (!signer) {
        throw new Error("No active wallet signer available.");
      }

      setStep("executing");
      setStatus("Preparing...");
      const nextResult = await executeWrapAction(request, signer, rpc, setStatus);
      setResult(nextResult);
      setStep("result");

      if (nextResult.success) {
        onTransactionComplete();
        void loadAvailability();
      }
    } catch (err: unknown) {
      if (err instanceof WalletLockedError) {
        openUnlockPrompt();
        return;
      }

      setResult({
        success: false,
        signature: null,
        action: request.action,
        amount: request.amount,
        error: err instanceof Error ? err.message : "Unknown error",
      });
      setStep("result");
    } finally {
      executeInFlight.current = false;
    }
  }, [loadAvailability, onTransactionComplete, openUnlockPrompt, resolveRequest, rpc]);

  const submitUnlock = useCallback(async () => {
    if (!unlockWalletId || unlocking) return;

    setUnlocking(true);
    setUnlockError(null);

    try {
      await unlockWallet(unlockWalletId, unlockInput);
      setUnlockInput("");
      setUnlocking(false);
      setStep("preview");
      void executeAction();
    } catch (err: unknown) {
      if (err instanceof WalletPassphraseError || (err instanceof Error && err.message === "Incorrect passphrase.")) {
        setUnlockError("Incorrect passphrase.");
        setUnlocking(false);
        return;
      }

      setUnlocking(false);
      setUnlockInput("");
      setResult({
        success: false,
        signature: null,
        action,
        amount: 0n,
        error: err instanceof Error ? err.message : "Failed to unlock wallet.",
      });
      setStep("result");
    }
  }, [action, executeAction, unlockInput, unlockWalletId, unlocking]);

  const previewAmount = action === "wrap"
    ? amountInput === "max" && availability
      ? formatAmount(String(getMaxWrappableLamports(availability)), 9)
      : amountInput
    : availability
      ? formatAmount(String(availability.wrappedSolRawBalance), 9)
      : "";

  useInput(
    (input, key) => {
      if (!isActive) return;

      if (step === "choose-action" && input === "r") {
        void loadAvailability();
        return;
      }

      if (step === "enter-amount" && input === "r") {
        void loadAvailability();
        return;
      }

      if (key.escape) {
        if (step === "unlock") {
          setUnlockInput("");
          setUnlockError(null);
          setUnlocking(false);
          setStep("preview");
        } else if (step === "result" || step === "choose-action") {
          onExit();
        } else if (step === "preview") {
          if (action === "wrap") {
            setStep("enter-amount");
          } else if (availability?.wrappedSolAccountExists) {
            setStep("choose-action");
          } else {
            setStep("enter-amount");
          }
        } else if (step === "enter-amount") {
          setAmountInput("");
          if (availability?.wrappedSolAccountExists) {
            setStep("choose-action");
          } else {
            onExit();
          }
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
            setUnlockInput((value) => value.slice(0, -1));
            setUnlockError(null);
          }
          return;
        }
        if (input && !key.ctrl && !key.meta && !unlocking) {
          setUnlockInput((value) => value + input);
          setUnlockError(null);
        }
        return;
      }

      if (step === "choose-action") {
        if (key.upArrow || key.downArrow) {
          setAction((value) => value === "wrap" ? "unwrap" : "wrap");
          setError(null);
          return;
        }

        if (key.return) {
          setError(null);
          if (action === "wrap") {
            setStep("enter-amount");
            return;
          }

          if (!resolveRequest()) {
            return;
          }

          setStep("preview");
        }
        return;
      }

      if (step === "enter-amount") {
        if (key.return && amountInput.length > 0) {
          if (!resolveRequest()) {
            return;
          }

          setStep("preview");
          return;
        }

        if (key.backspace || key.delete) {
          setAmountInput((value) => value.slice(0, -1));
          setError(null);
          return;
        }

        if (input && !key.ctrl && !key.meta && input.length === 1) {
          if (/\d/.test(input) || (input === "." && !amountInput.includes(".")) || (input === "m" && amountInput === "")) {
            setAmountInput((value) => value + input);
          } else if (input === "a" && amountInput === "m") {
            setAmountInput("ma");
          } else if (input === "x" && amountInput === "ma") {
            setAmountInput("max");
          }
          setError(null);
        }
        return;
      }

      if (step === "preview") {
        if (input === "c" || key.return) {
          void executeAction();
        }
        return;
      }

      if (step === "result") {
        if (input === "y" && result?.signature) {
          if (copyToClipboard(result.signature)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
          return;
        }

        if (key.return || input === "n") {
          onExit();
        }
      }
    },
    { isActive },
  );

  if (!walletAddress) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Wrap SOL</Text>
        <Box marginTop={1}>
          <Text color="yellow">No wallet configured. Press [w] to manage wallets.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold>Wrap SOL</Text>
        {lastUpdated && <Text dimColor>updated {timeAgo(lastUpdated)}</Text>}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {loading && (step === "choose-action" || step === "enter-amount") && (
        <Box marginTop={1}>
          <Text dimColor>Loading wrap balances...</Text>
        </Box>
      )}

      {availability && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text dimColor>{"Native SOL:   "}</Text>
            <Text>{formatBalance(availability.nativeSolBalance, 9)} SOL</Text>
          </Box>
          <Box>
            <Text dimColor>{"Standard WSOL:"}</Text>
            <Text> {formatBalance(availability.wrappedSolBalance, 9)} WSOL</Text>
          </Box>
          <Box>
            <Text dimColor>{"WSOL Account:  "}</Text>
            <Text>{truncateAddress(availability.wrappedSolAccountAddress)}</Text>
          </Box>
        </Box>
      )}

      {step === "choose-action" && availability && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Choose action:</Text>
          <Box marginTop={1} flexDirection="column">
            {(["wrap", "unwrap"] as WrapAction[]).map((option) => {
              const isSelected = option === action;
              return (
                <Box key={option}>
                  <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                    {isSelected ? "> " : "  "}
                    {actionLabel(option)}
                  </Text>
                </Box>
              );
            })}
          </Box>
          {!availability.wrappedSolAccountExists && availability.extraWrappedSolRawBalance > 0n && (
            <Box marginTop={1}>
              <Text color="yellow">{missingStandardWrapMessage(availability)}</Text>
            </Box>
          )}
          {availability.extraWrappedSolRawBalance > 0n && (
            <Box marginTop={1}>
              <Text dimColor>
                Note: additional WSOL exists outside the standard account. Unwrap only affects the standard account.
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>[up/down] navigate  [enter] select  [r] refresh  [esc] back</Text>
          </Box>
        </Box>
      )}

      {step === "enter-amount" && availability && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Action: </Text>
            <Text color="cyan">Wrap SOL</Text>
          </Box>
          <Box>
            <Text dimColor>Max wrappable: </Text>
            <Text>{formatAmount(String(getMaxWrappableLamports(availability)), 9)} SOL</Text>
          </Box>
          {!availability.wrappedSolAccountExists && (
            <Box>
              <Text dimColor>Note: includes reserve for creating the standard WSOL account.</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Amount: </Text>
            <Text>{amountInput || " "}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[type] amount or "max"  [enter] preview  [esc] back</Text>
          </Box>
        </Box>
      )}

      {step === "preview" && availability && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{action === "wrap" ? "Wrap Preview" : "Unwrap Preview"}</Text>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text dimColor>{"Action:    "}</Text>
              <Text>{actionLabel(action)}</Text>
            </Box>
            <Box>
              <Text dimColor>{"Amount:    "}</Text>
              <Text color="green">{previewAmount} SOL</Text>
            </Box>
            <Box>
              <Text dimColor>{"Account:   "}</Text>
              <Text>{availability.wrappedSolAccountAddress}</Text>
            </Box>
            {action === "wrap" && !availability.wrappedSolAccountExists && (
              <Box marginTop={1}>
                <Text dimColor>Note: this will create your standard Wrapped SOL account before syncing WSOL.</Text>
              </Box>
            )}
            {action === "unwrap" && (
              <Box marginTop={1}>
                <Text dimColor>Note: this closes the standard Wrapped SOL account and returns SOL to your wallet.</Text>
              </Box>
            )}
            {availability.extraWrappedSolRawBalance > 0n && action === "unwrap" && (
              <Box marginTop={1}>
                <Text dimColor>Additional non-standard WSOL accounts will remain untouched.</Text>
              </Box>
            )}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[c/enter] confirm  [esc] back</Text>
          </Box>
        </Box>
      )}

      {step === "executing" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>{status}</Text>
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

      {step === "result" && result && (
        <Box flexDirection="column" marginTop={1}>
          {result.success ? (
            <>
              <Text color="green" bold>
                {result.action === "wrap" ? "Wrap successful!" : "Unwrap successful!"}
              </Text>
              <Box marginTop={1} flexDirection="column">
                <Box>
                  <Text dimColor>{`${resultVerb(result.action)}: `}</Text>
                  <Text>{formatAmount(String(result.amount), 9)} SOL</Text>
                </Box>
                <Box>
                  <Text dimColor>{"Tx:        "}</Text>
                  <Link url={`${SOLSCAN_TX_URL}${result.signature!}`}>
                    <Text>{truncateAddress(result.signature!)}</Text>
                  </Link>
                </Box>
              </Box>
            </>
          ) : (
            <>
              <Text color="red" bold>{result.action === "wrap" ? "Wrap failed" : "Unwrap failed"}</Text>
              <Box marginTop={1}>
                <Text color="red">{result.error}</Text>
              </Box>
            </>
          )}
          <Box marginTop={1} gap={2}>
            <Text dimColor>
              [enter/n] back to portfolio{result.success ? "  [y] copy tx" : ""}  [esc] back
            </Text>
            {copied && <Text color="green">copied!</Text>}
          </Box>
        </Box>
      )}
    </Box>
  );
}
