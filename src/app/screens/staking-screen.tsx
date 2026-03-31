import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import Link from "ink-link";
import { fetchAllBalances } from "../../portfolio/index.js";
import { fetchTokenMetadata } from "../../pricing/index.js";
import { truncateAddress, formatBalance, parseDecimalAmount, timeAgo } from "../../lib/format.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import {
  DEFAULT_VALIDATORS,
  STAKE_PROVIDERS,
  fetchStakeAccounts,
  fetchStakePoolInfo,
  createNativeStake,
  depositToStakePool,
  deactivateStake,
  loadCustomPools,
  withdrawSolFromStakePool,
  withdrawStake,
  loadCustomValidators,
  saveCustomPool,
  saveCustomValidator,
} from "../../staking/index.js";
import { isValidSolanaAddress } from "../../transfer/index.js";
import { getActiveWalletSigner, WalletLockedError } from "../../wallet/index.js";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import type { CustomValidator, StakeAccountInfo, StakeProvider, StakeTarget } from "../../types/staking.js";

const SOLSCAN_TX_URL = "https://solscan.io/tx/";

type Step =
  | "list"
  | "choose-type"
  | "choose-provider"
  | "add-pool-address"
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
  jupiterApiKey: string;
  isActive: boolean;
  onCapturingInputChange: (capturing: boolean) => void;
  onTransactionComplete: () => void;
}

interface LiquidStakePosition {
  providerLabel: string;
  mint: string;
  balance: number;
  rawBalance: bigint;
  decimals: number;
}

type FlowAction = "stake" | "unstake";

type StakingListItem =
  | { kind: "native"; account: StakeAccountInfo }
  | { kind: "liquid"; position: LiquidStakePosition };

function statusColor(status: string): string {
  switch (status) {
    case "active": return "green";
    case "activating": return "cyan";
    case "deactivating": return "yellow";
    case "deactivated": return "red";
    default: return "gray";
  }
}

function canAppendDecimalValue(current: string, next: string): boolean {
  if (!/^[0-9.]$/.test(next)) return false;
  if (next !== ".") return true;
  return !current.includes(".");
}

function getLiquidUnitLabel(position: LiquidStakePosition): string {
  const symbolMatch = position.providerLabel.match(/\(([^)]+)\)$/);
  return symbolMatch?.[1] ?? position.providerLabel;
}

export default function StakingScreen({
  walletAddress,
  rpc,
  jupiterApiKey,
  isActive,
  onCapturingInputChange,
  onTransactionComplete,
}: StakingScreenProps) {
  // --- List state ---
  const [stakeAccounts, setStakeAccounts] = useState<StakeAccountInfo[]>([]);
  const [liquidPositions, setLiquidPositions] = useState<LiquidStakePosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [copied, setCopied] = useState(false);
  const [availableSol, setAvailableSol] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const [customPools, setCustomPools] = useState<StakeProvider[]>([]);
  const [customValidators, setCustomValidators] = useState<CustomValidator[]>([]);
  const fetchInFlight = useRef(false);

  // --- New stake flow state ---
  const [step, setStep] = useState<Step>("list");
  const [flowAction, setFlowAction] = useState<FlowAction>("stake");
  const [stakeTarget, setStakeTarget] = useState<StakeTarget | null>(null);
  const [unstakePosition, setUnstakePosition] = useState<LiquidStakePosition | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [executingStatus, setExecutingStatus] = useState("");
  const [resultSignature, setResultSignature] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);

  // --- Add custom validator state ---
  const [newPoolAddress, setNewPoolAddress] = useState("");
  const [newValidatorVote, setNewValidatorVote] = useState("");
  const [newValidatorLabel, setNewValidatorLabel] = useState("");

  // Capture input when in any flow step or detail drawer is open.
  const isCapturing = step !== "list" || showDetail;
  useEffect(() => {
    onCapturingInputChange(isCapturing);
  }, [isCapturing, onCapturingInputChange]);

  const loadSavedTargets = useCallback(() => {
    setCustomPools(loadCustomPools());
    setCustomValidators(loadCustomValidators());
  }, []);

  useEffect(() => {
    try {
      loadSavedTargets();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load saved staking targets.");
    }
  }, [loadSavedTargets]);

  // --- Data fetching ---

  const fetchData = useCallback(async () => {
    if (!walletAddress || fetchInFlight.current) return;
    fetchInFlight.current = true;
    setLoading(true);
    try {
      const providers = [...STAKE_PROVIDERS, ...customPools];
      const [accounts, balances] = await Promise.all([
        fetchStakeAccounts(rpc, walletAddress),
        fetchAllBalances(rpc, walletAddress),
      ]);
      const liquid = balances
        .filter((balance) => !balance.isNative)
        .flatMap((balance) => {
          const provider = providers.find((item) => item.lstMint === balance.mint);
          if (!provider) return [];
          return [{
            providerLabel: provider.label,
            mint: balance.mint,
            balance: balance.balance,
            rawBalance: balance.rawBalance,
            decimals: balance.decimals,
          } satisfies LiquidStakePosition];
        });
      setStakeAccounts(accounts);
      setLiquidPositions(liquid);
      const nativeSol = balances.find((balance) => balance.isNative);
      setAvailableSol(nativeSol?.balance ?? 0);
      setSelectedIndex((prev) => Math.min(prev, Math.max(0, accounts.length + liquid.length - 1)));
      setLastUpdated(new Date());
      setError(null);
    } catch (err: unknown) {
      setStakeAccounts([]);
      setLiquidPositions([]);
      setAvailableSol(0);
      setSelectedIndex(0);
      setError(err instanceof Error ? err.message : "Failed to fetch stake accounts");
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, [customPools, rpc, walletAddress]);

  useEffect(() => {
    if (isActive && walletAddress && step === "list") {
      fetchData();
    }
  }, [isActive, walletAddress, fetchData, step]);

  // Close detail drawer when leaving the screen.
  useEffect(() => {
    if (!isActive) {
      setShowDetail(false);
    }
  }, [isActive]);

  useEffect(() => {
    setStakeAccounts([]);
    setLiquidPositions([]);
    setAvailableSol(null);
    setLastUpdated(null);
    setSelectedIndex(0);
    setShowDetail(false);
  }, [walletAddress]);

  // Tick every 10s so the "updated X ago" label stays fresh.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  // --- Reset flow ---

  const resetFlow = useCallback(() => {
    setStep("list");
    setFlowAction("stake");
    setStakeTarget(null);
    setUnstakePosition(null);
    setAmountInput("");
    setExecutingStatus("");
    setResultSignature(null);
    setResultError(null);
    setOptionIndex(0);
    setNewPoolAddress("");
    setNewValidatorVote("");
    setNewValidatorLabel("");
    setError(null);
  }, []);

  const startUnstakeFlow = useCallback((position: LiquidStakePosition) => {
    setFlowAction("unstake");
    setUnstakePosition(position);
    setAmountInput("");
    setError(null);
    setShowDetail(false);
    setStep("amount");
  }, []);

  const getUnstakeAmount = useCallback((): bigint | null => {
    if (!unstakePosition || !amountInput) return null;
    if (amountInput === "max") return unstakePosition.rawBalance;
    return parseDecimalAmount(amountInput, unstakePosition.decimals);
  }, [amountInput, unstakePosition]);

  const previewUnstakeAmount = useCallback((): string => {
    if (!unstakePosition) return amountInput;
    if (amountInput === "max") {
      return formatBalance(unstakePosition.balance, unstakePosition.decimals);
    }
    return amountInput;
  }, [amountInput, unstakePosition]);

  const getStakeAmount = useCallback((): bigint | null => {
    if (!amountInput) return null;
    return parseDecimalAmount(amountInput, 9);
  }, [amountInput]);

  const savePoolAndContinue = useCallback(async () => {
    if (!newPoolAddress) return;

    setError(null);
    setExecutingStatus("Validating stake pool...");
    setStep("executing");

    try {
      const poolInfo = await fetchStakePoolInfo(rpc, newPoolAddress);
      let providerLabel = truncateAddress(poolInfo.poolMint);

      try {
        setExecutingStatus("Loading token metadata...");
        const metadata = await fetchTokenMetadata([poolInfo.poolMint], jupiterApiKey);
        const token = metadata.get(poolInfo.poolMint);
        providerLabel = token?.symbol ?? token?.name ?? providerLabel;
      } catch {
        providerLabel = truncateAddress(poolInfo.poolMint);
      }

      const provider = saveCustomPool(providerLabel, newPoolAddress, poolInfo.poolMint);
      loadSavedTargets();
      setStakeTarget({ mode: "liquid", provider });
      setNewPoolAddress("");
      setExecutingStatus("");
      setStep("amount");
    } catch (err: unknown) {
      setExecutingStatus("");
      setError(err instanceof Error ? err.message : "Failed to save stake pool.");
      setStep("add-pool-address");
    }
  }, [jupiterApiKey, loadSavedTargets, newPoolAddress, rpc]);

  const listItems: StakingListItem[] = [
    ...stakeAccounts.map((account) => ({ kind: "native", account }) as const),
    ...liquidPositions.map((position) => ({ kind: "liquid", position }) as const),
  ];
  const selectedItem = listItems[selectedIndex] ?? null;

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

      const lamports = getStakeAmount();
      if (lamports === null || lamports <= 0n) {
        throw new Error("Invalid amount.");
      }

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
      setResultError(
        err instanceof WalletLockedError
          ? "Wallet locked. Open Wallets [w] and press [u] to unlock it."
          : err instanceof Error
            ? err.message
            : "Staking failed.",
      );
    }

    setStep("result");
    if (succeeded) onTransactionComplete();
  }, [getStakeAmount, stakeTarget, rpc, onTransactionComplete]);

  const handleUnstake = useCallback(async (position: LiquidStakePosition) => {
    const poolTokens = getUnstakeAmount();
    if (!poolTokens || poolTokens <= 0n) return;

    setStep("executing");
    let succeeded = false;
    try {
      const signer = await getActiveWalletSigner();
      if (!signer) {
        throw new Error("Could not load wallet signer.");
      }

      const provider = [...STAKE_PROVIDERS, ...customPools].find(
        (item) => item.lstMint === position.mint,
      );
      if (!provider) {
        throw new Error("Could not resolve stake pool for this LST.");
      }

      const sig = await withdrawSolFromStakePool(
        rpc,
        signer,
        provider.stakePoolAddress,
        poolTokens,
        setExecutingStatus,
      );
      setResultSignature(sig);
      succeeded = true;
    } catch (err: unknown) {
      setResultError(
        err instanceof WalletLockedError
          ? "Wallet locked. Open Wallets [w] and press [u] to unlock it."
          : err instanceof Error
            ? err.message
            : "Unstake failed.",
      );
    }
    setStep("result");
    if (succeeded) onTransactionComplete();
  }, [customPools, getUnstakeAmount, rpc, onTransactionComplete]);

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
      setResultError(
        err instanceof WalletLockedError
          ? "Wallet locked. Open Wallets [w] and press [u] to unlock it."
          : err instanceof Error
            ? err.message
            : "Deactivate failed.",
      );
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
      setResultError(
        err instanceof WalletLockedError
          ? "Wallet locked. Open Wallets [w] and press [u] to unlock it."
          : err instanceof Error
            ? err.message
            : "Withdraw failed.",
      );
    }
    setStep("result");
    if (succeeded) onTransactionComplete();
  }, [rpc, onTransactionComplete]);

  // --- Input handling ---

  const handleInput = useCallback((input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean }) => {
    if (!isActive) return;

    // --- List view ---
    if (step === "list") {
      if (key.upArrow && listItems.length > 0) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow && listItems.length > 0) {
        setSelectedIndex((i) => Math.min(listItems.length - 1, i + 1));
        return;
      }
      if (input === "y" && showDetail && selectedItem) {
        const value = selectedItem.kind === "native"
          ? selectedItem.account.address
          : selectedItem.position.mint;
        if (copyToClipboard(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
        return;
      }
      if (key.escape && showDetail) {
        setShowDetail(false);
        return;
      }
      if (key.return && listItems.length > 0) {
        setShowDetail((v) => !v);
        return;
      }
      if (input === "d" && showDetail && selectedItem?.kind === "native" && selectedItem.account.status === "active") {
        handleDeactivate(selectedItem.account);
        return;
      }
      if (input === "w" && showDetail && selectedItem?.kind === "native" && selectedItem.account.status === "deactivated") {
        handleWithdraw(selectedItem.account);
        return;
      }
      if (input === "u" && showDetail && selectedItem?.kind === "liquid") {
        startUnstakeFlow(selectedItem.position);
        return;
      }
      if (input === "n") {
        setFlowAction("stake");
        setUnstakePosition(null);
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
        setOptionIndex(0);
        setStep("choose-validator");
        return;
      }
      return;
    }

    // --- Choose liquid provider ---
    if (step === "choose-provider") {
      const providers = [...STAKE_PROVIDERS, ...customPools];
      const totalOptions = providers.length + 1;
      if (key.escape) { setStep("choose-type"); return; }
      if (key.upArrow) { setOptionIndex((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setOptionIndex((i) => Math.min(totalOptions - 1, i + 1)); return; }
      if (key.return) {
        if (optionIndex === providers.length) {
          setNewPoolAddress("");
          setStep("add-pool-address");
          return;
        }

        const provider = providers[optionIndex];
        setStakeTarget({ mode: "liquid", provider });
        setStep("amount");
        return;
      }
      return;
    }

    // --- Add custom pool: stake pool address ---
    if (step === "add-pool-address") {
      if (key.escape) { setStep("choose-provider"); return; }
      if (key.return && newPoolAddress.length >= 32) {
        if (!isValidSolanaAddress(newPoolAddress)) {
          setError("Invalid stake pool address.");
          return;
        }
        void savePoolAndContinue();
        return;
      }
      if (key.backspace || key.delete) { setNewPoolAddress((value) => value.slice(0, -1)); return; }
      if (input.length >= 1 && !key.ctrl && !key.meta) {
        setNewPoolAddress((value) => value + input);
        return;
      }
      return;
    }

    // --- Choose validator (custom) ---
    if (step === "choose-validator") {
      const validators = [...DEFAULT_VALIDATORS, ...customValidators];
      const totalOptions = validators.length + 1;
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
          loadSavedTargets();
          setStakeTarget({ mode: "native", validator: { label: newValidatorLabel, voteAccount: newValidatorVote } });
          setNewValidatorVote("");
          setNewValidatorLabel("");
          setError(null);
          setStep("amount");
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Failed to save validator.");
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
      if (key.escape) {
        setAmountInput("");
        setError(null);
        if (flowAction === "unstake") {
          setStep("list");
          setUnstakePosition(null);
          setFlowAction("stake");
          setShowDetail(true);
          return;
        }

        setStep(stakeTarget?.mode === "liquid" ? "choose-provider" : "choose-validator");
        return;
      }
      if (key.return && amountInput.length > 0) {
        if (flowAction === "unstake") {
          const rawAmount = getUnstakeAmount();
          if (rawAmount === null || rawAmount <= 0n) { setError("Invalid amount."); return; }
          if (unstakePosition && rawAmount > unstakePosition.rawBalance) {
            setError("Amount exceeds available balance.");
            return;
          }
        } else {
          const rawAmount = getStakeAmount();
          if (rawAmount === null || rawAmount <= 0n) { setError("Invalid amount."); return; }
        }
        setError(null);
        setStep("preview");
        return;
      }
      if (key.backspace || key.delete) { setAmountInput((v) => v.slice(0, -1)); return; }
      if (flowAction === "unstake") {
        const nextValue = `${amountInput}${input}`;
        if (canAppendDecimalValue(amountInput, input)) {
          setAmountInput((v) => v + input);
          return;
        }
        if ("max".startsWith(nextValue.toLowerCase()) && !key.ctrl && !key.meta) {
          setAmountInput(nextValue.toLowerCase());
          return;
        }
      }
      if (canAppendDecimalValue(amountInput, input)) { setAmountInput((v) => v + input); return; }
      return;
    }

    // --- Preview ---
    if (step === "preview") {
      if (key.escape) { setStep("amount"); return; }
      if (key.return) {
        if (flowAction === "unstake" && unstakePosition) {
          void handleUnstake(unstakePosition);
        } else {
          void executeStake();
        }
        return;
      }
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
  }, [
    amountInput,
    customPools,
    customValidators,
    fetchData,
    flowAction,
    getStakeAmount,
    getUnstakeAmount,
    handleDeactivate,
    handleUnstake,
    handleWithdraw,
    isActive,
    listItems.length,
    loadSavedTargets,
    newPoolAddress,
    newValidatorLabel,
    newValidatorVote,
    optionIndex,
    resetFlow,
    resultSignature,
    savePoolAndContinue,
    selectedItem,
    showDetail,
    stakeTarget,
    startUnstakeFlow,
    unstakePosition,
  ]);

  useInput(handleInput, { isActive });

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
    const providers = [...STAKE_PROVIDERS, ...customPools];
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Liquid Staking</Text>
        <Text dimColor>Choose a provider:</Text>
        <Box marginTop={1} flexDirection="column">
          {providers.map((p, i) => (
            <Box key={p.id}>
              <Text color={i === optionIndex ? "cyan" : undefined}>
                {i === optionIndex ? "> " : "  "}{p.label}
              </Text>
            </Box>
          ))}
          <Box>
            <Text color={optionIndex === providers.length ? "cyan" : undefined}>
              {optionIndex === providers.length ? "> " : "  "}Enter custom pool address
            </Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[up/down] navigate  [enter] select  [esc] back</Text>
        </Box>
      </Box>
    );
  }

  // --- Add pool: stake pool address ---

  if (step === "add-pool-address") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Add Stake Pool</Text>
        <Text dimColor>Enter an SPL stake pool address with permissionless SOL deposits and withdrawals. The LST label will be detected automatically.</Text>
        <Box marginTop={1}>
          <Text dimColor>{"> "}</Text>
          <Text>{newPoolAddress}</Text>
          <Text dimColor>_</Text>
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>[enter] continue  [esc] back</Text>
        </Box>
      </Box>
    );
  }

  // --- Choose validator ---

  if (step === "choose-validator") {
    const validators = [...DEFAULT_VALIDATORS, ...customValidators];
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
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>[enter] save  [esc] back</Text>
        </Box>
      </Box>
    );
  }

  // --- Amount input ---

  if (step === "amount" && (stakeTarget || unstakePosition)) {
    const targetLabel = flowAction === "unstake"
      ? unstakePosition?.providerLabel
      : stakeTarget?.mode === "liquid"
        ? stakeTarget.provider.label
        : stakeTarget?.validator.label;
    const amountLabel = flowAction === "unstake"
      ? `Amount (${targetLabel ?? "LST"}): `
      : "Amount (SOL): ";
    const availableLabel = flowAction === "unstake"
      ? unstakePosition
        ? `${formatBalance(unstakePosition.balance, unstakePosition.decimals)} ${getLiquidUnitLabel(unstakePosition)}`
        : null
      : availableSol !== null
        ? `${availableSol.toLocaleString("en-US", { maximumFractionDigits: 6 })} SOL`
        : null;

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>{flowAction === "unstake" ? "Unstake LST" : "Stake SOL"}</Text>
        <Text dimColor>
          {flowAction === "unstake"
            ? `Redeem ${targetLabel ?? "LST"} back to SOL`
            : `${stakeTarget?.mode === "liquid" ? "Liquid stake" : "Native stake"} via ${targetLabel}`}
        </Text>
      <Box marginTop={1}>
        <Text dimColor>{amountLabel}</Text>
        <Text>{amountInput}</Text>
        <Text dimColor>_</Text>
      </Box>
      {availableLabel && (
        <Box marginTop={1}>
          <Text dimColor>Available: {availableLabel}</Text>
        </Box>
      )}
      {error && (
        <Box marginTop={1}><Text color="red">{error}</Text></Box>
      )}
        <Box marginTop={1}>
          <Text dimColor>[enter] preview  [esc] back{flowAction === "unstake" ? "  type max for full balance" : ""}</Text>
        </Box>
      </Box>
    );
  }

  // --- Preview ---

  if (step === "preview" && (stakeTarget || unstakePosition)) {
    const targetLabel = flowAction === "unstake"
      ? unstakePosition?.providerLabel
      : stakeTarget?.mode === "liquid"
        ? stakeTarget.provider.label
        : stakeTarget?.validator.label;
    const previewAmount = flowAction === "unstake"
      ? previewUnstakeAmount()
      : amountInput;
    const previewUnit = flowAction === "unstake"
      ? (unstakePosition ? getLiquidUnitLabel(unstakePosition) : "LST")
      : "SOL";

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>{flowAction === "unstake" ? "Confirm Unstake" : "Confirm Stake"}</Text>
        <Box marginTop={1} flexDirection="column">
          <Box gap={2}>
            <Text dimColor>Amount:</Text>
            <Text color="green">{previewAmount} {previewUnit}</Text>
          </Box>
          <Box gap={2}>
            <Text dimColor>Type:</Text>
            <Text>{flowAction === "unstake" ? "Liquid" : stakeTarget?.mode === "liquid" ? "Liquid" : "Native"}</Text>
          </Box>
          <Box gap={2}>
            <Text dimColor>Provider:</Text>
            <Text>{targetLabel}</Text>
          </Box>
          {flowAction === "unstake" && (
            <Box gap={2}>
              <Text dimColor>Receive:</Text>
              <Text>SOL</Text>
            </Box>
          )}
          {flowAction === "stake" && stakeTarget?.mode === "native" && (
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
        <Box gap={2}>
          {loading && <Text dimColor>loading...</Text>}
          {lastUpdated && !loading && <Text dimColor>updated {timeAgo(lastUpdated)}</Text>}
        </Box>
      </Box>

      {error && !loading && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red">Error: {error}</Text>
          <Box marginTop={1}><Text dimColor>Press [r] to retry.</Text></Box>
        </Box>
      )}

      {!error && !loading && listItems.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No staking positions found. Press [n] to create one.</Text>
        </Box>
      )}

      {listItems.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Box width={2}><Text dimColor>{"  "}</Text></Box>
            <Box width={8}><Text dimColor>TYPE</Text></Box>
            <Box width={18}><Text dimColor>TARGET</Text></Box>
            <Box width={18}><Text dimColor>BALANCE</Text></Box>
            <Box width={14}><Text dimColor>STATUS</Text></Box>
          </Box>

          {listItems.map((item, i) => {
            const isSelected = i === selectedIndex;
            const typeLabel = item.kind === "native" ? "native" : "liquid";
            const targetLabel = item.kind === "native"
              ? (item.account.validatorLabel ?? (item.account.validator ? truncateAddress(item.account.validator) : "-"))
              : item.position.providerLabel;
            const balanceText = item.kind === "native"
              ? `${formatBalance(item.account.balance, 9)} SOL`
              : `${formatBalance(item.position.balance, item.position.decimals)} ${getLiquidUnitLabel(item.position)}`;
            const statusText = item.kind === "native" ? item.account.status : "liquid";
            return (
              <Box key={item.kind === "native" ? item.account.address : item.position.mint}>
                <Box width={2}>
                  <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                    {isSelected ? "> " : "  "}
                  </Text>
                </Box>
                <Box width={8}><Text bold={isSelected}>{typeLabel}</Text></Box>
                <Box width={18}><Text bold={isSelected}>{targetLabel}</Text></Box>
                <Box width={18}><Text bold={isSelected}>{balanceText}</Text></Box>
                <Box width={14}>
                  <Text color={statusColor(statusText)} bold={isSelected}>{statusText}</Text>
                </Box>
              </Box>
            );
          })}

          {showDetail && selectedItem && (
            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
              {selectedItem.kind === "native" ? (
                <>
                  <Box gap={2}><Text dimColor>Account:</Text><Text>{selectedItem.account.address}</Text></Box>
                  {selectedItem.account.validator && (
                    <Box gap={2}><Text dimColor>Validator:</Text><Text>{selectedItem.account.validator}</Text></Box>
                  )}
                  <Box gap={2}><Text dimColor>Balance:</Text><Text>{selectedItem.account.balance.toFixed(9)} SOL</Text></Box>
                  <Box gap={2}>
                    <Text dimColor>Status:</Text>
                    <Text color={statusColor(selectedItem.account.status)}>{selectedItem.account.status}</Text>
                  </Box>
                  {selectedItem.account.status === "active" && (
                    <Box marginTop={1}><Text dimColor>[d] deactivate</Text></Box>
                  )}
                  {selectedItem.account.status === "deactivated" && (
                    <Box marginTop={1}><Text dimColor>[w] withdraw</Text></Box>
                  )}
                </>
              ) : (
                <>
                  <Box gap={2}><Text dimColor>Provider:</Text><Text>{selectedItem.position.providerLabel}</Text></Box>
                  <Box gap={2}><Text dimColor>Mint:</Text><Text>{selectedItem.position.mint}</Text></Box>
                  <Box gap={2}><Text dimColor>Balance:</Text><Text>{formatBalance(selectedItem.position.balance, selectedItem.position.decimals)}</Text></Box>
                  <Box gap={2}><Text dimColor>Type:</Text><Text color="cyan">liquid</Text></Box>
                  <Box marginTop={1}><Text dimColor>[u] unstake</Text></Box>
                </>
              )}
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        <Text dimColor>
          {listItems.length === 0
            ? "[n] new stake"
            : showDetail
              ? selectedItem?.kind === "native"
                ? `[up/down] navigate  [y] copy address${selectedItem.account.status === "active" ? "  [d] deactivate" : ""}${selectedItem.account.status === "deactivated" ? "  [w] withdraw" : ""}  [esc] close`
                : "[up/down] navigate  [y] copy mint  [u] unstake  [esc] close"
              : "[up/down] navigate  [enter] details  [n] new stake"
          }
        </Text>
        {copied && <Text color="green">copied!</Text>}
      </Box>
    </Box>
  );
}
