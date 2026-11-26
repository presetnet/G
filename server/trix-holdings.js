import { VOID_TREASURY, TOKEN_2022 } from "./trix-voids.js";

// Keep the full scan off the browser refresh path. Only ranked rows and
// coverage travel in the snapshot; balances are grouped by mint, not ticker.
export async function collectVoidHoldings(rpc, market, previous) {
  const interval = 15 * 60000;
  const now = Date.now();
  if (previous?.source && now - Date.parse(previous.checkedAt) < interval) return previous;
  const source = { source: "trix.holdings", checkedAt: new Date(now).toISOString(),
    sourceUrl: `https://solscan.io/account/${VOID_TREASURY}` };
  try {
    const programs = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", TOKEN_2022];
    const accounts = await Promise.all(programs.map(programId => rpc("getTokenAccountsByOwner",
      [VOID_TREASURY, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }])));
    const balances = new Map();
    for (const page of accounts) {
      for (const row of page.value) {
        const { mint, tokenAmount } = row.account.data.parsed.info;
        const amount = BigInt(tokenAmount.amount);
        if (amount === 0n) continue;
        const entry = balances.get(mint) || { mint, raw: 0n, decimals: tokenAmount.decimals };
        entry.raw += amount;
        balances.set(mint, entry);
      }
    }
    const coins = new Map((market?.ok && !market.stale ? market.coins : [])?.map(c => [c.mintAddress, c]));
    const tokens = [...balances.values()];
    const priced = [], missing = [];
    for (let i = 0; i < tokens.length; i += 100) {
      const batch = tokens.slice(i, i + 100);
      const supplies = await rpc("getMultipleAccounts", [batch.map(t => t.mint), { encoding: "jsonParsed", commitment: "confirmed" }]);
      batch.forEach((t, index) => {
        const coin = coins.get(t.mint);
        const supply = Number(supplies.value[index]?.data?.parsed?.info?.supply);
        const balance = Number(t.raw) / 10 ** t.decimals;
        const row = { mint: t.mint, symbol: coin?.ticker, balance };
        if (supply > 0 && coin?.currentMarketCap > 0) {
          priced.push({ ...row, value: Number(t.raw) / supply * coin.currentMarketCap,
            via: "TRIX cap", priceAt: coin.marketCapUpdatedAt });
        } else missing.push(row);
      });
    }
    let dexFailed = false;
    for (let i = 0; i < missing.length; i += 30) {
      const batch = missing.slice(i, i + 30);
      try {
        const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${batch.map(t => t.mint).join(",")}`,
          { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const pairs = await response.json();
        for (const t of batch) {
          const pair = pairs.filter(p => p.baseToken?.address === t.mint && Number(p.priceUsd) > 0 && p.liquidity?.usd > 0)
            .sort((a, b) => b.liquidity.usd - a.liquidity.usd)[0];
          if (pair) priced.push({ ...t, symbol: pair.baseToken.symbol, value: t.balance * Number(pair.priceUsd),
            via: "DEX Screener", priceAt: new Date().toISOString() });
        }
      } catch { dexFailed = true; break; }
    }
    priced.sort((a, b) => b.value - a.value || a.mint.localeCompare(b.mint));
    return { ...source, ok: true, total: tokens.length, priced: priced.length, dexFailed, top: priced.slice(0, 20) };
  } catch (error) {
    return { ...source, ok: false, reason: error.message };
  }
}
