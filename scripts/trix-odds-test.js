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
const { parseTrixPackMarket } = module.namespace;
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
console.log("trix odds: all assertions passed");
