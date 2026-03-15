import React from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  walletLabel: string | null;
  publicKey: string | null;
  rpcConnected: boolean;
}

function truncateAddress(address: string): string {
  if (address.length <= 11) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
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
