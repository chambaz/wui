import { bootstrapWalletStore, printJson } from "./index.js";

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
    default:
      throw new Error(
        "Usage: wui wallet current",
      );
  }
}
