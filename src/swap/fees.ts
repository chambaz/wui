import { type Rpc, type SolanaRpcApi, address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { JUPITER_REFERRAL_PROGRAM, REFERRAL_ACCOUNT_ADDRESS } from "./constants.js";

const REFERRAL_ATA_SEED = "referral_ata";

interface FeeAccountCandidate {
  mint: string;
  account: string;
  exists: boolean;
}

export interface ResolvedFeeAccount {
  feeAccount: string | null;
  feeMint: string | null;
  candidates: FeeAccountCandidate[];
}

async function deriveReferralTokenAccount(mint: string): Promise<string> {
  const encoder = getAddressEncoder();
  const [referralTokenAccount] = await getProgramDerivedAddress({
    programAddress: address(JUPITER_REFERRAL_PROGRAM),
    seeds: [
      new TextEncoder().encode(REFERRAL_ATA_SEED),
      encoder.encode(address(REFERRAL_ACCOUNT_ADDRESS)),
      encoder.encode(address(mint)),
    ],
  });
  return referralTokenAccount;
}

async function feeAccountExists(rpc: Rpc<SolanaRpcApi>, accountAddress: string): Promise<boolean> {
  try {
    const info = await rpc
      .getAccountInfo(address(accountAddress), {
        encoding: "base64",
        dataSlice: { offset: 0, length: 0 },
      })
      .send();
    return info.value !== null;
  } catch {
    return false;
  }
}

async function resolveCandidate(
  rpc: Rpc<SolanaRpcApi>,
  mint: string,
): Promise<FeeAccountCandidate> {
  const account = await deriveReferralTokenAccount(mint);
  const exists = await feeAccountExists(rpc, account);
  return { mint, account, exists };
}

export async function resolveFeeAccount(
  rpc: Rpc<SolanaRpcApi>,
  inputMint: string,
  outputMint: string,
): Promise<ResolvedFeeAccount> {
  if (REFERRAL_ACCOUNT_ADDRESS.startsWith("TODO")) {
    return {
      feeAccount: null,
      feeMint: null,
      candidates: [],
    };
  }

  try {
    const candidates: FeeAccountCandidate[] = [];
    const outputCandidate = await resolveCandidate(rpc, outputMint);
    candidates.push(outputCandidate);

    if (outputCandidate.exists) {
      return {
        feeAccount: outputCandidate.account,
        feeMint: outputCandidate.mint,
        candidates,
      };
    }

    if (inputMint !== outputMint) {
      const inputCandidate = await resolveCandidate(rpc, inputMint);
      candidates.push(inputCandidate);

      if (inputCandidate.exists) {
        return {
          feeAccount: inputCandidate.account,
          feeMint: inputCandidate.mint,
          candidates,
        };
      }
    }

    return {
      feeAccount: null,
      feeMint: null,
      candidates,
    };
  } catch {
    return {
      feeAccount: null,
      feeMint: null,
      candidates: [],
    };
  }
}
