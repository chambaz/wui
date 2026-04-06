export class LedgerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerUnavailableError";
  }
}

export class LedgerActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerActionError";
  }
}

export function formatLedgerError(error: unknown, fallback: string): Error {
  if (error instanceof Error && error.message) {
    return new LedgerActionError(error.message);
  }

  if (typeof error === "string" && error) {
    return new LedgerActionError(error);
  }

  return new LedgerActionError(fallback);
}
