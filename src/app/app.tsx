import React, { useState, useCallback } from "react";
import { Box, useApp, useInput } from "ink";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import type { Screen } from "../types/screens.js";
import type { SelectedAssetRef } from "../types/portfolio.js";
import type { WalletEntry } from "../types/wallet.js";
import type { AppConfig } from "../lib/config.js";
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
import WrapScreen from "./screens/wrap-screen.js";

interface AppProps {
  wallet: WalletEntry | null;
  rpcConnected: boolean;
  rpc: Rpc<SolanaRpcApi>;
  config: AppConfig;
  version: string;
}

const SCREEN_KEYS: Record<string, Screen> = {
  p: "portfolio",
  s: "swap",
  t: "send",
  a: "activity",
  w: "wallets",
  k: "staking",
};

export default function App({
  wallet: initialWallet,
  rpcConnected,
  rpc,
  config,
  version,
}: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("portfolio");
  const [wallet, setWallet] = useState<WalletEntry | null>(initialWallet);
  const [swapCapturingInput, setSwapCapturingInput] = useState(false);
  const [sendCapturingInput, setSendCapturingInput] = useState(false);
  const [portfolioCapturingInput, setPortfolioCapturingInput] = useState(false);
  const [walletsCapturingInput, setWalletsCapturingInput] = useState(false);
  const [stakingCapturingInput, setStakingCapturingInput] = useState(false);
  const [wrapCapturingInput, setWrapCapturingInput] = useState(false);

  // Currently selected asset in portfolio screen (for cross-screen shortcuts).
  const [portfolioSelectedAsset, setPortfolioSelectedAsset] = useState<
    SelectedAssetRef | null
  >(null);

  // Pre-selected asset passed to swap/send screens when navigating from portfolio.
  const [swapPreSelectedAsset, setSwapPreSelectedAsset] = useState<SelectedAssetRef | null>(null);
  const [sendPreSelectedAsset, setSendPreSelectedAsset] = useState<SelectedAssetRef | null>(null);
  const [wrapEntryAsset, setWrapEntryAsset] = useState<SelectedAssetRef | null>(null);

  // Refresh key — incremented after swaps/transfers/staking to trigger data refreshes.
  const [refreshKey, setRefreshKey] = useState(0);

  /** Re-read active wallet from disk after wallet operations. */
  const refreshWallet = useCallback(() => {
    setWallet(getActiveWalletEntry());
  }, []);

  /** Trigger portfolio refresh after a swap or transfer completes. */
  const handleTransactionComplete = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useInput((input) => {
    // When a screen is capturing text input, don't process single-key shortcuts.
    if (
      portfolioCapturingInput ||
      swapCapturingInput ||
      sendCapturingInput ||
      walletsCapturingInput ||
      stakingCapturingInput ||
      wrapCapturingInput
    )
      return;

    if (input === "q") {
      exit();
      return;
    }

    if (input in SCREEN_KEYS) {
      const targetScreen = SCREEN_KEYS[input];

      // When switching from portfolio to swap or send, pass the selected asset.
      if (screen === "portfolio" && portfolioSelectedAsset) {
        if (targetScreen === "swap") {
          setSwapPreSelectedAsset(portfolioSelectedAsset);
        } else if (targetScreen === "send") {
          setSendPreSelectedAsset(portfolioSelectedAsset);
        }
      }

      setScreen(targetScreen);
    }
  });

  return (
    <Box flexDirection="column">
      {/* Splash shown above the app */}
      <Splash version={version} />

      {/* Main app */}
      <Header
        walletLabel={wallet?.label ?? null}
        publicKey={wallet?.publicKey ?? null}
        rpcConnected={rpcConnected}
      />
      <Box
        borderStyle="single"
        borderTop={false}
        flexDirection="column"
        minHeight={10}
      >
        <Box
          display={screen === "portfolio" ? "flex" : "none"}
          flexDirection="column"
        >
          <PortfolioScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            jupiterApiKey={config.jupiterApiKey}
            isActive={screen === "portfolio"}
            onSelectedMintChange={setPortfolioSelectedAsset}
            onCapturingInputChange={setPortfolioCapturingInput}
            onOpenSwap={(asset) => {
              setSwapPreSelectedAsset(asset);
              setScreen("swap");
            }}
            onOpenSend={(asset) => {
              setSendPreSelectedAsset(asset);
              setScreen("send");
            }}
            onOpenWrap={(asset) => {
              setWrapEntryAsset(asset);
              setScreen("wrap");
            }}
            refreshKey={refreshKey}
          />
        </Box>
        <Box
          display={screen === "swap" ? "flex" : "none"}
          flexDirection="column"
        >
          <SwapScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            jupiterApiKey={config.jupiterApiKey}
            isActive={screen === "swap"}
            onCapturingInputChange={setSwapCapturingInput}
            preSelectedAsset={swapPreSelectedAsset}
            onPreSelectedAssetConsumed={() => setSwapPreSelectedAsset(null)}
            refreshKey={refreshKey}
            onTransactionComplete={handleTransactionComplete}
          />
        </Box>
        <Box
          display={screen === "send" ? "flex" : "none"}
          flexDirection="column"
        >
          <SendScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            jupiterApiKey={config.jupiterApiKey}
            isActive={screen === "send"}
            onCapturingInputChange={setSendCapturingInput}
            preSelectedAsset={sendPreSelectedAsset}
            onPreSelectedAssetConsumed={() => setSendPreSelectedAsset(null)}
            refreshKey={refreshKey}
            onTransactionComplete={handleTransactionComplete}
          />
        </Box>
        <Box
          display={screen === "wrap" ? "flex" : "none"}
          flexDirection="column"
        >
          <WrapScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            isActive={screen === "wrap"}
            entryAsset={wrapEntryAsset}
            onCapturingInputChange={setWrapCapturingInput}
            onTransactionComplete={handleTransactionComplete}
            onExit={() => {
              setWrapEntryAsset(null);
              setScreen("portfolio");
            }}
          />
        </Box>
        <Box
          display={screen === "activity" ? "flex" : "none"}
          flexDirection="column"
        >
          <ActivityScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            jupiterApiKey={config.jupiterApiKey}
            isActive={screen === "activity"}
            refreshKey={refreshKey}
          />
        </Box>
        <Box
          display={screen === "wallets" ? "flex" : "none"}
          flexDirection="column"
        >
          <WalletsScreen
            isActive={screen === "wallets"}
            rpc={rpc}
            onWalletChange={refreshWallet}
            onCapturingInputChange={setWalletsCapturingInput}
          />
        </Box>
        <Box
          display={screen === "staking" ? "flex" : "none"}
          flexDirection="column"
        >
          <StakingScreen
            walletAddress={wallet?.publicKey ?? null}
            rpc={rpc}
            jupiterApiKey={config.jupiterApiKey}
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
