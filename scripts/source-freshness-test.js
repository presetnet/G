// Run: node --experimental-vm-modules scripts/source-freshness-test.js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as crypto from "node:crypto";
import * as tokenPlan from "../server/token-plan.js";

let now = Date.parse("2026-09-04T12:00:00Z");
const iso = () => new Date(now).toISOString();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
let persisted = null;
let requests = 0;
let failFetch = false;
const context = vm.createContext({
  Date: Clock, process: { env: {} }, AbortController, setTimeout, clearTimeout,
  fetch: async () => {
    requests += 1;
    now += 100;
    if (failFetch) throw new Error("offline");
    return {
      ok: true, status: 200, url: "https://fixture.test/",
      headers: new Map(),
      text: async () => JSON.stringify([{ tag_name: "v1", published_at: "2020-01-01" }]),
      json: async () => ({ result: [] }),
    };
  },
});
const code = await readFile(new URL("../server/sniffer.js", import.meta.url), "utf8");
// Test-only access keeps production exports and dependency injection unchanged.
const module = new vm.SourceTextModule(`${code}
export { observeSource };
export function stubCollectors() {
  ${[...code.matchAll(/(?:export )?async function (sniff\w+)\(/g)]
    .map((match) => match[1])
    .filter((name) => name !== "sniffStacknetMinute")
    .map((name) => `${name} = async () => { throw new Error("fixture failure"); };`)
    .join("\n")}
  sniffStacknetHealth = async () => {
    nowAdvance();
    return { source: "stacknet.health", ok: true };
  };
  sniffStacknetRoot = async () => ({ source: "stacknet.root", ok: false, status: 503 });
}
`, { context });
context.nowAdvance = () => { now += 1000; };
await module.link(async (specifier) => {
  const exports = specifier === "node:crypto" ? crypto
    : specifier === "./token-plan.js" ? tokenPlan
    : specifier === "./config.js" ? { config: {} }
    : {
      loadMiningSurfaceCache: async () => persisted,
      saveMiningSurfaceCache: async (value) => { persisted = value; },
    };
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
});
await module.evaluate();
const api = module.namespace;

let resolveSlow;
const slow = api.observeSource("slow", new Promise((resolve) => { resolveSlow = resolve; }));
const fast = await api.observeSource("fast", Promise.resolve({ source: "fast", ok: true }));
const fastAt = iso();
now += 5000;
resolveSlow({ source: "slow", ok: false, status: 503 });
assert.equal(fast.checkedAt, fastAt);
assert.equal((await slow).checkedAt, iso());
const rejected = await api.observeSource("failed", Promise.reject(new Error("offline")));
assert.equal(rejected.source, "failed");
assert.equal(rejected.checkedAt, iso());
assert.equal(rejected.ok, false);
for (const value of [
  { source: "old", checkedAt: "2020-01-01T00:00:00Z" },
  { source: "unknown", checkedAt: null },
  { source: "legacy", cached: true },
  { source: "skipped", skipped: true },
]) {
  assert.equal(await api.observeSource(value.source, Promise.resolve(value)), value);
}

for (const collect of [api.sniffOpencodeReleases, api.sniffZenErrorShape, api.sniffNodeKeys9g]) {
  const first = await collect();
  const count = requests;
  now += 1000;
  const cached = await collect();
  assert.ok(first.checkedAt);
  assert.equal(cached.checkedAt, first.checkedAt);
  assert.equal(cached.cached, true);
  assert.equal(requests, count);
}
const mining = await api.sniffMiningSurface(true);
assert.equal(persisted.source.checkedAt, mining.checkedAt);
now += 1000;
const cachedMining = await api.sniffMiningSurface();
assert.equal(cachedMining.checkedAt, mining.checkedAt);
delete persisted.source.checkedAt;
const legacyMining = await api.observeSource("surface.mining", api.sniffMiningSurface());
assert.equal(Object.hasOwn(legacyMining, "checkedAt"), false);
assert.ok(legacyMining.miners60mAt);

now += 16 * 60 * 1000;
failFetch = true;
const failedRelease = await api.sniffOpencodeReleases();
assert.equal(failedRelease.ok, false);
assert.equal(failedRelease.checkedAt, iso());
assert.ok(Date.parse(failedRelease.latestCheckedAt) < Date.parse(failedRelease.checkedAt));
assert.equal(failedRelease.latestAt, "2020-01-01");

api.stubCollectors();
const previous = { sources: {
  untouched: { source: "untouched", checkedAt: "2020-01-01T00:00:00Z" },
  legacy: { source: "legacy" },
  "solana.tokens": { mints: [{ mint: "fixture" }] },
} };
const before = JSON.stringify(previous);
const full = await api.runSniff({ previous });
assert.equal(Object.keys(full.sources).length, 31);
assert.equal(Object.keys(full.sources).some((key) => key.startsWith("source-")), false);
for (const source of Object.values(full.sources)) assert.ok(source.checkedAt, source.source);
assert.equal(full.sources["stacknet.health"].ok, true);
assert.equal(full.sources["stacknet.root"].status, 503);
assert.equal(full.sources["solana.tokens"].mintsCheckedAt, null);
previous.sources["solana.tokens"].mintsCheckedAt = fastAt;
const retained = await api.runSniff({ previous });
assert.equal(retained.sources["solana.tokens"].mintsCheckedAt, fastAt);
delete previous.sources["solana.tokens"].mintsCheckedAt;
assert.equal(JSON.stringify(previous), before);

const minute = await api.sniffStacknetMinute();
assert.equal(Object.keys(minute.sources).length, 5);
for (const source of Object.values(minute.sources)) {
  assert.equal(source.checkedAt, iso());
  assert.notEqual(source.checkedAt, minute.takenAt);
}
// api/tick.js overlays only observed sources; no timestamp backfill on retained data.
const merged = { ...previous.sources, ...minute.sources };
assert.equal(merged.untouched, previous.sources.untouched);
assert.equal(Object.hasOwn(merged.legacy, "checkedAt"), false);
console.log("source freshness: all assertions passed");
