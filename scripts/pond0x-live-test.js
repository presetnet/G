// Run: node --experimental-vm-modules scripts/pond0x-live-test.js
// All fetches are fixtures. Nothing touches a live desk or a live pond0x.com.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as crypto from "node:crypto";
import * as tokenPlan from "../server/token-plan.js";

const requests = [];
let now = Date.parse("2026-09-08T12:00:00Z");
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

const pond0xStatsRecord = {
  usd_sol_rewards: 6909850.890100285, usd_eth_rewards: 28315409,
  usd_claims: 6698463.659491777, usd_ref_rewards: 1170515,
  usd_swap_volume: 0, num_swaps: 52723518, usd_total: 43094238.54959206,
};
// The production payload is an escaped Next.js flight string; quotes arrive as \".
const pond0xHomepage = () => {
  const payload = `1c:["$","$L3a",null,{"statsData":${JSON.stringify(pond0xStatsRecord)},"summary":{}}]`;
  const statsPush = `self.__next_f.push([1,${JSON.stringify(payload)}])`;
  return `<script>${statsPush}</script>\n<header><input placeholder="Search or ask Geoff"></header><GeoffProvider darkMode="true"></GeoffProvider>`;
};
const pond0xHomeNoStats = () =>
  `<script>self.__next_f.push([1,"1c:[\\"$\\",\\"$L1a\\",null,{}]\\n"])</script>\n<div>welcome to the rebuild</div>`;
const assetResponse = (text, status = 200) => ({
  ok: status >= 200 && status < 300, status, url: "https://fixture.test/",
  headers: new Map(), text: async () => text, json: async () => null,
});
let pairStatus = 200;
let pairPayload = { paired: false };
let homepage = pond0xHomepage;

const context = vm.createContext({
  Date: Clock, process: { env: {} }, Buffer, AbortController, URL: URL,
  setTimeout, clearTimeout,
  fetch: async (input, options = {}) => {
    const url = new URL(input);
    requests.push({ url: String(url), method: options.method || "GET" });
    assert.equal(options.headers?.Authorization, undefined);
    assert.equal(options.headers?.Cookie, undefined);
    if (url.hostname === "www.pond0x.com" && url.pathname === "/") {
      return assetResponse(homepage());
    }
    if (url.hostname === "www.pond0x.com" && url.pathname === "/api/geoff/pair") {
      if (pairStatus !== 200) {
        return { ok: false, status: pairStatus, url: String(url), headers: new Map(), text: async () => JSON.stringify({ paired: false }), json: async () => ({ paired: false }) };
      }
      return { ok: true, status: 200, url: String(url), headers: new Map(), text: async () => JSON.stringify(pairPayload), json: async () => pairPayload };
    }
    throw new Error(`Unexpected fixture URL ${url}`);
  },
});
const readOnlyStore = {
  loadMiningSurfaceCache: async () => null,
  saveMiningSurfaceCache: async () => {},
};
const modules = new Map();
for (const [key, exports] of Object.entries({
  "node:crypto": crypto,
  "token-plan.js": tokenPlan,
  "config.js": { config: { stacknetBaseUrl: "https://stacknet.fixture", pollIntervalMs: 60000 } },
  "store.js": readOnlyStore,
})) {
  modules.set(key, new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { context }));
}
const snifferCode = await readFile(new URL("../server/sniffer.js", import.meta.url), "utf8");
const translatorCode = await readFile(new URL("../server/translator.js", import.meta.url), "utf8");
const stubs = [...snifferCode.matchAll(/(?:export )?async function (sniff\w+)\(/g)]
  .map((match) => match[1])
  .filter((name) => !name.startsWith("sniffPond0x"))
  .map((name) => `${name} = async () => { throw new Error("unrelated collector fixture"); };`)
  .join("\n");
modules.set("sniffer.js", new vm.SourceTextModule(`${snifferCode}\nexport function stubUnrelated() { ${stubs} }`, { context }));
modules.set("translator.js", new vm.SourceTextModule(translatorCode, { context }));
const sniffer = new vm.SourceTextModule("import * as api from './sniffer.js'; import * as tr from './translator.js'; export { api, tr };", { context });
await sniffer.link(async (specifier) => {
  const key = specifier.startsWith("node:") ? specifier : specifier.split("/").at(-1);
  assert.ok(modules.has(key), `Unexpected import ${specifier}`);
  return modules.get(key);
});
await sniffer.evaluate();
const api = modules.get("sniffer.js").namespace;
const translate = modules.get("translator.js").namespace.translate;
api.stubUnrelated();

// 1. The escaped flight payload decodes into the real rewards numbers.
const [block, stats] = await Promise.all([api.extractPond0xStatsBlock(homepage()), api.sniffPond0xStats()]);
assert.equal(block.usd_total, 43094238.54959206);
assert.equal(block.num_swaps, 52723518);
assert.equal(block.usd_swap_volume, 0);
assert.equal(stats.ok, true, stats.reason || "stats ok");
assert.equal(stats.source, "pond0x.stats");
assert.equal(stats.status, 200);
assert.equal(stats.usdTotal, 43094238.54959206);
assert.equal(stats.numSwaps, 52723518);
assert.equal(stats.usdEthRewards, 28315409);
assert.equal(stats.usdSolRewards, 6909850.890100285);
assert.equal(stats.usdClaims, 6698463.659491777);
assert.equal(stats.usdRefRewards, 1170515);
assert.equal(stats.usdSwapVolume, 0);
assert.equal(typeof stats.fingerprint, "string");
assert.ok(stats.fingerprint.length >= 6);

// 2. Rounding keeps the fingerprint quiet under normal swap accumulation.
const smallShift = await api.sniffPond0xStats();
assert.equal(smallShift.fingerprint, stats.fingerprint);
const tinyTotal = await api.sniffPond0xStats();
now += 60001;
pond0xStatsRecord.usd_total += 100000;
const bigShift = await api.sniffPond0xStats();
assert.notEqual(bigShift.fingerprint, stats.fingerprint);
assert.notEqual(bigShift.usdTotal, stats.usdTotal);
pond0xStatsRecord.usd_total = tinyTotal.usdTotal;
now += 60001;
assert.equal((await api.sniffPond0xStats()).fingerprint, stats.fingerprint);

// 3. A home page without the block is a failed source, not a silent zero.
homepage = pond0xHomeNoStats;
now += 60001;
const noStats = await api.sniffPond0xStats({ previous: stats });
assert.equal(noStats.ok, false);
assert.equal(noStats.stale, true);
assert.equal(noStats.checkedAt, stats.checkedAt);
assert.ok(noStats.lastAttemptAt);
assert.equal(noStats.fingerprint, stats.fingerprint);
assert.equal(noStats.usdTotal, stats.usdTotal);
assert.match(noStats.reason, /not found/);
homepage = pond0xHomepage;
now += 60001;
assert.equal((await api.sniffPond0xStats()).fingerprint, stats.fingerprint);

// 4. Geoff rail presence.
const geoff = await api.sniffPond0xGeoff();
assert.equal(geoff.ok, true, geoff.reason || "geoff ok");
assert.equal(geoff.source, "pond0x.geoff");
assert.equal(geoff.paired, false);
assert.equal(geoff.chatEmbedded, true);
assert.equal(geoff.providerEmbedded, true);
assert.equal(typeof geoff.fingerprint, "string");
const repeated = await api.sniffPond0xGeoff();
assert.equal(repeated.fingerprint, geoff.fingerprint);

// 5. Pairing an operator account flips the fingerprint.
now += 60001;
pairPayload = { paired: true };
const paired = await api.sniffPond0xGeoff();
assert.equal(paired.paired, true);
assert.notEqual(paired.fingerprint, geoff.fingerprint);
pairPayload = { paired: false };
now += 60001;
assert.equal((await api.sniffPond0xGeoff()).fingerprint, geoff.fingerprint);

// 6. A failing pair gateway is a failed source with retained evidence.
pairStatus = 500;
now += 60001;
const pairDown = await api.sniffPond0xGeoff({ previous: geoff });
assert.equal(pairDown.ok, false);
assert.equal(pairDown.stale, true);
assert.equal(pairDown.status, 500);
assert.equal(pairDown.checkedAt, geoff.checkedAt);
assert.equal(pairDown.fingerprint, geoff.fingerprint);
assert.equal(pairDown.paired, false);
assert.match(pairDown.reason, /500/);
pairStatus = 200;

// 7. Translator events: stats move fires a pond0x "move", geoff flips fire a "note".
const takenAt = new Date().toISOString();
const prev = {
  takenAt, summary: {},
  sources: {
    "pond0x.stats": { ...stats, checkedAt: takenAt },
    "pond0x.geoff": { ...geoff, checkedAt: takenAt },
  },
};
const moved = await api.sniffPond0xStats();
now += 60001;
pond0xStatsRecord.usd_total += 100000;
const movedStats = await api.sniffPond0xStats();
pond0xStatsRecord.usd_total = tinyTotal.usdTotal;
const current = {
  takenAt, summary: {}, sources: {
    "pond0x.stats": movedStats,
    "pond0x.geoff": { ...geoff, checkedAt: takenAt },
  },
};
const statsMoved = await translate(prev, current);
const moveEvent = statsMoved.find((event) => event.kind === "pond0x" && /moved/.test(event.title));
assert.ok(moveEvent, "stats fingerprint change produces a pond0x move event");
assert.equal(moveEvent.kind, "pond0x");
assert.equal(moveEvent.rank, "move");
assert.match(moveEvent.title, /moved/);
assert.equal(moveEvent.details.to.usdTotal, movedStats.usdTotal);
pond0xStatsRecord.usd_total = tinyTotal.usdTotal;
const pairFlipped = {
  takenAt, summary: {}, sources: {
    "pond0x.stats": { ...movedStats, usdTotal: tinyTotal.usdTotal, fingerprint: stats.fingerprint, checkedAt: takenAt },
    "pond0x.geoff": { ...paired, checkedAt: takenAt },
  },
};
const geoffEvents = await translate(current, pairFlipped);
const presenceEvent = geoffEvents.find((event) => event.kind === "pond0x" && /presence changed/.test(event.title));
assert.ok(presenceEvent, "geoff presence change produces a pond0x event");
assert.equal(presenceEvent.rank, "note");
assert.match(presenceEvent.title, /presence changed|presence/i);
assert.match(presenceEvent.summary, /operator account is paired/);

console.log("pond0x live: escaped payload decode, rounding, pair rail, retention and translator event assertions passed");