import { execSync } from "child_process";

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
      // Try next clipboard command.
    }
  }

  return false;
}
