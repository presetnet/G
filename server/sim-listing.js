// SIM LISTING PREFLIGHT — "I have a Simulation, why can't I see or list it?"
//
// The desk keeps hitting the same wall: a holder opens OpenSea, sees nothing
// that looks like theirs, and concludes the NFT is missing or unsellable. In
// practice the causes are few and each one has a different fix, so this module
// answers them by measurement instead of guesswork. For any address it reports:
//
//   - which SIM token ids the wallet holds, confirmed with ownerOf (the index
//     can lag or be wrong; the chain cannot);
//   - whether the holder is an EOA or a contract, and for a Safe, its owners
//     and signing threshold — because a token inside a 2-of-3 Safe is invisible
//     under every owner account and cannot be listed from one;
//   - whether tokenURI resolves, whether that metadata has a usable name, and
//     whether the image host is actually serving bytes;
//   - whether OpenSea has indexed the item at all (keyless: the item page),
//     with the page title as evidence.
//
// What it deliberately does NOT do: place an order. OpenSea has no listing API
// (v1 was removed, v2 demands a key) and every sale needs a wallet signature
// anyway, so the honest end of this tool is "here is the exact next step", not
// a fake one-click listing.
//
// Same desk rules as the asset viewer: a failed sub-read is null with a reason,
// never a zero; every cap and every skipped check is disclosed; the last good
// read is served as stale:true; provenance names hosts, never keys.
import "./config.js";
import { createHash } from "node:crypto";
import { ETHERSCUT, SIM_COLLECTION, SIM_COLLECTION_NAME, SIM_COLLECTION_URL } from "./wallet-assets.js";

export const SIM_CONTRACT = SIM_COLLECTION;
export const SIM_NAME = SIM_COLLECTION_NAME;
export const SIM_COLLECTION_PAGE = SIM_COLLECTION_URL;
export const OPENSEA_ITEM = (id) => `https://opensea.io/item/ethereum/${SIM_CONTRACT}/${id}`;

const ETHERSCAN_EXPLORER = (id) => `https://etherscan.io/nft/${SIM_CONTRACT}/${id}`;

// Public mainnet endpoints tried in order. They rate-limit aggressively, so a
// caller rotates rather than hammering whichever one answered last time.
const ETH_RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://1rpc.io/eth",
  "https://rpc.ankr.com/eth",
  "https://cloudflare-eth.com",
  "https://eth.llamarpc.com",
];

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const DEFAULT_TIMEOUT_MS = 12_000;
export const MAX_ADDRESSES = 4;
// Blockscout's page size is not contractually fixed, so the cap is stated in
// pages, never as an invented token count.
const NFT_PAGE_CAP = 6;
const MAX_TOKENS_CHECKED = 8;
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_OPENSEA_CHECKS = 2; // item pages are ~800KB of HTML; check few, cache long
export const CACHE_TTL_MS = Number(process.env.SIM_LISTING_CACHE_TTL_MS || 300_000);
const OPENSEA_TTL_MS = Number(process.env.SIM_LISTING_OPENSEA_TTL_MS || 900_000);
const CACHE_MAX = 100;

// Checks we cannot make without a listing API or a human signature. Naming them
// is more useful than implying the token is "verified for listing".
const NOT_CHECKED = [
  "no order placed — OpenSea has no listing API; the last step is always a click + signature",
  "transfer locks (if the project added one) are not read — no known lock interface on this contract",
  "the collection's OpenSea review/flag state is not exposed keylessly",
];

const cache = new Map();
const openseaCache = new Map();

const sha1 = (value) => createHash("sha1").update(value).digest("hex").slice(0, 10);
const nowIso = () => new Date().toISOString();

const withTimeout = async (timeoutMs, fn) => {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`read timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

async function fetchRaw(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, bytes = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "geoff-thermometer-sim-listing", ...headers },
      redirect: "follow",
      signal: controller.signal,
    });
    let body = null;
    if (!bytes) {
      // No cap requested: read the whole thing. Callers that only want a
      // prefix pass `bytes` and get the streaming path below.
      body = res.ok ? await res.text().catch(() => null) : null;
    } else if (res.ok) {
      const reader = res.body?.getReader();
      if (reader) {
        const chunks = [];
        let total = 0;
        while (total < bytes) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.length;
        }
        await reader.cancel().catch(() => {});
        body = Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, bytes);
      }
    }
    return { ok: res.ok === true, status: res.status || 0, body, headers: res.headers, finalUrl: res.url || url };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`read timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetchRaw(url, { timeoutMs, headers: { Accept: "application/json" } });
  const text = res.body ? res.body.toString("utf8") : null;
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (json === null && res.ok) {
    // re-read as text for the caller when JSON parsing failed
    const retry = await fetchRaw(url, { timeoutMs, headers: { Accept: "text" } });
    const raw = retry.body ? retry.body.toString("utf8") : "";
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
  }
  return { ok: res.ok === true, status: res.status, json };
}

async function ethCall(data, { to = SIM_CONTRACT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let lastError = null;
  for (const url of ETH_RPCS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (typeof json?.result === "string" && json.result !== "0x") return { ok: true, result: json.result, rpc: url };
      if (json?.result === "0x" || json?.result === "") return { ok: true, result: "0x", rpc: url }; // clean empty/revert
      if (json?.error) {
        lastError = new Error(json.error.message || "eth_call error");
        // A revert is an answer, not a transport failure — stop rotating.
        if (/execution reverted|revert/i.test(json.error.message || "")) return { ok: false, result: null, error: lastError.message, rpc: url };
      }
    } catch (error) {
      lastError = error?.name === "AbortError" ? new Error(`rpc timed out after ${Math.round(timeoutMs / 1000)}s`) : error;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, result: null, error: lastError?.message || "no public Ethereum RPC answered", rpc: null };
}

const hexToBuffer = (hex) => Buffer.from(String(hex).replace(/^0x/, ""), "hex");

function decodeString(hex) {
  if (!hex || hex === "0x") return null;
  try {
    const b = hexToBuffer(hex);
    if (b.length < 64) return null;
    const offset = Number(BigInt("0x" + b.subarray(0, 32).toString("hex")));
    const length = Number(BigInt("0x" + b.subarray(offset, offset + 32).toString("hex")));
    if (!Number.isFinite(offset) || !Number.isFinite(length) || length < 0) return null;
    return b.subarray(offset + 32, offset + 32 + length).toString("utf8");
  } catch {
    return null;
  }
}

const padAddress = (address) => address.replace(/^0x/, "").toLowerCase().padStart(64, "0");

const safeHost = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

function decodeAddressList(hex) {
  if (!hex || hex === "0x") return [];
  try {
    const b = hexToBuffer(hex);
    const count = Number(BigInt("0x" + b.subarray(32, 64).toString("hex")));
    const out = [];
    for (let i = 0; i < count && i < 20; i++) {
      const slice = b.subarray(64 + i * 32 + 12, 64 + i * 32 + 32);
      if (slice.length === 20) out.push("0x" + slice.toString("hex"));
    }
    return out;
  } catch {
    return [];
  }
}

const hexToInt = (hex) => {
  if (!hex || hex === "0x") return null;
  try {
    return Number(BigInt(hex));
  } catch {
    return null;
  }
};

// -------------------------------------------------------------- token ids

async function simTokenIds(address, { timeoutMs, pageCap = NFT_PAGE_CAP }) {
  const items = [];
  let params = {};
  let pages = 0;
  let truncated = false;
  while (pages < pageCap) {
    const qs = new URLSearchParams({ type: "ERC-721", ...params });
    const res = await fetchJson(`${ETHERSCUT}/api/v2/addresses/${address}/nft?${qs}`, { timeoutMs });
    if (!res.ok || !Array.isArray(res.json?.items)) {
      const err = new Error(res.ok ? "unexpected NFT list shape" : `nft list HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    pages += 1;
    for (const item of res.json.items) {
      const contract = (item.token?.address_hash || item.token_address_hash || "").toLowerCase();
      if (contract !== SIM_CONTRACT) continue;
      const id = item.token_id ?? item.id;
      if (id !== null && id !== undefined) items.push(String(id));
    }
    if (!res.json.next_page_params) break;
    params = res.json.next_page_params;
    if (pages === pageCap) truncated = true;
  }
  return { ids: [...new Set(items)], pages, truncated };
}

// -------------------------------------------------------------- metadata

function dataUriToJson(uri) {
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const meta = uri.slice(0, comma).toLowerCase();
  const body = uri.slice(comma + 1);
  try {
    const text = meta.includes(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
    const json = JSON.parse(text);
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
}

async function readInstance(id, { timeoutMs }) {
  // Blockscout decodes the on-chain metadata server-side, so this is both the
  // cheap path and the one that keeps working when the public RPCs throttle.
  const res = await fetchJson(`${ETHERSCUT}/api/v2/tokens/${SIM_CONTRACT}/instances/${id}`, { timeoutMs });
  if (!res.ok || !res.json || typeof res.json !== "object") {
    return { ok: false, reason: res.ok ? "instance shape unexpected" : `instance HTTP ${res.status}` };
  }
  const j = res.json;
  let raw = null;
  if (typeof j.metadata === "string") {
    try {
      raw = JSON.parse(j.metadata);
    } catch {
      raw = null;
    }
  } else if (j.metadata && typeof j.metadata === "object") {
    raw = j.metadata;
  }
  const attributes = (Array.isArray(raw?.attributes) ? raw.attributes : Array.isArray(j.attributes) ? j.attributes : []).slice(0, 16);
  const name = j.name ?? raw?.name ?? null;
  const image = j.image_url ?? j.media_url ?? raw?.image ?? null;
  const description = typeof raw?.description === "string" && raw.description.trim() ? raw.description.trim() : typeof j.description === "string" && j.description.trim() ? j.description : null;
  return {
    ok: true,
    name,
    image,
    animation: j.animation_url ?? raw?.animation_url ?? null,
    description,
    attributes: attributes.map((a) => ({ trait: a?.trait_type ?? a?.trait ?? null, value: a?.value ?? null })),
    owner: j.owner?.hash ?? null,
    ownerName: j.owner?.name ?? null,
    ownerIsContract: j.owner?.is_contract === true,
    implementation: j.owner?.implementations?.[0]?.name ?? null,
    mediaType: j.media_type ?? null,
    externalAppUrl: j.external_app_url ?? null,
    reason: null,
  };
}

async function readTokenUriOnChain(id, { timeoutMs }) {
  const res = await ethCall("0xc87b56dd" + Number(id).toString(16).padStart(64, "0"), { timeoutMs });
  if (!res.ok) return { ok: false, reason: res.error || "tokenURI unread", rpc: res.rpc };
  const uri = decodeString(res.result);
  if (!uri) return { ok: false, reason: "tokenURI empty (burned or unused id)", rpc: res.rpc, burned: true };
  const kind = uri.startsWith("data:") ? "onchain-data-uri" : uri.startsWith("ipfs://") ? "ipfs" : uri.startsWith("http") ? "http" : "unknown";
  if (kind === "onchain-data-uri") {
    const meta = dataUriToJson(uri);
    return { ok: !!meta, kind, inlined: true, meta, reason: meta ? null : "tokenURI is a data: URI but its JSON did not parse", rpc: res.rpc };
  }
  if (kind === "ipfs") return { ok: false, kind, inlined: false, meta: null, reason: "tokenURI points at ipfs:// and needs a gateway; not resolved here", rpc: res.rpc };
  if (kind === "http") {
    try {
      const got = await fetchRaw(uri, { timeoutMs, headers: { Accept: "application/json" }, bytes: MAX_METADATA_BYTES });
      const text = got.body ? got.body.toString("utf8") : "";
      let meta = null;
      try {
        meta = JSON.parse(text);
      } catch {}
      return { ok: got.ok && !!meta, kind, inlined: false, uriHost: safeHost(uri), meta, reason: got.ok ? (meta ? null : "metadata JSON did not parse") : `metadata HTTP ${got.status}`, rpc: res.rpc };
    } catch (error) {
      return { ok: false, kind, inlined: false, meta: null, reason: error.message, rpc: res.rpc };
    }
  }
  return { ok: false, kind, inlined: false, meta: null, reason: `tokenURI scheme not supported (${kind})`, rpc: res.rpc };
}

/** The collection writes its `name` as one of its own trait values, and for
 *  some tokens literally "UNDEFINED". OpenSea titles the page from that field,
 *  which is why holders see "UNDEFINED #2074" instead of a real name. */
function nameHealth(name, attributes) {
  const raw = typeof name === "string" ? name.trim() : "";
  if (!raw) return { state: "missing", detail: "metadata has no name field" };
  if (/^undefined$/i.test(raw)) return { state: "undefined", detail: 'metadata name is literally "UNDEFINED"' };
  const values = new Set(
    (Array.isArray(attributes) ? attributes : [])
      .map((a) => String(a?.value ?? "").trim().toUpperCase())
      .filter(Boolean),
  );
  if (values.has(raw.toUpperCase())) return { state: "trait-word", detail: `metadata name repeats a trait value (${raw})` };
  if (!/\s/.test(raw) && raw === raw.toUpperCase() && /^[A-Z_ -]+$/.test(raw)) {
    return { state: "trait-like", detail: `metadata name is a bare trait-style word (${raw})` };
  }
  return { state: "ok", detail: null };
}

async function checkImage(url, { timeoutMs }) {
  if (!url || typeof url !== "string") return { url: null, ok: null, type: null, status: 0, host: null, reason: "no image field" };
  let target = url;
  if (target.startsWith("ipfs://")) return { url, ok: null, type: null, status: 0, host: "ipfs", reason: "ipfs:// image needs a gateway; not fetched" };
  if (!/^https?:\/\//i.test(target)) return { url, ok: null, type: null, status: 0, host: null, reason: "image url is not http(s)" };
  try {
    const res = await fetchRaw(target, { timeoutMs, headers: { Range: "bytes=0-2048", Accept: "image/*,*/*" }, bytes: 2048 });
    const type = res.headers?.get?.("content-type") || null;
    let host = null;
    try {
      host = new URL(res.finalUrl || target).host;
    } catch {
      host = null;
    }
    const servedBytes = res.body ? res.body.length : 0;
    const isImage = /^image\//i.test(type || "");
    return {
      url,
      ok: res.ok && isImage && servedBytes > 0,
      type,
      status: res.status,
      bytes: servedBytes,
      host,
      retryAfter: res.headers?.get?.("retry-after") || null,
      finalHostChanged: host && host !== new URL(target).host ? host : null,
      reason: res.ok
        ? isImage
          ? servedBytes > 0
            ? null
            : "image response had no bytes"
          : `image host returned ${type || "no content-type"}`
        : res.status === 503
          ? `image host is down for this token (HTTP 503${res.headers?.get?.("retry-after") ? `, retry-after ${res.headers.get("retry-after")}s` : ""})`
          : `image HTTP ${res.status}`,
    };
  } catch (error) {
    return { url, ok: false, type: null, status: 0, bytes: 0, host: null, retryAfter: null, reason: error.message };
  }
}

// -------------------------------------------------------------- opensea

async function checkOpenSeaItem(id, { timeoutMs, ttlMs = OPENSEA_TTL_MS }) {
  const url = OPENSEA_ITEM(id);
  const hit = openseaCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.value, cached: true };
  let out;
  try {
    const res = await fetchRaw(url, { timeoutMs, headers: { Accept: "text/html" }, bytes: 1_200_000 });
    const html = res.body ? res.body.toString("utf8") : "";
    const title = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() || null;
    const notIndexed = /item not found|not been indexed|no results for|we can.t find this item/i.test(html);
    out = {
      checked: true,
      url,
      status: res.status,
      indexed: res.status === 200 && !notIndexed,
      notIndexedMarker: notIndexed,
      title,
      contractInPage: html.toLowerCase().includes(SIM_CONTRACT),
      reason: res.status === 200 ? (notIndexed ? "page returned 200 but says the item is not indexed" : null) : `item page HTTP ${res.status}`,
      cached: false,
    };
  } catch (error) {
    out = { checked: true, url, status: 0, indexed: null, notIndexedMarker: false, title: null, contractInPage: null, reason: error.message, cached: false };
  }
  openseaCache.set(url, { at: Date.now(), value: out });
  return out;
}

export function clearSimListingCache() {
  cache.clear();
  openseaCache.clear();
}

// -------------------------------------------------------------- holder

async function describeHolder(address, { timeoutMs }) {
  const out = { kind: "unknown", name: null, verified: null, owners: null, threshold: null, ownersAreContracts: null, reason: null };
  try {
    const res = await fetchJson(`${ETHERSCUT}/api/v2/addresses/${address}`, { timeoutMs });
    const j = res.json || {};
    if (j.is_contract) {
      out.kind = "contract";
      out.name = j.name || null;
      out.verified = j.is_verified === true;
      // Gnosis Safe: getOwners() (0xa0e67e2b) + getThreshold() (0xe75235b8)
      const [ownersRes, thresholdRes] = await Promise.all([
        ethCall("0xa0e67e2b", { to: address, timeoutMs }),
        ethCall("0xe75235b8", { to: address, timeoutMs }),
      ]);
      const owners = decodeAddressList(ownersRes.result);
      if (owners.length) {
        out.owners = owners;
        out.threshold = hexToInt(thresholdRes.result);
        out.ownersAreContracts = null;
        const flags = await Promise.all(
          owners.map(async (o) => {
            try {
              const r = await fetchJson(`${ETHERSCUT}/api/v2/addresses/${o}`, { timeoutMs: Math.min(timeoutMs, 6000) });
              return !!r.json?.is_contract;
            } catch {
              return null;
            }
          }),
        );
        if (flags.some((f) => f !== null)) out.ownersAreContracts = flags;
        // Paired form, so consumers never have to zip two parallel arrays by
        // index and silently mislabel a signer.
        out.ownerList = owners.map((address, i) => ({ address, isContract: flags[i] === true }));
      } else {
        out.reason = "contract wallet, but it does not expose Safe owners (not a Gnosis Safe or a different multisig)";
      }
    } else if (res.ok) {
      out.kind = "eoa";
    } else {
      out.reason = `holder lookup HTTP ${res.status}`;
    }
  } catch (error) {
    out.reason = error.message;
  }
  return out;
}

// -------------------------------------------------------------- verdict

function verdictFor(token, holder) {
  const blockers = [];
  const notes = [];
  if (token.burned) blockers.push(`token #${token.id} is burned — ownerOf is empty, so nobody holds it`);
  if (token.heldOnChain === false && !token.burned) blockers.push("the chain says this wallet no longer owns it (the index was stale)");
  if (token.ownershipAgrees === false) notes.push("the index and the chain disagree on the owner — the index is stale, the chain is not");
  if (token.ownerUnread) notes.push(`ownership not confirmed on-chain: ${token.ownerUnread}`);
  if (token.opensea && token.opensea.checked) {
    if (token.opensea.indexed === false) blockers.push("OpenSea has not indexed this item yet");
    else if (token.opensea.indexed === null) notes.push("OpenSea item page unread — could not confirm indexing");
  } else {
    notes.push("OpenSea indexing not checked for this token (page checks are capped)");
  }
  if (token.name && token.name.state !== "ok") notes.push(`metadata name is unusable: ${token.name.detail}`);
  if (token.image && token.image.ok === false) notes.push(`image is not serving: ${token.image.reason}`);
  if (token.metadata && token.metadata.uriKind === "ipfs") notes.push("tokenURI needs an IPFS gateway to resolve");
  if (token.metadata && token.metadata.read === false) notes.push(`metadata unread: ${token.metadata.reason}`);

  let nextStep = null;
  if (token.burned) {
    nextStep = `Token #${token.id} is burned on-chain, so it cannot be listed or recovered. If the index still shows it here, that listing is stale.`;
  } else if (token.heldOnChain === false) {
    nextStep = "This token is not in the wallet any more — check the transfer history before assuming it is stuck.";
  } else if (token.opensea?.indexed === false) {
    nextStep = "OpenSea has not indexed this token. Nothing to fix locally; it becomes listable once the indexer catches up.";
  } else if (holder.kind === "contract") {
    if (holder.owners?.length) {
      const need = holder.threshold ? `${holder.threshold} of ${holder.owners.length} owner signatures` : "the wallet's required signatures";
      nextStep = `The token sits inside a ${holder.name || "contract wallet"} (${holder.owners.length} owners, ${need}). Connect that wallet itself — via WalletConnect or Safe{Wallet} — and list from it. Connecting an owner account shows nothing, because the owner does not hold the token.`;
    } else {
      nextStep = `The token sits inside a contract wallet (${holder.name || "contract"}). Marketplaces generally only let the contract list, by connecting that contract; an owner account will show nothing.`;
    }
    blockers.push("held by a contract wallet — connect the contract, not an owner EOA");
  } else if (holder.kind === "eoa") {
    nextStep = token.opensea?.indexed === true
      ? "Open the item page below, connect this same address, and list from there."
      : "This address is a normal wallet, so nothing about it blocks listing. The item page below is where the listing happens once OpenSea has the item.";
  } else {
    nextStep = "Holder type unread, so a contract wallet cannot be ruled out. Check the address on Etherscan before listing.";
  }

  if (!blockers.length && token.opensea?.indexed === true && !notes.length) {
    return { state: "ready", blockers, notes, nextStep };
  }
  if (!blockers.length) {
    return { state: "listable-with-notes", blockers, notes, nextStep };
  }
  return { state: "blocked", blockers, notes, nextStep };
}

// -------------------------------------------------------------- row

function emptyRow(address, reason) {
  return {
    address,
    chain: "ethereum",
    ok: false,
    stale: false,
    reason,
    holder: { kind: "unknown", name: null, verified: null, owners: null, threshold: null, reason },
    sim: { held: null, checked: false },
    tokens: [],
    verdict: { state: "unknown", blockers: [], notes: [], nextStep: null },
    caps: [],
    warnings: [],
    provenance: [],
    notChecked: NOT_CHECKED,
    checkedAt: nowIso(),
    fingerprint: null,
  };
}

async function inspectOne(address, { timeoutMs = DEFAULT_TIMEOUT_MS, fresh = false } = {}) {
  const lower = address.toLowerCase();
  if (!EVM_RE.test(lower)) {
    return emptyRow(address, "not an Ethereum address (SIM is an Ethereum mainnet ERC-721, not Solana)");
  }
  const row = emptyRow(address, null);
  row.provenance.push(`Blockscout v2 (keyless) · eth.blockscout.com`, `Ethereum mainnet JSON-RPC · ${ETH_RPCS[0]}`);

  const [holderRes, idsRes] = await Promise.allSettled([
    describeHolder(lower, { timeoutMs }),
    simTokenIds(lower, { timeoutMs }),
  ]);

  row.holder = holderRes.status === "fulfilled" ? holderRes.value : { kind: "unknown", name: null, verified: null, owners: null, threshold: null, reason: holderRes.reason?.message || "holder lookup failed" };
  if (row.holder.reason) row.warnings.push(`holder type: ${row.holder.reason}`);

  if (idsRes.status === "rejected") {
    row.reason = `could not list the wallet's NFTs: ${idsRes.reason?.message || idsRes.reason}`;
    row.warnings.push("no SIM count or token list: the NFT walk failed");
    return row;
  }
  const { ids, pages, truncated } = idsRes.value;
  if (truncated) row.caps.push(`NFT walk stopped after ${pages} of ${NFT_PAGE_CAP} pages — a SIM token further down the list would be missed`);
  row.sim = { held: ids.length, checked: true, pages };
  row.provenance.push(`Blockscout NFT walk · ${pages} page(s) of type=ERC-721`);

  if (!ids.length) {
    row.ok = true;
    row.reason = null;
    row.verdict = {
      state: "none",
      blockers: [],
      notes: [`no ${SIM_NAME} token in this address on Ethereum mainnet`],
      nextStep: `This address holds no ${SIM_NAME}. If you expected one, the usual causes are the wrong address, a transfer out, or a mint on Sepolia — SIM on mainnet is ${SIM_CONTRACT}.`,
    };
    row.fingerprint = sha1(`none:${lower}`);
    return row;
  }

  const shown = ids.slice(0, MAX_TOKENS_CHECKED);
  if (ids.length > shown.length) row.caps.push(`metadata checked for the first ${shown.length} of ${ids.length} SIM tokens`);
  const osChecked = shown.slice(0, MAX_OPENSEA_CHECKS);
  if (shown.length > osChecked.length) row.caps.push(`OpenSea page checked for ${osChecked.length} of ${shown.length} SIM tokens (item pages are ~800KB of HTML)`);

  const tokens = await Promise.all(
    shown.map(async (id) => {
      const [ownerRes, instanceRes, onchainRes] = await Promise.allSettled([
        ethCall("0x6352211e" + Number(id).toString(16).padStart(64, "0"), { timeoutMs }),
        readInstance(id, { timeoutMs }),
        readTokenUriOnChain(id, { timeoutMs }),
      ]);
      const owner = ownerRes.status === "fulfilled" ? ownerRes.value : { ok: false, result: null, error: ownerRes.reason?.message || "ownerOf failed" };
      const instance = instanceRes.status === "fulfilled" ? instanceRes.value : { ok: false, reason: instanceRes.reason?.message || "instance read failed" };
      const onchain = onchainRes.status === "fulfilled" ? onchainRes.value : { ok: false, reason: onchainRes.reason?.message || "tokenURI read failed" };
      const onchainMeta = onchain.meta && typeof onchain.meta === "object" ? onchain.meta : null;

      // The chain is the authority on ownership; the index is only a hint.
      // An empty ownerOf answer is a burned id, which is a definite "not yours",
      // not an unknown — so it must not read as unconfirmed.
      const chainAnsweredEmpty = owner.ok && (owner.result === "0x" || owner.result === "" || owner.result === null);
      const burned = chainAnsweredEmpty;
      const chainOwner = !burned && owner.result && owner.result.length >= 66 ? "0x" + owner.result.slice(-40).toLowerCase() : null;
      const indexOwner = typeof instance.owner === "string" ? instance.owner.toLowerCase() : null;
      const heldOnChain = burned ? false : chainOwner ? chainOwner === lower : null;
      // `held` is the answer to "does this wallet have it" and may lean on the
      // index; `heldOnChain` stays strictly the chain's answer.
      const held = burned ? false : chainOwner ? heldOnChain : indexOwner ? indexOwner === lower : null;
      const ownershipAgrees = chainOwner && indexOwner ? chainOwner === indexOwner : null;

      const name = onchainMeta?.name ?? instance.name ?? null;
      const attributes = onchainMeta && Array.isArray(onchainMeta.attributes)
        ? onchainMeta.attributes.slice(0, 16).map((a) => ({ trait: a?.trait_type ?? a?.trait ?? null, value: a?.value ?? null }))
        : instance.attributes || [];
      const imageUrl = onchainMeta?.image ?? instance.image ?? null;
      const animation = onchainMeta?.animation_url ?? instance.animation ?? null;
      const description = (onchainMeta && typeof onchainMeta.description === "string" && onchainMeta.description.trim())
        ? onchainMeta.description.trim().slice(0, 200)
        : instance.description || null;

      // Distinguish "no image in the metadata" from "we could not read the
      // metadata" — the second is a failure, the first is a fact.
      const metadataUnread = !instance.ok && !onchain.ok;
      const image = imageUrl
        ? await checkImage(imageUrl, { timeoutMs: Math.min(timeoutMs, 8000) })
        : { url: null, ok: null, type: null, status: 0, bytes: 0, host: null, reason: metadataUnread ? `metadata unread: ${instance.reason || onchain.reason}` : "metadata has no image field" };

      const opensea = await checkOpenSeaItem(id, { timeoutMs: Math.max(timeoutMs, 15_000) }).catch((e) => ({ checked: true, url: OPENSEA_ITEM(id), indexed: null, reason: e.message }));
      const token = {
        id,
        owner: chainOwner,
        ownerIndex: indexOwner,
        held,
        burned,
        ownerUnread: chainOwner ? null : owner.error || "ownerOf unread (public RPC throttled)",
        ownershipAgrees,
        heldOnChain,
        metadata: {
          read: !metadataUnread,
          source: onchain.ok ? `tokenURI (${onchain.kind}${onchain.inlined ? ", inlined" : ""})` : instance.ok ? "Blockscout instance" : null,
          uriKind: onchain.kind ?? null,
          uriHost: onchain.uriHost ?? null,
          inlined: onchain.inlined === true,
          reason: metadataUnread ? instance.reason || onchain.reason : null,
        },
        name: name === null && metadataUnread ? null : nameHealth(name, attributes),
        nameValue: name,
        description,
        attributes,
        animation: animation ? (String(animation).startsWith("data:") ? "inlined (data: URI)" : "external url") : null,
        image,
        opensea,
        links: { opensea: OPENSEA_ITEM(id), etherscan: ETHERSCAN_EXPLORER(id) },
      };
      token.verdict = verdictFor(token, row.holder);
      return token;
    }),
  );

  row.tokens = tokens;
  row.ok = true;
  row.reason = null;
  const states = new Set(tokens.map((t) => t.verdict.state));
  row.verdict =
    states.size === 1 ? { ...tokens[0].verdict, tokenIds: tokens.map((t) => t.id) } : {
      state: states.has("blocked") ? "blocked" : states.has("ready") ? "ready" : "listable-with-notes",
      blockers: [...new Set(tokens.flatMap((t) => t.verdict.blockers))],
      notes: [...new Set(tokens.flatMap((t) => t.verdict.notes))],
      nextStep: tokens.find((t) => t.verdict.nextStep)?.verdict.nextStep || null,
      tokenIds: tokens.map((t) => t.id),
    };
  row.provenance.push(`OpenSea item pages (keyless HTML) · opensea.io${osChecked.length ? ` · checked ${osChecked.length}` : ""}`);
  row.fingerprint = sha1(JSON.stringify({ a: lower, ids: tokens.map((t) => [t.id, t.owner, t.name?.state]) }));
  return row;
}

export async function inspectSimListing(address, options = {}) {
  const lower = String(address ?? "").trim().toLowerCase();
  if (!lower) throw new Error("no address supplied");
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fresh = false, ttlMs = CACHE_TTL_MS } = options;
  const hit = cache.get(lower);
  if (!fresh && hit && Date.now() - hit.at < ttlMs) return { ...hit.value, cached: true };
  let row;
  try {
    row = await inspectOne(lower, { timeoutMs, fresh });
  } catch (error) {
    row = emptyRow(lower, error?.message || "read failed");
  }
  // A row can come back ok:false without throwing (the NFT walk failed, the
  // holder lookup failed). That is still a failed read, so a wallet that read
  // before serves its last good row, flagged stale, rather than blanking out.
  if (!row.ok && hit?.value?.ok) {
    const previous = hit.value;
    row = {
      ...previous,
      stale: true,
      reason: `read failed: ${row.reason}`,
      checkedAt: previous.checkedAt,
      warnings: [...(previous.warnings || []), `last good read served stale: ${row.reason}`],
    };
  }
  cache.delete(lower);
  cache.set(lower, { at: Date.now(), value: row });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return { ...row, cached: false };
}

export async function inspectSimListings(rawWallets, options = {}) {
  const { concurrency = 2, ...rest } = options;
  const seen = new Set();
  const addresses = [];
  const dropped = [];
  for (const raw of String(rawWallets ?? "").split(/[\s,;]+/)) {
    const value = raw.trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    // Never truncate silently: a dropped wallet would read as "checked, no SIM".
    if (seen.size >= MAX_ADDRESSES) {
      dropped.push(value);
      continue;
    }
    seen.add(value);
    addresses.push(value);
  }
  if (!addresses.length) throw new Error("no addresses supplied (use wallets=0x…)");
  const out = new Array(addresses.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < addresses.length) {
      const index = cursor++;
      out[index] = await inspectSimListing(addresses[index], rest).catch((error) => emptyRow(addresses[index], error.message));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, addresses.length)) }, worker));
  return {
    checkedAt: nowIso(),
    collection: { name: SIM_NAME, contract: SIM_CONTRACT, opensea: SIM_COLLECTION_PAGE, supply: null },
    wallets: out,
    limits: {
      maxWallets: MAX_ADDRESSES,
      checked: addresses.length,
      dropped,
    },
    notChecked: dropped.length ? [`${dropped.length} wallet(s) beyond the ${MAX_ADDRESSES}-wallet limit were NOT read: ${dropped.join(", ")}`] : [],
  };
}
