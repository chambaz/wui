import type { StakeProvider, ValidatorInfo } from "../types/staking.js";

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const STAKE_POOL_PROGRAM = "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy";
export const STAKE_ACCOUNT_SIZE = 200n;
export const MAX_EPOCH = 18446744073709551615n;

export const STAKE_PROVIDERS: StakeProvider[] = [
  {
    id: "jito",
    label: "Jito (JitoSOL)",
    stakePoolAddress: "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb",
    lstMint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  },
  {
    id: "p0",
    label: "Project 0 (LST)",
    stakePoolAddress: "DqhH94PjkZsjAqEze2BEkWhFQJ6EyU6MdtMphMgnXqeK",
    lstMint: "LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp",
  },
];

export const DEFAULT_VALIDATORS: ValidatorInfo[] = [
  {
    label: "P0 Horizon",
    voteAccount: "mrgn2vsZ5EJ8YEfAMNPXmRux7th9cNfBasQ1JJvVwPn",
  },
  {
    label: "P0 Meridian",
    voteAccount: "mrgn4t2JabSgvGnrCaHXMvz8ocr4F52scsxJnkQMQsQ",
  },
];
