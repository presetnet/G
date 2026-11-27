import { createHash } from "node:crypto";
export const PACK_PROGRAM = "HTrrq6C6j9NYySUrpSLn9nDjFbKNBD6pS3xBuLppfW4F";
const DESTINATIONS = ["D8LYYHufXvEVAfMKfmv9amKLJjdJejpXAwsM5Wqp3iQe", "78zsqg7rhoBGMra57Nq1kiLGM8KxFBYefoKZDXDRFhHb"];
const DAY = 86400000;
// Grail: instruction level and receipt byte both 3 in jb5Yo2k6...BbNJBzWr,
// a single BuyPack for exactly the published Grail quote (3,536,452,670 lamports).
const PACK_TIERS = ["base", "hype", "viral", "grail"];
// Publicly identified receipts predate the rolling discovery window. Fetch and
// validate them exactly like sampled signatures, and expire them after 24h.
const REPORTED_PAYOUTS = [
  { signature: "3Rf3ruWw2ajqfutqiDHZRnuetBr6QRdmJyyUcZeZh6xHYHWUAvgyRburzFTLm6N6QjkhW2feZCnu1FgfZ9ANF1yv", at: Date.parse("2026-11-26T18:35:44Z") },
  { signature: "2SJASsGgg91BCuHxmJfgs1Lk1zephbiqkFsUiRFndtEfXTwJ5FeADGKatiHVh28TTVmdjARNDdAEgHfokH2YNP81", at: Date.parse("2026-11-27T00:39:04Z") },
  { signature: "3TUU911h7VuoQoZHtA362cYrrmqp48HTFYnj7RpCmjTMPQTLMfKE7DgH5gA84cFUGojaLzvAwr7YTrJH56EJHYjy", at: Date.parse("2026-11-27T00:43:42Z") },
];
const CENSUS_INTERVAL = 15 * 60000;

// Receipt discriminator and byte 104 mapping are empirically cross-checked
// against BuyPack transaction prices, not an officially published account ABI.
export async function collectPackCensus(rpc, previous = null, now = Date.now()) {
  const attempted = Date.parse(previous?.lastAttemptAt || previous?.checkedAt || "");
  if (Number.isFinite(attempted) && now >= attempted && now - attempted < CENSUS_INTERVAL) return previous;
  const at = new Date(now).toISOString();
  try {
    const result = await rpc("getProgramAccounts", [PACK_PROGRAM, {
      encoding: "base64", withContext: true, commitment: "confirmed",
      filters: [{ dataSize: 107 }, { memcmp: { offset: 0, bytes: "LacdB1MoxcT" } }],
      dataSlice: { offset: 104, length: 1 },
    }], { timeoutMs: 15000 });
    if (!result || !Array.isArray(result.value) || !Number.isSafeInteger(result.context?.slot)) throw Error("Invalid receipt census response");
    const counts = { base: 0, hype: 0, viral: 0, grail: 0, unknown: 0 };
    for (const row of result.value) {
      const data = row?.account?.data;
      if (!Array.isArray(data) || data[1] !== "base64" || typeof data[0] !== "string") throw Error("Invalid receipt data");
      const bytes = Buffer.from(data[0], "base64");
      if (bytes.length !== 1) throw Error("Incomplete receipt data");
      const tier = PACK_TIERS[bytes[0]] || "unknown";
      counts[tier]++;
    }
    return { source: "trix.packcensus", ok: true, checkedAt: at, lastAttemptAt: at, slot: result.context.slot,
      total: result.value.length, counts, sourceUrl: `https://solscan.io/account/${PACK_PROGRAM}`,
      note: "Current program-owned receipt accounts, not guaranteed lifetime purchases. Tier byte mapping is empirically checked against sample transactions, not an official ABI." };
  } catch (error) {
    return { ...(previous || {}), source: "trix.packcensus", ok: false, stale: true, checkedAt: previous?.checkedAt || at,
      lastAttemptAt: at, reason: error.message || "Receipt census unavailable" };
  }
}
const BUY_PACK = createHash("sha256").update("global:buy_pack").digest().subarray(0, 8);
function buyPackTier(data) {
  if (typeof data !== "string" || !data) return null;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const ch of data) { const digit = alphabet.indexOf(ch); if (digit < 0) return null; value = value * 58n + BigInt(digit); }
  let hex = value.toString(16); if (hex.length % 2) hex = `0${hex}`;
  const prefix = data.match(/^1*/)[0].length;
  const bytes = Buffer.concat([Buffer.alloc(prefix), Buffer.from(hex, "hex")]);
  if (!bytes.subarray(0, 8).equals(BUY_PACK)) return null;
  return PACK_TIERS[bytes[8]] || "unknown";
}

// Attribute only inner transfers belonging to the specific outer program
// instruction, signed by the payer, and containing both observed recipients.
export function parsePackFlow(tx) {
  if (!tx?.meta || tx.meta.err || !Number.isFinite(tx.blockTime) || !tx.meta.logMessages?.some((s) => s.includes("Instruction: BuyPack"))) return null;
  const payer = tx.transaction?.message?.accountKeys?.find((k) => k.signer)?.pubkey;
  const outer = tx.transaction?.message?.instructions || [];
  const groups = tx.meta.innerInstructions || [];
  const amounts = [0, 0];
  const tiers = new Set();
  let packs = 0;
  for (const group of groups) {
    const ix = outer[group.index];
    if (ix?.programId !== PACK_PROGRAM) continue;
    const tier = buyPackTier(ix.data);
    if (!tier) continue;
    const matched = [0, 0];
    for (const instruction of group.instructions || []) {
      const info = instruction.parsed?.info;
      const index = DESTINATIONS.indexOf(info?.destination);
      if (instruction.program === "system" && instruction.parsed?.type === "transfer" && info?.source === payer && index >= 0 && Number.isSafeInteger(info.lamports) && info.lamports > 0) matched[index] += info.lamports;
    }
    if (matched.every((v) => v > 0)) { tiers.add(tier); packs++; amounts[0] += matched[0]; amounts[1] += matched[1]; }
  }
  const signature = tx.transaction?.signatures?.[0];
  return packs && signature ? { signature, at: new Date(tx.blockTime * 1000).toISOString(), buyer: payer, tiers: [...tiers], packs, lamports: amounts } : null;
}

export function parseShopPayouts(tx) {
  const signature = tx?.transaction?.signatures?.[0];
  if (!signature || !tx.meta || tx.meta.err || !Number.isFinite(tx.blockTime) ||
      !tx.meta.logMessages?.includes("Program log: Instruction: ShopBuyShared")) return [];
  const payouts = [];
  for (const group of tx.meta.innerInstructions || []) {
    const ix = tx.transaction.message.instructions[group.index];
    // ShopBuyShared discriminator, vault and recipient account positions from
    // the confirmed program receipts. Ignore rent refunds on sibling instructions.
    if (ix?.programId !== PACK_PROGRAM || ix.data !== "aqyWW67znve" || ix.accounts?.[3] !== DESTINATIONS[0]) continue;
    const seller = ix.accounts[8];
    let lamports = 0;
    for (const inner of group.instructions || []) {
      const info = inner.parsed?.info;
      if (inner.program === "system" && inner.parsed?.type === "transfer" &&
          info?.source === DESTINATIONS[0] && info.destination === seller &&
          Number.isSafeInteger(info.lamports) && info.lamports > 0) lamports += info.lamports;
    }
    if (lamports > 0) payouts.push({ signature, index: group.index, seller, lamports, at: new Date(tx.blockTime * 1000).toISOString() });
  }
  return payouts;
}

// Freeze the finalized slot range while paging. Only advance past the upper
// bound after the provider exhausts it, even when one minute spans many pages.
export async function scanLiveSellbacks(rpc, previous, now = Date.now()) {
  let scan = { ...previous, ok: false };
  const payouts = [];
  try {
    if (!scan.end) {
      const head = await rpc("getSlot", [{ commitment: "finalized" }]);
      if (!Number.isSafeInteger(head) || head < 1) throw Error("Finalized slot unavailable");
      const start = scan.through ? scan.through + 1 : Math.max(1, head - 300);
      if (head < start) return { scan: { ...scan, ok: true }, payouts };
      scan = { ...scan, since: scan.since || start, start, end: head, cursor: null };
    }
    for (let page = 0; page < 3; page++) {
      const result = await rpc("getTransactionsForAddress", [DESTINATIONS[0], {
        transactionDetails: "full", sortOrder: "asc", commitment: "finalized", limit: 100,
        encoding: "jsonParsed", maxSupportedTransactionVersion: 0,
        filters: { slot: { gte: scan.start, lte: scan.end }, status: "succeeded" },
        ...(scan.cursor ? { paginationToken: scan.cursor } : {}),
      }], { timeoutMs: 8000 });
      if (!Array.isArray(result?.data) || result.data.some(t => !t?.meta || !t.transaction?.message ||
          !(t.slot >= scan.start && t.slot <= scan.end))) throw Error("Incomplete sellback page");
      for (const tx of result.data) payouts.push(...parseShopPayouts(tx));
      if (!result.paginationToken) {
        scan = { since: scan.since, through: scan.end, checkedAt: new Date(now).toISOString(), ok: true };
        break;
      }
      if (result.paginationToken === scan.cursor) throw Error("Sellback cursor did not advance");
      scan = { ...scan, cursor: result.paginationToken, ok: true };
    }
  } catch { scan.ok = false; }
  return { scan, payouts };
}

export async function collectPackFlow(rpc, previous = null, now = Date.now()) {
  const [flow, live] = await Promise.all([
    collectSampledPackFlow(rpc, previous, now), scanLiveSellbacks(rpc, previous?.sellbackScan, now),
  ]);
  const receipts = new Map();
  for (const p of [...(previous?.payouts || []), ...(flow.payouts || []), ...live.payouts]) {
    if (Date.parse(p.at) >= now - DAY && Date.parse(p.at) <= now) receipts.set(`${p.signature}:${p.index}`, p);
  }
  return { ...flow, sellbackScan: live.scan, payouts: [...receipts.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) };
}

async function collectSampledPackFlow(rpc, previous, now) {
  const checkedAt = new Date(now).toISOString();
  try {
    const signatures = await rpc("getSignaturesForAddress", [PACK_PROGRAM, { limit: 25, commitment: "confirmed" }]);
    if (!Array.isArray(signatures)) throw Error("Signature response unavailable");
    const scanned = new Set(previous?.scanned || []);
    const candidates = signatures.filter((x) => x.signature && !x.err && !scanned.has(x.signature));
    const selected = candidates.slice(0, 5);
    const payouts = new Map((previous?.payouts || []).filter(p => Date.parse(p.at) >= now - DAY)
      .map(p => [`${p.signature}:${p.index}`, p]));
    for (const seed of REPORTED_PAYOUTS) {
      if (seed.at <= now && seed.at >= now - DAY && ![...payouts.values()].some(p => p.signature === seed.signature) &&
          !selected.some(s => s.signature === seed.signature)) selected.push(seed);
    }
    // Re-read one legacy record per scan; never label old unknowns from price alone.
    const legacy = previous?.records?.find(r => (!r.buyer || (r.tiers?.includes("unknown") && !r.grailChecked)) && Date.parse(r.at) >= now - DAY);
    if (legacy && !selected.some(s => s.signature === legacy.signature)) selected.push(legacy);
    const results = await Promise.allSettled(selected.map((s) => rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }])));
    const records = new Map((previous?.records || []).filter((r) => Date.parse(r.at) >= now - DAY && Date.parse(r.at) <= now).map((r) => [r.signature, r]));
    let resolved = 0;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== "fulfilled" || !result.value) continue;
      resolved++;
      scanned.add(selected[i].signature);
      const record = parsePackFlow(result.value);
      if (record && Date.parse(record.at) >= now - DAY && Date.parse(record.at) <= now) {
        if (record.tiers.includes("unknown")) record.grailChecked = true;
        records.set(record.signature, record);
      }
      for (const p of parseShopPayouts(result.value)) {
        if (p.signature === selected[i].signature && Date.parse(p.at) >= now - DAY && Date.parse(p.at) <= now) payouts.set(`${p.signature}:${p.index}`, p);
      }
    }
    if (selected.length && !resolved) throw Error("Could not resolve sampled transactions");
    const retained = [...records.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 1000);
    return { source: "trix.packflow", ok: true, checkedAt, sourceUrl: `https://solscan.io/account/${PACK_PROGRAM}`, records: retained,
      payouts: [...payouts.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 1000),
      scanned: [...scanned].slice(-1000), packs24h: retained.reduce((sum, r) => sum + r.packs, 0),
      depositsLamports24h: DESTINATIONS.map((_, i) => retained.reduce((sum, r) => sum + r.lamports[i], 0)),
      destinations: DESTINATIONS, firstObservedAt: previous?.firstObservedAt || checkedAt,
      sampledSignatures: signatures.length, queuedInSample: Math.max(0, candidates.length - selected.length), unresolved: selected.length - resolved,
      note: "Observed minimum from a bounded rolling scan, not complete 24-hour activity. Counts matching outer BuyPack instructions and the two observed deposit legs; history before monitoring and transactions outside the scan can be missed." };
  } catch (error) {
    return { source: "trix.packflow", ok: false, stale: true, checkedAt: previous?.checkedAt || checkedAt, lastAttemptAt: checkedAt,
      records: previous?.records || [], payouts: previous?.payouts || [], scanned: previous?.scanned || [], firstObservedAt: previous?.firstObservedAt || null, reason: error.message };
  }
}
