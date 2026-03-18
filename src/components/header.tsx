import React from "react";
import { Box, Text } from "ink";
import { truncateAddress } from "../format/index.js";

interface HeaderProps {
  walletLabel: string | null;
  publicKey: string | null;
  rpcConnected: boolean;
}

export default function Header({
  walletLabel,
  publicKey,
  rpcConnected,
}: HeaderProps) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box>
        <Text bold>wui</Text>
        {walletLabel && publicKey ? (
          <>
            <Text dimColor> | </Text>
            <Text color="cyan">{walletLabel}</Text>
            <Text dimColor> ({truncateAddress(publicKey)})</Text>
          </>
        ) : (
          <>
            <Text dimColor> | </Text>
            <Text color="yellow">No wallet</Text>
          </>
        )}
      </Box>
      <Box>
        <Text dimColor>RPC: </Text>
        <Text color={rpcConnected ? "green" : "red"}>
          {rpcConnected ? "connected" : "disconnected"}
        </Text>
      </Box>
    </Box>
  );
}
