export async function promptForPassphrase(message: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(
      "Encrypted wallet is locked. This command requires an interactive terminal to enter the passphrase.",
    );
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stderr = process.stderr;
    const wasRaw = stdin.isRaw;
    let value = "";

    function cleanup(): void {
      stdin.off("data", onData);
      if (!wasRaw) {
        stdin.setRawMode(false);
      }
      stdin.pause();
    }

    function onData(chunk: Buffer): void {
      const input = chunk.toString("utf-8");

      if (input === "\u0003") {
        cleanup();
        stderr.write("\n");
        reject(new Error("Passphrase entry cancelled."));
        return;
      }

      if (input === "\r" || input === "\n") {
        cleanup();
        stderr.write("\n");
        resolve(value);
        return;
      }

      if (input === "\u007f") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stderr.write("\b \b");
        }
        return;
      }

      if (input >= " " && input !== "\u001b") {
        value += input;
        stderr.write("*".repeat(input.length));
      }
    }

    stderr.write(message);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.on("data", onData);
  });
}
