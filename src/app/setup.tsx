import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { saveConfig, CONFIG_FILE_PATH } from "../lib/config.js";
import { initRpc, checkRpcHealth } from "../lib/rpc.js";
import { fetchWithTimeout } from "../lib/errors.js";

type SetupStep = "rpc-url" | "jupiter-key" | "validating" | "done";

interface SetupProps {
  onComplete: () => void;
}

export default function Setup({ onComplete }: SetupProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<SetupStep>("rpc-url");
  const [rpcUrl, setRpcUrl] = useState("");
  const [jupiterKey, setJupiterKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback(async () => {
    setStep("validating");
    setError(null);

    // Validate RPC.
    try {
      const rpc = initRpc(rpcUrl);
      const healthy = await checkRpcHealth(rpc);
      if (!healthy) {
        setError("Cannot connect to RPC. Check the URL and try again.");
        setStep("rpc-url");
        return;
      }
    } catch {
      setError("Invalid RPC URL. Check the URL and try again.");
      setStep("rpc-url");
      return;
    }

    // Validate Jupiter API key (quick test).
    try {
      const res = await fetchWithTimeout("https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112", {
        headers: { "x-api-key": jupiterKey },
      }, "Jupiter API");
      if (res.status === 401 || res.status === 403) {
        setError("Invalid Jupiter API key. Get one at https://portal.jup.ag");
        setStep("jupiter-key");
        return;
      }
      if (!res.ok) {
        setError(`Could not validate Jupiter API key (${res.status}). Try again.`);
        setStep("jupiter-key");
        return;
      }
    } catch {
      setError("Could not validate Jupiter API key. Check your network connection.");
      setStep("jupiter-key");
      return;
    }

    // Save config.
    saveConfig(rpcUrl, jupiterKey);
    setStep("done");
  }, [rpcUrl, jupiterKey]);

  useInput((input, key) => {
    // Quit.
    if (key.escape) {
      exit();
      return;
    }

    // --- RPC URL step ---
    if (step === "rpc-url") {
      if (key.return && rpcUrl.length > 0) {
        setError(null);
        setStep("jupiter-key");
        return;
      }
      if (key.backspace || key.delete) {
        setRpcUrl((v) => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setRpcUrl((v) => v + input);
        return;
      }
      return;
    }

    // --- Jupiter key step ---
    if (step === "jupiter-key") {
      if (key.return && jupiterKey.length > 0) {
        validate();
        return;
      }
      if (key.backspace || key.delete) {
        setJupiterKey((v) => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setJupiterKey((v) => v + input);
        return;
      }
      return;
    }

    // --- Done step ---
    if (step === "done") {
      if (key.return) {
        onComplete();
        return;
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyan">wui setup</Text>
      <Text dimColor>Configure your Solana RPC and Jupiter API key.</Text>

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {/* Step: RPC URL */}
      {(step === "rpc-url") && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Solana RPC URL:</Text>
          <Text dimColor>  e.g. https://mainnet.helius-rpc.com/?api-key=...</Text>
          <Box marginTop={1}>
            <Text dimColor>{"> "}</Text>
            <Text>{rpcUrl}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] next  [esc] quit</Text>
          </Box>
        </Box>
      )}

      {/* Step: Jupiter API key */}
      {step === "jupiter-key" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>RPC: </Text>
            <Text color="green">{rpcUrl.slice(0, 50)}{rpcUrl.length > 50 ? "..." : ""}</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Jupiter API Key:</Text>
            <Text dimColor>  Get one free at https://portal.jup.ag</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>{"> "}</Text>
            <Text>{jupiterKey}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] validate & save  [esc] quit</Text>
          </Box>
        </Box>
      )}

      {/* Step: Validating */}
      {step === "validating" && (
        <Box marginTop={1}>
          <Text dimColor>Validating configuration...</Text>
        </Box>
      )}

      {/* Step: Done */}
      {step === "done" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green" bold>Configuration saved!</Text>
          <Box marginTop={1}>
            <Text dimColor>Saved to </Text>
            <Text>{CONFIG_FILE_PATH}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] continue to wui</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
