import React from "react";
import { Box, Text } from "ink";

interface UnlockPromptProps {
  walletLabel: string;
  value: string;
  error: string | null;
  submitting: boolean;
}

export default function UnlockPrompt({
  walletLabel,
  value,
  error,
  submitting,
}: UnlockPromptProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Unlock Wallet</Text>
      <Box marginTop={1}>
        <Text dimColor>Wallet: </Text>
        <Text color="cyan">{walletLabel}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Passphrase: </Text>
        <Text>{"*".repeat(value.length)}</Text>
        <Text dimColor>_</Text>
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {submitting ? "Unlocking..." : "[enter] unlock  [esc] cancel"}
        </Text>
      </Box>
    </Box>
  );
}
