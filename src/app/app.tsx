import React, { useState } from "react";
import { Box, useApp, useInput } from "ink";
import type { Screen } from "../types/screens.js";
import type { WalletEntry } from "../types/wallet.js";
import Header from "../components/header.js";
import Footer from "../components/footer.js";
import PortfolioScreen from "./screens/portfolio-screen.js";
import SwapScreen from "./screens/swap-screen.js";
import WalletsScreen from "./screens/wallets-screen.js";

interface AppProps {
  wallet: WalletEntry | null;
  rpcConnected: boolean;
}

const SCREEN_COMPONENTS: Record<Screen, React.ComponentType> = {
  portfolio: PortfolioScreen,
  swap: SwapScreen,
  wallets: WalletsScreen,
};

const SCREEN_KEYS: Record<string, Screen> = {
  p: "portfolio",
  s: "swap",
  w: "wallets",
};

export default function App({ wallet, rpcConnected }: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("portfolio");

  useInput((input, key) => {
    if (key.escape || input === "q") {
      exit();
      return;
    }

    if (input in SCREEN_KEYS) {
      setScreen(SCREEN_KEYS[input]);
    }
  });

  const ActiveScreen = SCREEN_COMPONENTS[screen];

  return (
    <Box flexDirection="column">
      <Header
        walletLabel={wallet?.label ?? null}
        publicKey={wallet?.publicKey ?? null}
        rpcConnected={rpcConnected}
      />
      <Box borderStyle="single" borderTop={false} flexDirection="column" minHeight={10}>
        <ActiveScreen />
      </Box>
      <Footer activeScreen={screen} />
    </Box>
  );
}
