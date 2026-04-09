import { bootstrapWalletStore, printJson } from "./index.js";
import { switchWalletByLabelOrPublicKey } from "../wallet/index.js";

export const WALLET_USAGE = `Usage: wui wallet <subcommand>

Subcommands:
  current                     Show the active wallet
  use <label|pubkey>          Switch the active wallet by exact label or pubkey

Examples:
  wui wallet current
  wui wallet use Dev
  wui wallet use 5Utc...WSJ5`;

export async function walletCommand(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "current": {
      const { wallet } = bootstrapWalletStore();

      if (json) {
        printJson({
          wallet: wallet
            ? {
                label: wallet.label,
                publicKey: wallet.publicKey,
              }
            : null,
        });
        return;
      }

      if (!wallet) {
        console.log("No active wallet.");
        return;
      }

      console.log(`Label:      ${wallet.label}`);
      console.log(`Public key: ${wallet.publicKey}`);
      return;
    }
    case "use": {
      const selector = args[1]?.trim();
      if (!selector) {
        throw new Error("Usage: wui wallet use <label|pubkey>");
      }

      bootstrapWalletStore();
      const wallet = switchWalletByLabelOrPublicKey(selector);

      if (json) {
        printJson({
          wallet: {
            label: wallet.label,
            publicKey: wallet.publicKey,
          },
        });
        return;
      }

      console.log(`Active wallet: ${wallet.label} (${wallet.publicKey})`);
      return;
    }
    default:
      throw new Error(WALLET_USAGE);
  }
}
