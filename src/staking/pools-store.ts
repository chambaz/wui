import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { StakeProvider } from "../types/staking.js";
import { STAKE_PROVIDERS } from "./constants.js";

const DATA_DIR = join(homedir(), ".wui");
const POOLS_PATH = join(DATA_DIR, "pools.json");

export function loadCustomPools(): StakeProvider[] {
  if (!existsSync(POOLS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(POOLS_PATH, "utf-8")) as StakeProvider[];
  } catch {
    throw new Error("Failed to read saved stake pools.");
  }
}

export function saveCustomPool(label: string, stakePoolAddress: string, lstMint: string): StakeProvider {
  const pools = loadCustomPools();
  if (
    STAKE_PROVIDERS.some((pool) => pool.stakePoolAddress === stakePoolAddress)
    || pools.some((pool) => pool.stakePoolAddress === stakePoolAddress)
  ) {
    throw new Error("Stake pool already exists.");
  }

  const provider: StakeProvider = {
    id: `custom-${stakePoolAddress}`,
    label,
    stakePoolAddress,
    lstMint,
  };

  pools.push(provider);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(POOLS_PATH, JSON.stringify(pools, null, 2), { encoding: "utf-8", mode: 0o600 });
  return provider;
}
