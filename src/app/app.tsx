import React, { useState, useCallback } from "react";
import { Box, useApp, useInput } from "ink";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import type { Screen } from "../types/screens.js";
import type { WalletEntry } from "../types/wallet.js";
import type { AppConfig } from "../config/index.js";
import { getActiveWalletEntry } from "../wallet/index.js";
import Header from "../components/header.js";
import Footer from "../components/footer.js";
import Splash from "../components/splash.js";
import PortfolioScreen from "./screens/portfolio-screen.js";
import SwapScreen from "./screens/swap-screen.js";
import SendScreen from "./screens/send-screen.js";
import ActivityScreen from "./screens/activity-screen.js";
import WalletsScreen from "./screens/wallets-screen.js";
import StakingScreen from "./screens/staking-screen.js";

/** App version. */
const VERSION = "0.1.0";

interface AppProps {
  wallet: WalletEntry | null;
  rpcConnected: boolean;
  rpc: Rpc<SolanaRpcApi>;
  config: AppConfig;
}

const SCREEN_KEYS: Record<string, Screen> = {
  p: "portfolio",
  s: "swap",
  t: "send",
  a: "activity",
  w: "wallets",
  k: "staking",
};

export default function App({ wallet: initialWallet, rpcConnected, rpc, config }: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("portfolio");
  const [wallet, setWallet] = useState<WalletEntry | null>(initialWallet);
  const [swapCapturingInput, setSwapCapturingInput] = useState(false);
  const [sendCapturingInput, setSendCapturingInput] = useState(false);
  const [walletsCapturingInput, setWalletsCapturingInput] = useState(false);
  const [stakingCapturingInput, setStakingCapturingInput] = useState(false);

  // Currently selected mint in portfolio screen (for cross-screen shortcuts).
  const [portfolioSelectedMint, setPortfolioSelectedMint] = useState<string | null>(null);

  // Pre-selected mint passed to swap/send screens when navigating from portfolio.
  const [swapPreSelectedMint, setSwapPreSelectedMint] = useState<string | null>(null);
  const [sendPreSelectedMint, setSendPreSelectedMint] = useState<string | null>(null);

  // Refresh key — incremented after swaps/transfers to trigger portfolio refresh.
  const [portfolioRefreshKey, setPortfolioRefreshKey] = useState(0);

  /** Re-read active wallet from disk after wallet operations. */
  const refreshWallet = useCallback(() => {
    setWallet(getActiveWalletEntry());
  }, []);

  /** Trigger portfolio refresh after a swap or transfer completes. */
  const handleTransactionComplete = useCallback(() => {
    setPortfolioRefreshKey((k) => k + 1);
  }, []);

  useInput((input) => {
    // When a screen is capturing text input, don't process single-key shortcuts.
    if (swapCapturingInput || sendCapturingInput || walletsCapturingInput || stakingCapturingInput) return;

    if (input === "q") {
      exit();
      return;
    }

    if (input in SCREEN_KEYS) {
      const targetScreen = SCREEN_KEYS[input];

      // When switching from portfolio to swap or send, pass the selected mint.
      if (screen === "portfolio" && portfolioSelectedMint) {
        if (targetScreen === "swap") {
          setSwapPreSelectedMint(portfolioSelectedMint);
        } else if (targetScreen === "send") {
          setSendPreSelectedMint(portfolioSelectedMint);
        }
      }

      setScreen(targetScreen);
    }
  });

  return (
    <Box flexDirection="column">
      {/* Splash shown above the app */}
      <Splash version={VERSION} />

      {/* Main app */}
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
            onSelectedMintChange={setPortfolioSelectedMint}
            refreshKey={portfolioRefreshKey}
          />
        </Box>
        <Box display={screen === "swap" ? "flex" : "none"} flexDirection="column">
          <SwapScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            jupiterApiKey={config.jupiterApiKey}
            isActive={screen === "swap"}
            onCapturingInputChange={setSwapCapturingInput}
            preSelectedMint={swapPreSelectedMint}
            onPreSelectedMintConsumed={() => setSwapPreSelectedMint(null)}
            onTransactionComplete={handleTransactionComplete}
          />
        </Box>
        <Box display={screen === "send" ? "flex" : "none"} flexDirection="column">
          <SendScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            jupiterApiKey={config.jupiterApiKey}
            isActive={screen === "send"}
            onCapturingInputChange={setSendCapturingInput}
            preSelectedMint={sendPreSelectedMint}
            onPreSelectedMintConsumed={() => setSendPreSelectedMint(null)}
            onTransactionComplete={handleTransactionComplete}
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
          <WalletsScreen
            isActive={screen === "wallets"}
            onWalletChange={refreshWallet}
            onCapturingInputChange={setWalletsCapturingInput}
          />
        </Box>
        <Box display={screen === "staking" ? "flex" : "none"} flexDirection="column">
          <StakingScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            isActive={screen === "staking"}
            onCapturingInputChange={setStakingCapturingInput}
            onTransactionComplete={handleTransactionComplete}
          />
        </Box>
      </Box>
      <Footer activeScreen={screen} />
    </Box>
  );
}
