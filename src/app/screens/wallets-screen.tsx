import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { copyToClipboard } from "../../lib/clipboard.js";
import { truncateAddress } from "../../lib/format.js";
import type { WalletEntry } from "../../types/wallet.js";
import {
  listWallets,
  switchWallet,
  createWallet,
  importWallet,
  labelWallet,
  deleteWallet,
  isWalletUnlocked,
  lockWallet,
  unlockWallet,
} from "../../wallet/index.js";

type WalletStep =
  | "list"
  | "create-label"
  | "create-passphrase"
  | "create-passphrase-confirm"
  | "import-label"
  | "import-path"
  | "import-passphrase"
  | "import-passphrase-confirm"
  | "unlock-passphrase"
  | "rename"
  | "confirm-delete";

interface WalletsScreenProps {
  isActive: boolean;
  onWalletChange: () => void;
  onCapturingInputChange: (capturing: boolean) => void;
}

export default function WalletsScreen({
  isActive,
  onWalletChange,
  onCapturingInputChange,
}: WalletsScreenProps) {
  const [step, setStep] = useState<WalletStep>("list");
  const [wallets, setWallets] = useState<WalletEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [importPath, setImportPath] = useState("");
  const [pendingPassphrase, setPendingPassphrase] = useState("");
  const [message, setMessage] = useState<{ text: string; color: string } | null>(null);
  const operationInFlight = useRef(false);

  // Notify parent about input capture — only the list view allows parent shortcuts.
  const isCapturing = step !== "list";
  useEffect(() => {
    onCapturingInputChange(isCapturing);
  }, [isCapturing, onCapturingInputChange]);

  // Load wallets.
  const refreshList = useCallback(() => {
    const list = listWallets();
    setWallets(list);
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, list.length - 1)));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Clear messages after 3 seconds.
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  /** Show a success or error message. */
  function showMessage(text: string, color: string) {
    setMessage({ text, color });
  }

  /** Reset to list view. */
  function resetToList() {
    setStep("list");
    setTextInput("");
    setImportLabel("");
    setImportPath("");
    setPendingPassphrase("");
    refreshList();
  }

  function isSecretStep(currentStep: WalletStep): boolean {
    return (
      currentStep === "create-passphrase" ||
      currentStep === "create-passphrase-confirm" ||
      currentStep === "import-passphrase" ||
      currentStep === "import-passphrase-confirm" ||
      currentStep === "unlock-passphrase"
    );
  }

  useInput(
    (input, key) => {
      if (!isActive) return;

      // --- List view ---
      if (step === "list") {
        if (key.upArrow && wallets.length > 0) {
          setSelectedIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow && wallets.length > 0) {
          setSelectedIndex((i) => Math.min(wallets.length - 1, i + 1));
          return;
        }
        // Switch wallet.
        if (key.return && wallets.length > 0) {
          try {
            switchWallet(selectedIndex);
            onWalletChange();
            refreshList();
            showMessage("Wallet switched", "green");
          } catch (err: unknown) {
            showMessage(err instanceof Error ? err.message : "Failed to switch", "red");
          }
          return;
        }
        // Create.
        if (input === "c") {
          setStep("create-label");
          setTextInput("");
          return;
        }
        // Import.
        if (input === "i") {
          setStep("import-label");
          setTextInput("");
          return;
        }
        // Rename.
        if (input === "l" && wallets.length > 0) {
          setStep("rename");
          setTextInput("");
          return;
        }
        // Delete.
        if (input === "d" && wallets.length > 0) {
          setStep("confirm-delete");
          return;
        }
        if (input === "u" && wallets.length > 0) {
          setStep("unlock-passphrase");
          setTextInput("");
          return;
        }
        if (input === "x" && wallets.length > 0) {
          lockWallet(wallets[selectedIndex].id);
          showMessage(`Locked "${wallets[selectedIndex].label}"`, "yellow");
          refreshList();
          return;
        }
        // Copy public key.
        if (input === "y" && wallets.length > 0) {
          if (copyToClipboard(wallets[selectedIndex].publicKey)) {
            showMessage("Address copied", "green");
          }
          return;
        }
        return;
      }

      // --- Confirm delete ---
      if (step === "confirm-delete") {
        if (input === "y" || input === "Y") {
          try {
            const target = wallets[selectedIndex];
            deleteWallet(target.label);
            onWalletChange();
            showMessage(`Deleted "${target.label}"`, "yellow");
          } catch (err: unknown) {
            showMessage(err instanceof Error ? err.message : "Failed to delete", "red");
          }
          resetToList();
          return;
        }
        resetToList();
        return;
      }

      // --- Text input steps ---
      if (key.escape) {
        operationInFlight.current = false;
        resetToList();
        return;
      }

      if (key.backspace || key.delete) {
        setTextInput((v) => v.slice(0, -1));
        return;
      }

      if (key.return) {
        handleTextSubmit();
        return;
      }

      // Printable characters (supports paste).
      if (input && !key.ctrl && !key.meta) {
        setTextInput((v) => v + input);
      }
    },
    { isActive },
  );

  /** Handle enter key during text input steps. */
  function handleTextSubmit() {
    const value = isSecretStep(step) ? textInput : textInput.trim();
    if (!value) return;

    if (step === "create-label") {
      setImportLabel(value);
      setTextInput("");
      setStep("create-passphrase");
      return;
    }

    if (step === "create-passphrase") {
      setPendingPassphrase(value);
      setTextInput("");
      setStep("create-passphrase-confirm");
      return;
    }

    if (step === "create-passphrase-confirm") {
      if (value !== pendingPassphrase) {
        showMessage("Passphrases do not match", "red");
        setTextInput("");
        setPendingPassphrase("");
        setStep("create-passphrase");
        return;
      }

      operationInFlight.current = true;
      createWallet(importLabel, pendingPassphrase)
        .then(() => {
          if (!operationInFlight.current) return;
          onWalletChange();
          showMessage(`Created encrypted wallet "${importLabel}"`, "green");
          resetToList();
        })
        .catch((err: unknown) => {
          if (!operationInFlight.current) return;
          showMessage(err instanceof Error ? err.message : "Failed to create", "red");
          resetToList();
        })
        .finally(() => { operationInFlight.current = false; });
      return;
    }

    if (step === "import-label") {
      setImportLabel(value);
      setTextInput("");
      setStep("import-path");
      return;
    }

    if (step === "import-path") {
      setImportPath(value);
      setTextInput("");
      setStep("import-passphrase");
      return;
    }

    if (step === "import-passphrase") {
      setPendingPassphrase(value);
      setTextInput("");
      setStep("import-passphrase-confirm");
      return;
    }

    if (step === "import-passphrase-confirm") {
      if (value !== pendingPassphrase) {
        showMessage("Passphrases do not match", "red");
        setTextInput("");
        setPendingPassphrase("");
        setStep("import-passphrase");
        return;
      }

      operationInFlight.current = true;
      importWallet(importPath, importLabel, pendingPassphrase)
        .then(() => {
          if (!operationInFlight.current) return;
          onWalletChange();
          showMessage(`Imported and encrypted "${importLabel}"`, "green");
          resetToList();
        })
        .catch((err: unknown) => {
          if (!operationInFlight.current) return;
          showMessage(err instanceof Error ? err.message : "Failed to import", "red");
          operationInFlight.current = false;
        })
        .finally(() => { operationInFlight.current = false; });
      return;
    }

    if (step === "unlock-passphrase") {
      const target = wallets[selectedIndex];
      if (!target) return;

      operationInFlight.current = true;
      unlockWallet(target.id, value)
        .then(() => {
          if (!operationInFlight.current) return;
          showMessage(`Unlocked "${target.label}"`, "green");
          resetToList();
        })
        .catch((err: unknown) => {
          if (!operationInFlight.current) return;
          showMessage(err instanceof Error ? err.message : "Failed to unlock", "red");
          setTextInput("");
        })
        .finally(() => { operationInFlight.current = false; });
      return;
    }

    if (step === "rename") {
      try {
        const target = wallets[selectedIndex];
        labelWallet(target.label, value);
        onWalletChange();
        showMessage(`Renamed to "${value}"`, "green");
      } catch (err: unknown) {
        showMessage(err instanceof Error ? err.message : "Failed to rename", "red");
      }
      resetToList();
    }
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Wallets</Text>

      {/* Status message */}
      {message && (
        <Box marginTop={1}>
          <Text color={message.color}>{message.text}</Text>
        </Box>
      )}

      {/* Wallet list */}
      {step === "list" && (
        <Box flexDirection="column" marginTop={1}>
          {wallets.length === 0 ? (
            <Text dimColor>No wallets configured. Press [c] to create or [i] to import.</Text>
          ) : (
            <>
              {/* Header */}
              <Box>
                <Text dimColor>
                  {"  "}
                  {"LABEL".padEnd(16)}
                  {"ADDRESS".padEnd(14)}
                  {"STATUS"}
                </Text>
              </Box>
              {/* Rows */}
              {wallets.map((w, i) => {
                const isSelected = i === selectedIndex;
                const indicator = isSelected ? "> " : "  ";
                return (
                  <Box key={w.publicKey}>
                    <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                      {indicator}
                      {w.label.slice(0, 14).padEnd(16)}
                      {truncateAddress(w.publicKey).padEnd(14)}
                    </Text>
                    <Text color={w.isActive ? "green" : undefined} bold={w.isActive}>
                      {w.isActive ? "active" : "      "}
                    </Text>
                    <Text dimColor> </Text>
                    <Text color={isWalletUnlocked(w.id) ? "cyan" : "yellow"}>
                      {isWalletUnlocked(w.id) ? "unlocked" : "locked"}
                    </Text>
                  </Box>
                );
              })}
            </>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              [enter] switch  [u] unlock  [x] lock  [y] copy  [c] create  [i] import  [l] rename  [d] delete
            </Text>
          </Box>
        </Box>
      )}

      {/* Create wallet prompt */}
      {step === "create-label" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Label for new wallet: </Text>
            <Text>{isSecretStep(step) ? "*".repeat(textInput.length) : textInput}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] confirm  [esc] cancel</Text>
          </Box>
        </Box>
      )}

      {step === "create-passphrase" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Label: </Text>
            <Text color="cyan">{importLabel}</Text>
          </Box>
          <Box>
            <Text dimColor>Passphrase: </Text>
            <Text>{"*".repeat(textInput.length)}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Minimum 12 characters</Text>
          </Box>
        </Box>
      )}

      {step === "create-passphrase-confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Confirm passphrase: </Text>
            <Text>{"*".repeat(textInput.length)}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] create  [esc] cancel</Text>
          </Box>
        </Box>
      )}

      {/* Import wallet prompts */}
      {step === "import-label" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Label for imported wallet: </Text>
            <Text>{textInput}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] next  [esc] cancel</Text>
          </Box>
        </Box>
      )}

      {step === "import-path" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Label: </Text>
            <Text color="cyan">{importLabel}</Text>
          </Box>
          <Box>
            <Text dimColor>Path to keypair file: </Text>
            <Text>{textInput}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] import  [esc] cancel</Text>
          </Box>
        </Box>
      )}

      {step === "import-passphrase" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Label: </Text>
            <Text color="cyan">{importLabel}</Text>
          </Box>
          <Box>
            <Text dimColor>Source path: </Text>
            <Text>{importPath}</Text>
          </Box>
          <Box>
            <Text dimColor>Passphrase: </Text>
            <Text>{"*".repeat(textInput.length)}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Wallet will be copied into ~/.wui/keys and encrypted.</Text>
          </Box>
        </Box>
      )}

      {step === "import-passphrase-confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Confirm passphrase: </Text>
            <Text>{"*".repeat(textInput.length)}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] import  [esc] cancel</Text>
          </Box>
        </Box>
      )}

      {step === "unlock-passphrase" && wallets[selectedIndex] && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Unlocking: </Text>
            <Text color="cyan">{wallets[selectedIndex].label}</Text>
          </Box>
          <Box>
            <Text dimColor>Passphrase: </Text>
            <Text>{"*".repeat(textInput.length)}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] unlock  [esc] cancel</Text>
          </Box>
        </Box>
      )}

      {/* Rename prompt */}
      {step === "rename" && wallets[selectedIndex] && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Renaming: </Text>
            <Text color="cyan">{wallets[selectedIndex].label}</Text>
          </Box>
          <Box>
            <Text dimColor>New label: </Text>
            <Text>{textInput}</Text>
            <Text dimColor>_</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[enter] confirm  [esc] cancel</Text>
          </Box>
        </Box>
      )}

      {/* Delete confirmation */}
      {step === "confirm-delete" && wallets[selectedIndex] && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">
            Delete wallet &quot;{wallets[selectedIndex].label}&quot;?
          </Text>
          <Text dimColor>The encrypted wallet file will be deleted from ~/.wui/keys.</Text>
          <Box marginTop={1}>
            <Text dimColor>[y] yes  [any key] cancel</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
