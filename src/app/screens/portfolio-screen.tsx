import React from "react";
import { Box, Text } from "ink";

export default function PortfolioScreen() {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Portfolio</Text>
      <Box marginTop={1}>
        <Text dimColor>Token balances will appear here.</Text>
      </Box>
    </Box>
  );
}
