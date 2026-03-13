import React from "react";
import { Box, Text } from "ink";

export default function WalletsScreen() {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Wallets</Text>
      <Box marginTop={1}>
        <Text dimColor>Wallet management will appear here.</Text>
      </Box>
    </Box>
  );
}
