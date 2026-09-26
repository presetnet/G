// ASSET VIEWER core — on-chain holdings for any wallet, keyed or keyless.
//
// Solana: the public JSON-RPC (api.mainnet-beta) or a keyed SOLANA_RPC_URL /
// Helius endpoint when one is configured. Ethereum mainnet: Blockscout's v2
// API (no key). Everything the desk believes about a wallet is fetched live
// here, and each row names the endpoint that served it, so a reader can
// re-check it themselves.
//
// Desk rules that this module keeps:
//   - a failed read never prints a zero balance. Rows are ok:false with null
//     numbers, or the last good read served with stale:true;
//   - capped walks (NFT pages, signature pages, token lists) say so in caps[];
//   - a Helius key never appears in output, only the endpoint host.
import "./config.js";
import { createHash } from "node:crypto";

export const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ||
  (process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com");
export const SOLANA_RPC_HOST = (() => {
  try {
    return new URL(SOLANA_RPC_URL).host;
  } catch {
    return "solana-rpc";
  }
})();
export const ETHERSCUT = "https://eth.blockscout.com";
export const JUPITER_PRICE = "https://lite-api.jup.ag/price/v3";
export const SOLSCAN = "https://solscan.io";
export const SIM_COLLECTION = "0xc3706195ff60658585b58716717ee7acc5ebca60";
export const SIM_COLLECTION_NAME = "The Simulation";
export const SIM_COLLECTION_URL = "https://opensea.io/collection/the-simulation-958481099";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const MAX_WALLETS = 8;
export const MAX_TOKENS = 25;
export const JUPITER_BATCH = 90;
export const MAX_COLLECTIONS = 12;
export const NFT_PAGE_CAP = 8; // Blockscout serves 50 items/page → up to 400 NFTs walked
export const SIG_CAP = 1000;
export const CACHE_TTL_MS = Number(process.env.ASSET_CACHE_TTL_MS || 60_000);
const DEFAULT_TIMEOUT_MS = 10_000;

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** @returns {{ok:true,chain:"solana"|"ethereum",chainLabel:string,address:string}|{ok:false,reason:string}} */
export function classifyAddress(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, reason: "no address supplied" };
  if (EVM_RE.test(value)) {
    return { ok: true, chain: "ethereum", chainLabel: "Ethereum mainnet (1)", address: value };
  }
  if (BASE58_RE.test(value)) {
    return { ok: true, chain: "solana", chainLabel: "Solana mainnet", address: value };
  }
  return { ok: false, reason: "not a Solana (base58, 32-44 chars) or Ethereum (0x + 40 hex) address" };
}

const sha1 = (value) => createHash("sha1").update(value).digest("hex").slice(0, 10);

async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "geoff-thermometer-asset-viewer" },
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok === true, status: res.status || 0, json };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`read timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function solanaRpc(method, params = [], { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status || 0}`);
    const json = await res.json().catch(() => null);
    if (json?.error) throw new Error(json.error.message || "Solana RPC error");
    return json?.result ?? null;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Solana RPC read timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const scale = (raw, decimals) => {
  const amount = num(raw);
  const d = num(decimals);
  if (amount === null) return null;
  return d === null ? null : amount / 10 ** d;
};
const isoFrom = (seconds) =>
  Number.isFinite(Number(seconds)) ? new Date(Number(seconds) * 1000).toISOString() : null;

const NATIVE_MINT = "So11111111111111111111111111111111111111112";
const isNativeMint = (mint) => mint === NATIVE_MINT || mint === "So11111111111111111111111111111111111111113";
let lastJupiterError = null;

/** Keyless USD prices for SPL mints via Jupiter, in batches. Never fatal. */
async function jupiterPrices(mints, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const out = new Map();
  let failedBatches = 0;
  for (let i = 0; i < mints.length; i += JUPITER_BATCH) {
    const batch = mints.slice(i, i + JUPITER_BATCH);
    if (!batch.length) break;
    try {
      const res = await fetchJson(`${JUPITER_PRICE}?ids=${batch.join(",")}`, { timeoutMs });
      if (!res.ok || !res.json || typeof res.json !== "object") {
        failedBatches += 1;
        continue;
      }
      for (const [mint, row] of Object.entries(res.json)) {
        if (row && row.error) continue;
        const price = num(row?.usdPrice);
        if (price !== null) out.set(mint, { usd: price, liquidity: num(row?.liquidity) });
      }
    } catch (error) {
      failedBatches += 1;
      if (error?.message) lastJupiterError = error.message;
    }
  }
  return { prices: out, failedBatches };
}

function sortTokens(tokens) {
  // Priced tokens first by USD value; everything unpriced (spam airdrops, dead
  // mints) sorts below, by raw amount. Amount alone would put a decimals:0
  // spam mint with 10^11 units at the top of a real wallet's list.
  return tokens.sort((a, b) => {
    if (a.usd != null && b.usd != null) return b.usd - a.usd;
    if (a.usd != null) return -1;
    if (b.usd != null) return 1;
    return b.amount - a.amount;
  });
}

function baseRow(identity, started) {
  return {
    address: identity.address,
    chain: identity.chain,
    chainLabel: identity.chainLabel,
    checkedAt: new Date().toISOString(),
    ms: Date.now() - started,
    ok: false,
    stale: false,
    reason: null,
    warnings: [],
    caps: [],
    identity: null,
    native: { symbol: identity.chain === "solana" ? "SOL" : "ETH", decimals: 9, amount: null, raw: null, usdRate: null, usd: null },
    tokens: [],
    tokensCapped: false,
    nft: { total: 0, collections: [], capped: false },
    sim: { held: 0, url: SIM_COLLECTION_URL, contract: SIM_COLLECTION, name: SIM_COLLECTION_NAME },
    activity: { lastAt: null, lastRef: null, count: null, capped: false },
    explorer: { name: identity.chain === "solana" ? "Solscan" : "Blockscout", addressUrl: null, txUrl: null },
    provenance: [],
    fingerprint: null,
  };
}

function emptyRow(identity, reason) {
  const row = baseRow(identity, Date.now());
  row.reason = reason;
  return row;
}

/* ------------------------------------------------------------------ solana */

async function inspectSolana(identity, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const started = Date.now();
  const row = baseRow(identity, started);
  const address = identity.address;
  row.explorer = {
    name: "Solscan",
    addressUrl: `${SOLSCAN}/account/${address}`,
    txUrl: `${SOLSCAN}/account/${address}#transactions`,
  };
  const provenance = [
    `getBalance · ${SOLANA_RPC_HOST}`,
    `getTokenAccountsByOwner Token/${TOKEN_2022_PROGRAM.slice(0, 8)}… · ${SOLANA_RPC_HOST}`,
    `getSignaturesForAddress limit ${SIG_CAP} · ${SOLANA_RPC_HOST}`,
  ];
  row.provenance = provenance;

  const [balanceRes, legacyTokens, tokens2022, sigs] = await Promise.allSettled([
    solanaRpc("getBalance", [address, { commitment: "confirmed" }], { timeoutMs }),
    solanaRpc(
      "getTokenAccountsByOwner",
      [address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }],
      { timeoutMs },
    ),
    solanaRpc(
      "getTokenAccountsByOwner",
      [address, { programId: TOKEN_2022_PROGRAM }, { encoding: "jsonParsed" }],
      { timeoutMs },
    ),
    solanaRpc("getSignaturesForAddress", [address, { limit: SIG_CAP }], { timeoutMs }),
  ]);

  if (balanceRes.status === "rejected") {
    row.reason = `getBalance failed: ${balanceRes.reason?.message || balanceRes.reason}`;
    row.provenance = [`getBalance FAILED · ${SOLANA_RPC_HOST}`];
    return row;
  }
  const lamports = num(balanceRes.value?.value);
  row.native = { symbol: "SOL", decimals: 9, amount: lamports !== null ? lamports / 1e9 : null, raw: lamports, usdRate: null, usd: null };
  row.ok = row.native.amount !== null;

  // SPL holdings: the same mint can appear in both token programs, so sum by mint.
  const byMint = new Map();
  for (const [label, settled] of [
    ["Token", legacyTokens],
    ["Token-2022", tokens2022],
  ]) {
    if (settled.status === "rejected") {
      row.warnings.push(`${label} holdings unread: ${settled.reason?.message || settled.reason}`);
      continue;
    }
    for (const account of settled.value?.value || []) {
      const info = account?.account?.data?.parsed?.info;
      const mint = info?.mint;
      const amount = scale(info?.tokenAmount?.amount, info?.tokenAmount?.decimals);
      if (!mint || amount === null || amount <= 0) continue;
      const existing = byMint.get(mint);
      if (existing) {
        existing.amount += amount;
        continue;
      }
      byMint.set(mint, {
        symbol: null,
        name: null,
        mint,
        decimals: num(info?.tokenAmount?.decimals) ?? 0,
        amount,
        usdRate: null,
        usd: null,
        url: `${SOLSCAN}/account/${mint}`,
        program: label,
      });
    }
  }
  const all = [...byMint.values()];
  const priced = new Map();
  if (all.length) {
    lastJupiterError = null;
    const { prices, failedBatches } = await jupiterPrices(all.map((t) => t.mint), { timeoutMs });
    for (const [mint, price] of prices) priced.set(mint, price);
    // A partial price read must be visible: the amounts are still chain truth,
    // but the USD column is then incomplete and we say so.
    if (failedBatches > 0) {
      row.warnings.push(
        `USD prices incomplete (Jupiter): ${failedBatches} of ${Math.ceil(all.length / JUPITER_BATCH)} batch(es) unread${lastJupiterError ? ` — ${lastJupiterError}` : ""}`,
      );
    }
  }
  // Jupiter drops the tail of a long ids list, so the native mint needs its own
  // small request or a wallet that holds no wrapped SOL has no SOL price.
  if (!priced.has(NATIVE_MINT)) {
    try {
      const solo = await jupiterPrices([NATIVE_MINT], { timeoutMs });
      for (const [mint, price] of solo.prices) priced.set(mint, price);
      if (solo.prices.size === 0) row.warnings.push("SOL/USD price unread (Jupiter) — amounts shown without a USD column");
    } catch (error) {
      row.warnings.push(`SOL/USD price unread (Jupiter): ${error?.message || error}`);
    }
  }
  for (const token of all) {
    const price = priced.get(token.mint);
    if (price) {
      token.usdRate = price.usd;
      token.usd = price.usd * token.amount;
      token.liquidity = price.liquidity;
    }
    if (isNativeMint(token.mint)) token.wrappedNative = true;
  }
  const tokens = sortTokens(all);
  row.tokensCapped = tokens.length > MAX_TOKENS;
  if (row.tokensCapped) {
    row.caps.push(`SPL tokens shown: top ${MAX_TOKENS} of ${tokens.length} (ranked by USD, unpriced dust last)`);
  }
  if (tokens.some((t) => t.usd == null)) {
    row.caps.push(`${tokens.filter((t) => t.usd == null).length} of ${tokens.length} SPL mints have no Jupiter price (unranked, sorted by amount)`);
  }
  row.tokens = tokens.slice(0, MAX_TOKENS);
  if (priced.size) {
    row.provenance = [...row.provenance, `Jupiter price/v3 (batch of ${Math.ceil(all.length / JUPITER_BATCH)}) · lite-api.jup.ag`];
  }

  if (sigs.status === "fulfilled" && Array.isArray(sigs.value)) {
    const list = sigs.value;
    row.activity = {
      lastAt: isoFrom(list[0]?.blockTime),
      lastRef: list[0]?.signature ?? null,
      count: list.length,
      capped: list.length >= SIG_CAP,
    };
    if (row.activity.capped) row.caps.push(`activity shown: newest ${SIG_CAP} signatures`);
  } else if (sigs.status === "rejected") {
    row.warnings.push(`activity unread: ${sigs.reason?.message || sigs.reason}`);
  }

  row.fingerprint = row.ok
    ? sha1(JSON.stringify({ a: address, lamports, m: row.tokens.length, s: row.activity.count }))
    : null;
  if (!row.ok) row.reason = "getBalance returned no value";
  // Native SOL in USD: native.amount is already what the row reports, so the
  // price lands on native.usdRate only.
  const solPrice = priced.get(NATIVE_MINT);
  if (solPrice && row.native.amount !== null) {
    row.native.usdRate = solPrice.usd;
    row.native.usd = solPrice.usd * row.native.amount;
  }
  return row;
}

/* --------------------------------------------------------------- ethereum */

function evmTokens(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const token = row?.token;
    const decimals = num(token?.decimals);
    const amount = scale(row?.value, decimals);
    if (!token?.address_hash || amount === null || amount <= 0) continue;
    const rate = num(token?.exchange_rate);
    out.push({
      symbol: token.symbol || null,
      name: token.name || null,
      contract: token.address_hash,
      decimals,
      amount,
      usdRate: rate,
      usd: rate === null ? null : amount * rate,
      url: `https://etherscan.io/token/${token.address_hash}`,
      type: token.type || "ERC-20",
    });
  }
  out.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || b.amount - a.amount);
  return out;
}

function evmNftCollections(items) {
  const byCollection = new Map();
  for (const item of items) {
    const token = item?.token;
    const contract = token?.address_hash;
    if (!contract) continue;
    const count = Number.isFinite(Number(item?.value)) ? Number(item.value) : 1;
    const existing = byCollection.get(contract);
    if (existing) {
      existing.count += count;
      continue;
    }
    const isSim = contract.toLowerCase() === SIM_COLLECTION;
    byCollection.set(contract, {
      contract,
      name: token.name || null,
      symbol: token.symbol || null,
      type: token.type || null,
      count,
      isSim,
      // OpenSea slugs are not derivable from chain data; only the collection we
      // have a verified slug for gets a marketplace link.
      openseaUrl: isSim ? SIM_COLLECTION_URL : null,
      etherscanUrl: `https://etherscan.io/nft/${contract}`,
    });
  }
  return [...byCollection.values()].sort((a, b) => b.count - a.count);
}

async function inspectEvm(identity, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const started = Date.now();
  const row = baseRow(identity, started);
  const address = identity.address;
  row.explorer = {
    name: "Blockscout",
    addressUrl: `${ETHERSCUT}/address/${address}`,
    txUrl: `${ETHERSCUT}/address/${address}?tab=txs`,
  };
  row.provenance = [
    `GET /api/v2/addresses/${address} · ${new URL(ETHERSCUT).host}`,
    `GET /api/v2/addresses/${address}/token-balances · ${new URL(ETHERSCUT).host}`,
    `GET /api/v2/addresses/${address}/nft (≤ ${NFT_PAGE_CAP} pages) · ${new URL(ETHERSCUT).host}`,
    `GET /api/v2/addresses/${address}/transactions (first page) · ${new URL(ETHERSCUT).host}`,
  ];

  const [metaRes, balancesRes, nftRes, txsRes] = await Promise.all([
    fetchJson(`${ETHERSCUT}/api/v2/addresses/${address}`, { timeoutMs }),
    fetchJson(`${ETHERSCUT}/api/v2/addresses/${address}/token-balances`, { timeoutMs }),
    fetchJson(`${ETHERSCUT}/api/v2/addresses/${address}/nft`, { timeoutMs }),
    fetchJson(`${ETHERSCUT}/api/v2/addresses/${address}/transactions`, { timeoutMs }),
  ]);

  const meta = metaRes.ok && metaRes.json ? metaRes.json : null;
  if (!meta || !meta.coin_balance) {
    row.reason = `Ethereum address unread: ${metaRes.ok ? "no balance in address metadata" : `Blockscout HTTP ${metaRes.status}`}`;
    row.provenance = [`GET /api/v2/addresses/${address} FAILED · ${new URL(ETHERSCUT).host}`];
    return row;
  }
  const wei = num(meta.coin_balance);
  const rate = num(meta.exchange_rate);
  row.native = {
    symbol: "ETH",
    decimals: 18,
    amount: wei !== null ? wei / 1e18 : null,
    raw: wei,
    usdRate: rate,
    usd: wei !== null && rate !== null ? (wei / 1e18) * rate : null,
  };
  row.ok = row.native.amount !== null;
  row.identity = {
    name: meta.name || meta.ens_domain_name || null,
    ensDomain: meta.ens_domain_name || null,
    isContract: meta.is_contract === true,
    isVerified: meta.is_verified === true,
    proxyType: meta.proxy_type || null,
    implementations: Array.isArray(meta.implementations)
      ? meta.implementations.map((i) => ({ address: i.address_hash, name: i.name || null })).slice(0, 5)
      : [],
  };

  if (balancesRes.ok && Array.isArray(balancesRes.json)) {
    const tokens = sortTokens(evmTokens(balancesRes.json));
    row.tokensCapped = tokens.length > MAX_TOKENS;
    if (row.tokensCapped) row.caps.push(`ERC-20 tokens shown: top ${MAX_TOKENS} of ${tokens.length}`);
    row.tokens = tokens.slice(0, MAX_TOKENS);
  } else {
    row.warnings.push(`ERC-20 balances unread: HTTP ${balancesRes.status}`);
  }

  if (nftRes.ok && nftRes.json && Array.isArray(nftRes.json.items)) {
    const items = [...nftRes.json.items];
    let cursor = nftRes.json.next_page_params || null;
    let pages = 1;
    while (cursor && pages < NFT_PAGE_CAP) {
      const page = await fetchJson(
        `${ETHERSCUT}/api/v2/addresses/${address}/nft?${new URLSearchParams(cursor).toString()}`,
        { timeoutMs },
      );
      if (!page.ok || !Array.isArray(page.json?.items) || page.json.items.length === 0) break;
      items.push(...page.json.items);
      cursor = page.json.next_page_params || null;
      pages += 1;
    }
    const collections = evmNftCollections(items);
    row.nft = { total: items.length, collections: collections.slice(0, MAX_COLLECTIONS), capped: pages >= NFT_PAGE_CAP && cursor != null };
    if (row.nft.capped) {
      row.caps.push(`NFTs walked: first ${NFT_PAGE_CAP} pages (${items.length} items) — counts are a floor, not the full wallet`);
    }
    if (row.nft.collections.length > MAX_COLLECTIONS) {
      row.caps.push(`collections shown: top ${MAX_COLLECTIONS} of ${collections.length}`);
    }
    const simRow = collections.find((c) => c.isSim);
    if (simRow) {
      row.sim = { held: simRow.count, url: SIM_COLLECTION_URL, contract: SIM_COLLECTION, name: SIM_COLLECTION_NAME };
    }
  } else {
    row.warnings.push(`NFT holdings unread: HTTP ${nftRes.status}`);
  }

  if (txsRes.ok && txsRes.json && Array.isArray(txsRes.json.items) && txsRes.json.items.length > 0) {
    const first = txsRes.json.items[0];
    row.activity = {
      lastAt: first?.timestamp ?? null,
      lastRef: first?.hash ?? null,
      count: txsRes.json.items.length,
      capped: txsRes.json.next_page_params != null,
    };
    if (row.activity.capped) row.caps.push(`activity shown: newest page of transactions`);
  } else {
    row.warnings.push(`transaction activity unread: HTTP ${txsRes.status}`);
  }

  row.fingerprint = row.ok
    ? sha1(JSON.stringify({ a: address, wei, t: row.tokens.length, n: row.nft.total }))
    : null;
  if (!row.ok) row.reason = "address metadata returned no balance";
  return row;
}

/* ------------------------------------------------------------ orchestration */

const cache = new Map(); // key -> { at, row }
const cacheKey = (chain, address) => `${chain}:${address.toLowerCase()}`;

async function inspectOne(address, opts = {}) {
  const identity = classifyAddress(address);
  if (!identity.ok) {
    return { address: String(address ?? "").trim(), chain: null, chainLabel: null, ok: false, stale: false, reason: identity.reason, checkedAt: new Date().toISOString(), native: null, tokens: [], nft: null, sim: null, activity: null, identity: null, explorer: null, provenance: [], caps: [], warnings: [] };
  }
  const key = cacheKey(identity.chain, identity.address);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && opts.fresh !== true && now - hit.at < CACHE_TTL_MS) {
    return { ...hit.row, cached: true, cacheAgeMs: now - hit.at };
  }
  let row;
  try {
    row = identity.chain === "solana" ? await inspectSolana(identity, opts) : await inspectEvm(identity, opts);
  } catch (error) {
    row = emptyRow(identity, error?.message || String(error));
  }
  if (row.ok) {
    cache.set(key, { at: now, row });
    if (cache.size > 200) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50);
      for (const [k] of oldest) cache.delete(k);
    }
  } else if (hit?.row) {
    // Never print a zero for a wallet we could read before: serve the last
    // good read, clearly marked stale with the failure that replaced it.
    return { ...hit.row, ok: false, stale: true, cached: true, reason: row.reason, checkedAt: row.checkedAt };
  }
  return row;
}

/** Inspect up to MAX_WALLETS wallets. Never throws for a single bad wallet. */
export async function inspectWallets(addresses, opts = {}) {
  const list = (Array.isArray(addresses) ? addresses : String(addresses ?? "").split(/[,\s]+/))
    .map((a) => String(a ?? "").trim())
    .filter(Boolean);
  const deduped = [];
  const seen = new Set();
  for (const address of list) {
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(address);
    if (deduped.length >= MAX_WALLETS) break;
  }
  const wallets = await Promise.all(deduped.map((address) => inspectOne(address, opts)));
  return {
    checkedAt: new Date().toISOString(),
    maxWallets: MAX_WALLETS,
    requested: list.length,
    shown: wallets.length,
    ttlMs: CACHE_TTL_MS,
    wallets,
  };
}

export function _clearAssetCache() {
  cache.clear();
}
