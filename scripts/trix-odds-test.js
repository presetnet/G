// Run: node --experimental-vm-modules scripts/trix-odds-test.js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as crypto from "node:crypto";
import * as tokenPlan from "../server/token-plan.js";

const context = vm.createContext({
  process: { env: {} },
  fetch: () => { throw new Error("Network is forbidden in parser fixtures"); },
});
const code = await readFile(new URL("../server/sniffer.js", import.meta.url), "utf8");
const module = new vm.SourceTextModule(code, { context });
await module.link(async (specifier) => {
  const exports = specifier === "node:crypto" ? crypto
    : specifier === "./token-plan.js" ? tokenPlan
    : specifier === "./config.js" ? { config: {} }
    : { loadMiningSurfaceCache: async () => null, saveMiningSurfaceCache: async () => {} };
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
});
await module.evaluate();
const { parseTrixPackMarket, mergeTrixGeoffHistory } = module.namespace;
const state = {
  round: 2,
  levels: [{ id: "base", minted: 12, available: 88, priceUsd: 10, bands: { common: [1, 2] } }],
};
const parse = (oddsBp) => parseTrixPackMarket({ ...state, economy: { oddsBp } }, { status: 200 });
const schedule = { common: 4000, uncommon: 1000, rare: 300, epic: 50, mythic: 10, trix: 4640 };
const result = parse(schedule);
assert.equal(result.ok, true);
assert.deepEqual(Array.from(result.classes, ({ key, label }) => [key, label]), [
  ["common", "Common"], ["uncommon", "Uncommon"], ["rare", "Rare"],
  ["epic", "Epic"], ["mythic", "Mythic"], ["trix", "Void"],
]);
for (const row of result.classes) {
  assert.equal(row.oddsBps, schedule[row.key]);
  assert.equal(row.oddsPercent, schedule[row.key] / 100);
}
assert.equal(result.minted, 12);
assert.equal(result.classes[0].payoutMin, 1);
assert.equal(result.classes[0].payoutMax, 2);
assert.equal(result.oddsSourceUrl, result.sourceUrl);
assert.ok(result.oddsSourceUrl.endsWith("/api/mkt/state"));
assert.match(result.note, /API-reported, not observed card outcomes/);

for (const input of [state, { ...state, economy: null }, { ...state, economy: {} }]) {
  for (const row of parseTrixPackMarket(input, { status: 200 }).classes) {
    assert.equal(row.oddsBps, null);
    assert.equal(row.oddsPercent, null);
  }
}
for (const invalid of [undefined, null, "4000", "", true, false, NaN, Infinity, -Infinity, -1, 10001, {}, []]) {
  const rows = parse({ ...schedule, common: invalid }).classes;
  assert.equal(rows[0].oddsBps, null);
  assert.equal(rows[0].oddsPercent, null);
  assert.equal(rows[1].oddsBps, schedule.uncommon);
}
for (const value of [0, 10000, 12.5]) {
  const row = parse({ common: value }).classes[0];
  assert.equal(row.oddsBps, value);
  assert.equal(row.oddsPercent, value / 100);
}
// Preserve individually valid odds even when their total is not 10,000.
const unnormalized = { ...schedule, common: 1 };
assert.deepEqual(Array.from(parse(unnormalized).classes, (row) => row.oddsBps), Object.values(unnormalized));
assert.notEqual(parse(unnormalized).fingerprint, result.fingerprint);
assert.notEqual(parse({}).fingerprint, parse({ common: 0 }).fingerprint);
assert.equal(parse({ common: null }).fingerprint, parse({}).fingerprint);
assert.equal(parse(Object.fromEntries(Object.entries(schedule).reverse())).fingerprint, result.fingerprint);
assert.equal(parseTrixPackMarket(state, { status: 503 }).ok, false);
assert.equal(parseTrixPackMarket(null, { status: 200 }).classes.length, 0);

const richState = {
  round: 3,
  roundStatus: "live",
  tcg: false,
  roundPacks: 100,
  rewardValueUsd: 130375.46,
  memesRemaining: 5835,
  vaultBacked: true,
  vaultShortfallLamports: 0,
  memePoolFloor: 10,
  coverableUsd: 130375.46,
  outstandingLiabilityUsd: 157332.63,
  sharedLockCoverageBps: 10000,
  sharedLockNominalLamports: 0,
  roundFloor: 200,
  roundEndsAt: null,
  agedPool: {
    stakedPacks: 4084,
    accPerShare: "88534589721",
    totalShares: 1388737760184,
    undistributedLamports: 0,
    fundedLamports: 13870374365,
    paidLamports: 0,
    owedLamports: 13870374365,
    fundedUsd: 1441.55,
    paidUsd: 0,
    owedUsd: 1441.55,
  },
  snapshot: {
    stale: false,
    generatedAt: "2026-09-07T21:58:23.137Z",
    ageMs: 4967,
    refreshInFlight: false,
    lastRefreshFailedAt: null,
  },
  levels: [{
    id: "base",
    minted: 4084,
    available: 5825,
    priceUsd: 35.34,
    priceSol: 0.34,
    soldOut: false,
    maxSupply: 0,
    maxMultiple: 400,
    isNew: true,
    bands: { common: [0.5, 0.75] },
  }],
  economy: { oddsBp: { common: 4561, uncommon: 900, rare: 200, epic: 35, mythic: 4, trix: 4300 } },
};
const rich = parseTrixPackMarket(richState, {
  status: 200,
  genesisStatus: 200,
  genesis: {
    round: 1,
    isGenesis: true,
    tcg: false,
    status: "warming",
    endsAt: null,
    owned: 0,
    opened: false,
    cap: 5825,
    pricePerPackUsd: 35.34,
    mostRipped: { symbol: "CANNON", buybackUsd: 0 },
    memeStatus: "OK",
    topMemed: Array.from({ length: 12 }, (_, index) => ({
      symbol: `S${index}`, name: `N${index}`, memes: 100 - index,
    })),
    botUnlocked: false,
    maxPerBuy: 20,
  },
});
assert.equal(rich.ok, true);
assert.equal(rich.snapshotStale, false);
assert.equal(rich.snapshotGeneratedAt, "2026-09-07T21:58:23.137Z");
assert.equal(rich.snapshotAgeMs, 4967);
assert.equal(rich.snapshotRefreshInFlight, false);
assert.equal(rich.snapshotLastRefreshFailedAt, null);
assert.equal(rich.vaultBacked, true);
assert.equal(rich.coverableUsd, 130375.46);
assert.equal(rich.outstandingLiabilityUsd, 157332.63);
assert.equal(rich.sharedLockCoverageBps, 10000);
assert.equal(rich.sharedLockNominalLamports, 0);
assert.equal(rich.memePoolFloor, 10);
assert.equal(rich.roundFloor, 200);
assert.equal(rich.memesRemaining, 5835);
assert.equal(rich.rewardValueUsd, 130375.46);
assert.equal(rich.roundEndsAt, null);
assert.equal(rich.agedPool.stakedPacks, 4084);
assert.equal(rich.agedPool.accPerShare, "88534589721");
assert.equal(rich.agedPool.totalShares, 1388737760184);
assert.equal(rich.agedPool.owedUsd, 1441.55);
assert.equal(rich.levels[0].soldOut, false);
assert.equal(rich.levels[0].maxSupply, 0);
assert.equal(rich.levels[0].maxMultiple, 400);
assert.equal(rich.levels[0].isNew, true);
assert.equal(rich.genesisTopMemed.length, 10);
assert.equal(rich.genesisTopMemed[0].symbol, "S0");
assert.equal(rich.genesisTopMemed[0].memes, 100);
assert.equal(rich.genesisBotUnlocked, false);
assert.equal(rich.genesisMaxPerBuy, 20);
assert.equal(rich.genesisOwned, 0);
assert.equal(rich.genesisOpened, false);
assert.equal(rich.genesisEndsAt, null);
assert.notEqual(rich.fingerprint, result.fingerprint);
assert.notEqual(
  parseTrixPackMarket({ ...richState, vaultBacked: false }, { status: 200 }).fingerprint,
  rich.fingerprint,
);
const noSnapshot = parseTrixPackMarket({ ...richState, snapshot: null, agedPool: null }, { status: 200 });
assert.equal(noSnapshot.snapshotAgeMs, null);
assert.equal(noSnapshot.snapshotStale, null);
assert.equal(noSnapshot.agedPool, null);
assert.notEqual(noSnapshot.fingerprint, rich.fingerprint);

const hugePrevious = {
  tokenMints: Array.from({ length: 3100 }, (_, index) => `mint-${index}`),
  scannedTokenMints: Array.from({ length: 3100 }, (_, index) => `scanned-${index}`),
  count: 5,
  paidLamports: 100,
  records: [],
};
const merged = mergeTrixGeoffHistory(hugePrevious, { records: [], ok: true });
assert.equal(merged.tokenMints.length, 3000);
assert.equal(merged.scannedTokenMints.length, 3000);
assert.equal(merged.tokenMints[0], "mint-100");
assert.equal(merged.scannedTokenMints[0], "scanned-100");
console.log("trix odds: all assertions passed");
