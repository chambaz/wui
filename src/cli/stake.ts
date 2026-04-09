import { fetchAllBalances } from "../portfolio/index.js";
import {
  createNativeStake,
  deactivateStake,
  DEFAULT_VALIDATORS,
  depositToStakePool,
  fetchStakeAccounts,
  loadCustomPools,
  loadCustomValidators,
  STAKE_PROVIDERS,
  withdrawSolFromStakePool,
  withdrawStake,
} from "../staking/index.js";
import { STAKE_ACCOUNT_SIZE } from "../staking/constants.js";
import { formatBalance, parseDecimalAmount } from "../lib/format.js";
import { maxSendableSol } from "../transfer/index.js";
import type { TokenBalance } from "../types/portfolio.js";
import type { StakeAccountInfo, StakeProvider, ValidatorInfo } from "../types/staking.js";
import { bootstrap, getCliActiveSigner, printJson, printTable } from "./index.js";

interface LiquidStakePosition {
  providerId: string;
  providerLabel: string;
  mint: string;
  balance: number;
  rawBalance: bigint;
  decimals: number;
}

interface StakeActionResult {
  mode: "native" | "liquid";
  action: "stake" | "deactivate" | "withdraw";
  signature: string | null;
  success: boolean;
  error: string | null;
  amount: string | null;
  target: string;
}

function allStakeProviders(): StakeProvider[] {
  return [...STAKE_PROVIDERS, ...loadCustomPools()];
}

function allValidators(): ValidatorInfo[] {
  return [...DEFAULT_VALIDATORS, ...loadCustomValidators()];
}

function resolveValidator(selector: string): ValidatorInfo {
  const validators = allValidators();
  const byVoteAccount = validators.find((validator) => validator.voteAccount === selector);
  if (byVoteAccount) {
    return byVoteAccount;
  }

  const byLabel = validators.find((validator) => validator.label === selector);
  if (byLabel) {
    return byLabel;
  }

  throw new Error(`Validator not found: ${selector}`);
}

function resolveStakeProvider(selector: string): StakeProvider {
  const providers = allStakeProviders();
  const byId = providers.find((provider) => provider.id === selector);
  if (byId) {
    return byId;
  }

  const byStakePool = providers.find((provider) => provider.stakePoolAddress === selector);
  if (byStakePool) {
    return byStakePool;
  }

  const byMint = providers.find((provider) => provider.lstMint === selector);
  if (byMint) {
    return byMint;
  }

  throw new Error(`Stake provider not found: ${selector}`);
}

function getNativeSolBalance(balances: TokenBalance[]): TokenBalance {
  const nativeSol = balances.find((balance) => balance.isNative);
  if (!nativeSol) {
    throw new Error("Native SOL balance not found.");
  }

  return nativeSol;
}

async function validateNativeStakeAmount(
  rpc: Awaited<ReturnType<typeof bootstrap>>["rpc"],
  amountArg: string,
  nativeSol: TokenBalance,
): Promise<bigint> {
  const stakeAccountRent = await rpc.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SIZE).send();
  const amount = parseDecimalAmount(amountArg, 9) ?? 0n;
  if (amount <= 0n) {
    throw new Error(`Invalid amount: ${amountArg}`);
  }

  const maxAmount = maxSendableSol(nativeSol.rawBalance) - stakeAccountRent;
  if (amount > maxAmount) {
    throw new Error("Insufficient SOL balance (need to reserve for fees and stake account rent).");
  }

  return amount;
}

function validateLiquidStakeAmount(amountArg: string, nativeSol: TokenBalance): bigint {
  const amount = parseDecimalAmount(amountArg, 9) ?? 0n;
  if (amount <= 0n) {
    throw new Error(`Invalid amount: ${amountArg}`);
  }

  const maxAmount = maxSendableSol(nativeSol.rawBalance);
  if (amount > maxAmount) {
    throw new Error("Insufficient SOL balance (need to reserve for fees).");
  }

  return amount;
}

function validateLiquidUnstakeAmount(amountArg: string, position: LiquidStakePosition): bigint {
  const amount = amountArg === "max"
    ? position.rawBalance
    : parseDecimalAmount(amountArg, position.decimals) ?? 0n;

  if (amount <= 0n) {
    throw new Error(`Invalid amount: ${amountArg}`);
  }

  if (amount > position.rawBalance) {
    throw new Error(`Insufficient balance. Have ${position.balance}, unstaking ${amountArg}.`);
  }

  return amount;
}

function validateNativeWithdrawAmount(amountArg: string, account: StakeAccountInfo): bigint {
  const amount = amountArg === "max"
    ? account.lamports
    : parseDecimalAmount(amountArg, 9) ?? 0n;

  if (amount <= 0n) {
    throw new Error(`Invalid amount: ${amountArg}`);
  }

  if (amount > account.lamports) {
    throw new Error(`Insufficient stake balance. Have ${account.balance}, withdrawing ${amountArg}.`);
  }

  return amount;
}

function findStakeAccount(accounts: StakeAccountInfo[], address: string): StakeAccountInfo {
  const account = accounts.find((item) => item.address === address);
  if (!account) {
    throw new Error(`Stake account not found in this wallet: ${address}`);
  }

  return account;
}

function mapLiquidStakePositions(
  balances: TokenBalance[],
  providers: StakeProvider[],
): LiquidStakePosition[] {
  return balances
    .filter((balance) => !balance.isNative)
    .flatMap((balance) => {
      const provider = providers.find((item) => item.lstMint === balance.mint);
      if (!provider) return [];
      return [{
        providerId: provider.id,
        providerLabel: provider.label,
        mint: balance.mint,
        balance: balance.balance,
        rawBalance: balance.rawBalance,
        decimals: balance.decimals,
      } satisfies LiquidStakePosition];
    });
}

function findLiquidPosition(positions: LiquidStakePosition[], provider: StakeProvider): LiquidStakePosition {
  const position = positions.find((item) => item.mint === provider.lstMint);
  if (!position) {
    throw new Error(`No liquid stake position found for provider ${provider.label}.`);
  }

  return position;
}

function printStakeList(nativeAccounts: StakeAccountInfo[], liquidPositions: LiquidStakePosition[]): void {
  if (nativeAccounts.length === 0 && liquidPositions.length === 0) {
    console.log("No staking positions found.");
    return;
  }

  if (nativeAccounts.length > 0) {
    console.log("Native Staking");
    const rows = nativeAccounts.map((account) => [
      account.address,
      formatBalance(account.balance, 9),
      account.status,
      account.validatorLabel ?? account.validator ?? "-",
    ]);
    printTable(["ACCOUNT", "BALANCE", "STATUS", "VALIDATOR"], rows, [44, 12, 12, 24]);
    console.log();
  }

  if (liquidPositions.length > 0) {
    console.log("Liquid Staking");
    const rows = liquidPositions.map((position) => [
      position.providerLabel,
      formatBalance(position.balance, position.decimals),
      position.mint,
    ]);
    printTable(["PROVIDER", "BALANCE", "LST MINT"], rows, [24, 12, 44]);
  }
}

export async function stakeCommand(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "list") {
    const { rpc, wallet } = await bootstrap();
    const providers = allStakeProviders();
    const [nativeAccounts, balances] = await Promise.all([
      fetchStakeAccounts(rpc, wallet.publicKey),
      fetchAllBalances(rpc, wallet.publicKey),
    ]);
    const liquidPositions = mapLiquidStakePositions(balances, providers);

    if (json) {
      printJson({
        nativeStakeAccounts: nativeAccounts,
        liquidStakePositions: liquidPositions,
      });
      return;
    }

    printStakeList(nativeAccounts, liquidPositions);
    return;
  }

  if (subcommand === "native") {
    const amountArg = args[1]?.trim();
    const validatorArg = args[2]?.trim();
    if (!amountArg || !validatorArg) {
      throw new Error("Usage: wui stake native <amount> <validator-label|vote-account>");
    }

    const { rpc, wallet } = await bootstrap();
    const balances = await fetchAllBalances(rpc, wallet.publicKey);
    const amount = await validateNativeStakeAmount(rpc, amountArg, getNativeSolBalance(balances));
    const validator = resolveValidator(validatorArg);

    if (!json) {
      console.log(`Staking ${amountArg} SOL with ${validator.label}...`);
    }

    const signer = await getCliActiveSigner(json);
    const signature = await createNativeStake(
      rpc,
      signer,
      validator.voteAccount,
      amount,
      json ? undefined : (status) => console.log(status),
    );

    const result: StakeActionResult = {
      mode: "native",
      action: "stake",
      signature,
      success: true,
      error: null,
      amount: String(amount),
      target: validator.voteAccount,
    };

    if (json) {
      printJson(result);
      return;
    }

    console.log(`Native stake successful! Tx: ${signature}`);
    return;
  }

  if (subcommand === "liquid") {
    const amountArg = args[1]?.trim();
    const providerArg = args[2]?.trim();
    if (!amountArg || !providerArg) {
      throw new Error("Usage: wui stake liquid <amount> <provider-id|pool-address|lst-mint>");
    }

    const { rpc, wallet } = await bootstrap();
    const balances = await fetchAllBalances(rpc, wallet.publicKey);
    const amount = validateLiquidStakeAmount(amountArg, getNativeSolBalance(balances));
    const provider = resolveStakeProvider(providerArg);

    if (!json) {
      console.log(`Liquid staking ${amountArg} SOL with ${provider.label}...`);
    }

    const signer = await getCliActiveSigner(json);
    const signature = await depositToStakePool(
      rpc,
      signer,
      provider.stakePoolAddress,
      amount,
      json ? undefined : (status) => console.log(status),
    );

    const result: StakeActionResult = {
      mode: "liquid",
      action: "stake",
      signature,
      success: true,
      error: null,
      amount: String(amount),
      target: provider.stakePoolAddress,
    };

    if (json) {
      printJson(result);
      return;
    }

    console.log(`Liquid stake successful! Tx: ${signature}`);
    return;
  }

  throw new Error(
    "Usage: wui stake <list|native|liquid>",
  );
}

export async function unstakeCommand(args: string[], json: boolean): Promise<void> {
  const mode = args[0];

  if (mode === "native") {
    const action = args[1];
    const stakeAccountArg = args[2]?.trim();
    if (!action || !stakeAccountArg) {
      throw new Error("Usage: wui unstake native <deactivate|withdraw> <stake-account> [amount|max]");
    }

    const { rpc, wallet } = await bootstrap();
    const accounts = await fetchStakeAccounts(rpc, wallet.publicKey);
    const account = findStakeAccount(accounts, stakeAccountArg);

    if (action === "deactivate") {
      if (account.status !== "active" && account.status !== "activating") {
        throw new Error("Stake account must be active before deactivation.");
      }

      if (!json) {
        console.log(`Deactivating native stake account ${account.address}...`);
      }

      const signer = await getCliActiveSigner(json);
      const signature = await deactivateStake(
        rpc,
        signer,
        account.address,
        json ? undefined : (status) => console.log(status),
      );

      const result: StakeActionResult = {
        mode: "native",
        action: "deactivate",
        signature,
        success: true,
        error: null,
        amount: null,
        target: account.address,
      };

      if (json) {
        printJson(result);
        return;
      }

      console.log(`Native stake deactivation successful! Tx: ${signature}`);
      return;
    }

    if (action === "withdraw") {
      const amountArg = args[3]?.trim();
      if (!amountArg) {
        throw new Error("Usage: wui unstake native withdraw <stake-account> <amount|max>");
      }

      if (account.status !== "deactivated") {
        throw new Error("Stake account must be fully deactivated before withdrawing.");
      }

      const amount = validateNativeWithdrawAmount(amountArg, account);

      if (!json) {
        console.log(`Withdrawing ${amountArg} SOL from native stake account ${account.address}...`);
      }

      const signer = await getCliActiveSigner(json);
      const signature = await withdrawStake(
        rpc,
        signer,
        account.address,
        amount,
        json ? undefined : (status) => console.log(status),
      );

      const result: StakeActionResult = {
        mode: "native",
        action: "withdraw",
        signature,
        success: true,
        error: null,
        amount: String(amount),
        target: account.address,
      };

      if (json) {
        printJson(result);
        return;
      }

      console.log(`Native stake withdrawal successful! Tx: ${signature}`);
      return;
    }
  }

  if (mode === "liquid") {
    const amountArg = args[1]?.trim();
    const providerArg = args[2]?.trim();
    if (!amountArg || !providerArg) {
      throw new Error("Usage: wui unstake liquid <amount|max> <provider-id|pool-address|lst-mint>");
    }

    const { rpc, wallet } = await bootstrap();
    const provider = resolveStakeProvider(providerArg);
    const balances = await fetchAllBalances(rpc, wallet.publicKey);
    const liquidPositions = mapLiquidStakePositions(balances, allStakeProviders());
    const position = findLiquidPosition(liquidPositions, provider);
    const amount = validateLiquidUnstakeAmount(amountArg, position);

    if (!json) {
      console.log(`Unstaking ${amountArg} ${provider.label}...`);
    }

    const signer = await getCliActiveSigner(json);
    const signature = await withdrawSolFromStakePool(
      rpc,
      signer,
      provider.stakePoolAddress,
      amount,
      json ? undefined : (status) => console.log(status),
    );

    const result: StakeActionResult = {
      mode: "liquid",
      action: "withdraw",
      signature,
      success: true,
      error: null,
      amount: String(amount),
      target: provider.stakePoolAddress,
    };

    if (json) {
      printJson(result);
      return;
    }

    console.log(`Liquid unstake successful! Tx: ${signature}`);
    return;
  }

  throw new Error(
    "Usage: wui unstake <native|liquid>",
  );
}
