// Run: node --experimental-vm-modules scripts/sim-live-test.js
// SIM desk sniffers + translator events, fully fxtured. Nothing touches a live desk.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as crypto from "node:crypto";
import * as tokenPlan from "../server/token-plan.js";

let now = Date.parse("2026-09-24T12:00:00Z");
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

const SIM_SOL_DEST = "BjLoeUtRq1QBLBWcTWgUFFfj75BsrcESZMu6F1DrMV9C";
const SIM_MINT = "CZNZLxbSB3VRTSZR5TH9FKozh2RGjrZGGUAANE8JTRiX";

const siteFixture = {
  version: 1,
  sections: { home: true, money: true },
  rates: { like: 1111, reply: 2223, repost: 3333, mention: 4444, payment: 66369 },
};
const sessionFixture = { configured: true, user: null, isAdmin: false };
const frontHtml = () => `<!doctype html><html><body>
  <h1>THE SIMULATION</h1><h2>UNREALITY</h2><p>XMONEY</p>
  <p>SEND $8 @XMONEY</p><p>0.003 ETH TO void.eth · chain 11155111</p>
  <p>0.068 SOL TO ${SIM_SOL_DEST}</p>
  <strong class="sim-countdown" datetime="2026-09-25T20:00:00-04:00">deadline</strong>
  </body></html>`;
let siteStatus = 200;

const readOnlyStore = {
  loadMiningSurfaceCache: async () => null,
  saveMiningSurfaceCache: async () => {},
};
const context = vm.createContext({
  Date: Clock, process: { env: {} }, Buffer, AbortController, URL,
  setTimeout, clearTimeout,
  fetch: async (input, options = {}) => {
    const url = new URL(input);
    options.signal?.throwIfAborted();
    now += 1;
    const respond = (status, json) => ({
      ok: status >= 200 && status < 300, status,
      url: String(url), headers: new Map(),
      text: async () => typeof json === "string" ? json : JSON.stringify(json),
      json: async () => typeof json === "string" ? null : json,
    });
    if (url.origin === "https://sim.tech") {
      if (url.pathname === "/api/site") return respond(siteStatus, siteFixture);
      if (url.pathname === "/api/session") return respond(200, sessionFixture);
      if (url.pathname === "/") return respond(200, frontHtml());
      throw new Error(`Unexpected sim.tech fixture URL ${url}`);
    }
    if (url.origin === "https://api.mainnet-beta.solana.com") {
      const rpc = JSON.parse(options.body);
      if (rpc.method === "getTokenSupply") {
        assert.equal(rpc.params[0], SIM_MINT);
        return respond(200, { result: { value: { amount: "9999313135929", decimals: 6, uiAmount: 9999313.135929 } } });
      }
      if (rpc.method === "getSignaturesForAddress") {
        const address = rpc.params[0];
        assert.equal(JSON.stringify(rpc.params[1]), JSON.stringify({ limit: 1, commitment: "confirmed" }));
        if (address !== SIM_MINT && address !== SIM_SOL_DEST) return respond(200, { result: [] });
        return respond(200, { result: [
          { signature: address === SIM_MINT ? "mint-sig" : "dest-sig", err: null, blockTime: now / 1000 - 120 },
        ] });
      }
      throw new Error(`Unexpected RPC ${rpc.method}`);
    }
    throw new Error(`Unexpected fixture URL ${url}`);
  },
});
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
  .filter((name) => !name.startsWith("sniffSim"))
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

// 1. Site settings source: version, sections, rate ladder, configured session, fingerprint.
const site = await api.sniffSimSite();
assert.equal(site.ok, true, site.reason || "site ok");
assert.equal(site.source, "sim.site");
assert.equal(site.status, 200);
assert.equal(site.siteVersion, 1);
assert.equal(site.sections.home, true);
assert.equal(site.sections.money, true);
assert.equal(site.configured, true);
assert.equal(site.rates.like, 1111);
assert.equal(site.rates.reply, 2223);
assert.equal(site.rates.repost, 3333);
assert.equal(site.rates.mention, 4444);
assert.equal(site.rates.payment, 66369);
assert.ok(site.fingerprint && site.fingerprint.length >= 6);

// 2. Home page source: brand markers, both rails, and the published deadline.
const front = await api.sniffSimFront();
assert.equal(front.ok, true, front.reason || "front ok");
assert.equal(front.source, "sim.front");
assert.equal(front.brand, "THE SIMULATION / UNREALITY / XMONEY");
assert.equal(front.markers.simulation, true);
assert.equal(front.markers.xmoneyPayrail, true);
assert.equal(front.markers.ethRailSepolia, true);
assert.equal(front.paymentRail.sol, SIM_SOL_DEST);
assert.equal(front.paymentRail.solAmountSol, 0.068);
assert.equal(front.paymentRail.eth, "void.eth");
assert.equal(front.paymentRail.ethAmount, "0.003");
assert.equal(front.paymentRail.xmoneyUsd, 8);
assert.equal(front.deadline, "2026-09-26T00:00:00.000Z");
assert.ok(front.fingerprint && front.fingerprint.length >= 6);

// 3. On-chain source: SIM supply, mint signature, SOL destination signature, fingerprint.
const chain = await api.sniffSimChain();
assert.equal(chain.ok, true, chain.reason || "chain ok");
assert.equal(chain.source, "sim.chain");
assert.equal(chain.tokenMint, SIM_MINT);
assert.equal(chain.simDecimals, 6);
assert.equal(chain.simSupply, 9999313.135929);
assert.equal(chain.mintLatestSignature, "mint-sig");
assert.equal(chain.destWallet, SIM_SOL_DEST);
assert.equal(chain.destLatestSignature, "dest-sig");
assert.ok(chain.mintLatestAt && chain.destLatestAt);
assert.ok(chain.fingerprint && chain.fingerprint.length >= 6);

// 4. HTTP failure is an unavailable source, not a silent zero or a stale replay.
siteStatus = 503;
now += 60_000;
const failed = await api.sniffSimSite();
assert.equal(failed.ok, false);
assert.equal(failed.status, 503);
assert.equal(failed.siteVersion, 1); // body parsed, but the source is marked unavailable
assert.equal(failed.fingerprint, null);
assert.ok(failed.reason);
siteStatus = 200;

// 5. runSniff wires all three sim sources into the full pass.
const full = await api.runSniff({ previous: null });
for (const name of ["sim.site", "sim.front", "sim.chain"]) {
  assert.ok(full.sources[name], `${name} present in full pass`);
  assert.equal(full.sources[name].ok, true, full.sources[name].reason || `${name} ok`);
}

// 6. Translator: a changed version + deadline emits one "sim" event with movers.
const base = {
  totalSources: 24, okSources: 24,
  sources: {
    "sim.site": { source: "sim.site", ok: true, siteVersion: 0, configured: true, rates: { payment: 66369 }, fingerprint: "a" },
    "sim.front": { source: "sim.front", ok: true, fingerprint: "old", deadline: "2026-09-24T20:00:00-04:00", deadlineFallbackAt: null, paymentRail: { sol: SIM_SOL_DEST }, brand: "THE SIMULATION / UNREALITY / XMONEY" },
    "sim.chain": { source: "sim.chain", ok: true, tokenMint: SIM_MINT, simSupply: 9999313.135929, mintLatestSignature: "mint-sig", destLatestSignature: "dest-sig", fingerprint: "old", destWallet: SIM_SOL_DEST },
  },
};
const moved = {
  ...base,
  sources: {
    ...base.sources,
    "sim.site": { ...base.sources["sim.site"], siteVersion: 1, fingerprint: "b" },
    "sim.front": { ...base.sources["sim.front"], fingerprint: "new", deadline: "2026-09-25T20:00:00-04:00" },
    "sim.chain": { ...base.sources["sim.chain"], simSupply: 9999313.135929 + 100, fingerprint: "c", destLatestSignature: "dest-sig-2" },
  },
};
const events = await translate(base, moved);
const simMovers = events.filter((e) => e.kind === "sim");
assert.equal(simMovers.length, 1, JSON.stringify(events.map((e) => e.kind)));
assert.equal(simMovers[0].rank, "move");
assert.equal(simMovers[0].title, "SIMULATION surface moved");
assert.ok(/site version 0 → 1/.test(simMovers[0].summary), simMovers[0].summary);
assert.ok(/deadline moved/.test(simMovers[0].summary), simMovers[0].summary);

// 7. Identical SIM surface produces no new sim event.
const quiet = await translate(moved, moved);
assert.equal(quiet.filter((e) => e.kind === "sim").length, 0);

// 8. Chain-only movement (supply + signature) is a quiet note, not a mover.
const chainOnly = await translate(moved, {
  ...moved,
  sources: { ...moved.sources, "sim.chain": { ...moved.sources["sim.chain"], simSupply: 9999313.135929 + 500, fingerprint: "d" } },
});
const note = chainOnly.filter((e) => e.kind === "sim");
assert.equal(note.length, 1);
assert.equal(note[0].rank, "note");

console.log("sim live: site/front/chain sniffers, full-pass wiring and translator events passed");