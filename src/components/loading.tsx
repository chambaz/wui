import React from "react";
import { Box, Text } from "ink";

interface LoadingProps {
  message?: string;
}

export default function Loading({ message = "Loading..." }: LoadingProps) {
  return (
    <Box paddingX={1} paddingY={1}>
      <Text dimColor>{message}</Text>
    </Box>
  );
}
