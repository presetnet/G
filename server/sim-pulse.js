// A supply milestone is not a scheduled contract event. Historical state reads
// measure net contraction; Seaport receipts measure paid prices, not listings.
import { Interface, formatEther } from "ethers";

export const SUPPLY_TARGET = 4500;
export const SEAPORT = "0x0000000000000068f116a894984e2db1123eb395";
export const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const ZERO = "0x0000000000000000000000000000000000000000";
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const hex = (n) => `0x${BigInt(n).toString(16)}`;
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const integer = (n) => {
  const value = Number(BigInt(n));
  ensure(Number.isSafeInteger(value) && value >= 0, "Invalid on-chain counter");
  return value;
};
const stamp = (seconds) => new Date(seconds * 1000).toISOString();
const settled = async (fn) => { try { return { ok: true, ...await fn() }; } catch (e) { return { ok: false, error: e.message }; } };
const EXPLORER = "https://eth.blockscout.com/api/v2";
const SIM_SITE = "https://sim.tech";
export const POOL_VOID = "0x40FA5b555b83676E203Dac4CfB70fD13A53bf6a7";
const VOID_PAGES = 8;
const VOID_BURNS = 400;
const SOCIAL_PAGES = 12;
const POOL_PAGES = 8;
const POOL_MAX = 400;
const TRANSFER = new Interface(["event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"]);
const COLLAPSE_LOG = new Interface(["event Collapsed(uint256 indexed formulaId,uint256 indexed output,uint256[] inputs)"]);
export const SEAPORT_ABI = new Interface([
  "event OrderFulfilled(bytes32 orderHash,address indexed offerer,address indexed zone,address recipient,tuple(uint8 itemType,address token,uint256 identifier,uint256 amount)[] offer,tuple(uint8 itemType,address token,uint256 identifier,uint256 amount,address recipient)[] consideration)",
]);

export function supplyWindow(now, before, label) {
  const seconds = now.timestamp - before.timestamp;
  ensure(seconds > 0, "Historical sample must precede the current block");
  const minted = now.minted - before.minted;
  const netReduction = before.supply - now.supply;
  const burned = minted + netReduction;
  ensure(minted >= 0 && burned >= 0, "Supply counters disagree across historical samples");
  return { label, fromBlock: before.block, toBlock: now.block, fromAt: stamp(before.timestamp), toAt: stamp(now.timestamp),
    seconds, hours: seconds / 3600, supplyBefore: before.supply, supplyNow: now.supply,
    minted, burned, netReduction, netPerHour: netReduction * 3600 / seconds };
}

export function buildSupplyPulse(now, history) {
  ensure(now.minted >= now.supply && now.supply >= 0, "Minted and live supply disagree");
  const remaining = Math.max(0, now.supply - SUPPLY_TARGET);
  const windows = history.map((h) => h.ok ? { ok: true, ...supplyWindow(now, h.sample, h.label) } : { ok: false, label: h.label, error: h.error });
  const project = (w) => remaining > 0 && w?.ok && w.netPerHour > 0 && w.seconds >= 1800
    ? { hoursRemaining: remaining / w.netPerHour, at: stamp(now.timestamp + remaining / w.netPerHour * 3600), basis: w.label, netPerHour: w.netPerHour }
    : null;
  const short = windows.find((w) => w.label === "1h"), long = windows.find((w) => w.label === "6h");
  const shortProjection = project(short), projection = project(long);
  const ratio = short?.ok && long?.ok && long.netPerHour > 0 ? short.netPerHour / long.netPerHour : null;
  return { target: SUPPLY_TARGET, current: now.supply, mintedLifetime: now.minted, burnedLifetime: now.minted - now.supply,
    remaining, state: now.supply > SUPPLY_TARGET ? "above" : now.supply === SUPPLY_TARGET ? "at" : "below",
    block: now.block, blockAt: stamp(now.timestamp), windows, projection, shortProjection,
    paceUnstable: ratio !== null && (ratio < 0.5 || ratio > 2),
    note: "4,500 is a user-supplied watch target, not an automatic contract unlock. Counts include originals and upgraded NFTs; owner minting and collapses can both change supply." };
}

export async function readSupplyPulse(s, block) {
  async function sample(at) {
    const [b, [supply], [next]] = await Promise.all([
      s.rpc("eth_getBlockByNumber", [at, false]), s.call("totalSupply", [], at), s.call("nextTokenId", [], at),
    ]);
    ensure(b && BigInt(b.number) === BigInt(at), "Block read mismatch");
    ensure(next > 0n, "Invalid next token ID");
    return { block: integer(at), timestamp: integer(b.timestamp), supply: integer(supply), minted: integer(next - 1n) };
  }
  const now = await sample(block);
  // Block distances are approximate windows. Rates always use the actual block
  // timestamps, so missed slots are not silently counted as twelve seconds.
  const history = await Promise.all([["1h", 300n], ["6h", 1800n], ["24h", 7200n]].map(async ([label, distance]) => {
    try { return { ok: true, label, sample: await sample(hex(BigInt(block) - distance)) }; }
    catch (e) { return { ok: false, label, error: e.message }; }
  }));
  return { ...buildSupplyPulse(now, history), history };
}

function currency(item) {
  if (Number(item.itemType) === 0 && same(item.token, ZERO)) return "ETH";
  if (Number(item.itemType) === 1 && same(item.token, WETH)) return "WETH";
  return null;
}

// Only one-NFT orders priced wholly in ETH or WETH are comparable here. A basket
// total is never divided into invented per-token prices. Transaction value is
// never used as the sale price (it can include refunds and unrelated orders).
export function decodeSeaportSales(receipt, contract) {
  ensure(receipt && BigInt(receipt.status) === 1n, "Sale transaction is not successful");
  ensure(Array.isArray(receipt.logs) && receipt.logs.length <= 5000, "Receipt log limit exceeded");
  const transfers = receipt.logs.filter((l) => same(l.address, contract)).flatMap((l) => {
    try { const p = TRANSFER.parseLog(l); return p ? [p.args] : []; } catch { return []; }
  });
  const sales = [], skipped = { multi: 0, currency: 0, transfer: 0, selfTransfer: 0, malformed: 0 };
  for (const log of receipt.logs.filter((l) => same(l.address, SEAPORT))) {
    let p;
    try { p = SEAPORT_ABI.parseLog(log); } catch { skipped.malformed++; continue; }
    if (!p || p.name !== "OrderFulfilled") continue;
    const a = p.args, offer = Array.from(a.offer), consideration = Array.from(a.consideration);
    // Seaport itemType 3 is ERC20, not an NFT. ERC721 is 2 and ERC1155 is 4.
    const isNft = (i) => i.itemType === 2n || i.itemType === 4n;
    const nfts = [...offer, ...consideration].filter(isNft);
    if (!nfts.some((i) => same(i.token, contract))) continue;
    if (nfts.length !== 1 || !isNft(nfts[0]) || nfts[0].itemType !== 2n || nfts[0].amount !== 1n) { skipped.multi++; continue; }
    const nft = nfts[0];
    const nftOffered = offer.includes(nft);
    const payment = nftOffered ? consideration : offer;
    const symbols = payment.map(currency);
    if (!payment.length || symbols.some((c) => !c) || new Set(symbols).size !== 1 || payment.some((i) => i.amount < 0n)) { skipped.currency++; continue; }
    // Bid consideration may include royalty/fee currency items, but nothing
    // outside the bid's quote currency can be interpreted as a simple fill.
    if (!nftOffered && consideration.some((i) => i !== nft && currency(i) !== symbols[0])) { skipped.currency++; continue; }
    const gross = payment.reduce((sum, i) => sum + i.amount, 0n);
    if (gross <= 0n) { skipped.currency++; continue; }
    const moved = transfers.filter((t) => t.tokenId === nft.identifier && !same(t.from, ZERO) && !same(t.to, ZERO));
    if (moved.length !== 1) { skipped.transfer++; continue; }
    if (same(moved[0].from, moved[0].to)) { skipped.selfTransfer++; continue; }
    const seller = nftOffered ? a.offerer : a.recipient;
    const buyer = nftOffered ? a.recipient : nft.recipient;
    if ((!same(seller, ZERO) && !same(moved[0].from, seller)) || (!same(buyer, ZERO) && !same(moved[0].to, buyer))) { skipped.transfer++; continue; }
    const key = `${a.orderHash}:${nft.identifier}`;
    if (sales.some((row) => row.key === key)) continue;
    sales.push({ key, tokenId: String(nft.identifier), currency: symbols[0], amountWei: String(gross), amountEth: formatEther(gross),
      tx: receipt.transactionHash, block: integer(receipt.blockNumber), source: `https://etherscan.io/tx/${receipt.transactionHash}` });
  }
  return { sales, skipped };
}

export function saleStats(sales) {
  if (!sales.length) return null;
  const values = sales.map((s) => BigInt(s.amountWei)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2n;
  return { count: values.length, lowEth: formatEther(values[0]), highEth: formatEther(values.at(-1)), medianEth: formatEther(median) };
}

export async function readSalesPulse(s, { contract, block }) {
  const candidates = new Map();
  let pages = 0, rows = 0, url = `${EXPLORER}/tokens/${contract}/transfers`, more = false;
  // Discovery is capped; the UI calls these a sample, never a market-wide floor.
  while (url && pages < 3 && candidates.size < 8) {
    const j = await s.json(url);
    ensure(Array.isArray(j.items), "Explorer transfer feed unavailable");
    pages++; rows += j.items.length;
    for (const t of j.items) {
      if (BigInt(t.block_number) > BigInt(block) || !same(t.token?.address_hash, contract) || same(t.from?.hash, ZERO) || same(t.to?.hash, ZERO) || same(t.from?.hash, t.to?.hash)) continue;
      if (!/^0x[0-9a-f]{64}$/i.test(t.transaction_hash || "")) continue;
      candidates.set(t.transaction_hash, true);
    }
    more = !!j.next_page_params;
    url = more ? `${EXPLORER}/tokens/${contract}/transfers?${new URLSearchParams(j.next_page_params)}` : null;
  }
  const chosen = [...candidates.keys()].slice(0, 8);
  const sales = [], skipped = {}, failures = [];
  const blocks = new Map();
  const [renderer] = await s.call("renderer", [], block);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, chosen.length) }, async () => {
    while (cursor < chosen.length) {
      const hash = chosen[cursor++];
      try {
        const receipt = await s.rpc("eth_getTransactionReceipt", [hash]);
        ensure(receipt && same(receipt.transactionHash, hash) && BigInt(receipt.blockNumber) <= BigInt(block), "Receipt not available at snapshot block");
        const decoded = decodeSeaportSales(receipt, contract);
        for (const [key, count] of Object.entries(decoded.skipped)) skipped[key] = (skipped[key] || 0) + count;
        if (!decoded.sales.length) { skipped.noSupportedSale = (skipped.noSupportedSale || 0) + 1; continue; }
        if (!blocks.has(receipt.blockNumber)) blocks.set(receipt.blockNumber, s.rpc("eth_getBlockByNumber", [receipt.blockNumber, false]));
        const b = await blocks.get(receipt.blockNumber);
        ensure(b && same(b.hash, receipt.blockHash), "Sale block hash mismatch");
        for (const sale of decoded.sales) {
          let typeId = null, name = null;
          try {
            const [category] = await s.call("tokenCategory", [sale.tokenId], receipt.blockNumber);
            if (category > 0n) { typeId = String(category); name = await s.typeName(category, renderer, block); }
          } catch { /* The paid price remains verified even if TYPE history fails. */ }
          sales.push({ ...sale, at: stamp(integer(b.timestamp)), typeId, name });
        }
      } catch (e) { failures.push({ source: `https://etherscan.io/tx/${hash}`, reason: e.message }); }
    }
  }));
  sales.sort((a, b) => b.block - a.block || a.key.localeCompare(b.key));
  // A successful discovery request is not a successful sale read when every
  // receipt failed. Never turn a provider outage into "no sales".
  ensure(!chosen.length || failures.length < chosen.length, "All discovered transaction receipts were unreadable; sale activity is unknown");
  const snapshot = await s.rpc("eth_getBlockByNumber", [block, false]);
  ensure(snapshot && BigInt(snapshot.number) === BigInt(block), "Sale snapshot block mismatch");
  const observedAt = stamp(integer(snapshot.timestamp));
  const recent = sales.filter((sale) => Date.parse(sale.at) >= Date.parse(observedAt) - 86400_000);
  return { sales, stats: saleStats(sales), originals: saleStats(sales.filter((s) => Number(s.typeId) >= 1 && Number(s.typeId) <= 8)),
    upgraded: saleStats(sales.filter((s) => Number(s.typeId) > 8)), pages, transferRows: rows, candidateTransactions: candidates.size,
    inspectedTransactions: chosen.length, capped: more || candidates.size > chosen.length, skipped, failures,
    observedAt, latestSaleAt: sales[0]?.at ?? null, oldestSaleAt: sales.at(-1)?.at ?? null,
    recentStats: saleStats(recent), recentWindowHours: 24,
    note: "Sample of recent Seaport 1.6 single-NFT ETH/WETH fills. Gross order amounts include fee/royalty shares, exclude gas. Bundles and other venues/currencies are omitted. Paid prices are not current asks or executable bids; trades are not screened for wash trading." };
}

export function burnTypeName(row) {
  const metadata = row?.total?.token_instance?.metadata;
  const trait = metadata?.attributes?.find((a) => String(a?.trait_type).toUpperCase() === "TYPE");
  const name = trait?.value || metadata?.name;
  return typeof name === "string" && name.trim() && name.length <= 40 ? name.trim().toUpperCase() : "TYPE UNREAD";
}

export function summarizeVoidMix(rows, { pages = 0, capped = false, source = "", note = "" } = {}) {
  const counts = new Map();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) || 0) + 1);
  return {
    ok: true,
    counted: rows.length,
    pages,
    capped,
    counts: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    newestAt: rows.map((r) => r.at).filter(Boolean).sort().at(-1) || null,
    oldestAt: rows.map((r) => r.at).filter(Boolean).sort()[0] || null,
    source,
    note,
  };
}

export async function readVoidMix(s, { contract, maxPages = VOID_PAGES, maxBurns = VOID_BURNS } = {}) {
  const burns = new Map();
  let url = `${EXPLORER}/tokens/${contract}/transfers`;
  let pages = 0;
  let more = false;
  const source = url;
  while (url && pages < maxPages && burns.size < maxBurns) {
    const j = await s.json(url);
    ensure(Array.isArray(j.items), "Explorer burn feed unavailable");
    pages++;
    for (const t of j.items) {
      if (!same(t.to?.hash, ZERO) || same(t.from?.hash, ZERO) || !same(t.token?.address_hash, contract)) continue;
      const key = `${t.transaction_hash}:${t.log_index ?? t.total?.token_id ?? burns.size}`;
      if (burns.has(key)) continue;
      burns.set(key, {
        name: burnTypeName(t),
        at: Number.isFinite(Date.parse(t.timestamp)) ? t.timestamp : null,
        block: Number(t.block_number),
        tx: t.transaction_hash,
      });
      if (burns.size >= maxBurns) break;
    }
    more = !!j.next_page_params;
    url = more ? `${EXPLORER}/tokens/${contract}/transfers?${new URLSearchParams(j.next_page_params)}` : null;
  }
  const note = "Newest burn transfers to the zero address in a bounded explorer sample. TYPE comes from each burned token's own metadata; this is not a lifetime burn count or proof of permanent loss.";
  return summarizeVoidMix([...burns.values()], { pages, capped: burns.size >= maxBurns || more, source, note });
}

export async function readVoidPool(s, { contract, pool = POOL_VOID, maxPages = POOL_PAGES, maxRows = POOL_MAX } = {}) {
  const addressNames = new Map();
  try {
    const social = await s.json(`${SIM_SITE}/api/mainnet/social`);
    for (const row of social?.activity || []) {
      if (row?.address && row?.name) addressNames.set(String(row.address).toLowerCase(), String(row.name));
    }
  } catch { /* Unlabeled senders stay as hashes rather than being guessed. */ }
  const query = new URLSearchParams({ token: contract });
  const source = `${EXPLORER}/addresses/${pool}/token-transfers?${query}`;
  let url = source, pages = 0, more = false;
  const seen = new Set(), rows = [];
  while (url && pages < maxPages && rows.length < maxRows) {
    const j = await s.json(url);
    ensure(Array.isArray(j.items), "Void pool transfer feed unavailable");
    pages++;
    for (const t of j.items) {
      if (!same(t.to?.hash, pool) || same(t.from?.hash, ZERO) || same(t.from?.hash, t.to?.hash) || !same(t.token?.address_hash, contract)) continue;
      const key = `${t.transaction_hash}:${t.log_index ?? ""}:${t.total?.token_id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        name: burnTypeName(t),
        tokenId: String(t.total?.token_id ?? ""),
        from: addressNames.get(String(t.from?.hash).toLowerCase()) || t.from?.ens_domain_name || t.from?.hash || "",
        at: Number.isFinite(Date.parse(t.timestamp)) ? t.timestamp : null,
        block: Number(t.block_number),
        tx: t.transaction_hash,
      });
      if (rows.length >= maxRows) break;
    }
    more = !!j.next_page_params;
    url = more ? `${EXPLORER}/addresses/${pool}/token-transfers?${new URLSearchParams(j.next_page_params)}` : null;
  }
  const counts = new Map();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) || 0) + 1);
  const times = rows.map((r) => r.at).filter(Boolean).sort();
  const note = "Incoming SIM transfers to poolvoid.eth in a bounded explorer sample. TYPE comes from each token's own metadata; sender labels come from SIM's public activity feed when available. The void pool holds the tokens; this is not a zero-address burn, a lifetime total, or proof of permanent loss.";
  return {
    ok: true,
    counted: rows.length,
    pages,
    capped: rows.length >= maxRows || more,
    pool,
    counts: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    tokens: rows.slice(0, 60),
    newestAt: times.at(-1) || null,
    oldestAt: times[0] || null,
    source,
    note,
  };
}

export async function readVoidOutputs(s, { maxPages = SOCIAL_PAGES } = {}) {
  const source = `${SIM_SITE}/api/mainnet/social`;
  const social = await s.json(source);
  ensure(Array.isArray(social.activity), "SIM activity feed unavailable");
  const events = social.activity.filter((a) => a?.kind === "collapse" && /^\d+$/.test(String(a.token)));
  const ids = [...new Set(events.map((a) => String(a.token)))];
  const names = new Map();
  let cursor = "", pages = 0, more = false;
  while (pages < maxPages && ids.some((id) => !names.has(id))) {
    const gallery = `${SIM_SITE}/api/mainnet/gallery${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`;
    const j = await s.json(gallery);
    ensure(Array.isArray(j.items), "SIM gallery feed unavailable");
    pages++;
    for (const item of j.items) {
      if (/^\d+$/.test(String(item?.id)) && typeof item?.name === "string" && item.name.trim()) names.set(String(item.id), item.name.trim().toUpperCase());
    }
    more = j.next != null && j.next !== "";
    cursor = more ? String(j.next) : "";
    if (!more) break;
  }
  let formulaNames;
  async function outputName(event) {
    const token = String(event.token);
    if (names.has(token)) return names.get(token);
    try {
      formulaNames ??= new Map((await s.json(`${SIM_SITE}/api/mainnet/formulas`)).formulas.map((f) => [String(f.id), String(f.outputName || "").toUpperCase()]));
      const receipt = await s.rpc("eth_getTransactionReceipt", [event.hash]);
      for (const log of receipt?.logs || []) {
        let parsed;
        try { parsed = COLLAPSE_LOG.parseLog(log); } catch { continue; }
        if (parsed && String(parsed.args.output) === token) return formulaNames.get(String(parsed.args.formulaId)) || "";
      }
    } catch { /* an unnamed output stays unread rather than being guessed */ }
    return "";
  }
  const counts = new Map();
  let unread = 0;
  for (const event of events) {
    const name = await outputName(event);
    if (!name) { unread++; continue; }
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const times = events.map((e) => Number.isFinite(Number(e.timestamp)) ? new Date(Number(e.timestamp)).toISOString() : null).filter(Boolean).sort();
  const sortRows = (map) => [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    ok: true,
    counted: events.length,
    matched: events.length - unread,
    unread,
    pages,
    capped: events.length >= 200 || more || ids.some((id) => !names.has(id)),
    counts: sortRows(counts),
    newestAt: times.at(-1) || null,
    oldestAt: times[0] || null,
    source,
    note: "Newest collapse rows in SIM's public activity feed, matched to TYPE names in SIM's public gallery. These are outputs created by collapses, not items burned; this is a recent sample, not a lifetime total.",
  };
}

export async function readRuleChanges(s, { block, oldBlock }) {
  if (oldBlock == null) return { ok: false, error: "Historical recipe baseline unavailable" };
  return settled(async () => {
    const [[count], [oldCount], [fee], [oldFee], [renderer]] = await Promise.all([
      s.call("formulaCount", [], block), s.call("formulaCount", [], hex(oldBlock)),
      s.call("collapseFee", [], block), s.call("collapseFee", [], hex(oldBlock)), s.call("renderer", [], block),
    ]);
    const added = [];
    const maximum = count < oldCount + 8n ? count : oldCount + 8n;
    for (let id = oldCount + 1n; id <= maximum; id++) {
      const f = await s.formula(id, block);
      const names = await Promise.all(f.outputTypes.map((type) => s.typeName(type, renderer, block)));
      added.push({ id: String(id), quantity: f.quantity, active: f.active, outputs: names });
    }
    return { fromBlock: oldBlock, toBlock: integer(block), previousCount: integer(oldCount), currentCount: integer(count), added,
      addedCapped: count > maximum, feeEth: formatEther(fee), previousFeeEth: formatEther(oldFee), feeChanged: fee !== oldFee };
  });
}
