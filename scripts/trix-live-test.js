// Run: node --experimental-vm-modules scripts/trix-live-test.js
// All fetches, configuration and stores are fixtures. Nothing touches a live desk.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as crypto from "node:crypto";
import * as tokenPlan from "../server/token-plan.js";

let now = Date.parse("2026-09-08T12:00:00Z");
const iso = () => new Date(now).toISOString();
const plain = (value) => JSON.parse(JSON.stringify(value));
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const requests = [];
const timeouts = [];
const timers = new Map();
let timerId = 0;
const schedule = (callback, ms) => {
  const id = ++timerId;
  timeouts.push(ms);
  timers.set(id, { callback, at: now + ms });
  return id;
};
let failures = new Map();
let catalogPages = null;
let catalogTotal = 983;
let boxesStatus = 404;
let boxesPayload = { message: "Not found" };
let tradeItems = [];
const tokenHistories = new Map();
let providerTransfers = [];
let slowStacknet = false;
let hang = false;
let bundle = { latest: null, state: {}, events: [], dailyActivity: [] };
let saved = null;
let saves = 0;
const freshAt = "2026-09-08T11:59:00Z";
const launches = Array.from({ length: 13 }, (_, index) => ({
  mintAddress: `mint-${index}`,
  name: `Token ${index}`,
  symbol: `T${index}`,
  logoUrl: `/logo-${index}.png`,
  chain: index === 1 ? "base" : "solana",
  status: "launched",
  isCoinAgent: index === 0,
  marketCap: index === 0 ? "9000" : index * 10,
  marketCapUpdatedAt: freshAt,
  // These unverified fields must never leak into current rows.
  price: 55, volume24h: 999, holderCount: 777, currentMarketCap: 1,
  snapshotTimestamp: "2026-03-25T00:00:00Z", type: "PUMP", boosted: true,
  totalSupply: 1000000000000,
}));
const generation = {
  id: "gen-1", tokenMint: "mint-0", generator: "geoff",
  createdAt: freshAt, imageUrl: "https://fixture.test/generation.png",
  paidNetwork: "mainnet", txSignature: "fixture-signature", feeLamports: 10000000,
};
let recent = [generation];
const context = vm.createContext({
  Date: Clock, process: { env: {} }, Buffer, AbortController, URL,
  setTimeout: schedule, clearTimeout: (id) => timers.delete(id),
  fetch: async (input, options = {}) => {
    const url = new URL(input);
    options.signal?.throwIfAborted();
    requests.push({ url: String(url), method: options.method || "GET" });
    if (hang) return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("fixture timeout")), { once: true });
    });
    if (slowStacknet && url.hostname === "stacknet.fixture" && ["/health", "/", "/network/summary"].includes(url.pathname)) {
      await new Promise((resolve, reject) => {
        const abort = () => { timers.delete(id); reject(new Error("fixture timeout")); };
        const id = schedule(() => {
          options.signal.removeEventListener("abort", abort);
          resolve();
        }, 7000);
        options.signal.addEventListener("abort", abort, { once: true });
      });
    }
    now += 1;
    assert.equal(options.headers?.Authorization, undefined);
    assert.equal(options.headers?.Cookie, undefined);
    assert.notEqual(url.pathname, "/api/meme-market");
    assert.notEqual(url.pathname, "/api/cards");
    const failure = failures.get(url.pathname + url.search) ?? failures.get(url.pathname);
    if (failure instanceof Error) throw failure;
    let json;
    if (url.pathname === "/api/launches") {
      assert.equal(url.searchParams.get("limit"), "500");
      const offset = Number(url.searchParams.get("offset"));
      assert.ok(offset === 0 || offset === 500);
      json = { items: catalogPages ? catalogPages[offset] : offset === 0 ? launches.slice(0, 8) : launches.slice(7), total: catalogTotal };
    } else if (url.pathname === "/api/meme-image/recent") json = recent;
    else if (url.pathname.startsWith("/api/meme-image/token/")) json = tokenHistories.get(url.pathname.split("/").at(-1)) ?? [generation];
    else if (url.pathname === "/api/artworks") json = [{
      id: "art-1", name: "Current artwork", linkedCoinMint: "mint-0", printedSupply: 0,
      imageUrl: "/artwork.png", createdAt: freshAt,
    }];
    else if (url.pathname === "/api/artworks/recent-activity") json = [];
    else if (url.pathname === "/api/auctions") json = [];
    else if (url.pathname === "/api/treasury") json = { balance: 0, totalPoints: 0 };
    else if (url.pathname === "/api/activity") json = { items: [], hasMore: false };
    else if (url.pathname === "/api/leaderboard") json = { leaderboard: [{ rank: 1, points: 0 }] };
    else if (url.pathname === "/api/mkt/leaderboard") {
      assert.equal(url.hostname, "www.trix.market");
      assert.equal(url.search, "");
      json = boxesPayload;
    }
    else if (url.pathname === "/api/launchpad-settings/public") json = { platformFeeBps: 0, creatorFeeBps: null, platformLaunchFeeSol: "0" };
    else if (url.pathname === "/api/feed/trades") json = { items: tradeItems };
    else if (url.pathname === "/api/frontpage") json = { featured: [], boosted: [], recent: [], builtAt: Date.parse(freshAt) };
    else if (url.pathname === "/api/tiers") json = [{ name: "Start", minPoints: null }, { name: "Zero", minPoints: 0 }];
    else if (url.pathname === "/api/fee-config") json = { feeWallet: "fixture-wallet", treasuryWallet: "fixture-treasury", feeBps: 0 };
    else if (url.hostname === "api.mainnet-beta.solana.com") {
      const rpc = JSON.parse(options.body);
      if (rpc.method === "getBalance") json = { result: { value: 0 } };
      else if (rpc.method === "getTransaction") json = { result: { meta: { err: null }, transaction: { message: {
        instructions: providerTransfers.map((destination) => ({ program: "system", parsed: { type: "transfer", info: { destination } } })),
      } } } };
      else throw new Error(`Unexpected RPC ${rpc.method}`);
    } else if (url.hostname === "stacknet.fixture") {
      if (url.pathname === "/health") json = { status: "healthy", in_flight: 0 };
      else if (url.pathname === "/network/summary") json = { network: { totalNodes: 2, availableNodes: 1 } };
      else if (url.pathname === "/v1/models") json = { data: [] };
      else json = {};
    } else throw new Error(`Unexpected fixture URL ${url}`);
    if (failure === "invalid") json = { message: "not a valid response" };
    const status = typeof failure === "number" ? failure : url.pathname === "/api/mkt/leaderboard" ? boxesStatus : 200;
    return {
      ok: status >= 200 && status < 300, status,
      url: String(url), headers: new Map(),
      text: async () => JSON.stringify(json), json: async () => json,
    };
  },
});
const codes = await Promise.all(["sniffer", "service"].map((name) =>
  readFile(new URL(`../server/${name}.js`, import.meta.url), "utf8"),
));
const tickCode = await readFile(new URL("../api/tick.js", import.meta.url), "utf8");
const config = { stacknetBaseUrl: "https://stacknet.fixture", heatmapDays: 30, pollIntervalMs: 60000 };
const noWrite = async () => { throw new Error("Unexpected store write"); };
const dependencies = {
  "node:crypto": crypto,
  "token-plan.js": tokenPlan,
  "config.js": { config },
  "store.js": {
    loadMiningSurfaceCache: async () => null, saveMiningSurfaceCache: noWrite,
    appendEvents: noWrite, loadDailyActivity: async () => [], loadEvents: async () => [],
    loadLatestSnapshot: async () => null, loadState: async () => ({}), saveLatestSnapshot: noWrite, saveState: noWrite,
  },
  "shared-store.js": {
    acquireSharedLock: async () => null, releaseSharedLock: async () => {},
    loadSharedBundle: async () => bundle, normalizeBundle: (value) => value,
    pruneEvents: (events) => events,
    saveSharedBundle: async (value) => { saved = value; saves += 1; return { ...value, updatedAt: iso() }; },
    sharedStoreConfig: () => ({ writable: true, redis: false, rawUrl: "https://store.fixture" }),
  },
  "briefing.js": { compileBriefing: () => null },
  "daily-activity.js": { upsertDailyActivity: (value) => value },
  "pond0x.js": { upsertPond0x: (value) => value },
  "translator.js": { computeTemperature: () => ({ value: 0 }), inferAgentDesk: () => ({}), translate: () => [] },
};
const modules = new Map();
for (const [key, exports] of Object.entries(dependencies)) modules.set(key, new vm.SyntheticModule(
  Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { context },
));
const stubs = [...codes[0].matchAll(/(?:export )?async function (sniff\w+)\(/g)]
  .map((match) => match[1])
  .filter((name) => !name.startsWith("sniffTrix") && ![
    "sniffStacknetMinute", "sniffStacknetHealth", "sniffStacknetRoot", "sniffStacknetNetwork", "sniffStacknetNode", "sniffStacknetModels",
  ].includes(name))
  .map((name) => `${name} = async () => { throw new Error("unrelated collector fixture"); };`)
  .join("\n");
modules.set("sniffer.js", new vm.SourceTextModule(`${codes[0]}\nexport function stubUnrelated() { ${stubs} }`, { context }));
modules.set("service.js", new vm.SourceTextModule(codes[1], { context }));
const tick = new vm.SourceTextModule(`${tickCode}\nexport function authorizeFixture() { authorized = () => true; }`, { context });
await tick.link(async (specifier) => {
  const key = specifier.startsWith("node:") ? specifier : specifier.split("/").at(-1);
  assert.ok(modules.has(key), `Unexpected import ${specifier}`);
  return modules.get(key);
});
await tick.evaluate();
const api = modules.get("sniffer.js").namespace;
const service = modules.get("service.js").namespace;
api.stubUnrelated();

const [market, geoff, meme] = await Promise.all([
  api.sniffTrixMarket(), api.sniffTrixGeoff(), api.sniffTrixMemeMarket(),
]);
assert.equal(requests.filter((request) => new URL(request.url).pathname === "/api/launches").length, 2);
assert.equal(meme.ok, true);
assert.equal(meme.stale, false);
assert.match(meme.sourceUrl, /\/api\/launches\?/);
assert.equal(meme.totalCoins, 13);
assert.equal(meme.catalogTotal, 983);
assert.equal(meme.top10.length, 10);
assert.equal(meme.coins[0].mintAddress, "mint-0");
assert.equal(meme.coins[0].currentMarketCap, 9000);
assert.equal(meme.coins[0].type, "Agent");
assert.equal(meme.coins.find((coin) => coin.chain === "base").type, "Token");
assert.equal(meme.coins[0].logoUrl, "https://trix.market/logo-0.png");
assert.equal(meme.dataUpdatedAt, new Date(freshAt).toISOString());
assert.equal(geoff.launchCatalogCheckedAt, meme.checkedAt);
assert.equal((await api.sniffTrixFrontpage()).builtAt, freshAt.replace("Z", ".000Z"));
assert.equal(market.endpoints.launches.checkedAt, meme.checkedAt);
assert.equal(market.recentMints[0].currentMarketCap, 9000);
assert.equal(Object.hasOwn(market.recentMints[0], "buyPriceSol"), false);
assert.equal(Object.hasOwn(market, "cards"), false);
assert.equal(market.auctions.active, 0);
const rowKeys = ["mintAddress", "tokenName", "ticker", "logoUrl", "chain", "status", "type", "currentMarketCap", "marketCapUpdatedAt"].sort();
for (const coin of meme.coins) assert.deepEqual(Object.keys(coin).sort(), rowKeys);
for (const key of ["snapshotAt", "totalVolume24h", "totalLiquidity", "totalHolders"]) assert.equal(Object.hasOwn(meme, key), false);

// Finite, null-aware conversion: unknowns never turn into zero or epoch dates.
for (const invalid of [null, undefined, "", " ", true, false, [], {}, "Infinity", "NaN", Infinity]) {
  launches[0].marketCap = invalid;
  launches[0].marketCapUpdatedAt = "invalid date";
  launches[0].isCoinAgent = "true";
  const value = await api.sniffTrixMemeMarket();
  const coin = value.coins.find((item) => item.mintAddress === "mint-0");
  assert.equal(coin.currentMarketCap, null);
  assert.equal(coin.marketCapUpdatedAt, null);
  assert.equal(coin.type, "Token");
  assert.equal(value.coins.at(-1).mintAddress, "mint-0");
}
for (const zero of [0, "0"]) {
  launches[0].marketCap = zero;
  const value = await api.sniffTrixMemeMarket();
  assert.equal(value.coins.at(-1).currentMarketCap, 0);
}
launches[0].marketCap = 9000;
launches[0].isCoinAgent = true;
launches[0].marketCapUpdatedAt = freshAt;
now += 60000;
const unchanged = await api.sniffTrixMemeMarket();
assert.notEqual(unchanged.checkedAt, meme.checkedAt);
assert.equal(unchanged.fingerprint, meme.fingerprint);
launches[0].marketCap = 9001;
const changed = await api.sniffTrixMemeMarket();
assert.notEqual(changed.fingerprint, unchanged.fingerprint);
assert.equal(changed.dataUpdatedAt, unchanged.dataUpdatedAt);

catalogPages = { 0: [{ mintAddress: "unknown", marketCap: null, marketCapUpdatedAt: null }], 500: [] };
catalogTotal = null;
const unknownCaps = await api.sniffTrixMemeMarket();
assert.equal(unknownCaps.totalMarketCap, null);
assert.equal(unknownCaps.catalogTotal, null);
assert.equal(unknownCaps.dataUpdatedAt, null);
catalogPages[0][0].marketCap = 0;
assert.equal((await api.sniffTrixMemeMarket()).totalMarketCap, 0);
catalogPages = { 0: [], 500: [] };
catalogTotal = 0;
const emptyCatalog = await api.sniffTrixMemeMarket();
assert.equal(emptyCatalog.ok, true);
assert.equal(emptyCatalog.totalCoins, 0);
assert.equal(emptyCatalog.totalMarketCap, 0);
catalogTotal = 2000;
catalogPages = Object.fromEntries([0, 500].map((offset) => [offset,
  Array.from({ length: 600 }, (_, index) => ({ mintAddress: `${offset}-${index}`, marketCap: 1 })),
]));
const cappedCatalog = await api.sniffTrixMemeMarket();
assert.equal(cappedCatalog.totalCoins, 1000);
assert.equal(cappedCatalog.catalogTotal, 2000);
assert.equal(cappedCatalog.totalMarketCap, 1000);
catalogPages = null;
catalogTotal = 983;

// A failed page cannot produce a new successful ranking or relabel old values.
failures.set("/api/launches?limit=500&offset=500&sort=marketCap", 503);
const beforeMeme = JSON.stringify(changed);
const retained = await api.sniffTrixMemeMarket({ previous: changed });
assert.equal(retained.ok, false);
assert.equal(retained.stale, true);
assert.equal(retained.checkedAt, changed.checkedAt);
assert.equal(retained.dataUpdatedAt, changed.dataUpdatedAt);
assert.equal(retained.fingerprint, changed.fingerprint);
assert.deepEqual(plain(retained.coins), plain(changed.coins));
assert.ok(Date.parse(retained.lastAttemptAt) > Date.parse(retained.checkedAt));
assert.match(retained.reason, /503/);
assert.equal(JSON.stringify(changed), beforeMeme);
failures.set("/api/launches?limit=500&offset=0&sort=marketCap", new Error("catalog offline"));
const noHistory = await api.sniffTrixMemeMarket({ previous: {
  ok: true, coins: [{ price: 555, currentMarketCap: 99999 }], totalMarketCap: 99999,
  checkedAt: "2026-03-25T00:00:00Z",
} });
assert.equal(noHistory.ok, false);
assert.equal(noHistory.coins.length, 0);
assert.equal(noHistory.totalMarketCap, null);
assert.equal(noHistory.catalogTotal, null);
assert.equal(noHistory.dataUpdatedAt, null);
failures.clear();

// The optional official box leaderboard is a real 404, never a coin-derived rank.
const boxesUrl = "https://www.trix.market/api/mkt/leaderboard";
const boxesRequestStart = requests.length;
const boxesTimeoutStart = timeouts.length;
const unavailableBoxes = await api.sniffTrixBoxes();
assert.equal(requests.length - boxesRequestStart, 1);
assert.deepEqual(timeouts.slice(boxesTimeoutStart), [6000]);
assert.equal(unavailableBoxes.source, "trix.boxes");
assert.equal(unavailableBoxes.optional, true);
assert.equal(unavailableBoxes.ok, false);
assert.equal(unavailableBoxes.stale, true);
assert.equal(unavailableBoxes.status, 404);
assert.equal(unavailableBoxes.checkedAt, iso());
assert.equal(unavailableBoxes.sourceUrl, boxesUrl);
assert.equal(unavailableBoxes.shopUrl, "https://www.trix.market/shop");
assert.equal(unavailableBoxes.fingerprint, null);
assert.match(unavailableBoxes.reason, /HTTP 404.*Not found/);
for (const key of ["topCoins", "biggestPulls", "topCollectors"]) assert.equal(unavailableBoxes[key], null);
for (const key of ["count", "totalCoins", "types"]) assert.equal(Object.hasOwn(unavailableBoxes, key), false);
now += 1000;
const stillUnavailable = await api.sniffTrixBoxes({ previous: unavailableBoxes });
assert.equal(stillUnavailable.checkedAt, iso());
assert.notEqual(stillUnavailable.checkedAt, unavailableBoxes.checkedAt);

boxesStatus = 200;
boxesPayload = {
  topCoins: [
    { mint: "box-coin-1", symbol: "ONE", name: "One", logoUrl: "/one.png", rips: "0", type: "PUMP", price: 99 },
    { mint: "box-coin-2", rips: 100, logoUrl: "javascript:alert(1)" },
  ],
  biggestPulls: [
    { ripper: "Ripper", rarity: "mythic", coinSymbol: "ONE", rewardUsd: "12.50", wallet: "not included" },
    { ripper: "Unknown reward", rarity: null, rewardUsd: null },
  ],
  topCollectors: [
    { username: "Collector", rips: 0, mythics: null, earnedUsd: "0", secret: "not included" },
  ],
};
const liveBoxes = await api.sniffTrixBoxes({ previous: unavailableBoxes });
assert.equal(liveBoxes.ok, true);
assert.equal(liveBoxes.stale, false);
assert.equal(liveBoxes.status, 200);
assert.equal(liveBoxes.reason, null);
assert.deepEqual(plain(liveBoxes.topCoins[0]), {
  mint: "box-coin-1", symbol: "ONE", name: "One", logoUrl: "https://www.trix.market/one.png", rips: 0,
});
assert.equal(liveBoxes.topCoins[1].logoUrl, null);
assert.equal(liveBoxes.biggestPulls[0].rarity, "mythic");
assert.equal(liveBoxes.biggestPulls[0].rewardUsd, 12.5);
assert.equal(liveBoxes.biggestPulls[1].rewardUsd, null);
assert.deepEqual(plain(liveBoxes.topCollectors[0]), { username: "Collector", rips: 0, mythics: null, earnedUsd: 0 });
const unchangedBoxes = await api.sniffTrixBoxes();
assert.equal(unchangedBoxes.fingerprint, liveBoxes.fingerprint);
assert.notEqual(unchangedBoxes.checkedAt, liveBoxes.checkedAt);
for (const invalid of [null, undefined, "", " ", true, false, [], {}, "Infinity", -1, 0.5, 1e100]) {
  boxesPayload.topCoins[0].rips = invalid;
  assert.equal((await api.sniffTrixBoxes()).topCoins[0].rips, null);
}
boxesPayload.topCoins[0].rips = 5;
assert.notEqual((await api.sniffTrixBoxes()).fingerprint, liveBoxes.fingerprint);
boxesPayload.topCoins = Array.from({ length: 40 }, (_, index) => ({ mint: `box-${index}`, rips: index }));
const cappedBoxes = await api.sniffTrixBoxes();
assert.equal(cappedBoxes.topCoins.length, 25);
assert.equal(cappedBoxes.topCoins[0].mint, "box-0");
assert.equal(cappedBoxes.topCoins.at(-1).mint, "box-24");

for (const invalid of [
  null, [], { message: "Not found" }, { topCoins: [], biggestPulls: [] },
  { topCoins: [], biggestPulls: {}, topCollectors: [] },
  { topCoins: [null], biggestPulls: [], topCollectors: [] },
  { topCoins: [{}], biggestPulls: [], topCollectors: [] },
]) {
  boxesPayload = invalid;
  const malformed = await api.sniffTrixBoxes();
  assert.equal(malformed.ok, false);
  assert.equal(malformed.status, 200);
  assert.equal(malformed.topCoins, null);
  assert.equal(malformed.biggestPulls, null);
  assert.equal(malformed.topCollectors, null);
  assert.equal(malformed.fingerprint, null);
  assert.match(malformed.reason, /[Ii]nvalid|Unrecognized/);
}
boxesStatus = 404;
boxesPayload = { message: "Not found" };
const liveBoxesJson = JSON.stringify(liveBoxes);
const retainedBoxes = await api.sniffTrixBoxes({ previous: liveBoxes });
assert.equal(retainedBoxes.ok, false);
assert.equal(retainedBoxes.stale, true);
assert.equal(retainedBoxes.status, 404);
assert.equal(retainedBoxes.checkedAt, liveBoxes.checkedAt);
assert.equal(retainedBoxes.lastAttemptAt, iso());
assert.equal(retainedBoxes.sourceUrl, boxesUrl);
assert.equal(retainedBoxes.fingerprint, liveBoxes.fingerprint);
assert.deepEqual(plain(retainedBoxes.topCoins), plain(liveBoxes.topCoins));
assert.equal(JSON.stringify(liveBoxes), liveBoxesJson);
const againRetained = await api.sniffTrixBoxes({ previous: retainedBoxes });
assert.equal(againRetained.checkedAt, liveBoxes.checkedAt);
assert.ok(Date.parse(againRetained.lastAttemptAt) > Date.parse(retainedBoxes.lastAttemptAt));
for (const previous of [
  meme, { ...liveBoxes, sourceUrl: "https://trix.market/api/launches" },
  { ...liveBoxes, fingerprint: null }, unavailableBoxes,
]) assert.equal((await api.sniffTrixBoxes({ previous })).topCoins, null);
failures.set("/api/mkt/leaderboard", new Error("boxes offline"));
const offlineBoxes = await api.sniffTrixBoxes({ previous: liveBoxes });
assert.equal(offlineBoxes.status, 0);
assert.equal(offlineBoxes.checkedAt, liveBoxes.checkedAt);
assert.match(offlineBoxes.reason, /boxes offline/);
failures.clear();
boxesStatus = 200;
boxesPayload = { topCoins: [], biggestPulls: [], topCollectors: [] };
const recoveredBoxes = await api.sniffTrixBoxes({ previous: retainedBoxes });
assert.equal(recoveredBoxes.ok, true);
assert.equal(recoveredBoxes.stale, false);
assert.deepEqual(plain(recoveredBoxes.topCoins), []);
assert.notEqual(recoveredBoxes.checkedAt, retainedBoxes.checkedAt);
boxesStatus = 404;
boxesPayload = { message: "Not found" };

failures.set("/api/artworks", 503);
const requestStart = requests.length;
const partial = await api.sniffTrixMarket({ previous: market });
assert.equal(partial.ok, true);
assert.equal(partial.partial, true);
assert.equal(partial.artworks.total, null);
assert.equal(partial.leaderboard.rows[0].points, 0);
assert.equal(partial.treasury.balanceSol, 0);
assert.equal(partial.endpoints.artworks.ok, false);
assert.equal(requests.slice(requestStart).filter((request) => new URL(request.url).pathname === "/api/artworks").length, 1);
assert.match(partial.reason, /artworks:503/);
failures.set("/api/feed/trades", 503);
const money = await api.sniffTrixMoney();
assert.equal(money.partial, true);
assert.equal(money.feeSplit.platformFeeBps, 0);
assert.equal(money.feeSplit.creatorFeeBps, null);
assert.equal(money.treasury.balanceSolOnChain, 0);
assert.equal(money.fees.recentBuysSol, null);
assert.equal(money.recentTrades, null);
assert.equal(Object.hasOwn(money, "market24h"), false);
failures.clear();
const emptyTrades = await api.sniffTrixMoney();
assert.equal(emptyTrades.fees.recentBuysSol, 0);
assert.equal(emptyTrades.fees.buyCount, 0);
assert.deepEqual(plain(emptyTrades.recentTrades), []);

// Live GET exposes txSignature, not signature; never derive an ID or event time.
tradeItems = Array.from({ length: 15 }, (_, index) => ({
  id: `trade-${index}`, txSignature: index === 1 ? null : `trade-signature-${index}`,
  side: index === 1 ? "void" : "buy", symbol: `T${index}`, mint: `mint-${index}`,
  solAmount: index === 1 ? 0 : "0.03", createdAt: index === 1 ? null : freshAt,
  signature: "unverified alias", timestamp: "2026-01-01T00:00:00Z", walletAddress: "not exposed", kind: "coin",
}));
tradeItems[2].createdAt = "invalid date";
tradeItems[2].solAmount = null;
const tradesRequestStart = requests.length;
const actualTrades = await api.sniffTrixMoney();
assert.equal(requests.slice(tradesRequestStart).filter((request) => new URL(request.url).pathname === "/api/feed/trades").length, 1);
assert.equal(actualTrades.recentTrades.length, 12);
assert.deepEqual(plain(actualTrades.recentTrades[0]), {
  signature: "trade-signature-0", id: "trade-0", side: "buy", symbol: "T0", mint: "mint-0",
  solAmount: 0.03, createdAt: new Date(freshAt).toISOString(),
});
assert.equal(actualTrades.recentTrades[1].signature, null);
assert.equal(actualTrades.recentTrades[1].side, "void");
assert.equal(actualTrades.recentTrades[1].solAmount, 0);
assert.equal(actualTrades.recentTrades[1].createdAt, null);
assert.equal(actualTrades.recentTrades[2].createdAt, null);
assert.equal(actualTrades.recentTrades[2].solAmount, null);
assert.equal(actualTrades.recentTrades.at(-1).id, "trade-11");
assert.deepEqual(plain(api.summarizeTrix({ "trix.money": actualTrades }).trixMoneyRecentTrades), plain(actualTrades.recentTrades));
for (const row of actualTrades.recentTrades) {
  assert.deepEqual(Object.keys(row).sort(), ["signature", "id", "side", "symbol", "mint", "solAmount", "createdAt"].sort());
}
tradeItems = [null, {}, [], { signature: "not the real field", createdAt: freshAt }];
assert.deepEqual(plain((await api.sniffTrixMoney()).recentTrades), []);
tradeItems = [];
failures.set("/", 503);
const failedBalances = await api.sniffTrixMoney();
assert.equal(failedBalances.treasury.balanceSolOnChain, null);
assert.equal(failedBalances.treasury.balanceSolOnChainAt, null);
assert.equal(failedBalances.partial, true);
assert.match(failedBalances.reason, /Solana RPC HTTP 503/);
failures.clear();

// Cached catalog discovery/inference keep their old evidence times, not this poll's.
recent = [{ ...generation, generator: null }];
const discoveryAt = "2026-09-08T11:00:00Z";
const cachedStart = requests.length;
const cachedGeoff = await api.sniffTrixGeoff({ previous: {
  tokenMints: Array.from({ length: 100 }, (_, index) => `known-${index}`),
  launchCatalogCheckedAt: discoveryAt, launchTotal: 983,
  infer: { inferredSigs: [generation.txSignature], verifiedAt: discoveryAt },
}, maxMints: 0 });
assert.equal(cachedGeoff.launchCatalogCheckedAt, discoveryAt);
assert.equal(cachedGeoff.infer.verifiedAt, discoveryAt);
assert.equal(cachedGeoff.inferredCount, 1);
assert.equal(requests.length - cachedStart, 1);
recent = [generation];

// Retain generation history and its provenance without reviving retired Packs.
const oldAt = "2026-09-08T10:00:00Z";
const oldGeoff = { ...plain(geoff), checkedAt: oldAt, packs: { ok: true, minted: 99 } };
const history = api.mergeTrixGeoffHistory(null, oldGeoff);
const failedHistory = api.mergeTrixGeoffHistory(history, {
  source: "trix.geoff", ok: false, checkedAt: iso(), error: "offline", records: [],
});
assert.equal(failedHistory.ok, false);
assert.equal(failedHistory.stale, true);
assert.equal(failedHistory.checkedAt, oldAt);
assert.equal(failedHistory.count, history.count);
assert.equal(failedHistory.paidLamports, history.paidLamports);
assert.equal(failedHistory.records[0].txSignature, generation.txSignature);
assert.equal(Object.hasOwn(failedHistory, "packs"), false);
assert.match(failedHistory.reason, /offline/);
assert.equal(api.mergeTrixGeoffHistory({ ...history, checkedAt: null }, {
  ok: false, checkedAt: iso(), reason: "offline", records: [],
}).checkedAt, null);
const nextRecord = { ...history.records[0], id: "gen-2", createdAt: iso() };
const recovered = api.mergeTrixGeoffHistory(failedHistory, {
  ok: true, checkedAt: iso(), records: [nextRecord, nextRecord],
});
assert.equal(recovered.count, history.count + 1);
assert.equal(recovered.paidLamports, history.paidLamports + nextRecord.feeLamports);
assert.equal(recovered.checkedAt, iso());
assert.equal(recovered.stale, false);
assert.equal(api.mergeTrixGeoffHistory(history, recovered).count, recovered.count);

// One failed history must not discard other records, scan progress or inference.
const partialPrevious = { sources: { "trix.geoff": {
  ...plain(history),
  tokenMints: Array.from({ length: 100 }, (_, index) => `backfill-${index}`),
  scannedTokenMints: ["backfill-99"],
  launchCatalogCheckedAt: iso(),
  infer: { inferredSigs: ["old-inference"], verifiedAt: oldAt },
  inferredSigs: ["old-inference"],
} } };
const partialPreviousJson = JSON.stringify(partialPrevious);
recent = [];
for (let index = 0; index < 5; index += 1) tokenHistories.set(`backfill-${index}`, []);
tokenHistories.set("backfill-0", [{ ...generation, id: "partial-labeled", txSignature: "partial-labeled-tx", createdAt: iso() }]);
tokenHistories.set("backfill-1", [{ ...generation, id: "failed-response-record", createdAt: iso() }]);
tokenHistories.set("backfill-2", [{ ...generation, generator: null, id: "partial-inferred", txSignature: "partial-inferred-tx", createdAt: iso() }]);
providerTransfers = ["QR7US76WP3D4Hk65DuvF8ZPWb9E65MBgBk25j7f9TtY", "H1HU4Bfg6hsMz8SP2JB27urLM1TeB7UhKREsukRtvoid"];
failures.set("/api/meme-image/token/backfill-1", 503);
const partialMinute = await api.runMinuteSniff({ previous: partialPrevious });
const partialGeoff = partialMinute.sources["trix.geoff"];
assert.equal(partialGeoff.ok, false);
assert.equal(partialGeoff.stale, true);
assert.equal(partialGeoff.checkedAt, partialPrevious.sources["trix.geoff"].checkedAt);
assert.match(partialGeoff.reason, /Some token generation histories unavailable/);
assert.deepEqual(Array.from(partialGeoff.records, (record) => record.id).sort(), ["partial-inferred", "partial-labeled"]);
assert.deepEqual(plain(partialGeoff.resolvedTokenMints), ["backfill-0", "backfill-2", "backfill-3", "backfill-4"]);
assert.ok(partialGeoff.scannedTokenMints.includes("backfill-99"));
assert.ok(partialGeoff.scannedTokenMints.includes("backfill-0"));
assert.equal(partialGeoff.scannedTokenMints.includes("backfill-1"), false);
assert.ok(partialGeoff.inferredSigs.includes("partial-inferred-tx"));
assert.ok(partialGeoff.infer.inferredSigs.includes("old-inference"));
assert.ok(partialGeoff.infer.inferredSigs.includes("partial-inferred-tx"));
assert.ok(Date.parse(partialGeoff.infer.verifiedAt) > Date.parse(oldAt));
const mergedPartial = service.preserveTrixHistory(partialPrevious, partialMinute);
assert.equal(mergedPartial.sources["trix.geoff"].ok, false);
assert.equal(mergedPartial.sources["trix.geoff"].count, history.count + 2);
assert.equal(mergedPartial.sources["trix.geoff"].paidLamports, history.paidLamports + generation.feeLamports * 2);
assert.equal(mergedPartial.sources["trix.geoff"].records.length, history.records.length + 2);
assert.equal(mergedPartial.summary.trixGeoffCount, history.count + 2);
const progressStart = requests.length;
const progressed = service.preserveTrixHistory(mergedPartial, await api.runMinuteSniff({ previous: mergedPartial }));
const nextHistories = requests.slice(progressStart).map((request) => new URL(request.url).pathname).filter((path) => path.startsWith("/api/meme-image/token/"));
assert.ok(nextHistories.includes("/api/meme-image/token/backfill-1"));
assert.ok(nextHistories.includes("/api/meme-image/token/backfill-5"));
assert.equal(nextHistories.includes("/api/meme-image/token/backfill-0"), false);
assert.ok(progressed.sources["trix.geoff"].scannedTokenMints.includes("backfill-5"));
assert.equal(progressed.sources["trix.geoff"].count, history.count + 2);
assert.equal(JSON.stringify(partialPrevious), partialPreviousJson);
tokenHistories.clear();
providerTransfers = [];
recent = [generation];
failures.clear();

// Full/minute summaries use the same source contract, including coverage.
const coldMinute = await api.runMinuteSniff();
assert.equal(Object.keys(coldMinute.sources).length, 13);
assert.equal(coldMinute.summary.totalSources, 13);
assert.equal(coldMinute.sources["trix.boxes"].status, 404);
const full = service.preserveTrixHistory(null, await api.runSniff());
assert.equal(Object.keys(full.sources).length, 36);
assert.equal(full.sources["trix.boxes"].status, 404);
assert.equal(full.summary.trixBoxesOk, false);
assert.equal(full.summary.trixBoxesStatus, 404);
assert.equal(full.summary.trixBoxesTopCoins, null);
assert.equal(full.summary.coverage.find((source) => source.source === "trix.boxes").optional, true);
const baseline = {
  ...plain(full),
  sources: { ...plain(full.sources), untouched: { source: "untouched", ok: true, checkedAt: oldAt } },
  summary: { ...plain(full.summary), trixCardCount: 99, trixMoneyMarketVolume24h: 99999, trixMemeMarketTotalVol: 55555 },
};
baseline.sources["trix.geoff"].packs = { ok: true, minted: 888 };
failures.set("/api/meme-image/recent", new Error("generations offline"));
failures.set("/api/fee-config", "invalid");
failures.set("/health", new Error("health offline"));
launches[0].marketCap = 9500;
const baselineJson = JSON.stringify(baseline);
const minuteRequestStart = requests.length;
const minute = service.preserveTrixHistory(baseline, await api.runMinuteSniff({ previous: baseline }));
assert.equal(requests.slice(minuteRequestStart).filter((request) => new URL(request.url).pathname === "/api/mkt/leaderboard").length, 1);
assert.equal(minute.sources["trix.boxes"].status, 404);
assert.equal(minute.sources["trix.boxes"].topCoins, null);
assert.notEqual(minute.sources["trix.boxes"].checkedAt, baseline.sources["trix.boxes"].checkedAt);
assert.equal(minute.summary.trixBoxesStatus, 404);
assert.equal(minute.summary.trixBoxesTopCoins, null);
assert.equal(minute.summary.trixBoxesReason, minute.sources["trix.boxes"].reason);
assert.equal(minute.summary.coverage.find((source) => source.source === "trix.boxes").ok, false);
assert.equal(requests.slice(minuteRequestStart).filter((request) => new URL(request.url).pathname === "/api/launches").length, 2);
for (const source of ["trix.geoff", "trix.fee.config", "stacknet.health"]) {
  assert.equal(minute.sources[source].ok, false, source);
  assert.equal(minute.sources[source].stale, true, source);
  assert.equal(minute.sources[source].checkedAt, baseline.sources[source].checkedAt, source);
  assert.ok(minute.sources[source].lastAttemptAt, source);
}
assert.equal(minute.sources["trix.money"].ok, true);
assert.notEqual(minute.sources["trix.money"].checkedAt, baseline.sources["trix.money"].checkedAt);
assert.equal(minute.sources.untouched, baseline.sources.untouched);
assert.equal(minute.summary.trixMemeMarketTotalMc, minute.sources["trix.meme.market"].totalMarketCap);
assert.notEqual(minute.summary.trixMemeMarketTotalMc, baseline.summary.trixMemeMarketTotalMc);
assert.equal(minute.summary.trixGeoffOk, false);
assert.equal(minute.summary.trixCardCount, null);
assert.equal(minute.summary.trixMoneyMarketVolume24h, null);
assert.equal(minute.summary.trixMemeMarketTotalVol, null);
assert.equal(minute.summary.totalSources, Object.keys(minute.sources).length);
assert.equal(minute.summary.failedSources, Object.values(minute.sources).filter((source) => !source.ok && !source.skipped).length);
const failedFull = service.preserveTrixHistory(baseline, await api.runSniff({ previous: baseline }));
assert.equal(failedFull.sources["trix.geoff"].ok, false);
assert.equal(failedFull.sources["trix.geoff"].checkedAt, baseline.sources["trix.geoff"].checkedAt);
for (const snapshot of [full, failedFull, minute]) {
  for (const [key, value] of Object.entries(api.summarizeTrix(snapshot.sources))) {
    assert.deepEqual(plain(snapshot.summary[key]), plain(value), key);
  }
  for (const [key, value] of Object.entries(api.summarizeCoverage(snapshot.sources))) {
    assert.deepEqual(plain(snapshot.summary[key]), plain(value), key);
  }
}
assert.equal(JSON.stringify(baseline), baselineJson);
const minuteWithBoxHistory = await api.runMinuteSniff({ previous: {
  ...baseline, sources: { ...baseline.sources, "trix.boxes": liveBoxes },
} });
assert.equal(minuteWithBoxHistory.sources["trix.boxes"].status, 404);
assert.equal(minuteWithBoxHistory.sources["trix.boxes"].checkedAt, liveBoxes.checkedAt);
assert.deepEqual(plain(minuteWithBoxHistory.summary.trixBoxesTopCoins), plain(liveBoxes.topCoins));
assert.equal(minuteWithBoxHistory.summary.trixBoxesOk, false);
assert.equal(minuteWithBoxHistory.summary.trixBoxesStale, true);

// Execute the real tick handler with in-memory persistence and no real auth.
bundle = { latest: baseline, state: { lastPollAt: oldAt, pollCount: 3 }, events: [], dailyActivity: [] };
tick.namespace.authorizeFixture();
const response = {
  setHeader() {}, status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; },
};
await tick.namespace.default({ method: "GET", headers: {}, query: { profile: "trix" } }, response);
assert.equal(response.statusCode, 200);
assert.equal(saves, 1);
assert.equal(saved.latest.sources["trix.geoff"].ok, false);
assert.equal(saved.latest.sources["trix.fee.config"].ok, false);
assert.equal(saved.latest.sources["trix.boxes"].status, 404);
assert.equal(saved.latest.summary.trixBoxesStatus, 404);
assert.equal(saved.latest.summary.trixGeoffOk, false);
assert.equal(saved.state.lastPollAt, oldAt);
assert.equal(saved.state.pollCount, 4);
bundle = saved;
const payload = await service.getSharedPayload({ sniffLive: false });
assert.equal(payload.state.lastPollAt, oldAt);
assert.notEqual(payload.state.lastPollAt, payload.latest.takenAt);
assert.equal(saves, 1);

// Three 7s Stacknet reads must not starve responsive TRIX's 6s requests.
failures.clear();
slowStacknet = true;
let slowMinute = null;
const slowPending = api.runMinuteSniff({ previous: baseline }).then((value) => { slowMinute = value; });
for (let step = 0; step < 100 && !slowMinute; step += 1) {
  await new Promise(setImmediate);
  if (slowMinute) break;
  const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || [];
  assert.ok(timer, "slow Stacknet test stalled without a timer");
  now = Math.max(now, timer.at);
  timers.delete(id);
  timer.callback();
}
await slowPending;
for (const [name, source] of Object.entries(slowMinute.sources)) {
  if (name.startsWith("trix.") && name !== "trix.boxes") assert.equal(source.ok, true, name);
}
assert.equal(slowMinute.sources["trix.boxes"].status, 404);
assert.equal(slowMinute.sources["stacknet.health"].ok, true);
assert.ok(slowMinute.sources["trix.geoff"].resolvedTokenMints.length > 0);
assert.ok(slowMinute.durationMs < 18000);
assert.equal(timers.size, 0);
slowStacknet = false;

// Hanging upstreams obey queue-inclusive timeouts, never consume the 60s tick.
assert.equal(timers.size, 0);
const timeoutStart = now;
const timedRequestStart = requests.length;
hang = true;
let timed = null;
const pending = api.runMinuteSniff({ previous: baseline }).then((value) => { timed = value; });
for (let step = 0; step < 100 && !timed; step += 1) {
  await new Promise(setImmediate);
  if (timed) break;
  const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || [];
  assert.ok(timer, "hung collection without a bounded timer");
  now = Math.max(now, timer.at);
  timers.delete(id);
  timer.callback();
}
await pending;
assert.ok(timed);
assert.ok(now - timeoutStart <= 18000, `minute took ${now - timeoutStart}ms`);
assert.ok(timed.durationMs < 60000);
assert.ok(requests.length - timedRequestStart <= 23);
assert.ok(timeouts.every((timeout) => timeout <= 18000));
for (const [name, source] of Object.entries(timed.sources)) {
  if (name.startsWith("trix.") || ["stacknet.health", "stacknet.root", "stacknet.network", "stacknet.node", "stacknet.models"].includes(name)) {
    assert.equal(source.ok, false, name);
    assert.equal(source.stale, true, name);
    if (name === "trix.boxes") {
      assert.notEqual(source.checkedAt, baseline.sources[name].checkedAt);
      assert.equal(source.topCoins, null);
      assert.equal(source.sourceUrl, boxesUrl);
    } else assert.equal(source.checkedAt, baseline.sources[name].checkedAt, name);
  }
}
assert.equal(timers.size, 0);
assert.equal(saves, 1);
console.log("trix live: current catalog, boxes, trade rows, bounded reads, partial failure, history, minute/full summary and tick assertions passed");
