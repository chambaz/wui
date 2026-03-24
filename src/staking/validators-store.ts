import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CustomValidator } from "../types/staking.js";
import { DEFAULT_VALIDATORS } from "./constants.js";

const DATA_DIR = join(homedir(), ".wui");
const VALIDATORS_PATH = join(DATA_DIR, "validators.json");

export function loadCustomValidators(): CustomValidator[] {
  if (!existsSync(VALIDATORS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(VALIDATORS_PATH, "utf-8")) as CustomValidator[];
  } catch {
    throw new Error("Failed to read saved validators.");
  }
}

export function saveCustomValidator(label: string, voteAccount: string): void {
  const validators = loadCustomValidators();
  if (
    DEFAULT_VALIDATORS.some((validator) => validator.voteAccount === voteAccount)
    || validators.some((validator) => validator.voteAccount === voteAccount)
  ) {
    throw new Error("Validator already exists.");
  }
  validators.push({ label, voteAccount });
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(VALIDATORS_PATH, JSON.stringify(validators, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function resolveValidatorLabel(
  voteAccount: string,
  customValidators: CustomValidator[] = loadCustomValidators(),
): string | null {
  const builtin = DEFAULT_VALIDATORS.find((validator) => validator.voteAccount === voteAccount);
  if (builtin) return builtin.label;

  const custom = customValidators.find((validator) => validator.voteAccount === voteAccount);
  return custom?.label ?? null;
}
