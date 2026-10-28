// Read-only public-source adapter. No wallet connection, signing or receipt minting.
export const POOLVOID_BASE = "https://poolvoid.app";
const ADDRESS = /^0x[\da-f]{40}$/i;
const text = (v, max = 160) => typeof v === "string" ? v.slice(0, max) : null;
const date = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
export const decimal = (v) => (typeof v === "number" && Number.isFinite(v) || typeof v === "string")
  && /^-?\d+(?:\.\d+)?$/.test(String(v)) && String(v).length <= 100 ? String(v) : null;
const integer = (v) => v !== null && v !== undefined && v !== "" && Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;

export function normalizeBoard(j) {
  if (!Array.isArray(j?.items)) throw Error("Leaderboard response has no items array");
  const seen = new Set();
  const items = j.items.filter((r) => {
    if (!ADDRESS.test(r?.address || "")) return false;
    const key = r.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map((r) => ({ address: r.address.toLowerCase(), sourceRank: integer(r.rank), eth: decimal(r.eth),
    poolEth: decimal(r.poolvoid_eth), voidEth: decimal(r.void_eth), points: decimal(r.points),
    achievements: integer(r.achievements), transactions: integer(r.transactions), receipt: text(r.receipt_number, 40) }));
  return { items, received: j.items.length, omitted: j.items.length - items.length,
    hasMore: j.hasMore === true, since: date(j.since), until: date(j.until) };
}

export function normalizeBadge(r) {
  return { id: integer(r.id), name: text(r.name, 80) || "Unnamed source rule", kind: text(r.kind, 30),
    chainId: integer(r.chain_id), asset: text(r.asset_symbol || r.asset_type, 25), amount: decimal(r.amount),
    tier: text(r.ribbon_tier, 30), points: decimal(r.points), multiplier: decimal(r.multiplier),
    wallets: integer(r.wallet_count), groupWallets: integer(r.group_wallet_count), occurrences: integer(r.occurrences),
    unlockedAt: date(r.unlocked_at), hash: /^0x[\da-f]{64}$/i.test(r.hash || "") ? r.hash : null,
    enabled: r.enabled === true, merged: r.merged_into != null };
}

export function createPoolVoidHall({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  async function cached(key, path, normalize) {
    const old = cache.get(key);
    if (old && old.until > now()) return old.value;
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      const checkedAt = new Date(now()).toISOString();
      let value;
      try {
        const response = await fetchImpl(`${POOLVOID_BASE}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
        if (!response.ok) throw Error(`Pool Void HTTP ${response.status}`);
        const body = await response.text();
        if (body.length > 8_000_000) throw Error("Source response exceeds the readable size limit");
        value = { ...normalize(JSON.parse(body)), ok: true, stale: false, checkedAt, sourceUrl: `${POOLVOID_BASE}${path}` };
      } catch (error) {
        value = { ...(old?.value || {}), ok: false, stale: !!old?.value?.checkedAt,
          checkedAt: old?.value?.checkedAt || null, lastAttemptAt: checkedAt, sourceUrl: `${POOLVOID_BASE}${path}`,
          reason: error.name === "TimeoutError" ? "Pool Void request timed out" : String(error.message).slice(0, 180) };
      }
      cache.delete(key);
      cache.set(key, { value, until: now() + (value.ok ? 5 * 60_000 : 60_000) });
      while (cache.size > 100) cache.delete(cache.keys().next().value);
      return value;
    })();
    pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
  }
  return {
    async hall() {
      const [board, weekly, rules] = await Promise.all([
        cached("board", "/api/leaderboard", normalizeBoard),
        cached("weekly", "/api/leaderboard/weekly?period=week", normalizeBoard),
        cached("rules", "/api/scoring/rules", (j) => {
          if (!Array.isArray(j?.rules)) throw Error("Achievement response has no rules array");
          return { items: j.rules.filter((r) => r && typeof r === "object").map(normalizeBadge),
            recalculating: j.state?.dirty === true || j.backfilling === true, calculatedAt: date(j.state?.last_calculated_at) };
        }),
      ]);
      return { board, weekly, rules, attribution: "Pool Void-reported data. Rankings and badges are not independently verified by this desk." };
    },
    async profile(address) {
      if (!ADDRESS.test(address || "")) throw Error("A valid Ethereum/Base wallet address is required");
      address = address.toLowerCase();
      const [profile, identity] = await Promise.all([
        cached(`profile:${address}`, `/api/profile/${address}`, (j) => {
          if (j?.profile?.address?.toLowerCase() !== address || !Array.isArray(j?.unlocks)) throw Error("Profile response is unavailable or mismatched");
          return { address, displayName: text(j.profile.display_name, 80), bio: text(j.profile.bio, 280),
            eth: decimal(j.stats?.eth), transactions: integer(j.stats?.transactions), transfers: integer(j.stats?.transfers),
            firstSeen: date(j.stats?.first_seen), latestTransfer: date(j.stats?.latest_transfer), receipt: text(j.receiptNumber, 40),
            points: decimal(j.score?.points), achievementCount: integer(j.score?.achievement_count),
            calculatedAt: date(j.score?.calculated_at), recalculating: j.scoring?.dirty === true,
            unlocks: j.unlocks.filter((r) => r && typeof r === "object").map(normalizeBadge) };
        }),
        cached(`identity:${address}`, `/api/identity/${address}`, (j) => ({ name: text(j?.name, 100) })),
      ]);
      return { profile, identity };
    },
  };
}
export const poolVoidHall = createPoolVoidHall();
