import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import Link from "ink-link";
import { truncateAddress, formatBalance } from "../../lib/format.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import {
  STAKE_PROVIDERS,
  fetchStakeAccounts,
  createNativeStake,
  depositToStakePool,
  deactivateStake,
  withdrawStake,
  loadCustomValidators,
  saveCustomValidator,
} from "../../staking/index.js";
import { isValidSolanaAddress } from "../../transfer/index.js";
import { getActiveWalletSigner } from "../../wallet/index.js";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import type { StakeAccountInfo, StakeTarget } from "../../types/staking.js";

const SOLSCAN_TX_URL = "https://solscan.io/tx/";

type Step =
  | "list"
  | "choose-type"
  | "choose-provider"
  | "choose-validator"
  | "add-validator-vote"
  | "add-validator-label"
  | "amount"
  | "preview"
  | "executing"
  | "result";

interface StakingScreenProps {
  walletAddress: string | null;
  rpc: Rpc<SolanaRpcApi>;
  isActive: boolean;
  onCapturingInputChange: (capturing: boolean) => void;
  onTransactionComplete: () => void;
}

function statusColor(status: string): string {
  switch (status) {
    case "active": return "green";
    case "activating": return "cyan";
    case "deactivating": return "yellow";
    case "deactivated": return "red";
    default: return "gray";
  }
}

export default function StakingScreen({
  walletAddress,
  rpc,
  isActive,
  onCapturingInputChange,
  onTransactionComplete,
}: StakingScreenProps) {
  // --- List state ---
  const [stakeAccounts, setStakeAccounts] = useState<StakeAccountInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [copied, setCopied] = useState(false);
  const fetchInFlight = useRef(false);

  // --- New stake flow state ---
  const [step, setStep] = useState<Step>("list");
  const [stakeTarget, setStakeTarget] = useState<StakeTarget | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [executingStatus, setExecutingStatus] = useState("");
  const [resultSignature, setResultSignature] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);

  // --- Add custom validator state ---
  const [newValidatorVote, setNewValidatorVote] = useState("");
  const [newValidatorLabel, setNewValidatorLabel] = useState("");

  // Capture input when in any flow step or detail drawer is open.
  const isCapturing = step !== "list" || showDetail;
  useEffect(() => {
    onCapturingInputChange(isCapturing);
  }, [isCapturing, onCapturingInputChange]);

  // --- Data fetching ---

  const fetchData = useCallback(async () => {
    if (!walletAddress || fetchInFlight.current) return;
    fetchInFlight.current = true;
    setLoading(true);
    try {
      const accounts = await fetchStakeAccounts(rpc, walletAddress);
      setStakeAccounts(accounts);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch stake accounts");
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, [rpc, walletAddress]);

  useEffect(() => {
    if (isActive && walletAddress && step === "list") {
      fetchData();
    }
  }, [isActive, walletAddress, fetchData, step]);

  // --- Reset flow ---

  const resetFlow = useCallback(() => {
    setStep("list");
    setStakeTarget(null);
    setAmountInput("");
    setExecutingStatus("");
    setResultSignature(null);
    setResultError(null);
    setOptionIndex(0);
    setNewValidatorVote("");
    setNewValidatorLabel("");
    setError(null);
  }, []);

  // --- Execute staking ---

  const executeStake = useCallback(async () => {
    if (!stakeTarget || !amountInput) return;
    setStep("executing");
    let succeeded = false;

    try {
      const signer = await getActiveWalletSigner();
      if (!signer) {
        throw new Error("Could not load wallet signer.");
      }

      const lamports = BigInt(Math.floor(parseFloat(amountInput) * 1e9));

        if (stakeTarget.mode === "liquid") {
        const sig = await depositToStakePool(
          rpc, signer,
          stakeTarget.provider.stakePoolAddress,
          lamports, setExecutingStatus,
        );
        setResultSignature(sig);
        succeeded = true;
      } else {
        const sig = await createNativeStake(
          rpc, signer,
          stakeTarget.validator.voteAccount,
          lamports, setExecutingStatus,
        );
        setResultSignature(sig);
        succeeded = true;
      }
    } catch (err: unknown) {
      setResultError(err instanceof Error ? err.message : "Staking failed.");
    }

    setStep("result");
    if (succeeded) onTransactionComplete();
  }, [stakeTarget, amountInput, rpc, onTransactionComplete]);

  // --- Deactivate / Withdraw ---

  const handleDeactivate = useCallback(async (account: StakeAccountInfo) => {
    setStep("executing");
    let succeeded = false;
    try {
      const signer = await getActiveWalletSigner();
      if (!signer) {
        throw new Error("Could not load wallet signer.");
      }

      const sig = await deactivateStake(rpc, signer, account.address, setExecutingStatus);
      setResultSignature(sig);
      succeeded = true;
    } catch (err: unknown) {
      setResultError(err instanceof Error ? err.message : "Deactivate failed.");
    }
    setStep("result");
    if (succeeded) onTransactionComplete();
  }, [rpc, onTransactionComplete]);

  const handleWithdraw = useCallback(async (account: StakeAccountInfo) => {
    setStep("executing");
    let succeeded = false;
    try {
      const signer = await getActiveWalletSigner();
      if (!signer) {
        throw new Error("Could not load wallet signer.");
      }

      const sig = await withdrawStake(rpc, signer, account.address, account.lamports, setExecutingStatus);
      setResultSignature(sig);
      succeeded = true;
    } catch (err: unknown) {
      setResultError(err instanceof Error ? err.message : "Withdraw failed.");
    }
    setStep("result");
    if (succeeded) onTransactionComplete();
  }, [rpc, onTransactionComplete]);

  // --- Input handling ---

  useInput((input, key) => {
    if (!isActive) return;

    // --- List view ---
    if (step === "list") {
      if (key.upArrow && stakeAccounts.length > 0) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow && stakeAccounts.length > 0) {
        setSelectedIndex((i) => Math.min(stakeAccounts.length - 1, i + 1));
        return;
      }
      if (input === "y" && showDetail && stakeAccounts[selectedIndex]) {
        if (copyToClipboard(stakeAccounts[selectedIndex].address)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
        return;
      }
      if (key.return && stakeAccounts.length > 0) {
        setShowDetail((v) => !v);
        return;
      }
      if (input === "d" && showDetail && stakeAccounts[selectedIndex]?.status === "active") {
        handleDeactivate(stakeAccounts[selectedIndex]);
        return;
      }
      if (input === "w" && showDetail && stakeAccounts[selectedIndex]?.status === "deactivated") {
        handleWithdraw(stakeAccounts[selectedIndex]);
        return;
      }
      if (input === "n") {
        setOptionIndex(0);
        setStep("choose-type");
        return;
      }
      if (input === "r") {
        fetchData();
        return;
      }
      return;
    }

    // --- Choose type: liquid or native ---
    if (step === "choose-type") {
      if (key.escape) { resetFlow(); return; }
      if (input === "l") { setOptionIndex(0); setStep("choose-provider"); return; }
      if (input === "n") {
        const validators = loadCustomValidators();
        if (validators.length === 0) {
          setStep("add-validator-vote");
        } else {
          setOptionIndex(0);
          setStep("choose-validator");
        }
        return;
      }
      return;
    }

    // --- Choose liquid provider ---
    if (step === "choose-provider") {
      if (key.escape) { setStep("choose-type"); return; }
      if (key.upArrow) { setOptionIndex((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setOptionIndex((i) => Math.min(STAKE_PROVIDERS.length - 1, i + 1)); return; }
      if (key.return) {
        const provider = STAKE_PROVIDERS[optionIndex];
        setStakeTarget({ mode: "liquid", provider });
        setStep("amount");
        return;
      }
      return;
    }

    // --- Choose validator (custom) ---
    if (step === "choose-validator") {
      const validators = loadCustomValidators();
      const totalOptions = validators.length + 1; // +1 for "Add new"
      if (key.escape) { setStep("choose-type"); return; }
      if (key.upArrow) { setOptionIndex((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setOptionIndex((i) => Math.min(totalOptions - 1, i + 1)); return; }
      if (key.return) {
        if (optionIndex < validators.length) {
          setStakeTarget({ mode: "native", validator: validators[optionIndex] });
          setStep("amount");
        } else {
          setStep("add-validator-vote");
        }
        return;
      }
      return;
    }

    // --- Add custom validator: vote account ---
    if (step === "add-validator-vote") {
      if (key.escape) { resetFlow(); return; }
      if (key.return && newValidatorVote.length >= 32) {
        if (!isValidSolanaAddress(newValidatorVote)) {
          setError("Invalid validator vote account.");
          return;
        }
        setError(null);
        setStep("add-validator-label");
        return;
      }
      if (key.backspace || key.delete) { setNewValidatorVote((v) => v.slice(0, -1)); return; }
      if (input.length >= 1 && !key.ctrl && !key.meta) {
        setNewValidatorVote((v) => v + input);
        return;
      }
      return;
    }

    // --- Add custom validator: label ---
    if (step === "add-validator-label") {
      if (key.escape) { setStep("add-validator-vote"); setNewValidatorLabel(""); return; }
      if (key.return && newValidatorLabel.length > 0) {
        try {
          saveCustomValidator(newValidatorLabel, newValidatorVote);
          setStakeTarget({ mode: "native", validator: { label: newValidatorLabel, voteAccount: newValidatorVote } });
          setNewValidatorVote("");
          setNewValidatorLabel("");
          setStep("amount");
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Failed to save validator.");
          resetFlow();
        }
        return;
      }
      if (key.backspace || key.delete) { setNewValidatorLabel((v) => v.slice(0, -1)); return; }
      if (input.length >= 1 && !key.ctrl && !key.meta) {
        setNewValidatorLabel((v) => v + input);
        return;
      }
      return;
    }

    // --- Amount input ---
    if (step === "amount") {
      if (key.escape) { setStep("choose-type"); setAmountInput(""); return; }
      if (key.return && amountInput.length > 0) {
        const num = parseFloat(amountInput);
        if (Number.isNaN(num) || num <= 0) { setError("Invalid amount."); return; }
        setError(null);
        setStep("preview");
        return;
      }
      if (key.backspace || key.delete) { setAmountInput((v) => v.slice(0, -1)); return; }
      if (/^[0-9.]$/.test(input)) { setAmountInput((v) => v + input); return; }
      return;
    }

    // --- Preview ---
    if (step === "preview") {
      if (key.escape) { setStep("amount"); return; }
      if (key.return) { executeStake(); return; }
      return;
    }

    // --- Result ---
    if (step === "result") {
      if (input === "y" && resultSignature) {
        if (copyToClipboard(resultSignature)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
        return;
      }
      if (key.return || key.escape) {
        resetFlow();
        fetchData();
        return;
      }
      return;
    }
  }, { isActive });

  // --- No wallet ---

  if (!walletAddress) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Staking</Text>
        <Box marginTop={1}>
          <Text color="yellow">No wallet configured. Press [w] to manage wallets.</Text>
        </Box>
      </Box>
    );
  }

  // --- Executing ---

  if (step === "executing") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Staking</Text>
        <Box marginTop={1}>
          <Text dimColor>{executingStatus || "Processing..."}</Text>
        </Box>
      </Box>
    );
  }

  // --- Result ---

  if (step === "result") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Staking</Text>
        <Box marginTop={1} flexDirection="column">
          {resultSignature ? (
            <>
              <Text color="green">Transaction successful!</Text>
              <Box marginTop={1}>
                <Text dimColor>{"Tx: "}</Text>
                <Link url={`${SOLSCAN_TX_URL}${resultSignature}`}>
                  <Text dimColor>{truncateAddress(resultSignature)}</Text>
                </Link>
              </Box>
            </>
          ) : (
            <Text color="red">{resultError ?? "Transaction failed."}</Text>
          )}
        </Box>
        <Box marginTop={1} gap={2}>
          <Text dimColor>[enter] back{resultSignature ? "  [y] copy tx" : ""}</Text>
          {copied && <Text color="green">copied!</Text>}
        </Box>
      </Box>
    );
  }

  // --- Choose type ---

  if (step === "choose-type") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>New Stake</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>[l] Liquid staking (receive LST token)</Text>
          <Text>[n] Native staking (delegate to validator)</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[esc] back</Text>
        </Box>
      </Box>
    );
  }

  // --- Choose liquid provider ---

  if (step === "choose-provider") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Liquid Staking</Text>
        <Text dimColor>Choose a provider:</Text>
        <Box marginTop={1} flexDirection="column">
          {STAKE_PROVIDERS.map((p, i) => (
            <Box key={p.id}>
              <Text color={i === optionIndex ? "cyan" : undefined}>
                {i === optionIndex ? "> " : "  "}{p.label}
              </Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[up/down] navigate  [enter] select  [esc] back</Text>
        </Box>
      </Box>
    );
  }

  // --- Choose validator ---

  if (step === "choose-validator") {
    const validators = loadCustomValidators();
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Native Staking</Text>
        <Text dimColor>Choose a validator:</Text>
        <Box marginTop={1} flexDirection="column">
          {validators.map((v, i) => (
            <Box key={v.voteAccount}>
              <Text color={i === optionIndex ? "cyan" : undefined}>
                {i === optionIndex ? "> " : "  "}{v.label}
              </Text>
              <Text dimColor> ({truncateAddress(v.voteAccount)})</Text>
            </Box>
          ))}
          <Box>
            <Text color={optionIndex === validators.length ? "cyan" : undefined}>
              {optionIndex === validators.length ? "> " : "  "}Add new validator
            </Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[up/down] navigate  [enter] select  [esc] back</Text>
        </Box>
      </Box>
    );
  }

  // --- Add validator: vote account ---

  if (step === "add-validator-vote") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Add Validator</Text>
        <Text dimColor>Enter the validator vote account address:</Text>
        <Box marginTop={1}>
          <Text dimColor>{"> "}</Text>
          <Text>{newValidatorVote}</Text>
          <Text dimColor>_</Text>
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>[enter] continue  [esc] cancel</Text>
        </Box>
      </Box>
    );
  }

  // --- Add validator: label ---

  if (step === "add-validator-label") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Add Validator</Text>
        <Text dimColor>Enter a label for this validator:</Text>
        <Box marginTop={1}>
          <Text dimColor>{"> "}</Text>
          <Text>{newValidatorLabel}</Text>
          <Text dimColor>_</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[enter] save  [esc] back</Text>
        </Box>
      </Box>
    );
  }

  // --- Amount input ---

  if (step === "amount" && stakeTarget) {
    const targetLabel = stakeTarget.mode === "liquid"
      ? stakeTarget.provider.label
      : stakeTarget.validator.label;

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Stake SOL</Text>
        <Text dimColor>
          {stakeTarget.mode === "liquid" ? "Liquid stake" : "Native stake"} via {targetLabel}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>Amount (SOL): </Text>
          <Text>{amountInput}</Text>
          <Text dimColor>_</Text>
        </Box>
        {error && (
          <Box marginTop={1}><Text color="red">{error}</Text></Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>[enter] preview  [esc] back</Text>
        </Box>
      </Box>
    );
  }

  // --- Preview ---

  if (step === "preview" && stakeTarget) {
    const targetLabel = stakeTarget.mode === "liquid"
      ? stakeTarget.provider.label
      : stakeTarget.validator.label;

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Confirm Stake</Text>
        <Box marginTop={1} flexDirection="column">
          <Box gap={2}>
            <Text dimColor>Amount:</Text>
            <Text color="green">{amountInput} SOL</Text>
          </Box>
          <Box gap={2}>
            <Text dimColor>Type:</Text>
            <Text>{stakeTarget.mode === "liquid" ? "Liquid" : "Native"}</Text>
          </Box>
          <Box gap={2}>
            <Text dimColor>Provider:</Text>
            <Text>{targetLabel}</Text>
          </Box>
          {stakeTarget.mode === "native" && (
            <Box gap={2}>
              <Text dimColor>Validator:</Text>
              <Text>{truncateAddress(stakeTarget.validator.voteAccount)}</Text>
            </Box>
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[enter] confirm  [esc] back</Text>
        </Box>
      </Box>
    );
  }

  // --- List view (default) ---

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold>Staking</Text>
        {loading && <Text dimColor>loading...</Text>}
      </Box>

      {error && !loading && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red">Error: {error}</Text>
          <Box marginTop={1}><Text dimColor>Press [r] to retry.</Text></Box>
        </Box>
      )}

      {!error && !loading && stakeAccounts.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No stake accounts found. Press [n] to create one.</Text>
        </Box>
      )}

      {stakeAccounts.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Box width={14}><Text dimColor>STATUS</Text></Box>
            <Box width={18}><Text dimColor>VALIDATOR</Text></Box>
            <Box width={14}><Text dimColor>BALANCE</Text></Box>
          </Box>

          {stakeAccounts.map((account, i) => {
            const isSelected = i === selectedIndex;
            return (
              <Box key={account.address}>
                <Box width={14}>
                  <Text color={statusColor(account.status)} bold={isSelected}>
                    {isSelected ? "> " : "  "}{account.status}
                  </Text>
                </Box>
                <Box width={18}>
                  <Text bold={isSelected}>
                    {account.validatorLabel ?? (account.validator ? truncateAddress(account.validator) : "-")}
                  </Text>
                </Box>
                <Box width={14}>
                  <Text bold={isSelected}>{formatBalance(account.balance, 9)} SOL</Text>
                </Box>
              </Box>
            );
          })}

          {showDetail && stakeAccounts[selectedIndex] && (
            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
              <Box gap={2}>
                <Text dimColor>Account:</Text>
                <Text>{stakeAccounts[selectedIndex].address}</Text>
              </Box>
              {stakeAccounts[selectedIndex].validator && (
                <Box gap={2}>
                  <Text dimColor>Validator:</Text>
                  <Text>{stakeAccounts[selectedIndex].validator}</Text>
                </Box>
              )}
              <Box gap={2}>
                <Text dimColor>Balance:</Text>
                <Text>{stakeAccounts[selectedIndex].balance.toFixed(9)} SOL</Text>
              </Box>
              <Box gap={2}>
                <Text dimColor>Status:</Text>
                <Text color={statusColor(stakeAccounts[selectedIndex].status)}>
                  {stakeAccounts[selectedIndex].status}
                </Text>
              </Box>
              {stakeAccounts[selectedIndex].status === "active" && (
                <Box marginTop={1}><Text dimColor>[d] deactivate</Text></Box>
              )}
              {stakeAccounts[selectedIndex].status === "deactivated" && (
                <Box marginTop={1}><Text dimColor>[w] withdraw</Text></Box>
              )}
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        <Text dimColor>
          {stakeAccounts.length > 0
            ? `[up/down] navigate  [enter] details${showDetail ? "  [y] copy address" : ""}  [n] new stake`
            : "[n] new stake"
          }
        </Text>
        {copied && <Text color="green">copied!</Text>}
      </Box>
    </Box>
  );
}
