import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { Box, Text, useInput } from "ink";
import Link from "ink-link";
import UnlockPrompt from "../../components/unlock-prompt.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import {
  formatAmount,
  formatUsd,
  parseDecimalAmount,
  timeAgo,
  truncateAddress,
} from "../../lib/format.js";
import {
  resolveDestinationToken,
  tokenSymbol,
  validateSwapAmount,
} from "../../lib/token-selectors.js";
import { fetchAllBalances } from "../../portfolio/index.js";
import { fetchTokenMetadata, fetchTokenPrices, searchTokens } from "../../pricing/index.js";
import {
  DEFAULT_SLIPPAGE_PCT,
  buildDustSwapPlan,
  buildSplitSwapPlan,
  executeMultiSwapPlan,
  executeSwap,
  getSwapQuote,
  previewDustSwapPlan,
  previewStrictMultiSwapPlan,
} from "../../swap/index.js";
import { maxSendableSol } from "../../transfer/index.js";
import type { SelectedAssetRef, TokenBalance, TokenMetadata } from "../../types/portfolio.js";
import type {
  MultiSwapExecutionResult,
  MultiSwapPreviewResult,
  SwapQuote,
  SwapResult,
} from "../../types/swap.js";
import {
  getActiveWalletEntry,
  getActiveWalletSigner,
  unlockWallet,
  WalletLockedError,
  WalletPassphraseError,
} from "../../wallet/index.js";

const SOLSCAN_TX_URL = "https://solscan.io/tx/";

type SwapMode = "single" | "dust" | "split";

type SwapStep =
  | "select-mode"
  | "select-source"
  | "select-dest"
  | "enter-amount"
  | "enter-dust-threshold"
  | "enter-split-allocations"
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
  preSelectedAsset: SelectedAssetRef | null;
  onPreSelectedAssetConsumed: () => void;
  refreshKey: number;
  onTransactionComplete: () => void;
}

interface DestinationSelection {
  mint: string;
  symbol: string;
  decimals: number | null;
}

const MODE_OPTIONS: Array<{ mode: SwapMode; label: string; description: string }> = [
  { mode: "single", label: "Single", description: "One token into one token" },
  { mode: "dust", label: "Dust", description: "Collect small positions into one asset" },
  { mode: "split", label: "Split", description: "Split one source across several targets" },
];

function getSourceAmountLabel(sourceToken: TokenBalance, amountInput: string): string {
  if (amountInput === "max") {
    if (sourceToken.isNative) {
      const maxAmount = maxSendableSol(sourceToken.rawBalance);
      return formatAmount(maxAmount.toString(), sourceToken.decimals);
    }

    return sourceToken.balance.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  return amountInput;
}

function getBackStep(mode: SwapMode | null, step: SwapStep): SwapStep {
  if (step === "preview") {
    if (mode === "single") return "enter-slippage";
    if (mode === "dust") return "enter-slippage";
    return "enter-slippage";
  }

  if (step === "enter-slippage") {
    if (mode === "single") return "enter-amount";
    if (mode === "dust") return "enter-dust-threshold";
    return "enter-split-allocations";
  }

  if (step === "enter-dust-threshold") {
    return "select-dest";
  }

  if (step === "enter-split-allocations") {
    return "enter-amount";
  }

  if (step === "enter-amount") {
    return mode === "single" ? "select-dest" : "select-source";
  }

  if (step === "select-dest" || step === "select-source") {
    return "select-mode";
  }

  return "select-mode";
}

export default function SwapScreen({
  walletAddress,
  rpc,
  jupiterApiKey,
  isActive,
  onCapturingInputChange,
  preSelectedAsset,
  onPreSelectedAssetConsumed,
  refreshKey,
  onTransactionComplete,
}: SwapScreenProps) {
  const [step, setStep] = useState<SwapStep>("select-mode");
  const [mode, setMode] = useState<SwapMode | null>(null);
  const [modeIndex, setModeIndex] = useState(0);
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [metadata, setMetadata] = useState<Map<string, TokenMetadata>>(new Map());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sourceToken, setSourceToken] = useState<TokenBalance | null>(null);
  const [destination, setDestination] = useState<DestinationSelection | null>(null);
  const [destSearch, setDestSearch] = useState("");
  const [destResults, setDestResults] = useState<TokenMetadata[]>([]);
  const [destSearchIndex, setDestSearchIndex] = useState(0);
  const [amountInput, setAmountInput] = useState("");
  const [dustThresholdInput, setDustThresholdInput] = useState("");
  const [splitAllocationsInput, setSplitAllocationsInput] = useState("");
  const [slippageInput, setSlippageInput] = useState(DEFAULT_SLIPPAGE_PCT);
  const [singleQuote, setSingleQuote] = useState<SwapQuote | null>(null);
  const [multiPreview, setMultiPreview] = useState<MultiSwapPreviewResult | null>(null);
  const [multiOutputDecimals, setMultiOutputDecimals] = useState<Map<string, number>>(new Map());
  const [swapStatus, setSwapStatus] = useState("Preparing...");
  const [singleResult, setSingleResult] = useState<SwapResult | null>(null);
  const [multiResult, setMultiResult] = useState<MultiSwapExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockInput, setUnlockInput] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockWalletId, setUnlockWalletId] = useState<string | null>(null);
  const [unlockWalletLabel, setUnlockWalletLabel] = useState("Active Wallet");
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [searchingTokens, setSearchingTokens] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const fetchInFlight = useRef(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingExecutionRef = useRef<(() => Promise<void>) | null>(null);

  const isCapturing =
    step === "select-dest"
    || step === "enter-amount"
    || step === "enter-dust-threshold"
    || step === "enter-split-allocations"
    || step === "enter-slippage"
    || step === "unlock";

  useEffect(() => {
    onCapturingInputChange(isCapturing);
  }, [isCapturing, onCapturingInputChange]);

  const clearModeState = useCallback(() => {
    setSourceToken(null);
    setDestination(null);
    setDestSearch("");
    setDestResults([]);
    setDestSearchIndex(0);
    setAmountInput("");
    setDustThresholdInput("");
    setSplitAllocationsInput("");
    setSlippageInput(DEFAULT_SLIPPAGE_PCT);
    setSingleQuote(null);
    setMultiPreview(null);
    setMultiOutputDecimals(new Map());
    setSingleResult(null);
    setMultiResult(null);
    setSwapStatus("Preparing...");
    setError(null);
    setUnlockInput("");
    setUnlockError(null);
    setUnlocking(false);
    setUnlockWalletId(null);
    setUnlockWalletLabel("Active Wallet");
    setCopied(false);
    pendingExecutionRef.current = null;
  }, []);

  const resetSwap = useCallback((clearBalances: boolean) => {
    clearModeState();
    setStep("select-mode");
    setMode(null);
    setModeIndex(0);
    setSelectedIndex(0);
    if (clearBalances) {
      setBalances([]);
      setMetadata(new Map());
      setLastUpdated(null);
    }
  }, [clearModeState]);

  const assetSymbol = useCallback((token: TokenBalance): string => {
    return tokenSymbol(token, metadata);
  }, [metadata]);

  const loadBalances = useCallback(async () => {
    if (!walletAddress || fetchInFlight.current) {
      return;
    }

    fetchInFlight.current = true;
    setLoadingBalances(true);
    try {
      const nextBalances = await fetchAllBalances(rpc, walletAddress);
      const mints = [...new Set(nextBalances.map((balance) => balance.mint))];
      const nextMetadata = await fetchTokenMetadata(mints, jupiterApiKey);
      setBalances(nextBalances);
      setMetadata(nextMetadata);
      setSelectedIndex((prev) => Math.min(prev, Math.max(0, nextBalances.length - 1)));
      setLastUpdated(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load balances");
    } finally {
      setLoadingBalances(false);
      fetchInFlight.current = false;
    }
  }, [walletAddress, rpc, jupiterApiKey]);

  useEffect(() => {
    if (isActive && walletAddress && balances.length === 0 && !loadingBalances && !error) {
      void loadBalances();
    }
  }, [isActive, walletAddress, balances.length, loadingBalances, error, loadBalances]);

  useEffect(() => {
    if (isActive && refreshKey > 0) {
      void loadBalances();
    }
  }, [isActive, refreshKey, loadBalances]);

  useEffect(() => {
    if (!preSelectedAsset || balances.length === 0) {
      return;
    }

    const token = balances.find((balance) => balance.id === preSelectedAsset.id);
    if (token) {
      clearModeState();
      setMode("single");
      setSourceToken(token);
      setStep("select-dest");
    }
    onPreSelectedAssetConsumed();
  }, [preSelectedAsset, balances, clearModeState, onPreSelectedAssetConsumed]);

  useEffect(() => {
    return () => {
      if (searchDebounce.current) {
        clearTimeout(searchDebounce.current);
      }
    };
  }, []);

  useEffect(() => {
    resetSwap(true);
  }, [walletAddress, resetSwap]);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 10_000);
    return () => clearInterval(timer);
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
        setDestResults([]);
      } finally {
        setSearchingTokens(false);
      }
    }, 300);
  }, [jupiterApiKey]);

  const getSlippageBps = useCallback(() => {
    const slippagePct = parseFloat(slippageInput || DEFAULT_SLIPPAGE_PCT);
    if (Number.isNaN(slippagePct) || slippagePct < 0.01 || slippagePct > 50) {
      throw new Error("Enter a slippage between 0.01% and 50%.");
    }

    return Math.round(slippagePct * 10) * 10;
  }, [slippageInput]);

  const prepareSinglePreview = useCallback(async () => {
    if (!sourceToken || !destination || amountInput.length === 0) {
      return;
    }

    setLoadingPreview(true);
    setError(null);
    try {
      const amount = validateSwapAmount(sourceToken, amountInput);
      const quote = await getSwapQuote(
        {
          inputMint: sourceToken.mint,
          outputMint: destination.mint,
          amount: String(amount),
          slippageBps: getSlippageBps(),
        },
        jupiterApiKey,
      );
      setSingleQuote(quote);
      setMultiPreview(null);
      setStep("preview");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to get quote");
    } finally {
      setLoadingPreview(false);
    }
  }, [sourceToken, destination, amountInput, getSlippageBps, jupiterApiKey]);

  const prepareDustPreview = useCallback(async () => {
    if (!destination || dustThresholdInput.length === 0) {
      return;
    }

    setLoadingPreview(true);
    setError(null);
    try {
      const maxUsd = Number(dustThresholdInput);
      const mints = [...new Set(balances.map((balance) => balance.mint))];
      const prices = await fetchTokenPrices(mints, jupiterApiKey);
      const plan = buildDustSwapPlan({
        balances,
        metadata,
        prices,
        destinationMint: destination.mint,
        destinationSymbol: destination.symbol,
        maxUsd,
        slippageBps: getSlippageBps(),
        includeUnpriced: false,
      });
      const preview = await previewDustSwapPlan(plan, jupiterApiKey);
      setMultiPreview(preview);
      setMultiOutputDecimals(new Map([[destination.mint, destination.decimals ?? 6]]));
      setSingleQuote(null);
      setStep("preview");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to prepare dust swap");
    } finally {
      setLoadingPreview(false);
    }
  }, [destination, dustThresholdInput, balances, metadata, getSlippageBps, jupiterApiKey]);

  const prepareSplitPreview = useCallback(async () => {
    if (!sourceToken || amountInput.length === 0 || splitAllocationsInput.length === 0) {
      return;
    }

    setLoadingPreview(true);
    setError(null);
    try {
      const allocations = splitAllocationsInput.split(",").map((entry) => entry.trim()).filter(Boolean);
      if (allocations.length === 0) {
        throw new Error("Enter at least one split allocation.");
      }

      const resolvedAllocations = [];
      for (const entry of allocations) {
        const separatorIndex = entry.indexOf(":");
        if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
          throw new Error(`Invalid split allocation: ${entry}`);
        }

        const percent = Number(entry.slice(0, separatorIndex));
        if (!Number.isFinite(percent) || percent <= 0) {
          throw new Error(`Invalid split allocation percentage: ${entry}`);
        }

        const selector = entry.slice(separatorIndex + 1).trim();
        const token = await resolveDestinationToken(selector, jupiterApiKey);
        resolvedAllocations.push({
          mint: token.mint,
          symbol: token.symbol,
          decimals: token.decimals,
          percent,
        });
      }

      const plan = buildSplitSwapPlan({
        sourceToken,
        sourceSymbol: assetSymbol(sourceToken),
        amountArg: amountInput,
        allocations: resolvedAllocations,
        slippageBps: getSlippageBps(),
      });
      const preview = await previewStrictMultiSwapPlan(plan, jupiterApiKey);
      setMultiPreview(preview);
      setMultiOutputDecimals(new Map(
        resolvedAllocations.map((allocation) => [allocation.mint, allocation.decimals ?? 6]),
      ));
      setSingleQuote(null);
      setStep("preview");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to prepare split swap");
    } finally {
      setLoadingPreview(false);
    }
  }, [sourceToken, amountInput, splitAllocationsInput, jupiterApiKey, assetSymbol, getSlippageBps]);

  const beginUnlock = useCallback(() => {
    const activeWallet = getActiveWalletEntry();
    setUnlockWalletId(activeWallet?.id ?? null);
    setUnlockWalletLabel(activeWallet?.label ?? "Active Wallet");
    setUnlockInput("");
    setUnlockError(null);
    setUnlocking(false);
    setStep("unlock");
  }, []);

  const doSingleSwap = useCallback(async () => {
    if (!singleQuote) {
      return;
    }

    pendingExecutionRef.current = doSingleSwap;

    try {
      const signer = await getActiveWalletSigner();
      if (!signer) {
        throw new Error("No active wallet signer available.");
      }

      setStep("executing");
      setSwapStatus("Preparing...");
      const result = await executeSwap(singleQuote, signer, rpc, jupiterApiKey, setSwapStatus);
      setSingleResult(result);
      setMultiResult(null);
      setStep("result");
      if (result.success) {
        onTransactionComplete();
      }
    } catch (err: unknown) {
      if (err instanceof WalletLockedError) {
        beginUnlock();
        return;
      }

      setSingleResult({
        success: false,
        signature: null,
        inputMint: singleQuote.inputMint,
        outputMint: singleQuote.outputMint,
        inAmount: singleQuote.inAmount,
        outAmount: singleQuote.outAmount,
        error: err instanceof Error ? err.message : "Unknown swap error",
      });
      setMultiResult(null);
      setStep("result");
    }
  }, [singleQuote, rpc, jupiterApiKey, onTransactionComplete, beginUnlock]);

  const doMultiSwap = useCallback(async () => {
    if (!multiPreview) {
      return;
    }

    pendingExecutionRef.current = doMultiSwap;

    try {
      const signer = await getActiveWalletSigner();
      if (!signer) {
        throw new Error("No active wallet signer available.");
      }

      setStep("executing");
      setSwapStatus("Preparing...");
      const result = await executeMultiSwapPlan(
        multiPreview.executionPlan,
        signer,
        rpc,
        jupiterApiKey,
        setSwapStatus,
      );
      setMultiResult(result);
      setSingleResult(null);
      setStep("result");
      if (result.summary.legsSucceeded > 0) {
        onTransactionComplete();
      }
    } catch (err: unknown) {
      if (err instanceof WalletLockedError) {
        beginUnlock();
        return;
      }

      setError(err instanceof Error ? err.message : "Failed to execute multi-swap");
      setStep("preview");
    }
  }, [multiPreview, rpc, jupiterApiKey, onTransactionComplete, beginUnlock]);

  const submitUnlock = useCallback(async () => {
    if (!unlockWalletId || unlocking || !pendingExecutionRef.current) {
      return;
    }

    setUnlocking(true);
    setUnlockError(null);

    try {
      await unlockWallet(unlockWalletId, unlockInput);
      setUnlockInput("");
      setUnlocking(false);
      setStep("preview");
      await pendingExecutionRef.current();
    } catch (err: unknown) {
      if (err instanceof WalletPassphraseError || (err instanceof Error && err.message === "Incorrect passphrase.")) {
        setUnlockError("Incorrect passphrase.");
        setUnlocking(false);
        return;
      }

      setUnlocking(false);
      setUnlockInput("");
      setError(err instanceof Error ? err.message : "Failed to unlock wallet.");
      setStep("preview");
    }
  }, [unlockWalletId, unlocking, unlockInput]);

  useInput((input, key) => {
    if (!isActive) {
      return;
    }

    if (key.escape) {
      setError(null);
      if (step === "unlock") {
        setUnlockInput("");
        setUnlockError(null);
        setUnlocking(false);
        setStep("preview");
        return;
      }

      if (step === "result") {
        clearModeState();
        setStep("select-mode");
        setMode(null);
        return;
      }

      if (step !== "select-mode" && step !== "executing") {
        setStep(getBackStep(mode, step));
        if (step === "preview") {
          setSingleQuote(null);
          setMultiPreview(null);
        }
      }
      return;
    }

    if (step === "unlock") {
      if (key.return && unlockInput.length > 0) {
        void submitUnlock();
        return;
      }
      if ((key.backspace || key.delete) && !unlocking) {
        setUnlockInput((value) => value.slice(0, -1));
        setUnlockError(null);
        return;
      }
      if (input && !key.ctrl && !key.meta && !unlocking) {
        setUnlockInput((value) => value + input);
        setUnlockError(null);
      }
      return;
    }

    if (step === "select-mode") {
      if (key.upArrow) {
        setModeIndex((value) => Math.max(0, value - 1));
        return;
      }
      if (key.downArrow) {
        setModeIndex((value) => Math.min(MODE_OPTIONS.length - 1, value + 1));
        return;
      }
      if (key.return) {
        clearModeState();
        const nextMode = MODE_OPTIONS[modeIndex]?.mode ?? "single";
        setMode(nextMode);
        if (nextMode === "dust") {
          setStep("select-dest");
        } else {
          setStep("select-source");
        }
      }
      return;
    }

    if (step === "select-source") {
      if (input === "r") {
        void loadBalances();
        return;
      }
      if (key.upArrow && balances.length > 0) {
        setSelectedIndex((value) => Math.max(0, value - 1));
        return;
      }
      if (key.downArrow && balances.length > 0) {
        setSelectedIndex((value) => Math.min(balances.length - 1, value + 1));
        return;
      }
      if (key.return && balances.length > 0) {
        const selectedToken = balances[selectedIndex];
        setSourceToken(selectedToken);
        if (mode === "single") {
          setStep("select-dest");
        } else {
          setStep("enter-amount");
        }
      }
      return;
    }

    if (step === "select-dest") {
      const maxVisible = Math.min(destResults.length, 10);
      if (key.upArrow && maxVisible > 0) {
        setDestSearchIndex((value) => Math.max(0, value - 1));
        return;
      }
      if (key.downArrow && maxVisible > 0) {
        setDestSearchIndex((value) => Math.min(maxVisible - 1, value + 1));
        return;
      }
      if (key.return && maxVisible > 0) {
        const selectedToken = destResults[destSearchIndex];
        setDestination({
          mint: selectedToken.mint,
          symbol: selectedToken.symbol,
          decimals: selectedToken.decimals,
        });
        if (mode === "single") {
          setStep("enter-amount");
        } else {
          setStep("enter-dust-threshold");
        }
        return;
      }
      if (key.backspace || key.delete) {
        const nextValue = destSearch.slice(0, -1);
        setDestSearch(nextValue);
        searchDestToken(nextValue);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        const nextValue = destSearch + input;
        setDestSearch(nextValue);
        searchDestToken(nextValue);
      }
      return;
    }

    if (step === "enter-amount") {
      if (key.return && amountInput.length > 0) {
        if (mode === "split") {
          setStep("enter-split-allocations");
        } else {
          setStep("enter-slippage");
        }
        return;
      }
      if (key.backspace || key.delete) {
        setAmountInput((value) => value.slice(0, -1));
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
      }
      return;
    }

    if (step === "enter-dust-threshold") {
      if (key.return && dustThresholdInput.length > 0) {
        setStep("enter-slippage");
        return;
      }
      if (key.backspace || key.delete) {
        setDustThresholdInput((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta && input.length === 1) {
        if (/\d/.test(input) || (input === "." && !dustThresholdInput.includes("."))) {
          setDustThresholdInput((value) => value + input);
        }
      }
      return;
    }

    if (step === "enter-split-allocations") {
      if (key.return && splitAllocationsInput.length > 0) {
        setStep("enter-slippage");
        return;
      }
      if (key.backspace || key.delete) {
        setSplitAllocationsInput((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSplitAllocationsInput((value) => value + input);
      }
      return;
    }

    if (step === "enter-slippage") {
      if (key.return) {
        if (mode === "single") {
          void prepareSinglePreview();
        } else if (mode === "dust") {
          void prepareDustPreview();
        } else {
          void prepareSplitPreview();
        }
        return;
      }
      if (key.backspace || key.delete) {
        setSlippageInput((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta && input.length === 1) {
        if (/\d/.test(input) || (input === "." && !slippageInput.includes("."))) {
          setSlippageInput((value) => value + input);
        }
      }
      return;
    }

    if (step === "preview") {
      if (input === "c" || key.return) {
        if (mode === "single") {
          void doSingleSwap();
        } else {
          void doMultiSwap();
        }
      }
      return;
    }

    if (step === "result") {
      if (input === "y" && singleResult?.signature) {
        if (copyToClipboard(singleResult.signature)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
        return;
      }
      if (key.return || input === "n") {
        clearModeState();
        setStep("select-mode");
        setMode(null);
      }
    }
  }, { isActive });

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

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold>Swap</Text>
        {lastUpdated && (step === "select-mode" || step === "select-source") && (
          <Text dimColor>updated {timeAgo(lastUpdated)}</Text>
        )}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {step === "select-mode" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Choose swap mode:</Text>
          {MODE_OPTIONS.map((option, index) => {
            const isSelected = index === modeIndex;
            return (
              <Box key={option.mode} marginTop={1}>
                <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                  {isSelected ? "> " : "  "}
                  {option.label.padEnd(8)}
                </Text>
                <Text dimColor>{option.description}</Text>
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text dimColor>[up/down] navigate  [enter] select</Text>
          </Box>
        </Box>
      )}

      {step === "select-source" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {mode === "split" ? "Select token to split from:" : "Select token to swap from:"}
          </Text>
          {!loadingBalances && balances.length === 0 && !error && (
            <Box marginTop={1}>
              <Text dimColor>No tokens found.</Text>
            </Box>
          )}
          {balances.map((balance, index) => {
            const isSelected = index === selectedIndex;
            return (
              <Box key={balance.id}>
                <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                  {isSelected ? "> " : "  "}
                  {assetSymbol(balance).padEnd(10)}
                  {balance.balance.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                </Text>
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text dimColor>[up/down] navigate  [enter] select  [esc] back</Text>
          </Box>
        </Box>
      )}

      {step === "select-dest" && (
        <Box flexDirection="column" marginTop={1}>
          {sourceToken && (
            <Box>
              <Text dimColor>From: </Text>
              <Text color="cyan">{assetSymbol(sourceToken)}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              {mode === "dust" ? "Search dust destination token: " : "Search destination token: "}
            </Text>
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
              {destResults.slice(0, 10).map((token, index) => {
                const isSelected = index === destSearchIndex;
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

      {step === "enter-amount" && sourceToken && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>From: </Text>
            <Text color="cyan">{assetSymbol(sourceToken)}</Text>
          </Box>
          {destination && mode === "single" && (
            <Box>
              <Text dimColor>To: </Text>
              <Text color="cyan">{destination.symbol}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Available: </Text>
            <Text>
              {sourceToken.balance.toLocaleString("en-US", { maximumFractionDigits: 6 })} {assetSymbol(sourceToken)}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Amount: </Text>
            <Text>{amountInput || " "}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              [type] amount or "max"  [enter] next  [esc] back
            </Text>
          </Box>
        </Box>
      )}

      {step === "enter-dust-threshold" && destination && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Dust destination: </Text>
            <Text color="cyan">{destination.symbol}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Max USD per asset: </Text>
            <Text>{dustThresholdInput || " "}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[type] threshold  [enter] next  [esc] back</Text>
          </Box>
        </Box>
      )}

      {step === "enter-split-allocations" && sourceToken && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>From: </Text>
            <Text color="cyan">{assetSymbol(sourceToken)}</Text>
          </Box>
          <Box>
            <Text dimColor>Amount: </Text>
            <Text>{getSourceAmountLabel(sourceToken, amountInput)}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Split allocations: </Text>
            <Text>{splitAllocationsInput || " "}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Example: 50:JitoSOL,30:mSOL,20:JupSOL</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[type] allocations  [enter] next  [esc] back</Text>
          </Box>
        </Box>
      )}

      {step === "enter-slippage" && (
        <Box flexDirection="column" marginTop={1}>
          {mode === "single" && sourceToken && destination && (
            <>
              <Box>
                <Text dimColor>From: </Text>
                <Text color="cyan">{assetSymbol(sourceToken)}</Text>
              </Box>
              <Box>
                <Text dimColor>To: </Text>
                <Text color="cyan">{destination.symbol}</Text>
              </Box>
            </>
          )}
          {mode === "dust" && destination && (
            <Box>
              <Text dimColor>Dust destination: </Text>
              <Text color="cyan">{destination.symbol}</Text>
            </Box>
          )}
          {mode === "split" && sourceToken && (
            <Box>
              <Text dimColor>Split source: </Text>
              <Text color="cyan">{assetSymbol(sourceToken)}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Max slippage (%): </Text>
            <Text>{slippageInput}</Text>
            <Text dimColor>_</Text>
          </Box>
          {loadingPreview && (
            <Box marginTop={1}>
              <Text dimColor>Preparing preview...</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>[enter] preview  [esc] back</Text>
          </Box>
        </Box>
      )}

      {step === "preview" && mode === "single" && singleQuote && sourceToken && destination && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Swap Preview</Text>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text dimColor>{"Sell:      "}</Text>
              <Text>{formatAmount(singleQuote.inAmount, sourceToken.decimals)} {assetSymbol(sourceToken)}</Text>
            </Box>
            <Box>
              <Text dimColor>{"Receive:   "}</Text>
              <Text color="green">{formatAmount(singleQuote.outAmount, destination.decimals ?? 6)} {destination.symbol}</Text>
            </Box>
            <Box>
              <Text dimColor>{"Min out:   "}</Text>
              <Text>{formatAmount(singleQuote.otherAmountThreshold, destination.decimals ?? 6)}</Text>
            </Box>
            <Box>
              <Text dimColor>{"Max slip:  "}</Text>
              <Text>{(singleQuote.slippageBps / 100).toFixed(2)}%</Text>
            </Box>
            <Box>
              <Text dimColor>{"Impact:    "}</Text>
              <Text color={Number(singleQuote.priceImpactPct) > 1 ? "red" : Number(singleQuote.priceImpactPct) > 0.1 ? "yellow" : undefined}>
                {Number(singleQuote.priceImpactPct).toFixed(4)}%
              </Text>
            </Box>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[c/enter] confirm swap  [esc] back</Text>
          </Box>
        </Box>
      )}

      {step === "preview" && mode !== "single" && multiPreview && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{mode === "dust" ? "Dust Swap Preview" : "Split Swap Preview"}</Text>
          <Box marginTop={1}>
            <Text dimColor>Planned: </Text>
            <Text>{multiPreview.executionPlan.summary.legsPlanned}</Text>
            {multiPreview.executionPlan.summary.legsSkipped > 0 && (
              <Text dimColor>{`  Skipped: ${multiPreview.executionPlan.summary.legsSkipped}`}</Text>
            )}
          </Box>
          <Box marginTop={1} flexDirection="column">
            {multiPreview.previewLegs.map(({ leg, quote }) => {
              const inputBalance = balances.find((balance) => balance.mint === leg.inputMint);
              const inputDecimals = inputBalance?.decimals ?? 9;
              const outputDecimals = multiOutputDecimals.get(leg.outputMint) ?? 6;
              return (
                <Box key={`${leg.index}-${leg.outputMint}`}>
                  <Text>
                    {`${leg.index + 1}. ${formatAmount(quote.inAmount, inputDecimals)} ${leg.inputSymbol}`}
                    {` -> ${formatAmount(quote.outAmount, outputDecimals)} ${leg.outputSymbol}`}
                  </Text>
                </Box>
              );
            })}
          </Box>
          {mode === "dust" && multiPreview.executionPlan.skipped.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>Skipped:</Text>
              {multiPreview.executionPlan.skipped.map((leg) => (
                <Box key={`${leg.inputMint}-${leg.reason}`} paddingLeft={2}>
                  <Text dimColor>{`${leg.inputSymbol}: ${leg.reason}`}</Text>
                </Box>
              ))}
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              {mode === "dust"
                ? "This plan executes as separate swap transactions. Earlier legs may succeed even if a later leg fails."
                : "This plan executes as separate swap transactions and stops on the first failed leg."}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[c/enter] confirm swap  [esc] back</Text>
          </Box>
        </Box>
      )}

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

      {step === "result" && singleResult && (
        <Box flexDirection="column" marginTop={1}>
          {singleResult.success ? (
            <>
              <Text color="green" bold>Swap successful!</Text>
              <Box marginTop={1} flexDirection="column">
                <Box>
                  <Text dimColor>{"Sold:     "}</Text>
                  <Text>
                    {formatAmount(singleResult.inAmount, sourceToken?.decimals ?? 9)} {sourceToken ? assetSymbol(sourceToken) : truncateAddress(singleResult.inputMint)}
                  </Text>
                </Box>
                <Box>
                  <Text dimColor>{"Received: "}</Text>
                  <Text color="green">
                    {formatAmount(singleResult.outAmount, destination?.decimals ?? 6)} {destination?.symbol ?? truncateAddress(singleResult.outputMint)}
                  </Text>
                </Box>
                <Box>
                  <Text dimColor>{"Tx:       "}</Text>
                  <Link url={`${SOLSCAN_TX_URL}${singleResult.signature!}`}>
                    <Text>{truncateAddress(singleResult.signature!)}</Text>
                  </Link>
                </Box>
              </Box>
            </>
          ) : (
            <>
              <Text color="red" bold>Swap failed</Text>
              <Box marginTop={1}>
                <Text color="red">{singleResult.error}</Text>
              </Box>
            </>
          )}
          <Box marginTop={1} gap={2}>
            <Text dimColor>[enter/n] new swap{singleResult.success ? "  [y] copy tx" : ""}  [esc] back</Text>
            {copied && <Text color="green">copied!</Text>}
          </Box>
        </Box>
      )}

      {step === "result" && !singleResult && multiResult && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={multiResult.summary.legsFailed > 0 ? "yellow" : "green"} bold>
            {mode === "dust" ? "Dust swap complete" : "Split swap complete"}
          </Text>
          <Box marginTop={1}>
            <Text>
              {`${multiResult.summary.legsSucceeded} succeeded, ${multiResult.summary.legsFailed} failed, ${multiResult.summary.legsUnattempted} unattempted.`}
            </Text>
          </Box>
          {multiResult.skipped.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>Skipped:</Text>
              {multiResult.skipped.map((leg) => (
                <Box key={`${leg.inputMint}-${leg.reason}`} paddingLeft={2}>
                  <Text dimColor>{`${leg.inputSymbol}: ${leg.reason}`}</Text>
                </Box>
              ))}
            </Box>
          )}
          <Box marginTop={1} flexDirection="column">
            {multiResult.legs.map((legResult) => (
              <Box key={`${legResult.leg.index}-${legResult.leg.outputMint}`}>
                <Text color={legResult.result.success ? "green" : "red"}>
                  {`${legResult.leg.outputSymbol}: `}
                </Text>
                {legResult.result.success && legResult.result.signature ? (
                  <Link url={`${SOLSCAN_TX_URL}${legResult.result.signature}`}>
                    <Text>{truncateAddress(legResult.result.signature)}</Text>
                  </Link>
                ) : (
                  <Text>{legResult.result.error}</Text>
                )}
              </Box>
            ))}
            {multiResult.unattempted.map((legResult) => (
              <Box key={`${legResult.leg.index}-${legResult.leg.outputMint}-unattempted`}>
                <Text dimColor>{`${legResult.leg.outputSymbol}: ${legResult.reason}`}</Text>
              </Box>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter/n] new swap  [esc] back</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
