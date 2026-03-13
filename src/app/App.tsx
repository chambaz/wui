import React from "react";
import { Box, Text } from "ink";

export default function App() {
  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="single" paddingX={1}>
        <Text bold>walletui</Text>
        <Text> </Text>
        <Text dimColor>v0.1.0</Text>
      </Box>
      <Box paddingX={1} paddingY={1}>
        <Text>Terminal-native Solana wallet</Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>[q] Quit</Text>
      </Box>
    </Box>
  );
}
