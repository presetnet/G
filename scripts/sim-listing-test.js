#!/usr/bin/env node
// SIM LISTING PREFLIGHT test.
//
// Fixture-based, hits NO network. It stubs fetch with recorded shapes from the
// four surfaces the preflight uses (Blockscout v2, Ethereum JSON-RPC, the
// collection's own image host, OpenSea's item page) and asserts the rules that
// decide whether a user can trust the answer:
//
//   - a SIM in a Gnosis Safe is reported as contract-held, with owners and
//     threshold, and the verdict says to connect the Safe — not an owner EOA;
//   - a token in a plain EOA is not blocked for wallet reasons;
//   - ownership is confirmed against ownerOf, and an index/chain disagreement
//     is surfaced instead of silently preferring one;
//   - an image host returning 503 is a failure with retry-after, not a blank tile
//     reported as fine;
//   - a token OpenSea has not indexed is blocked on that, and says so;
//   - metadata named "UNDEFINED" (what this collection actually writes) is
//     flagged rather than passed off as a real name;
//   - a failed read is ok:false with a reason, and a later failure serves the
//     last good row as stale:true;
//   - addresses are capped and the cap is disclosed.
//
// LIVE=1 reads a real mainnet holder and prints the observation table.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "server", "sim-listing.js"), "utf8");
const walletSource = readFileSync(path.join(root, "server", "wallet-assets.js"), "utf8");
const configSource = readFileSync(path.join(root, "server", "config.js"), "utf8");

const SIM = "0xc3706195ff60658585b58716717ee7acc5ebca60";
const SAFE = "0xe18d3f89665ebf4ef885389b62a91ed910572af4";
const EOA = "0x1111111111111111111111111111111111111111";
const OWNER_A = "0x6a4aa35badeb1417811edb4d005384678f4da79e";
const OWNER_B = "0x053fc70fe03112efbda5a23a10ae235f017925df";
const OWNER_C = "0xe3bbfad573698eb73841324b731af01fdbed5071";

let failures = 0;
let checks = 0;
const check = (label, condition, detail = "") => {
  checks += 1;
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

// ------------------------------------------------------------------ fixtures

const dataUri = (obj) => `data:application/json;base64,${Buffer.from(JSON.stringify(obj)).toString("base64")}`;

const metadata2074 = {
  name: "UNDEFINED",
  description: "",
  image: `https://sim.tech/api/nft-thumbnail/1/${SIM}/2074`,
  animation_url: "data:text/html;base64,PGh0bWw+PC9odG1sPg==",
  attributes: [
    { trait_type: "TYPE", value: "UNDEFINED" },
    { trait_type: "OBSERVE", value: true },
    { trait_type: "MEMETIC", value: 100 },
  ],
};
const metadata9 = {
  name: "UNNATURAL",
  description: "a sim",
  image: `https://sim.tech/api/nft-thumbnail/1/${SIM}/9`,
  attributes: [{ trait_type: "TYPE", value: "UNNATURAL" }],
};

const enc = (hex) => ({ ok: true, result: hex });
const addrWord = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const strWord = (text) => {
  const body = Buffer.from(text, "utf8");
  const len = body.length;
  const lenHex = len.toString(16).padStart(64, "0");
  return "0x" + (32).toString(16).padStart(64, "0") + lenHex + body.toString("hex");
};
const listWord = (addrs) => {
  const lenHex = BigInt(addrs.length).toString(16).padStart(64, "0");
  const body = addrs.map((a) => addrWord(a)).join("");
  return "0x" + (32).toString(16).padStart(64, "0") + lenHex + body;
};
const rpc = (result) => JSON.stringify({ jsonrpc: "2.0", id: 1, result });

/** Token 9 belongs to the plain EOA in the fixtures; everything else to the Safe. */
const ownerFor = (id) => (String(id) === "9" ? EOA : SAFE);

/** Minimal Response stand-in: the module uses .json() (RPC), .text()
 *  (Blockscout) and .body.getReader() (byte-capped reads), so the stub has to
 *  offer all three. */
function reply({ status = 200, body = "", json: payload = null, headers = {}, reader = false, finalUrl = null }) {
  const text = payload !== null ? JSON.stringify(payload) : body;
  const map = new Map(Object.entries({ "content-type": "application/json", ...headers }));
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl || "",
    headers: map,
    text: async () => text,
    json: async () => (payload !== null ? payload : JSON.parse(text)),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    body: reader
      ? {
          getReader: () => {
            const chunk = new TextEncoder().encode(text);
            let sent = false;
            return {
              read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: chunk })),
              cancel: async () => {},
            };
          },
        }
      : null,
  };
}

/** @param {{mode:string, tokenOwner?:string, imageStatus?:number, openseaStatus?:number, notIndexed?:boolean, burned?:number[], owners?:string[]}} state */
function makeFetch(state, calls) {
  return async (url, options = {}) => {
    const target = String(url);
    calls.push(target);

    if (options.method === "POST") {
      const body = JSON.parse(options.body || "{}");
      const data = body.params?.[0]?.data || "";
      if (state.mode === "rpc-down") return reply({ status: 200, json: { jsonrpc: "2.0", id: 1, error: { message: "connection refused" } } });
      if (data.startsWith("0x6352211e")) {
        const id = Number(BigInt(`0x${data.slice(10)}`));
        if (state.burned?.includes(id)) return reply({ status: 200, json: { jsonrpc: "2.0", id: 1, result: "0x" } });
        return reply({ status: 200, json: { jsonrpc: "2.0", id: 1, result: `0x${addrWord(state.tokenOwner ?? ownerFor(id))}` } });
      }
      if (data.startsWith("0xa0e67e2b")) return reply({ status: 200, json: { jsonrpc: "2.0", id: 1, result: listWord(state.owners ?? [OWNER_A, OWNER_B, OWNER_C]) } });
      if (data.startsWith("0xe75235b8")) return reply({ status: 200, json: { jsonrpc: "2.0", id: 1, result: (2).toString(16).padStart(64, "0") } });
      if (data.startsWith("0xc87b56dd")) {
        const id = Number(BigInt(`0x${data.slice(10)}`));
        if (state.mode === "uri-down") return reply({ status: 200, json: { jsonrpc: "2.0", id: 1, error: { message: "rate limit exceeded" } } });
        return reply({ status: 200, json: { jsonrpc: "2.0", id: 1, result: strWord(id === 9 ? dataUri(metadata9) : dataUri(metadata2074)) } });
      }
      return reply({ status: 200, json: { jsonrpc: "2.0", id: 1, result: "0x" } });
    }

    // Blockscout
    if (target.includes("/instances/")) {
      if (state.mode === "instance-down") return reply({ status: 502, body: "bad gateway" });
      const id = target.split("/instances/")[1];
      const meta = id === "9" ? metadata9 : metadata2074;
      return reply({
        status: 200,
        json: {
          id,
          name: meta.name,
          image_url: meta.image,
          animation_url: meta.animation_url,
          metadata: JSON.stringify(meta),
          owner: { hash: state.indexOwner ?? state.tokenOwner ?? ownerFor(id), name: "SafeProxy", is_contract: true },
        },
      });
    }
    if (target.includes("/addresses/") && target.includes("/nft")) {
      if (state.mode === "nft-down") return reply({ status: 500, body: "boom" });
      const addr = target.match(/addresses\/(0x[0-9a-fA-F]{40})/)[1].toLowerCase();
      const other = "0x1111111111111111111111111111111111111111";
      if (addr === SAFE) return reply({ status: 200, json: { items: [{ token: { address_hash: SIM }, token_id: "2074" }, { token: { address_hash: other }, token_id: "5" }] } });
      if (addr === EOA) return reply({ status: 200, json: { items: [{ token: { address_hash: SIM }, token_id: "9" }, { token: { address_hash: other }, token_id: "5" }] } });
      return reply({ status: 200, json: { items: [] } });
    }
    if (target.includes("/addresses/")) {
      const addr = target.match(/addresses\/(0x[0-9a-fA-F]{40})/)[1].toLowerCase();
      const safe = addr === SAFE;
      // The first Safe owner is itself a contract (measured live); the rest are EOAs.
      return reply({ status: 200, json: { is_contract: safe || addr === OWNER_A, is_verified: safe, name: safe ? "SafeProxy" : null } });
    }
    if (target.includes("/api/v2/tokens/")) return reply({ status: 200, json: { name: "The Simulation", symbol: "SIM" } });

    // the collection's image host
    if (target.includes("sim.tech/api/nft-thumbnail")) {
      const status = state.imageStatus ?? 200;
      if (status !== 200) return reply({ status, body: "", headers: { "retry-after": "30" } });
      return reply({
        status: 200,
        body: "PNG".repeat(64),
        headers: { "content-type": "image/png" },
        reader: true,
        finalUrl: "https://gateway.pinata.cloud/ipfs/bafkreifake",
      });
    }

    // OpenSea item page
    if (target.includes("opensea.io/item/")) {
      if (state.openseaStatus && state.openseaStatus >= 400) return reply({ status: state.openseaStatus, body: "<title>Not found</title>", reader: true });
      const id = target.split("/").pop();
      const html = state.notIndexed
        ? `<html><head><title>Search | OpenSea</title></head><body>This item has not been indexed</body></html>`
        : `<html><head><title>${metadata2074.name} #${id} - The Simulation | OpenSea</title></head><body>${SIM}</body></html>`;
      return reply({ status: 200, body: html, headers: { "content-type": "text/html" }, reader: true });
    }

    return reply({ status: 404, body: "not stubbed" });
  };
}

async function linkDeps(mod, context) {
  const dep = new vm.SyntheticModule(["ETHERSCUT", "SIM_COLLECTION", "SIM_COLLECTION_NAME", "SIM_COLLECTION_URL"], function () {
    this.setExport("ETHERSCUT", "https://eth.blockscout.com");
    this.setExport("SIM_COLLECTION", SIM);
    this.setExport("SIM_COLLECTION_NAME", "The Simulation");
    this.setExport("SIM_COLLECTION_URL", "https://opensea.io/collection/the-simulation-958481099");
  }, { context });
  await mod.link(async (specifier) => {
    if (specifier === "./wallet-assets.js") return dep;
    if (specifier === "node:crypto") {
      const real = await import("node:crypto");
      return new vm.SyntheticModule(["createHash"], function () {
        this.setExport("createHash", real.createHash);
      }, { context });
    }
    return new vm.SyntheticModule([], function () {}, { context });
  });
  await dep.evaluate();
  return dep;
}

const vmContext = (fetchImpl) => {
  const context = vm.createContext({
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    Buffer,
    URL,
    URLSearchParams,
    console,
    process: { env: {} },
    Object,
    Array,
    Set,
    Map,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Date,
    RegExp,
    Error,
    TypeError,
    Promise,
    Symbol,
    isNaN,
    isFinite,
  });
  context.globalThis = context;
  return context;
};

async function load(state = {}) {
  const calls = [];
  const context = vmContext(makeFetch({ mode: "ok", ...state }, calls));
  const mod = new vm.SourceTextModule(source, { context, identifier: "sim-listing.js" });
  await linkDeps(mod, context);
  await mod.evaluate();
  return { mod: mod.namespace, calls };
}

// ------------------------------------------------------------------ tests

console.log("sim listing preflight: fixture checks");

{
  const { mod } = await load();
  const safe = await mod.inspectSimListing(SAFE, { fresh: true });
  const t = safe.tokens[0];

  check("safe row reads ok", safe.ok === true, JSON.stringify(safe));
  check("one SIM found", safe.sim.held === 1, String(safe.sim.held));
  check("token id is the held one", t?.id === "2074", String(t?.id));
  check("holder detected as contract", safe.holder.kind === "contract", safe.holder.kind);
  check("holder named SafeProxy", safe.holder.name === "SafeProxy", String(safe.holder.name));
  check("safe owners read", Array.isArray(safe.holder.owners) && safe.holder.owners.length === 3, JSON.stringify(safe.holder.owners));
  check("safe threshold read", safe.holder.threshold === 2, String(safe.holder.threshold));
  check("owner contract flags read", Array.isArray(safe.holder.ownersAreContracts) && safe.holder.ownersAreContracts.length === 3, JSON.stringify(safe.holder.ownersAreContracts));
  // The paired list is what the UI renders, so it must carry the address on
  // each entry — a parallel array is what made the owner list render as "—".
  check("paired owner list carries every address", safe.holder.ownerList?.length === 3 && safe.holder.ownerList.every((o, i) => o.address === safe.holder.owners[i]), JSON.stringify(safe.holder.ownerList));
  check("paired owner list keeps the contract flag", safe.holder.ownerList?.[0]?.isContract === true && safe.holder.ownerList?.[1]?.isContract === false, JSON.stringify(safe.holder.ownerList));
  check("ownership confirmed on-chain", t.heldOnChain === true, String(t.heldOnChain));
  check("index and chain agree", t.ownershipAgrees === true, String(t.ownershipAgrees));
  check("image verified as png", t.image.ok === true && t.image.type === "image/png", JSON.stringify(t.image));
  check("metadata read from inlined tokenURI", t.metadata.read === true && t.metadata.inlined === true, JSON.stringify(t.metadata));
  check('name "UNDEFINED" flagged, not passed off', t.name.state === "undefined", JSON.stringify(t.name));
  check("name raw value kept for the reader", t.nameValue === "UNDEFINED", String(t.nameValue));
  check("attributes exposed", t.attributes.length === 3, JSON.stringify(t.attributes));
  check("opensea item indexed", t.opensea.indexed === true, JSON.stringify(t.opensea));
  check("verdict is blocked", t.verdict.state === "blocked", t.verdict.state);
  check("blocker names the contract wallet", t.verdict.blockers.some((b) => /contract wallet/i.test(b)), JSON.stringify(t.verdict.blockers));
  check("next step says connect the Safe", /Safe\{Wallet\}|connect that wallet itself/i.test(t.verdict.nextStep || ""), String(t.verdict.nextStep));
  check("row verdict is blocked too", safe.verdict.state === "blocked", safe.verdict.state);
  check("not-checked list is disclosed", safe.notChecked.length >= 3, JSON.stringify(safe.notChecked));
  check("no order or price field anywhere in the payload", !/"\b(order|orders|price|listing|signature)\b"\s*:/.test(JSON.stringify(safe)), "payload looks like it carries trade data");
  check("says plainly that no listing API exists", safe.notChecked.some((n) => /no listing api/i.test(n)), JSON.stringify(safe.notChecked));
}

{
  const { mod } = await load();
  const eoa = await mod.inspectSimListing(EOA, { fresh: true });
  const t = eoa.tokens[0];
  check("eoa row reads ok", eoa.ok === true, JSON.stringify(eoa));
  check("eoa holder is an eoa", eoa.holder.kind === "eoa", eoa.holder.kind);
  check("eoa is not blocked for wallet type", !t.verdict.blockers.some((b) => /contract wallet/i.test(b)), JSON.stringify(t.verdict.blockers));
  check("eoa verdict is not blocked", t.verdict.state !== "blocked", t.verdict.state);
  check("eoa token held", t.held === true && t.heldOnChain === true, JSON.stringify([t.held, t.heldOnChain]));
  check("eoa has no safe owners", eoa.holder.owners === null, JSON.stringify(eoa.holder.owners));
}

{
  // The image host is what makes an item render as a blank tile; a 503 must be
  // a loud failure, never "fine".
  const { mod } = await load({ imageStatus: 503 });
  const row = await mod.inspectSimListing(SAFE, { fresh: true });
  const t = row.tokens[0];
  check("503 image is not ok", t.image.ok === false, JSON.stringify(t.image));
  check("503 status recorded", t.image.status === 503, String(t.image.status));
  check("retry-after surfaced", t.image.retryAfter === "30", String(t.image.retryAfter));
  check("503 reason mentions the host being down", /down for this token/i.test(t.image.reason || ""), String(t.image.reason));
  check("dead image is a note, not a blocker", t.verdict.notes.some((n) => /image is not serving/i.test(n)), JSON.stringify(t.verdict.notes));
  check("still blocked by the Safe", t.verdict.state === "blocked", t.verdict.state);
}

{
  const { mod } = await load({ notIndexed: true });
  const row = await mod.inspectSimListing(SAFE, { fresh: true });
  const t = row.tokens[0];
  check("not-indexed detected despite HTTP 200", t.opensea.status === 200 && t.opensea.indexed === false, JSON.stringify(t.opensea));
  check("not-indexed is a blocker", t.verdict.blockers.some((b) => /not indexed/i.test(b)), JSON.stringify(t.verdict.blockers));
}

{
  // The index still credits the Safe, the chain says someone else holds it now.
  const { mod } = await load({ indexOwner: SAFE, tokenOwner: "0x9999999999999999999999999999999999999999" });
  const row = await mod.inspectSimListing(SAFE, { fresh: true });
  const t = row.tokens[0];
  check("chain beats a stale index", t.heldOnChain === false, String(t.heldOnChain));
  check("stale index disagreement surfaced", t.ownershipAgrees === false, String(t.ownershipAgrees));
  check("lost token is blocked with the right step", /not in the wallet any more|no longer owns it/i.test(t.verdict.nextStep || ""), String(t.verdict.nextStep));
  check("lost token is not blamed on the wallet type", !/connect that wallet/i.test(t.verdict.nextStep || ""), String(t.verdict.nextStep));
}

{
  const { mod } = await load({ burned: [2074] });
  const row = await mod.inspectSimListing(SAFE, { fresh: true });
  const t = row.tokens[0];
  check("burned id is not reported as held", t.heldOnChain === false, String(t.heldOnChain));
}

{
  const { mod } = await load();
  const none = await mod.inspectSimListing("0x2222222222222222222222222222222222222222", { fresh: true });
  check("address with no SIM still ok", none.ok === true, JSON.stringify(none.reason));
  check("no-SIM verdict is none", none.verdict.state === "none", none.verdict.state);
  check("no-SIM step mentions the wrong-chain cause", /sepolia|wrong address|transfer out/i.test(none.verdict.nextStep || ""), String(none.verdict.nextStep));
  check("no fake zeros in sim block", none.sim.held === 0, String(none.sim.held));
}

{
  const { mod } = await load({ mode: "nft-down" });
  const row = await mod.inspectSimListing(SAFE, { fresh: true });
  check("nft-walk failure is ok:false", row.ok === false, String(row.ok));
  check("nft-walk failure carries a reason", /could not list/i.test(row.reason || ""), String(row.reason));
  check("nft-walk failure leaves held null, not 0", row.sim.held === null, String(row.sim.held));
}

{
  // A later failure must serve the last good read, flagged stale.
  const calls = [];
  let phase = "good";
  const stub = makeFetch({ mode: "ok" }, calls);
  const context = vmContext(async (url, options) => (phase === "good" ? stub(url, options) : { ok: false, status: 500, url: String(url), headers: new Map(), text: async () => "down" }));
  const mod = new vm.SourceTextModule(source, { context, identifier: "sim-listing.js" });
  await linkDeps(mod, context);
  await mod.evaluate();
  const ns = mod.namespace;
  const good = await ns.inspectSimListing(SAFE, { fresh: true });
  phase = "down";
  const stale = await ns.inspectSimListing(SAFE, { fresh: true });
  check("first read ok", good.ok === true && good.sim.held === 1, String(good.sim.held));
  check("failure serves last good read", stale.stale === true && stale.tokens.length === 1, JSON.stringify({ stale: stale.stale, n: stale.tokens.length }));
  check("stale read keeps the data", stale.tokens[0]?.id === "2074", String(stale.tokens[0]?.id));
  check("stale read says why", /read failed/i.test(stale.reason || ""), String(stale.reason));
}

{
  const { mod } = await load();
  const rejected = [];
  for (const bad of ["not-an-address", "0x1234", "9GjEVnpWiLe2uknUmtaH6DSfgcBvL66DtSKGREXDctZU", "0x" + "z".repeat(40)]) {
    rejected.push(await mod.inspectSimListing(bad, { fresh: true }));
  }
  check("non-EVM and malformed addresses all refused", rejected.every((r) => r.ok === false && typeof r.reason === "string"), JSON.stringify(rejected.map((r) => r.reason)));
  check("a Solana address is told SIM is mainnet-only", /mainnet/i.test(rejected[2].reason || ""), String(rejected[2].reason));
  check("caching works", (await (async () => { const a = await mod.inspectSimListing(SAFE); const b = await mod.inspectSimListing(SAFE); return b.cached === true; })()) === true);
}

{
  const { mod } = await load();
  const many = Array.from({ length: 9 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`).join(",");
  const bulk = await mod.inspectSimListings(many);
  check("batch caps the address count", bulk.wallets.length === 4, String(bulk.wallets.length));
  check("batch payload names the collection", bulk.collection?.contract === SIM, JSON.stringify(bulk.collection));
  check("one bad address does not fail the batch", bulk.wallets.every((w) => w.address));
  // A silently dropped wallet would read as "checked, no SIM", so the payload
  // must name what it skipped.
  check("dropped wallets are named, not silently skipped", bulk.limits?.dropped?.length === 5, JSON.stringify(bulk.limits));
  check("the drop is disclosed in notChecked", (bulk.notChecked || []).some((n) => /not read/i.test(n)), JSON.stringify(bulk.notChecked));
}

{
  const { mod } = await load();
  const row = await mod.inspectSimListing(SAFE, { fresh: true });
  const link = row.tokens[0]?.links?.etherscan || "";
  check("etherscan link has a real contract, not a literal ${...}", link.includes(SIM) && !link.includes("${"), link);
}

{
  // The image host returning 503 must not be read as a reason to skip the row.
  const { mod, calls } = await load({ imageStatus: 503 });
  const row = await mod.inspectSimListing(SAFE, { fresh: true });
  check("image host failure does not blank the row", row.ok === true && row.tokens.length === 1, JSON.stringify({ ok: row.ok, n: row.tokens.length }));
  check("the image host was actually called", calls.some((c) => c.includes("sim.tech/api/nft-thumbnail")), "no image call recorded");
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.log("asset viewer: FAIL");
  process.exit(1);
}
console.log("sim listing preflight: PASS");

if (process.env.LIVE === "1") {
  console.log("\nLIVE read of a real mainnet SIM holder:");
  const live = await load();
  const mod = live.mod;
  const row = await mod.inspectSimListing(process.env.LIVE_ADDRESS || SAFE, { fresh: true });
  console.log(`  holder=${row.holder.kind} ${row.holder.name || ""} owners=${(row.holder.owners || []).length} threshold=${row.holder.threshold}`);
  console.log(`  held=${row.sim.held} verdict=${row.verdict.state}`);
  for (const t of row.tokens) {
    console.log(`  #${t.id} held=${t.held} name=${t.name?.state} image=${t.image.status}/${t.image.type || "-"} opensea=${t.opensea.indexed}`);
    console.log(`     ${t.verdict.nextStep}`);
  }
}
