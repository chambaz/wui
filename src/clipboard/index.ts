import { execSync } from "child_process";

/**
 * Copy text to the system clipboard.
 * Tries platform-specific commands in order: pbcopy (macOS),
 * wl-copy (Wayland), xclip (X11), xsel (X11).
 * Returns true on success, false if no clipboard tool is available.
 */
export function copyToClipboard(text: string): boolean {
  const commands = [
    "pbcopy",
    "wl-copy",
    "xclip -selection clipboard",
    "xsel --clipboard --input",
  ];

  for (const cmd of commands) {
    try {
      execSync(cmd, { input: text, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    } catch {
      // Command not found or failed — try next.
    }
  }

  return false;
}
