import React from "react";
import { Box, Text } from "ink";

export default function SwapScreen() {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Swap</Text>
      <Box marginTop={1}>
        <Text dimColor>Token swap interface will appear here.</Text>
      </Box>
    </Box>
  );
}
