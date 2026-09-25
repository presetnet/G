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
let destSigsMode = 1;
let rpc429 = false;
let v2Empty = false;
let ethMainnetV2Empty = false;
let v1Empty = false;
let v2Withheld = false;

const readOnlyStore = {
  loadMiningSurfaceCache: async () => null,
  saveMiningSurfaceCache: async () => {},
};
const context = vm.createContext({
  Date: Clock, process: { env: { SIM_CAMPAIGN_START: "2026-09-24T00:00:00Z" } }, Buffer, AbortController, URL,
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
        assert.equal(rpc.params[1]?.commitment, "confirmed");
        if (address !== SIM_MINT && address !== SIM_SOL_DEST) return respond(200, { result: [] });
        if (address === SIM_MINT) return respond(200, { result: [
          { signature: "mint-sig", err: null, blockTime: now / 1000 - 120 },
        ] });
        const destSigs = destSigsMode === 2
          ? [{ signature: "dest-sig2", err: null, blockTime: now / 1000 - 600 }, { signature: "dest-sig", err: null, blockTime: now / 1000 - 120 }]
          : destSigsMode === 3
            ? [{ signature: "seed-sig", err: null, blockTime: now / 1000 - 60 }, { signature: "dest-sig", err: null, blockTime: now / 1000 - 120 }]
            : [{ signature: "dest-sig", err: null, blockTime: now / 1000 - 120 }];
        return respond(200, { result: destSigs });
      }
      if (rpc.method === "getTransaction") {
        if (rpc429) return respond(429, { error: { message: "Solana RPC HTTP 429" } });
        assert.equal(rpc.params[1]?.commitment, "confirmed");
        assert.equal(rpc.params[1]?.maxSupportedTransactionVersion, 0);
        if (rpc.params[0] === "seed-sig") {
          return respond(200, {
            result: {
              slot: 460000300, blockTime: Math.floor(now / 1000) - 60, err: null,
              meta: {
                preBalances: [2000000000, 59513415452, 0, 1000000],
                postBalances: [2000000000, 139513415452, 0, 1000000],
              },
              transaction: { message: { accountKeys: ["9GjEVnpWiLe2uknUmtaH6DSfgcBvL66DtSKGREXDctZU", SIM_SOL_DEST, "11111111111111111111111111111111", "ComputeBudget111111111111111111111111111111"] } },
            },
          });
        }
        if (rpc.params[0] === "dest-sig2") {
          return respond(200, {
            result: {
              slot: 460000100, blockTime: Math.floor(now / 1000) - 600, err: null,
              meta: {
                preBalances: [2000000000, 59513415452, 0, 1000000],
                postBalances: [1999000000, 59514415452, 0, 1000000],
              },
              transaction: { message: { accountKeys: ["6ix1dAxoqNP4VuEANSMmeiefJcJUxaxW9ShjjLnv5Hid", SIM_SOL_DEST, "11111111111111111111111111111111", "ComputeBudget111111111111111111111111111111"] } },
            },
          });
        }
        return respond(200, {
          result: {
            slot: 460000000, blockTime: Math.floor(now / 1000) - 1200, err: null,
            meta: {
              preBalances: [2000000000, 59445415452, 0, 1000000],
              postBalances: [1993200000, 59513415452, 0, 1000000],
            },
            transaction: { message: { accountKeys: ["6ix1dAxoqNP4VuEANSMmeiefJcJUxaxW9ShjjLnv5Hid", SIM_SOL_DEST, "11111111111111111111111111111111", "ComputeBudget111111111111111111111111111111"] } },
          },
        });
      }
      throw new Error(`Unexpected RPC ${rpc.method}`);
    }
    if (url.origin === "https://eth-sepolia.blockscout.com") {
      if (url.searchParams.get("module") === "account") {
        if (v1Empty) return respond(200, { status: "0", message: "No records found", result: [] });
        return respond(200, {
          status: "1", message: "OK",
          result: [
            { hash: "0xaaa", from: "0x96c5161617323a56434753cbe43bad516adc7f48", to: "0xe18d3f89665ebf4ef885389b62a91ed910572af4", value: "3000000000000000", isError: "0", timeStamp: Math.floor(now / 1000) - 900 },
            { hash: "0xbbb", from: "0x686bab3f162e72f903fa9da42d1726e5d01bb46a", to: "0xe18d3f89665ebf4ef885389b62a91ed910572af4", value: "100000000000000000", isError: "1", timeStamp: Math.floor(now / 1000) - 800 },
          ],
        });
      }
      if (v2Empty) return respond(200, { items: [], next_page_params: null });
      if (v2Withheld) {
        return respond(200, {
          items: [
            { hash: "0xw1", result: "ok", value: null, to: { hash: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4" }, from: { hash: "0x999999" }, timestamp: "2026-09-24T11:05:00.000Z" },
            { hash: "0xaaa", result: "pending", value: "3000000000000000", to: { hash: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4" }, from: { hash: "0x96C5161617323A56434753Cbe43BAd516ADc7f48" }, timestamp: "2026-09-24T11:10:00.000Z" },
          ],
          next_page_params: null,
        });
      }
      const items = [
        { hash: "0xaaa", result: "pending", value: "3000000000000000", to: { hash: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4" }, from: { hash: "0x96C5161617323A56434753Cbe43BAd516ADc7f48" }, timestamp: "2026-09-24T11:10:00.000Z" },
        { hash: "0xbbb", result: "ok", value: "100000000000000000", to: { hash: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4" }, from: { hash: "0x686bab3F162e72F903fA9DA42D1726e5D01BB46A" }, timestamp: "2026-09-24T11:14:12.000Z" },
        { hash: "0xccc", result: "ok", value: "0", to: { hash: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4" }, from: { hash: "0x1111" }, timestamp: "2026-09-24T11:00:00.000Z" },
        { hash: "0xddd", result: "reverted", value: "3000000000000000", to: { hash: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4" }, from: { hash: "0x3333" }, timestamp: "2026-09-24T11:20:00.000Z" },
      ];
      return respond(200, { items, next_page_params: null });
    }
    if (url.origin === "https://eth.blockscout.com") {
      if (url.searchParams.get("module") === "account") {
        return respond(200, {
          status: "1", message: "OK",
          result: [
            { hash: "0xma1", from: "0x5c2bd5c6b9a2f0c3ac53d7c4e1ea9cf498a2d78f", to: "0xe18d3f89665ebf4ef885389b62a91ed910572af4", value: "6000000000000000", isError: "0", timeStamp: Math.floor(now / 1000) - 700 },
            { hash: "0xmb2", from: "0x7f0cf1d1b7c8e5a3491b2e9f07c4a6dca6f8f905", to: "0xe18d3f89665ebf4ef885389b62a91ed910572af4", value: "9000000000000000", isError: "1", timeStamp: Math.floor(now / 1000) - 600 },
          ],
        });
      }
      if (ethMainnetV2Empty) return respond(200, { items: [], next_page_params: null });
      const mainItems = [
        { hash: "0xma1", result: "pending", value: "4000000000000000", to: { hash: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4" }, from: { hash: "0x5C2BD5c6b9A2F0c3Ac53d7C4e1EA9Cf498A2d78F" }, timestamp: "2026-09-24T11:30:00.000Z" },
        { hash: "0xma3", result: "reverted", value: "7000000000000000", to: { hash: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4" }, from: { hash: "0x4444" }, timestamp: "2026-09-24T11:34:12.000Z" },
      ];
      return respond(200, { items: mainItems, next_page_params: null });
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

// 3. On-chain source: SIM supply, mint signature, SOL destination signature,
//    and the SOL deposit totals aggregated from the destination's balance deltas.
const chain = await api.sniffSimChain();
assert.equal(chain.ok, true, chain.reason || "chain ok");
assert.equal(chain.source, "sim.chain");
assert.equal(chain.tokenMint, SIM_MINT);
assert.equal(chain.simDecimals, 6);
assert.equal(chain.simSupply, 9999313.135929);
assert.equal(chain.mintLatestSignature, "mint-sig");
assert.equal(chain.destWallet, SIM_SOL_DEST);
assert.equal(chain.destLatestSignature, "dest-sig");
assert.equal(chain.solDepositCount, 1);
assert.equal(chain.solUniquePayers, 1);
assert.equal(chain.solDepositsSol, 68000000 / 1e9); // post 59,513,415,452 - pre 59,445,415,452
assert.ok(chain.knownSigs.includes("dest-sig"));
assert.ok(chain.mintLatestAt && chain.destLatestAt);
assert.ok(chain.fingerprint && chain.fingerprint.length >= 6);
assert.equal(chain.solDepositCount, chain.solDepositRows.length);
assert.equal(chain.solTodayCount, 1);
assert.equal(chain.solHourCount, 1);
assert.equal(chain.solDepositBars.length, 1);
assert.equal(chain.solLargestSol, 0.068);
assert.equal(chain.solTopPayers.length, 1);
assert.equal(chain.solTopPayers[0].wallet, "6ix1dAxoqNP4VuEANSMmeiefJcJUxaxW9ShjjLnv5Hid");
assert.equal(chain.solTopPayers[0].share, 1);
assert.ok(chain.solFirstSeenAt);
assert.equal(chain.solMedianGapSec, null, "a single deposit has no inter-payment gap");

// 3b. Owner/seed wallet (9G) money never surfaces on the SOL payment board.
destSigsMode = 3;
const seedChain = await api.sniffSimChain();
assert.equal(seedChain.ok, true, seedChain.reason || "seed chain ok");
assert.equal(seedChain.solDepositCount, 1, "seed transfer is not a payment");
assert.equal(seedChain.solDepositsSol, 68000000 / 1e9, "80 SOL seed stays out of the pot");
assert.equal(seedChain.solLargestSol, 0.068, "seed transfer is not the largest payment");
assert.equal(seedChain.solUniquePayers, 1);
assert.ok(!seedChain.solTopPayers.some((p) => p.wallet === "9GjEVnpWiLe2uknUmtaH6DSfgcBvL66DtSKGREXDctZU"), "9G never on the leaderboard");
assert.equal(seedChain.solTopPayers.length, 1);
assert.equal(seedChain.solTopPayers[0].wallet, "6ix1dAxoqNP4VuEANSMmeiefJcJUxaxW9ShjjLnv5Hid");
assert.ok(!seedChain.solPayerTotals.some((p) => p.w === "9GjEVnpWiLe2uknUmtaH6DSfgcBvL66DtSKGREXDctZU"));
assert.ok(seedChain.knownSigs.includes("seed-sig"), "excluded sig is still deduped as known");
destSigsMode = 1;

// 4. Ethereum mainnet rail: wei values sum, zero-value and non-incoming items are skipped.
const eth = await api.sniffSimEth();
assert.equal(eth.ok, true, eth.reason || "eth ok");
assert.equal(eth.source, "sim.eth");
assert.equal(eth.ethAddress, "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4");
assert.equal(eth.ethDepositCount, 2);
assert.equal(eth.ethDepositRows.length, 2, "reverted txs are excluded");
assert.equal(eth.ethKnownHashes.length, 4); // 2 deposits + 1 zero-value + 1 reverted skipped
assert.equal(eth.ethUniqueSenders, 2);
assert.ok(Math.abs(eth.ethDepositsEth - (0.003 + 0.1)) < 1e-12);
assert.equal(eth.ethLatestHash, "0xbbb");
assert.equal(eth.ethTodayCount, 2);
assert.equal(eth.ethHourCount, 2);
assert.equal(eth.ethDepositBars.length, 2);
assert.equal(eth.ethLargestEth, 0.1);
assert.equal(eth.ethTopSenders.length, 2);
assert.equal(eth.ethTopSenders[0].wallet, "0x686bab3F162e72F903fA9DA42D1726e5D01BB46A");
assert.ok(Math.abs(eth.ethTopSenders[0].share - (0.1 / 0.103)) < 1e-6);
assert.ok(eth.ethFirstSeenAt);
assert.equal(eth.ethExplorerFallback, null, "v2 path alone needs no fallback");
assert.ok(eth.fingerprint && eth.fingerprint.length >= 6);

// 4b. When the v2 explorer page shells out empty, the v1 txlist fallback records deposits.
v2Empty = true;
const fallbackEth = await api.sniffSimEth();
v2Empty = false;
assert.equal(fallbackEth.ok, true, fallbackEth.reason || "fallback eth ok");
assert.equal(fallbackEth.ethDepositCount, 1, "v1 txlist fallback counts real deposits");
assert.equal(fallbackEth.ethExplorerFallback, "v1", "fallback marked in the source row");
assert.ok(Math.abs(fallbackEth.ethDepositsEth - 0.003) < 1e-12);
assert.equal(fallbackEth.ethLatestHash, "0xaaa");
assert.equal(fallbackEth.ethUniqueSenders, 1);
assert.equal(fallbackEth.ethLargestEth, 0.003);
assert.ok(!fallbackEth.ethTopSenders.some((p) => p.wallet === "0x686bab3F162e72F903fA9DA42D1726e5D01BB46A"), "reverted (isError 1) v1 rows are excluded");

// 4c. The same wallet's Ethereum MAINNET rail reads independently (sim.ethm).
const ethMain = await api.sniffSimEthMainnet();
assert.equal(ethMain.source, "sim.ethm");
assert.equal(ethMain.ethChain, "Ethereum mainnet (1)");
assert.equal(ethMain.ethDepositCount, 1, "mainnet v2 counts 0xma1; reverted 0xma3 excluded");
assert.ok(Math.abs(ethMain.ethDepositsEth - 0.004) < 1e-12);
assert.equal(ethMain.ethMainnetUniqueSender ?? ethMain.ethUniqueSenders, 1);
assert.equal(ethMain.ethLatestHash, "0xma1");
assert.equal(ethMain.ethExplorerFallback, null);
// mainnet v2 pages shell out empty -> v1 txlist fallback serves the receipts.
ethMainnetV2Empty = true;
const ethMainFb = await api.sniffSimEthMainnet();
ethMainnetV2Empty = false;
assert.equal(ethMainFb.ethDepositCount, 1, "mainnet v1 fallback counts deposits");
assert.equal(ethMainFb.ethExplorerFallback, "v1");
assert.equal(ethMainFb.ethLatestHash, "0xma1");
assert.equal(ethMainFb.ethChain, "Ethereum mainnet (1)");

// 4d. An explorer that serves nothing verifiable (v2 shells empty AND the v1
// fallback has no records) must never be reported as a confident 0.0000 ETH —
// it is an unavailable source carrying last-observed totals. This is the exact
// bug that showed 0 ETH for a ~1000-deposit wallet while Blockscout throttled
// the deploy's egress IP.
v2Empty = true;
v1Empty = true;
const shelled = await api.sniffSimEth({ previous: null });
assert.equal(shelled.ok, false, "a fully-shelled read is unavailable, not ok");
assert.equal(shelled.status, 0);
assert.equal(shelled.ethDepositsEth, null, "never a confident 0.0000 ETH");
assert.ok(/no verifiable/.test(String(shelled.reason || "")), shelled.reason || "reason present");
v2Empty = false;
v1Empty = false;

// 4e. An explorer that WITHHOLDS a deposit's value ("UNAVAILABLE: values
// withheld" throttle variants) must not burn that hash: never committed to the
// ring, never counted, and coverage must stay open (ethScanDone false) so a
// later healthy pass retries the row instead of stranding the pot short.
v2Withheld = true;
const withheld = await api.sniffSimEth();
assert.equal(withheld.ok, true, withheld.reason || "withheld read stays usable");
assert.equal(withheld.ethDepositCount, 1, "only the resolvable deposit counts");
assert.ok(Math.abs(withheld.ethDepositsEth - 0.003) < 1e-12);
assert.ok(!withheld.ethKnownHashes.includes("0xw1"), "withheld hash is not ring-committed");
assert.equal(withheld.ethScanDone, false, "withheld rows keep coverage open");
assert.equal(withheld.ethExplorerFallback, null);
// A follow-up pass with the throttle STILL holding re-reads the withheld row;
// it must neither be ring-committed nor re-sum the deposit it hides.
const withheldRepeat = await api.sniffSimEth({ previous: withheld });
assert.equal(withheldRepeat.ethDepositCount, 1, "no re-sum from re-reading withheld row");
assert.equal(withheldRepeat.ethDepositsEth, withheld.ethDepositsEth);
assert.ok(!withheldRepeat.ethKnownHashes.includes("0xw1"), "still uncommitted on retry");
assert.equal(withheldRepeat.ethScanDone, false, "coverage still open while withheld");
v2Withheld = false;

// A second idle poll must not double-count anything (dedupe by tx hash).
const ethRepeat = await api.sniffSimEth({ previous: eth });
assert.equal(ethRepeat.ok, true);
assert.equal(ethRepeat.ethDepositCount, 2);
assert.equal(ethRepeat.ethDepositsEth, eth.ethDepositsEth);

// 5. HTTP failure is an unavailable source, not a silent zero or a stale replay.
siteStatus = 503;
now += 60_000;
const failed = await api.sniffSimSite();
assert.equal(failed.ok, false);
assert.equal(failed.status, 503);
assert.equal(failed.siteVersion, 1); // body parsed, but the source is marked unavailable
assert.equal(failed.fingerprint, null);
assert.ok(failed.reason);
siteStatus = 200;

// A second sim.chain read with carried state must not double-count deposits.
const carriedChain = await api.sniffSimChain({ previous: chain });
assert.equal(carriedChain.ok, true);
assert.equal(carriedChain.solDepositsSol, chain.solDepositsSol);
assert.equal(carriedChain.solDepositCount, chain.solDepositCount);
assert.equal(carriedChain.solUniquePayers, chain.solUniquePayers);
assert.equal(carriedChain.solRateLimited, false);

// A mid-poll RPC 429 bails softly: totals stay readable, nothing is marked known,
// and the next outburst recovers and counts the vote-paying poll.
destSigsMode = 2;
rpc429 = true;
const paused = await api.sniffSimChain({ previous: carriedChain });
assert.equal(paused.ok, true);
assert.equal(paused.solRateLimited, true);
assert.equal(paused.solDepositCount, 1, "429s leave the carried count intact");
assert.equal(paused.solDepositsSol, chain.solDepositsSol, "429s never zero totals");
assert.equal(paused.solDepositRows.length, 1);
rpc429 = false;
const recovered = await api.sniffSimChain({ previous: paused });
assert.equal(recovered.ok, true);
assert.equal(recovered.solRateLimited, false);
assert.equal(recovered.solDepositCount, 2);
assert.ok(Math.abs(recovered.solDepositsSol - (0.068 + 0.001)) < 1e-12);
assert.ok(recovered.knownSigs.includes("dest-sig2"));
destSigsMode = 1;

// 6. runSniff wires all four sim sources into the full pass.
const full = await api.runSniff({ previous: null });
for (const name of ["sim.site", "sim.front", "sim.chain", "sim.eth"]) {
  assert.ok(full.sources[name], `${name} present in full pass`);
  assert.equal(full.sources[name].ok, true, full.sources[name].reason || `${name} ok`);
}

// 7. Translator: a changed version + deadline emits one "sim" event with movers.
const base = {
  totalSources: 24, okSources: 24,
  sources: {
    "sim.site": { source: "sim.site", ok: true, siteVersion: 0, configured: true, rates: { payment: 66369 }, fingerprint: "a" },
    "sim.front": { source: "sim.front", ok: true, fingerprint: "old", deadline: "2026-09-24T20:00:00-04:00", deadlineFallbackAt: null, paymentRail: { sol: SIM_SOL_DEST }, brand: "THE SIMULATION / UNREALITY / XMONEY" },
    "sim.chain": { source: "sim.chain", ok: true, tokenMint: SIM_MINT, simSupply: 9999313.135929, mintLatestSignature: "mint-sig", destLatestSignature: "dest-sig", fingerprint: "old", destWallet: SIM_SOL_DEST },
    "sim.eth": { source: "sim.eth", ok: true, ethAddress: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4", ethDepositCount: 2, ethDepositsEth: 0.103, ethUniqueSenders: 2, fingerprint: "old-eth" },
  },
};
const moved = {
  ...base,
  sources: {
    ...base.sources,
    "sim.site": { ...base.sources["sim.site"], siteVersion: 1, fingerprint: "b" },
    "sim.front": { ...base.sources["sim.front"], fingerprint: "new", deadline: "2026-09-25T20:00:00-04:00" },
    "sim.chain": { ...base.sources["sim.chain"], simSupply: 9999313.135929 + 100, fingerprint: "c", destLatestSignature: "dest-sig-2" },
    "sim.eth": { ...base.sources["sim.eth"], ethDepositCount: 3, ethDepositsEth: 0.123, ethUniqueSenders: 3, fingerprint: "new-eth" },
  },
};
const events = await translate(base, moved);
const simMovers = events.filter((e) => e.kind === "sim");
assert.equal(simMovers.length, 1, JSON.stringify(events.map((e) => e.kind)));
assert.equal(simMovers[0].rank, "move");
assert.equal(simMovers[0].title, "SIMULATION surface moved");
assert.ok(/site version 0 → 1/.test(simMovers[0].summary), simMovers[0].summary);
assert.ok(/deadline moved/.test(simMovers[0].summary), simMovers[0].summary);
assert.ok(/ETH rail grew to 0\.123 ETH \(3 deposits\)/.test(simMovers[0].summary), simMovers[0].summary);
assert.equal(simMovers[0].details.deadline, "2026-09-25T20:00:00-04:00");

// 8. Identical SIM surface produces no new sim event.
const quiet = await translate(moved, moved);
assert.equal(quiet.filter((e) => e.kind === "sim").length, 0);

// 9. Chain-only movement (supply + signature) is a quiet note, not a mover.
const chainOnly = await translate(moved, {
  ...moved,
  sources: { ...moved.sources, "sim.chain": { ...moved.sources["sim.chain"], simSupply: 9999313.135929 + 500, fingerprint: "d" } },
});
const note = chainOnly.filter((e) => e.kind === "sim");
assert.equal(note.length, 1);
assert.equal(note[0].rank, "note");

console.log("sim live: site/front/chain/eth sniffers, full-pass wiring, deposit aggregation and translator events passed");