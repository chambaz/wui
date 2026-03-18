import { fetchAllBalances } from "../portfolio/index.js";
import { fetchTokenMetadata, fetchTokenPrices } from "../pricing/index.js";
import { bootstrap, printJson, printTable } from "./index.js";
import { formatUsd, formatPercent } from "../format/index.js";
import type { TokenBalance, TokenMetadata, TokenPrice } from "../types/portfolio.js";

/** Build a portfolio row for display. */
function buildRow(
  b: TokenBalance,
  meta: TokenMetadata | undefined,
  price: TokenPrice | undefined,
) {
  const symbol = meta?.symbol ?? b.mint.slice(0, 8);
  const usdPrice = price?.usdPrice ?? null;
  const usdValue = usdPrice !== null ? b.balance * usdPrice : null;
  const change = price?.priceChange24h ?? null;
  return { symbol, balance: b.balance, usdPrice, usdValue, change, mint: b.mint };
}

export async function portfolioCommand(json: boolean): Promise<void> {
  const { config, rpc, wallet } = await bootstrap();

  const balances = await fetchAllBalances(rpc, wallet.publicKey);
  const mints = balances.map((b) => b.mint);
  const [metadata, prices] = await Promise.all([
    fetchTokenMetadata(mints, config.jupiterApiKey),
    fetchTokenPrices(mints, config.jupiterApiKey),
  ]);

  const rows = balances.map((b) => buildRow(b, metadata.get(b.mint), prices.get(b.mint)));
  let totalValue = 0;
  for (const r of rows) {
    if (r.usdValue !== null) totalValue += r.usdValue;
  }

  if (json) {
    printJson({
      wallet: wallet.publicKey,
      totalValue,
      tokens: rows.map((r) => ({
        mint: r.mint,
        symbol: r.symbol,
        balance: r.balance,
        usdPrice: r.usdPrice,
        usdValue: r.usdValue,
        priceChange24h: r.change,
      })),
    });
    return;
  }

  console.log(`Wallet: ${wallet.publicKey}`);
  console.log(`Total:  ${formatUsd(totalValue)}`);
  console.log();

  const colWidths = [10, 16, 12, 14, 10];
  const tableRows = rows.map((r) => [
    r.symbol,
    r.balance.toLocaleString("en-US", { maximumFractionDigits: 6 }),
    r.usdPrice !== null ? formatUsd(r.usdPrice) : "-",
    r.usdValue !== null ? formatUsd(r.usdValue) : "-",
    r.change !== null ? formatPercent(r.change) : "-",
  ]);

  printTable(["TOKEN", "BALANCE", "PRICE", "VALUE", "24H"], tableRows, colWidths);
}
