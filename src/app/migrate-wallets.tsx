import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  getLegacyWalletMigrationInfo,
  migrateLegacyWallets,
} from "../wallet/index.js";

type MigrationStep = "intro" | "passphrase" | "confirm" | "migrating" | "done";

interface MigrateWalletsProps {
  onComplete: () => void;
}

export default function MigrateWallets({ onComplete }: MigrateWalletsProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<MigrationStep>("intro");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const info = getLegacyWalletMigrationInfo();

  useInput((input, key) => {
    if (key.escape) {
      if (step === "migrating") {
        return;
      }
      exit();
      return;
    }

    if (step === "intro") {
      if (key.return) {
        setError(null);
        setStep("passphrase");
      }
      return;
    }

    if (step === "passphrase") {
      if (key.return && passphrase.length > 0) {
        setError(null);
        setStep("confirm");
        return;
      }
      if (key.backspace || key.delete) {
        setPassphrase((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setPassphrase((value) => value + input);
      }
      return;
    }

    if (step === "confirm") {
      if (key.return && confirmPassphrase.length > 0) {
        if (confirmPassphrase !== passphrase) {
          setError("Passphrases do not match.");
          setConfirmPassphrase("");
          setStep("passphrase");
          return;
        }

        setStep("migrating");
        setError(null);
        void migrateLegacyWallets(passphrase)
          .then(() => {
            setPassphrase("");
            setConfirmPassphrase("");
            setStep("done");
          })
          .catch((migrationError: unknown) => {
            setError(migrationError instanceof Error ? migrationError.message : "Migration failed.");
            setConfirmPassphrase("");
            setStep("passphrase");
          });
        return;
      }
      if (key.backspace || key.delete) {
        setConfirmPassphrase((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setConfirmPassphrase((value) => value + input);
      }
      return;
    }

    if (step === "done" && key.return) {
      onComplete();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="yellow">wui security upgrade</Text>
      <Text dimColor>wui now encrypts wallet keypairs at rest.</Text>

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {step === "intro" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            Found {info.count} existing wallet{info.count === 1 ? "" : "s"} using the older plaintext format.
          </Text>
          <Box marginTop={1} flexDirection="column">
            {info.labels.map((label) => (
              <Text key={label} dimColor>- {label}</Text>
            ))}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>This one-time upgrade will encrypt your existing wui-managed wallets.</Text>
            <Text dimColor>External keypair files are never deleted unless they already live in ~/.wui/keys.</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] continue  [esc] quit</Text>
          </Box>
        </Box>
      )}

      {step === "passphrase" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Set a passphrase for your migrated wallets:</Text>
          <Box marginTop={1}>
            <Text>{"*".repeat(passphrase.length)}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Minimum 12 characters. This passphrase will be used for all migrated wallets.</Text>
          </Box>
        </Box>
      )}

      {step === "confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Confirm passphrase:</Text>
          <Box marginTop={1}>
            <Text>{"*".repeat(confirmPassphrase.length)}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] migrate  [esc] quit</Text>
          </Box>
        </Box>
      )}

      {step === "migrating" && (
        <Box marginTop={1}>
          <Text dimColor>Migrating wallets to encrypted storage...</Text>
        </Box>
      )}

      {step === "done" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green" bold>Wallet migration complete.</Text>
          <Box marginTop={1}>
            <Text dimColor>[enter] continue to wui</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
