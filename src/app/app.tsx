import React, { useState } from "react";
import { Box, useApp, useInput } from "ink";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import type { Screen } from "../types/screens.js";
import type { WalletEntry } from "../types/wallet.js";
import type { AppConfig } from "../config/index.js";
import Header from "../components/header.js";
import Footer from "../components/footer.js";
import PortfolioScreen from "./screens/portfolio-screen.js";
import SwapScreen from "./screens/swap-screen.js";
import ActivityScreen from "./screens/activity-screen.js";
import WalletsScreen from "./screens/wallets-screen.js";

interface AppProps {
  wallet: WalletEntry | null;
  rpcConnected: boolean;
  rpc: Rpc<SolanaRpcApi>;
  config: AppConfig;
}

const SCREEN_KEYS: Record<string, Screen> = {
  p: "portfolio",
  s: "swap",
  a: "activity",
  w: "wallets",
};

export default function App({ wallet, rpcConnected, rpc, config }: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("portfolio");
  const [swapCapturingInput, setSwapCapturingInput] = useState(false);

  useInput((input) => {
    // When the swap screen is capturing text input, don't process
    // single-key shortcuts (they conflict with typing).
    if (swapCapturingInput) return;

    if (input === "q") {
      exit();
      return;
    }

    if (input in SCREEN_KEYS) {
      setScreen(SCREEN_KEYS[input]);
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        walletLabel={wallet?.label ?? null}
        publicKey={wallet?.publicKey ?? null}
        rpcConnected={rpcConnected}
      />
      <Box borderStyle="single" borderTop={false} flexDirection="column" minHeight={10}>
        <Box display={screen === "portfolio" ? "flex" : "none"} flexDirection="column">
          <PortfolioScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            jupiterApiKey={config.jupiterApiKey}
            isActive={screen === "portfolio"}
          />
        </Box>
        <Box display={screen === "swap" ? "flex" : "none"} flexDirection="column">
          <SwapScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            jupiterApiKey={config.jupiterApiKey}
            isActive={screen === "swap"}
            onCapturingInputChange={setSwapCapturingInput}
          />
        </Box>
        <Box display={screen === "activity" ? "flex" : "none"} flexDirection="column">
          <ActivityScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            jupiterApiKey={config.jupiterApiKey}
            isActive={screen === "activity"}
          />
        </Box>
        <Box display={screen === "wallets" ? "flex" : "none"} flexDirection="column">
          <WalletsScreen />
        </Box>
      </Box>
      <Footer activeScreen={screen} />
    </Box>
  );
}
