import React from "react";
import { Box, Text } from "ink";

const WALLET_ART = [
  "      ▄██▄      ",
  "  ▄██████████▄▄ ",
  "  █ ▄▄ ▄▄ ▄▄ ██",
  "  █        ▄███",
  "  █ ▄▄ ▄▄ ▄▄ ██",
  "  ▀████████████ ",
];

interface SplashProps {
  version: string;
}

export default function Splash({ version }: SplashProps) {
  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      <Box flexDirection="column" alignItems="center">
        {WALLET_ART.map((line, i) => (
          <Text key={i} color="cyan">
            {line}
          </Text>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text bold color="cyan">
          wui
        </Text>
        <Text dimColor>Solana wallet for the terminal</Text>
        <Text dimColor>v{version}</Text>
      </Box>
    </Box>
  );
}
