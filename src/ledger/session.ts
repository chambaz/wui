import { firstValueFrom, timeout } from "rxjs";

import { DEFAULT_LEDGER_DISCOVERY_TIMEOUT_MS } from "./constants.js";
import { formatLedgerError, LedgerUnavailableError } from "./errors.js";
import type { LedgerSessionContext } from "./types.js";

type DeviceManagementKit = {
  isEnvironmentSupported(): boolean;
  startDiscovering(args: { transport: string }): ReturnType<typeof import("rxjs").from>;
  stopDiscovering(): Promise<void>;
  connect(args: { device: unknown }): Promise<string>;
  getConnectedDevice(args: { sessionId: string }): LedgerSessionContext["connectedDevice"];
  disconnect(args: { sessionId: string }): Promise<void>;
};

type LedgerRuntimeModules = {
  DeviceManagementKitBuilder: new () => {
    addTransport(transportFactory: unknown): { build(): DeviceManagementKit };
    build(): DeviceManagementKit;
  };
  SignerSolanaBuilder: new (args: { dmk: DeviceManagementKit; sessionId: string }) => {
    build(): LedgerSessionContext["signer"];
  };
  nodeHidIdentifier: string;
  nodeHidTransportFactory: unknown;
};

let dmkSingleton: DeviceManagementKit | null = null;

function getModuleExports<T>(module: T | { default: T }): T {
  return ((module as { default?: T }).default ?? module) as T;
}

async function loadLedgerRuntimeModules(): Promise<LedgerRuntimeModules> {
  const dmkModule = getModuleExports(await import("@ledgerhq/device-management-kit"));
  const signerModule = getModuleExports(await import("@ledgerhq/device-signer-kit-solana"));
  const transportModule = getModuleExports(await import("@ledgerhq/device-transport-kit-node-hid"));

  return {
    DeviceManagementKitBuilder: dmkModule.DeviceManagementKitBuilder as LedgerRuntimeModules["DeviceManagementKitBuilder"],
    SignerSolanaBuilder: signerModule.SignerSolanaBuilder as unknown as LedgerRuntimeModules["SignerSolanaBuilder"],
    nodeHidIdentifier: transportModule.nodeHidIdentifier,
    nodeHidTransportFactory: transportModule.nodeHidTransportFactory,
  };
}

async function getLedgerDeviceManagementKit(): Promise<{
  dmk: DeviceManagementKit;
  signerBuilder: LedgerRuntimeModules["SignerSolanaBuilder"];
  nodeHidIdentifier: string;
}> {
  if (!dmkSingleton) {
    const { DeviceManagementKitBuilder, nodeHidTransportFactory } = await loadLedgerRuntimeModules();
    dmkSingleton = new DeviceManagementKitBuilder().addTransport(nodeHidTransportFactory).build();
  }

  const { SignerSolanaBuilder, nodeHidIdentifier } = await loadLedgerRuntimeModules();

  return {
    dmk: dmkSingleton,
    signerBuilder: SignerSolanaBuilder,
    nodeHidIdentifier,
  };
}

export async function withLedgerSession<T>(
  callback: (context: LedgerSessionContext) => Promise<T>,
  onStatus?: (status: string) => void,
): Promise<T> {
  const { dmk, signerBuilder: SignerSolanaBuilder, nodeHidIdentifier } = await getLedgerDeviceManagementKit();
  if (!dmk.isEnvironmentSupported()) {
    throw new LedgerUnavailableError(
      "Ledger HID transport is not supported in this environment. Install udev rules and native HID dependencies, then try again.",
    );
  }

  onStatus?.("Connect and unlock your Ledger device...");

  let sessionId: string | null = null;

  try {
    const device = await firstValueFrom(
      dmk.startDiscovering({ transport: nodeHidIdentifier }).pipe(
        timeout({ first: DEFAULT_LEDGER_DISCOVERY_TIMEOUT_MS }),
      ),
    );
    await dmk.stopDiscovering();

    onStatus?.("Connecting to Ledger...");
    sessionId = await dmk.connect({ device });
    const connectedDevice = dmk.getConnectedDevice({ sessionId });
    const signer = new SignerSolanaBuilder({ dmk, sessionId }).build();

    return await callback({ connectedDevice, signer });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new LedgerUnavailableError(
        "No Ledger device found. Connect it with USB, unlock it, and open the Solana app.",
      );
    }

    throw formatLedgerError(error, "Failed to connect to Ledger.");
  } finally {
    await dmk.stopDiscovering().catch(() => undefined);
    if (sessionId) {
      await dmk.disconnect({ sessionId }).catch(() => undefined);
    }
  }
}
