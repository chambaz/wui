import React from "react";
import { Box, Text } from "ink";
import type { Screen } from "../types/screens.js";

interface Shortcut {
  hotkey: string;
  label: string;
  screen?: Screen;
}

const SHORTCUTS: Shortcut[] = [
  { hotkey: "p", label: "Portfolio", screen: "portfolio" },
  { hotkey: "s", label: "Swap", screen: "swap" },
  { hotkey: "t", label: "Transfer", screen: "send" },
  { hotkey: "a", label: "Activity", screen: "activity" },
  { hotkey: "w", label: "Wallets", screen: "wallets" },
  { hotkey: "k", label: "Stake", screen: "staking" },
  { hotkey: "r", label: "Refresh" },
  { hotkey: "q", label: "Quit" },
];

interface FooterProps {
  activeScreen: Screen;
}

export default function Footer({ activeScreen }: FooterProps) {
  return (
    <Box paddingX={1} gap={2}>
      {SHORTCUTS.map((shortcut) => {
        const isActive = shortcut.screen === activeScreen;
        return (
          <Box key={shortcut.hotkey}>
            <Text dimColor>[</Text>
            <Text color={isActive ? "cyan" : undefined} bold={isActive}>
              {shortcut.hotkey}
            </Text>
            <Text dimColor>] {shortcut.label}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
