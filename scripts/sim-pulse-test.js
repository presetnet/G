// Run: node --test scripts/sim-pulse-test.js. Fixtures perform no network I/O.
import test from "node:test";
import assert from "node:assert/strict";
import { Interface, parseEther } from "ethers";
import { SIM_ABI, SIM_CONTRACT, createCollapseReader } from "../server/sim-collapse.js";
import { SEAPORT, WETH, SUPPLY_TARGET, SEAPORT_ABI, VOID_ETH, POOL_VOID, VOID_VAULTS, buildSupplyPulse, supplyWindow, decodeSeaportSales, saleStats, readSalesPulse, burnTypeName, summarizeVoidMix, readVoidMix, readVoidVaults, readVoidOutputs } from "../server/sim-pulse.js";
import { supplyCard, marketCard, voidCard, voidOutputCard, nonPrimitiveTypes, leftText } from "../public/sim-collapse.js";
import handler from "../api/sim-collapse.js";

const RENDERER = "0x2222222222222222222222222222222222222222";
const RENDERER_ABI = new Interface(["function name(uint256) view returns (string)"]);
const ZERO = "0x0000000000000000000000000000000000000000";
const OTHER = "0x3333333333333333333333333333333333333333";
const SELLER = "0x4444444444444444444444444444444444444444";
const SELLER2 = "0x5555555555555555555555555555555555555555";
const BUYER = "0x6666666666666666666666666666666666666666";
const BUYER2 = "0x7777777777777777777777777777777777777777";
const USDC = "0x0000000000000000000000000000000000000008";
const USDC_ITEM = "0x3333333333333333333333333333333333333333";
const NOW = 9000;
const TX_ASK = "0x" + "1".repeat(64);
const TX_BID = "0x" + "2".repeat(64);
const TX_PLAIN = "0x" + "3".repeat(64);
const TX_BUNDLE = "0x" + "4".repeat(64);
const TX_STABLE = "0x" + "5".repeat(64);
const HASH_A = "0x" + "a".repeat(64);
const HASH_B = "0x" + "b".repeat(64);
const TYPE_NAMES = ["", "UNREAL", "UNSEEN", "UNDO", "UNHOLY", "UNKNOWN", "UNNATURAL", "UNREALITY", "UNDEFINED", "BURNED", "VOID", "MIND", "ENIGMA", "EN1GMA", "DESCENT", "FRACTURE", "OVERDO", "STATIC"];
const BASE = [1, 2, 3, 4, 5, 6, 7, 8];
const FORMULAS = {
  1: [0, 6, BASE, [], [9], [1], true], 2: [0, 12, BASE, [], [3], [1], false], 3: [0, 12, BASE, [], [10], [1], true],
  4: [1, 6, [8], [], [11], [1], true], 5: [1, 6, [8], [], [11], [1], false], 6: [1, 18, BASE, [], [12], [1], false],
  7: [0, 24, BASE, [], [13], [1], true], 8: [1, 4, BASE, [], [14], [1], true], 9: [0, 2, BASE, [], [15], [1], true],
  10: [1, 6, [3], [], [16], [1], true], 11: [0, 12, BASE, [], [17], [1], true],
};
const SUPPLY = { 9000: [6387, 11071], 8700: [6400, 11066], 7200: [6586, 11034], 1800: [7361, 10847] };
const sample = (block, timestamp, supply, minted) => ({ block, timestamp, supply, minted });
const blockHash = (n) => "0x" + n.toString(16).padStart(64, "0");
const hex = (n) => `0x${BigInt(n).toString(16)}`;
const transfer = (id, from, to) => ({ address: SIM_CONTRACT, ...SIM_ABI.encodeEventLog(SIM_ABI.getEvent("Transfer"), [from, to, id]) });
const fulfilled = (args) => ({ address: SEAPORT, ...SEAPORT_ABI.encodeEventLog(SEAPORT_ABI.getEvent("OrderFulfilled"), args) });
const nftItem = (token, identifier, amount = 1n) => ({ itemType: 2, token, identifier, amount });
const quote = (token, amount, recipient = ZERO) => ({ itemType: 0, token, identifier: 0n, amount, recipient });
const askSale = (hash, offerer, recipient, identifier, amount, itemType, token) => fulfilled([hash, offerer, ZERO, recipient,
  [nftItem(SIM_CONTRACT, identifier)],
  [{ ...quote(token, amount), itemType, recipient }]]);
const bidSale = (hash, seller, buyer, identifier, amount, itemType, token) => fulfilled([hash, seller, ZERO, seller,
  [{ itemType, token, identifier: 0n, amount }], [{ ...nftItem(SIM_CONTRACT, identifier), recipient: buyer }]]);
const receipt = (hash, block, logs) => ({ transactionHash: hash, blockNumber: hex(block), blockHash: blockHash(block), status: "0x1", logs });
const RECEIPTS = {
  [TX_ASK]: receipt(TX_ASK, 8800, [transfer(500n, SELLER, BUYER), askSale(HASH_A, SELLER, BUYER, 500n, 4288000000000000n, 0, ZERO)]),
  [TX_BID]: receipt(TX_BID, 8700, [transfer(601n, SELLER2, BUYER2), bidSale(HASH_B, SELLER2, BUYER2, 601n, 3300000000000000n, 1, WETH)]),
  [TX_PLAIN]: receipt(TX_PLAIN, 8790, [transfer(600n, BUYER, OTHER)]),
  [TX_BUNDLE]: receipt(TX_BUNDLE, 8780, [transfer(500n, SELLER, BUYER), transfer(501n, SELLER, BUYER),
    fulfilled([HASH_A, SELLER, ZERO, BUYER, [nftItem(SIM_CONTRACT, 500n), nftItem(SIM_CONTRACT, 501n)], [quote(ZERO, parseEther("0.01"), BUYER)]])]) ,
  [TX_STABLE]: receipt(TX_STABLE, 8770, [transfer(602n, SELLER, BUYER),
    askSale(HASH_B, SELLER, BUYER, 602n, 1000000n, 3, USDC_ITEM)]),
};
const feed = [
  { block_number: "8800", from: { hash: SELLER }, to: { hash: BUYER }, token: { address_hash: SIM_CONTRACT }, transaction_hash: TX_ASK },
  { block_number: "8700", from: { hash: SELLER2 }, to: { hash: BUYER2 }, token: { address_hash: SIM_CONTRACT }, transaction_hash: TX_BID },
  { block_number: "8790", from: { hash: BUYER }, to: { hash: OTHER }, token: { address_hash: SIM_CONTRACT }, transaction_hash: TX_PLAIN },
  { block_number: "8780", from: { hash: SELLER }, to: { hash: BUYER }, token: { address_hash: SIM_CONTRACT }, transaction_hash: TX_BUNDLE },
  { block_number: "8770", from: { hash: SELLER }, to: { hash: BUYER }, token: { address_hash: SIM_CONTRACT }, transaction_hash: TX_STABLE },
  { block_number: "8760", from: { hash: BUYER }, to: { hash: OTHER }, token: { address_hash: OTHER }, transaction_hash: TX_ASK },
  { block_number: "8750", from: { hash: ZERO }, to: { hash: BUYER }, token: { address_hash: SIM_CONTRACT }, transaction_hash: TX_BID },
];
const vaultTransfer = (id, name, from, at, tx, to = POOL_VOID) => ({
  block_number: "8800", timestamp: at, transaction_hash: tx, log_index: 2,
  from: { hash: from }, to: { hash: to }, token: { address_hash: SIM_CONTRACT },
  total: { token_id: id, token_instance: { metadata: { name,
    image: `https://sim.tech/api/nft-thumbnail/1/${SIM_CONTRACT}/${id}`,
    attributes: [{ trait_type: "TYPE", value: name }] } } },
});
const voidEthFeed = [
  vaultTransfer("7001", "FRACTURE", SELLER, "2026-11-15T17:42:47.000000Z", HASH_B, VOID_ETH),
  vaultTransfer("5003", "UNREAL", BUYER, "2026-11-14T12:41:59.000000Z", TX_PLAIN, VOID_ETH),
];
const voidFeed = [
  vaultTransfer("5001", "STATIC", SELLER, "2026-11-12T06:09:35.000000Z", HASH_A),
  vaultTransfer("5002", "MATRIX", SELLER2, "2026-10-28T05:53:23.000000Z", HASH_B),
  vaultTransfer("11527", "INTERFERENCE", BUYER, "2026-11-16T23:45:47.000000Z", TX_PLAIN),
  { ...vaultTransfer("11600", "MATRIX", BUYER2, "2026-11-18T00:00:00Z", TX_ASK), to: { hash: OTHER } },
  { ...vaultTransfer("11601", "MATRIX", BUYER2, "2026-11-18T00:00:00Z", TX_BID), token: { address_hash: OTHER } },
  { ...vaultTransfer("11602", "MATRIX", ZERO, "2026-11-18T00:00:00Z", TX_STABLE) },
];

function fixture() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (url.startsWith("https://sim.tech/api/mainnet/social")) {
      calls.push({ social: url });
      return { ok: true, json: async () => ({ activity: [
        { kind: "collapse", address: SELLER, name: "cdcommie.eth", token: "5001", timestamp: 1795068239000 },
        { kind: "collapse", address: SELLER2, name: "poolvoid.eth", token: "5002", timestamp: 1795068240000 },
        { kind: "collapse", address: BUYER, name: "dizyd.eth", token: "5003", timestamp: 1795068241000 },
      ] }) };
    }
    if (url.startsWith("https://sim.tech/api/mainnet/gallery")) {
      calls.push({ gallery: url });
      return { ok: true, json: async () => ({ items: [
        { id: "5001", name: "STATIC" }, { id: "5002", name: "MATRIX" }, { id: "5003", name: "UNREAL" },
      ], next: null }) };
    }
    if (url.includes(`/addresses/${VOID_ETH}/token-transfers`)) {
      calls.push({ vault: url });
      return { ok: true, json: async () => ({ items: voidEthFeed, next_page_params: null }) };
    }
    if (url.includes(`/addresses/${POOL_VOID}/token-transfers`)) {
      calls.push({ vault: url });
      return { ok: true, json: async () => ({ items: voidFeed, next_page_params: null }) };
    }
    if (url.includes("blockscout")) {
      calls.push({ explorer: url });
      return { ok: true, json: async () => ({ items: feed, next_page_params: null }) };
    }
    const { method, params } = JSON.parse(init.body);
    calls.push({ method, params });
    const success = (result) => ({ ok: true, json: async () => ({ result }) });
    if (method === "eth_chainId") return success("0x1");
    if (method === "eth_blockNumber") return success(hex(NOW));
    if (method === "eth_getTransactionReceipt") {
      const found = RECEIPTS[params[0]];
      if (!found) throw new Error(`Unstubbed receipt: ${params[0]}`);
      return success(found);
    }
    if (method === "eth_getBlockByNumber") {
      const n = Number(BigInt(params[0]));
      return success({ number: hex(n), timestamp: hex(n * 12), hash: blockHash(n), transactions: [] });
    }
    assert.equal(method, "eth_call");
    const [request, block] = params;
    const renderer = request.to.toLowerCase() === RENDERER;
    const abi = renderer ? RENDERER_ABI : SIM_ABI;
    const parsed = abi.parseTransaction({ data: request.data });
    const id = parsed.args.length ? parsed.args[0] : null;
    const at = Number(BigInt(block));
    let values;
    switch (parsed.name) {
      case "totalSupply": values = [SUPPLY[at][0]]; break;
      case "nextTokenId": values = [SUPPLY[at][1]]; break;
      case "formulaCount": values = [at >= NOW ? 11n : 9n]; break;
      case "collapseFee": values = [2000000000000000n]; break;
      case "renderer": values = [RENDERER]; break;
      case "getTypeFormula": values = [FORMULAS[Number(id)]]; break;
      case "name": values = [TYPE_NAMES[Number(id)]]; break;
      case "tokenCategory": values = [{ 500: 8, 601: 10, 602: 10 }[Number(id)] ?? 1n]; break;
      default: throw new Error("Unstubbed call: " + parsed.name);
    }
    return success(abi.encodeFunctionResult(parsed.name, values));
  };
  return { reader: createCollapseReader({ fetchImpl, rpcUrls: ["https://rpc.test"] }), calls };
}

test("supply window reports gross activity so mints cannot hide or fake a burn pace", () => {
  const now = sample(9000, 12 * 9000, 6387, 11070);
  const w = supplyWindow(now, sample(8700, 12 * 8700, 6400, 11065), "1h");
  assert.equal(w.minted, 5); assert.equal(w.netReduction, 13); assert.equal(w.burned, 18);
  assert.equal(w.netPerHour, 13);
  assert.throws(() => supplyWindow(now, sample(8700, 12 * 9000, 6400, 11065), "1h"), /precede/);
  assert.throws(() => supplyWindow(now, sample(8700, 12 * 8700, 6400, 11080), "1h"), /disagree/);
  const minting = supplyWindow(now, sample(8700, 12 * 8700, 6300, 10900), "1h");
  assert.equal(minting.netPerHour, -87, "a net increase is negative, not clamped to zero");
  assert.equal(minting.burned, 83);
  assert.throws(() => supplyWindow(now, sample(8700, 12 * 8700, 6300, 11065), "1h"), /disagree/,
    "supply cannot rise faster than mints on a contract that only mints and burns");
});
test("supply pulse projects only above-target gaps, labels an unstable pace, and never invents a date", () => {
  const now = sample(9000, 12 * 9000, 6387, 11070);
  const pulse = buildSupplyPulse(now, [
    { ok: true, label: "1h", sample: sample(8700, 12 * 8700, 6400, 11065) },
    { ok: true, label: "6h", sample: sample(7200, 12 * 7200, 6586, 11033) },
    { ok: false, label: "24h", error: "pruned" },
  ]);
  assert.equal(pulse.target, SUPPLY_TARGET);
  assert.equal(pulse.target, 4500, "the user's current watch target must reach the API");
  assert.equal(pulse.current, 6387);
  assert.equal(pulse.remaining, 1887);
  assert.equal(pulse.burnedLifetime, 11070 - 6387);
  assert.deepEqual(pulse.windows.map((w) => w.ok), [true, true, false]);
  assert.equal(pulse.windows[1].burned, 236);
  assert.equal(pulse.projection.basis, "6h");
  assert.ok(pulse.shortProjection.at !== pulse.projection.at);
  assert.equal(pulse.paceUnstable, true, "13/h against 33/h is not a stable pace");
  assert.throws(() => buildSupplyPulse(sample(9000, 1, 6387, 100), []), /disagree/);
  const flat = buildSupplyPulse(now, [{ ok: true, label: "6h", sample: sample(7200, 12 * 7200, 6387, 11070) }]);
  assert.equal(flat.projection, null, "a flat supply gets no date");
  const below = buildSupplyPulse(sample(9000, 12 * 9000, 4400, 11070), []);
  assert.equal(below.remaining, 0); assert.equal(below.state, "below");
});
test("Seaport fills are priced from the order, and every unsupported shape is skipped with a reason", () => {
  const ask = decodeSeaportSales(RECEIPTS[TX_ASK], SIM_CONTRACT);
  assert.equal(ask.sales.length, 1);
  assert.equal(ask.sales[0].amountEth, "0.004288");
  assert.equal(ask.sales[0].currency, "ETH");
  assert.equal(ask.sales[0].tokenId, "500");
  const bid = decodeSeaportSales(RECEIPTS[TX_BID], SIM_CONTRACT);
  assert.equal(bid.sales[0].amountEth, "0.0033");
  assert.equal(bid.sales[0].currency, "WETH");
  assert.equal(decodeSeaportSales(RECEIPTS[TX_BUNDLE], SIM_CONTRACT).skipped.multi, 1);
  assert.equal(decodeSeaportSales(RECEIPTS[TX_BUNDLE], SIM_CONTRACT).sales.length, 0, "a bundle total is never divided into per-token prices");
  assert.equal(decodeSeaportSales(RECEIPTS[TX_STABLE], SIM_CONTRACT).skipped.currency, 1, "an ERC20-denominated fill has no comparable ETH price");
  assert.equal(decodeSeaportSales(RECEIPTS[TX_STABLE], SIM_CONTRACT).sales.length, 0);
  assert.equal(decodeSeaportSales(RECEIPTS[TX_PLAIN], SIM_CONTRACT).sales.length, 0);
  assert.equal(decodeSeaportSales(receipt(TX_PLAIN, 8790, [transfer(600n, BUYER, OTHER)]), OTHER).sales.length, 0, "another collection is ignored");
  const foreign = receipt(TX_ASK, 8800, [transfer(500n, SELLER, BUYER), fulfilled([HASH_A, SELLER, ZERO, BUYER, [nftItem(OTHER, 500n)], [quote(ZERO, parseEther("0.01"), BUYER)]])]);
  assert.equal(decodeSeaportSales(foreign, SIM_CONTRACT).sales.length, 0);
  const half = receipt(TX_ASK, 8800, [askSale(HASH_A, SELLER, BUYER, 500n, 4288000000000000n, 0, ZERO)]);
  assert.equal(decodeSeaportSales(half, SIM_CONTRACT).skipped.transfer, 1, "no matching transfer is not a verified sale");
  const third = receipt(TX_ASK, 8800, [transfer(500n, OTHER, BUYER), askSale(HASH_A, SELLER, BUYER, 500n, 4288000000000000n, 0, ZERO)]);
  assert.equal(decodeSeaportSales(third, SIM_CONTRACT).skipped.transfer, 1, "a transfer from a third party is not the order offerer");
  const twice = receipt(TX_ASK, 8800, [transfer(500n, SELLER, BUYER), askSale(HASH_A, SELLER, BUYER, 500n, 4288000000000000n, 0, ZERO), askSale(HASH_A, SELLER, BUYER, 500n, 4288000000000000n, 0, ZERO)]);
  assert.equal(decodeSeaportSales(twice, SIM_CONTRACT).sales.length, 1, "one NFT, one price");
  assert.throws(() => decodeSeaportSales({ ...RECEIPTS[TX_ASK], status: "0x0" }, SIM_CONTRACT), /not successful/);
  assert.throws(() => decodeSeaportSales({ ...RECEIPTS[TX_ASK], logs: new Array(5001).fill({}) }, SIM_CONTRACT), /log limit/);
});
test("paid-price stats use a real median and never invent a floor", () => {
  const wei = (eth) => parseEther(eth).toString();
  const two = [{ amountWei: wei("0.004288") }, { amountWei: wei("0.0033") }];
  const three = [...two, { amountWei: wei("0.02") }];
  assert.equal(saleStats([]), null);
  assert.equal(saleStats(two).medianEth, "0.003794", "even counts average the middle pair");
  assert.equal(saleStats(three).medianEth, "0.004288");
  assert.equal(saleStats(three).lowEth, "0.0033");
  assert.equal(saleStats(three).highEth, "0.02");
  assert.equal(saleStats(three).count, 3);
  assert.equal(Object.keys(saleStats(three)).includes("floor"), false, "a paid sample is not a floor");
});
test("void mix reads TYPE from burned token metadata and keeps the sample bounded", async () => {
  const burn = (id, name, at) => ({
    block_number: "8800", timestamp: at, transaction_hash: `0xburn${id}`, log_index: 1,
    from: { hash: SELLER }, to: { hash: ZERO }, token: { address_hash: SIM_CONTRACT },
    total: { token_id: id, token_instance: { metadata: { name, attributes: [{ trait_type: "TYPE", value: name }] } } },
  });
  const rows = [burn("1", "STATIC", "2026-11-19T01:00:00Z"), burn("2", "MATRIX", "2026-11-19T02:00:00Z"), burn("3", "STATIC", "2026-11-19T03:00:00Z")];
  const urls = [];
  const first = { items: [rows[0], rows[1], { ...rows[0] }, { ...rows[0], from: { hash: ZERO }, to: { hash: SELLER } }, { ...rows[0], token: { address_hash: OTHER } }], next_page_params: { block_number: 8700, index: 1 } };
  const mix = await readVoidMix({ json: async (url) => { urls.push(url); return urls.length === 1 ? first : { items: [rows[2]], next_page_params: null }; } },
    { contract: SIM_CONTRACT, maxPages: 3, maxBurns: 10 });
  assert.equal(mix.counted, 3, "mints, other collections, and duplicate receipts are excluded");
  assert.deepEqual(mix.counts, [{ name: "STATIC", count: 2 }, { name: "MATRIX", count: 1 }]);
  assert.equal(mix.pages, 2);
  assert.equal(mix.capped, false);
  assert.equal(mix.newestAt, "2026-11-19T03:00:00Z");
  assert.match(urls[1], /block_number=8700/);
  assert.match(mix.note, /not a lifetime burn count/);
  assert.equal(burnTypeName({ total: { token_instance: { metadata: { attributes: [{ trait_type: "other", value: "x" }], name: "void" } } } }), "VOID");
  assert.equal(burnTypeName({}), "TYPE UNREAD");
  const capped = await readVoidMix({ json: async () => ({ items: [rows[0]], next_page_params: { more: 1 } }) }, { contract: SIM_CONTRACT, maxPages: 1, maxBurns: 1 });
  assert.equal(capped.capped, true);
  await assert.rejects(readVoidMix({ json: async () => ({ items: null }) }, { contract: SIM_CONTRACT }), /unavailable/);
});
test("void vaults read both ENS destinations with unique tokens, TYPEs, and sender labels", async () => {
  const urls = [];
  let voidEthPages = 0;
  const s = { json: async (url) => {
    urls.push(url);
    if (url.includes("/api/mainnet/social")) return { activity: [{ address: SELLER, name: "cdcommie.eth" }] };
    if (url.includes(`/addresses/${VOID_ETH}/`)) {
      voidEthPages++;
      return voidEthPages === 1
        ? { items: [voidEthFeed[0], voidEthFeed[0], { ...voidEthFeed[0], to: { hash: OTHER } }, { ...voidEthFeed[0], token: { address_hash: OTHER } }], next_page_params: { block_number: 8700, index: 1 } }
        : { items: [voidEthFeed[1]], next_page_params: null };
    }
    return { items: voidFeed, next_page_params: null };
  } };
  const p = await readVoidVaults(s, { contract: SIM_CONTRACT, maxPages: 3 });
  assert.equal(p.counted, 5, "outgoing transfers, other tokens, mints, duplicates and other vaults are excluded");
  assert.deepEqual(p.vaults.map((v) => [v.label, v.counted]), [["void.eth", 2], ["poolvoid.eth", 3]]);
  assert.deepEqual(p.counts, [
    { name: "FRACTURE", count: 1 }, { name: "INTERFERENCE", count: 1 }, { name: "MATRIX", count: 1 },
    { name: "STATIC", count: 1 }, { name: "UNREAL", count: 1 },
  ]);
  assert.equal(p.senderCount, 3);
  assert.equal(p.capped, false);
  assert.equal(p.tokens[0].tokenId, "7001");
  assert.equal(p.tokens[0].from, "cdcommie.eth", "SIM activity labels the sender");
  assert.equal(p.tokens[0].vault, "void.eth");
  assert.equal(p.tokens[0].image, `https://sim.tech/api/nft-thumbnail/1/${SIM_CONTRACT}/7001`);
  assert.equal(p.newestAt, "2026-11-16T23:45:47.000000Z");
  assert.match(urls[1], new RegExp(`/addresses/${VOID_ETH}/token-transfers`));
  assert.match(urls[2], /block_number=8700/);
  assert.match(urls[3], new RegExp(`/addresses/${POOL_VOID}/token-transfers`));
  assert.deepEqual(VOID_VAULTS.map((v) => v.label), ["void.eth", "poolvoid.eth"]);
  assert.match(p.note, /void.eth and poolvoid.eth/);
  assert.match(p.note, /not zero-address burns/);
  const capped = await readVoidVaults({ json: async (url) => url.includes("/social")
    ? { activity: [] } : { items: [voidFeed[0]], next_page_params: { more: 1 } } },
    { contract: SIM_CONTRACT, vaults: [VOID_VAULTS[1]], maxPages: 1, maxRows: 1 });
  assert.equal(capped.capped, true);
  await assert.rejects(readVoidVaults({ json: async (url) => url.includes("/social") ? { activity: [] } : { items: null } },
    { contract: SIM_CONTRACT, vaults: [VOID_VAULTS[1]] }), /unavailable/);
});
test("the void card states its source and sample limits, and an outage is never zero burns", () => {
  const mix = summarizeVoidMix([{ name: "STATIC", at: "2026-11-19T01:00:00Z" }, { name: "MATRIX", at: "2026-11-19T02:00:00Z" }, { name: "STATIC", at: "2026-11-19T03:00:00Z" }],
    { pages: 1, source: "https://eth.blockscout.com/api/v2/tokens/x/transfers", note: "Recent sample, not a lifetime total or proof of permanent loss." });
  const types = { 1: "UNREAL", 8: "UNDEFINED", 9: "BURNED", 10: "VOID", 14: "DESCENT", 17: "STATIC", 20: "MATRIX", 22: "INTERFERENCE", bad: "x", 23: "" };
  assert.deepEqual(nonPrimitiveTypes(types), [
    { id: "9", name: "BURNED" }, { id: "10", name: "VOID" }, { id: "14", name: "DESCENT" },
    { id: "17", name: "STATIC" }, { id: "20", name: "MATRIX" }, { id: "22", name: "INTERFERENCE" },
  ]);
  const html = voidCard({ ok: true, ...mix }, types, "https://etherscan.io/address/x#readContract");
  assert.match(html, /Zero-address burns/);
  assert.match(html, /<b>3<\/b> burn receipts/);
  assert.match(html, /Non-primitive TYPEs \(6\)/);
  assert.match(html, /title="TYPE 20">MATRIX/);
  assert.match(html, /title="TYPE 22">INTERFERENCE/);
  assert.match(html, /no counts are implied/);
  assert.match(html, /contract read/);
  assert.doesNotMatch(html, /title="TYPE 1">UNREAL/);
  assert.match(html, /not a lifetime total/);
  assert.match(html, /burn feed/);
  const unavailable = voidCard({ ok: false, error: "Explorer offline" }, types);
  assert.match(unavailable, /Burn sample unavailable: Explorer offline/);
  assert.match(unavailable, /Non-primitive TYPEs \(6\)/);
  assert.doesNotMatch(unavailable, /burn receipts/);
});
test("collapse output breakdown follows SIM activity names and stays a recent sample", async () => {
  const urls = [];
  const s = { json: async (url) => {
    urls.push(url);
    if (url.includes("/social")) return { activity: [
      { kind: "collapse", token: "1", timestamp: 1795068239000 },
      { kind: "collapse", token: "2", timestamp: 1795068240000 },
      { kind: "collapse", token: "1", timestamp: 1795068241000 },
      { kind: "sale", token: "3" },
    ] };
    if (url.includes("/gallery")) return url.includes("cursor=2")
      ? { items: [{ id: "2", name: "matrix" }], next: null }
      : { items: [{ id: "1", name: "STATIC" }], next: "2" };
    throw new Error("unexpected URL");
  } };
  const o = await readVoidOutputs(s, { maxPages: 3 });
  assert.equal(o.counted, 3, "non-collapse activity is ignored");
  assert.equal(o.matched, 3);
  assert.equal(o.unread, 0);
  assert.equal(o.pages, 2);
  assert.deepEqual(o.counts, [{ name: "STATIC", count: 2 }, { name: "MATRIX", count: 1 }]);
  assert.deepEqual(o.tokenIds, ["1", "2"], "exact output IDs are shipped for void-pool matching");
  assert.equal("voided" in o, false, "voided counts come from matched token IDs, not gallery absence");
  assert.match(urls[2], /cursor=2/);
  assert.match(o.note, /outputs created by collapses, not items burned/);
  const partial = await readVoidOutputs({ json: async (url) => url.includes("/social")
    ? { activity: [{ kind: "collapse", token: "9" }] } : { items: [], next: null } }, { maxPages: 1 });
  assert.equal(partial.unread, 1, "unnamed outputs are reported, not guessed");
  assert.equal(partial.capped, true);
  await assert.rejects(readVoidOutputs({ json: async () => ({ activity: null }) }), /activity feed unavailable/);
});
test("unnamed collapse output is still named from its receipt formula", async () => {
  const collapse = new Interface(["event Collapsed(uint256 indexed formulaId,uint256 indexed output,uint256[] inputs)"]);
  const encoded = collapse.encodeEventLog(collapse.getEvent("Collapsed"), [14n, 700n, []]);
  const o = await readVoidOutputs({
    json: async (url) => url.includes("/social") ? { activity: [{ kind: "collapse", token: "700", hash: "0xdead", timestamp: 1795068239000 }] }
      : url.includes("/gallery") ? { items: [], next: null }
        : { formulas: [{ id: "14", outputName: "MATRIX" }] },
    rpc: async () => ({ logs: [{ address: SIM_CONTRACT, ...encoded }] }),
  }, { maxPages: 1 });
  assert.equal(o.counted, 1);
  assert.deepEqual(o.counts, [{ name: "MATRIX", count: 1 }]);
  assert.deepEqual(o.tokenIds, ["700"]);
  assert.equal(o.unread, 0);
  assert.equal("voided" in o, false);
});
test("the collapse card ranks TYPEs by void percentage, with art thumbnails and subset clarity", () => {
  const made = { ok: true, counted: 200, matched: 200, unread: 0, pages: 9, capped: true,
    counts: [
      { name: "MATRIX", count: 79 }, { name: "QUANTUM", count: 29 }, { name: "WAVE", count: 23 },
      { name: "FRACTURE", count: 22 }, { name: "INTERFERENCE", count: 15 }, { name: "SINK", count: 13 },
      { name: "DESCENT", count: 8 }, { name: "STATIC", count: 7 }, { name: "OVERDO", count: 4 },
    ],
    tokenIds: ["11378", "11375", "11486", "11488", "11358", "11526", "11522", "11492"],
    newestAt: "2026-11-19T06:03:59.000Z", source: "https://sim.tech/api/mainnet/social",
    note: "Outputs created by collapses, not items burned; recent sample." };
  const thumb = (id) => `https://sim.tech/api/nft-thumbnail/1/${SIM_CONTRACT}/${id}`;
  const vaults = { ok: true, counted: 451, capped: false,
    vaults: [{ label: "void.eth", counted: 394 }, { label: "poolvoid.eth", counted: 57 }],
    tokens: [
      { tokenId: "11526", name: "INTERFERENCE", vault: "void.eth", image: thumb("11526"), at: "2026-11-15T17:42:47.000000Z", tx: HASH_B },
      { tokenId: "11522", name: "SINK", vault: "void.eth", image: thumb("11522"), at: "2026-11-14T12:41:59.000000Z", tx: TX_PLAIN },
      { tokenId: "11492", name: "WAVE", vault: "void.eth", image: thumb("11492"), at: "2026-11-14T12:41:59.000000Z", tx: TX_ASK },
      { tokenId: "11378", name: "MATRIX", vault: "poolvoid.eth", image: thumb("11378"), at: "2026-11-12T06:09:35.000000Z", tx: HASH_A },
      { tokenId: "11375", name: "MATRIX", vault: "poolvoid.eth", image: thumb("11375"), at: "2026-11-12T06:09:35.000000Z", tx: HASH_A },
      { tokenId: "11486", name: "QUANTUM", vault: "poolvoid.eth", image: thumb("11486"), at: "2026-10-28T22:31:47.000000Z", tx: HASH_B },
      { tokenId: "11488", name: "STATIC", vault: "poolvoid.eth", image: thumb("11488"), at: "2026-10-28T05:53:23.000000Z", tx: TX_PLAIN },
      { tokenId: "11358", name: "MATRIX", vault: "poolvoid.eth", image: thumb("11358"), at: "2026-10-22T19:39:35.000000Z", tx: TX_ASK },
      { tokenId: "11527", name: "INTERFERENCE", vault: "poolvoid.eth", image: thumb("11527"), at: "2026-11-16T23:45:47.000000Z", tx: TX_BUNDLE },
      { tokenId: "9001", name: "UNREAL", vault: "void.eth", image: thumb("9001"), at: "2026-10-01T00:00:00.000000Z", tx: TX_ASK },
    ],
    newestAt: "2026-11-16T23:45:47.000000Z",
    sources: [{ label: "void.eth feed", url: `https://eth.blockscout.com/addresses/${VOID_ETH}/token-transfers` },
      { label: "poolvoid.eth feed", url: `https://eth.blockscout.com/addresses/${POOL_VOID}/token-transfers` }],
    note: "Incoming SIM transfers into void.eth and poolvoid.eth in a bounded explorer sample." };
  const types = { 1: "UNREAL", 2: "UNSEEN", 3: "UNDO", 4: "UNHOLY", 5: "UNKNOWN", 6: "UNNATURAL", 7: "UNREALITY", 8: "UNDEFINED",
    9: "FRACTURE", 10: "BURNED", 11: "VOID", 12: "DESCENT", 13: "MIND", 14: "MATRIX", 15: "QUANTUM", 16: "STATIC", 17: "WAVE", 18: "OVERDO", 19: "EN1GMA", 20: "INTERFERENCE", 21: "SINK" };
  const html = voidOutputCard(made, vaults, types);
  assert.match(html, /Created by collapse/);
  assert.match(html, /<b>200<\/b> newest collapse outputs sampled across <b>9<\/b> TYPEs/);
  assert.match(html, /<b>8<\/b> of those exact tokens now in void vaults/);
  assert.match(html, /<b>451<\/b> void tokens in both vault feeds/);
  assert.match(html, /void.eth <b>394<\/b>/);
  assert.match(html, /poolvoid.eth <b>57<\/b>/);
  assert.match(html, /Non-primitive inventory in both vaults · 6 TYPEs/);
  assert.match(html, /full vault history/);
  assert.match(html, /<b>9<\/b> non-primitive tokens · <b>1<\/b> original primitive tokens/);
  assert.match(html, /<b>MATRIX<\/b><i>3<\/i>/);
  assert.match(html, /no outgoing SIM transfers/i);
  assert.match(html, /subset of the <b>200<\/b> sampled outputs/);
  assert.match(html, /not current TYPE supply/);
  assert.match(html, /capped made sample/);
  assert.match(html, /void share of made/);
  assert.match(html, /<em>1<\/em>STATIC/);
  assert.match(html, /<strong>14\.3%<small>1 \/ 7 in void<\/small><\/strong>/);
  assert.match(html, /<em>2<\/em>SINK/);
  assert.match(html, /<em>3<\/em>INTERFERENCE/);
  assert.match(html, /<em>4<\/em>WAVE/);
  assert.match(html, /<em>5<\/em>MATRIX/);
  assert.match(html, /<strong>3\.8%<small>3 \/ 79 in void<\/small><\/strong>/);
  assert.match(html, /<em>7<\/em>FRACTURE/);
  assert.match(html, /<strong>0\.0%<small>0 \/ 22 in void<\/small><\/strong>/);
  assert.ok(html.indexOf("<em>1</em>STATIC") < html.indexOf("<em>2</em>SINK"), "rows are ordered by void percentage");
  assert.match(html, /#11378/);
  assert.match(html, /#11526/);
  assert.match(html, /<img src="https:\/\/sim\.tech\/api\/nft-thumbnail\/1\/[^"]+\/11378"/);
  assert.match(html, /void.eth feed/);
  assert.match(html, /poolvoid.eth feed/);
  assert.doesNotMatch(html, /#11527/, "a void token outside the made sample is excluded");
  assert.doesNotMatch(html, /sender/i, "wallet labels are not part of this card");
  assert.match(html, /void.eth and poolvoid.eth/);
  assert.match(html, /matches token IDs shared/);
  assert.match(voidOutputCard(made, { ok: false, error: "Explorer offline" }), /Void vault read failed: Explorer offline/);
  assert.match(voidOutputCard({ ok: false, error: "SIM offline" }), /Collapse-output sample unavailable: SIM offline/);
});
test("pulse view reads supply, verified sales, and recipe changes, and caches a success", async () => {
  const { reader, calls } = fixture();
  const p = await reader.pulse();
  assert.equal(p.supply.ok, true);
  assert.equal(p.supply.current, 6387);
  assert.equal(p.supply.remaining, 1887);
  assert.equal(p.supply.projection.basis, "6h");
  assert.equal(p.supply.paceUnstable, true);
  assert.equal("history" in p.supply, false, "historical samples are not shipped to the browser");
  assert.equal(p.market.ok, true);
  assert.equal(p.market.stats.count, 2);
  assert.equal(p.market.stats.medianEth, "0.003794");
  assert.equal(p.market.originals.count, 1);
  assert.equal(p.market.upgraded.count, 1);
  assert.equal(p.market.sales[0].name, "UNDEFINED", "sales are listed newest first with their TYPE");
  assert.equal(p.market.sales[0].block, 8800);
  assert.equal(p.market.sales[1].name, "VOID");
  assert.equal(p.market.skipped.multi, 1);
  assert.equal(p.market.skipped.currency, 1);
  assert.equal(p.market.skipped.noSupportedSale, 3, "a plain transfer, a bundle and an ERC20 fill yield no comparable sale");
  assert.equal(p.market.failures.length, 0);
  assert.equal(p.market.capped, false);
  assert.equal(p.market.inspectedTransactions, 5, "mints and other collections are filtered before receipt reads");
  assert.equal(p.voids.ok, true);
  assert.equal(p.voids.counted, 0, "the fixture has no zero-address burn transfers");
  assert.equal(p.voidVaults.ok, true);
  assert.equal(p.voidVaults.counted, 5, "only real transfers into the two void vaults count");
  assert.deepEqual(p.voidVaults.vaults.map((v) => v.label), ["void.eth", "poolvoid.eth"]);
  assert.deepEqual(p.voidVaults.counts, [
    { name: "FRACTURE", count: 1 }, { name: "INTERFERENCE", count: 1 }, { name: "MATRIX", count: 1 },
    { name: "STATIC", count: 1 }, { name: "UNREAL", count: 1 },
  ]);
  assert.equal(p.voidVaults.tokens.some((t) => t.from === "cdcommie.eth"), true);
  assert.equal(p.voidOutputs.ok, true);
  assert.equal(p.voidOutputs.counted, 3);
  assert.deepEqual(p.voidOutputs.counts, [{ name: "MATRIX", count: 1 }, { name: "STATIC", count: 1 }, { name: "UNREAL", count: 1 }]);
  assert.deepEqual(p.voidOutputs.tokenIds, ["5001", "5002", "5003"]);
  assert.equal(calls.some((c) => c.social), true);
  assert.equal(calls.some((c) => c.gallery), true);
  assert.equal(calls.some((c) => c.vault), true);
  assert.equal(p.market.recentStats.count, 2);
  assert.equal(p.market.latestSaleAt, new Date(8800 * 12 * 1000).toISOString());
  assert.equal(p.market.observedAt, new Date(NOW * 12 * 1000).toISOString());
  assert.equal(p.changes.ok, true);
  assert.equal(p.changes.previousCount, 9);
  assert.equal(p.changes.currentCount, 11);
  assert.deepEqual(p.changes.added.map((a) => a.outputs), [["OVERDO"], ["STATIC"]]);
  assert.equal(p.changes.feeChanged, false);
  assert.ok(p.changes.fromBlock < p.changes.toBlock);
  const before = calls.length;
  assert.equal((await reader.pulse()).cached, true);
  assert.equal(calls.length, before, "a cached pulse performs no reads");
  await reader.pulse({ fresh: true });
  assert.ok(calls.length > before);
  assert.equal(calls.filter((c) => c.explorer).length >= 1, true);
});
test("a supply read failure is reported without becoming a cached success", async () => {
  const { reader } = fixture();
  const broken = createCollapseReader({
    fetchImpl: async (url, init) => {
      if (url.includes("blockscout")) return { ok: true, json: async () => ({ items: [], next_page_params: null }) };
      const { method, params } = JSON.parse(init.body);
      const success = (result) => ({ ok: true, json: async () => ({ result }) });
      if (method === "eth_chainId") return success("0x1");
      if (method === "eth_blockNumber") return success(hex(NOW));
      if (method === "eth_getBlockByNumber") { const n = Number(BigInt(params[0])); return success({ number: hex(n), timestamp: hex(n * 12), hash: blockHash(n) }); }
      if (method === "eth_call" && !params[0].data.includes("a9059cbb")) {
        const parsed = SIM_ABI.parseTransaction({ data: params[0].data });
        if (parsed.name === "totalSupply") return { ok: true, json: async () => ({ error: { message: "execution reverted" } }) };
        return success(SIM_ABI.encodeFunctionResult(parsed.name, parsed.name === "renderer" ? [RENDERER] : [1n]));
      }
      return { ok: true, json: async () => ({ result: "0x" }) };
    },
    rpcUrls: ["https://rpc.test"],
  });
  const p = await broken.pulse();
  assert.equal(p.supply.ok, false);
  assert.ok(/reverted/.test(p.supply.error));
  assert.equal(p.market.ok, true, "a supply failure does not hide the market read");
  const again = await broken.pulse();
  assert.equal(again.cached, false, "a failed supply read is never served as a fresh success");
  await assert.rejects(() => reader.pulse({ fresh: true }).then(() => { throw new Error("expected the healthy reader to succeed"); }), /succeed/);
});
test("the rendered watch uses the API target, and an elapsed projection never claims a threshold crossing", () => {
  const supply = { ok: true, ...buildSupplyPulse(sample(9000, 108000, 5131, 11448), []) };
  const html = supplyCard(supply);
  assert.match(html, /Supply watch · 4,500 target/);
  assert.match(html, /631/);
  assert.doesNotMatch(html, /6,000/);
  assert.match(supplyCard({ ...supply, target: 4200 }), /4,200 target/, "labels follow the payload rather than a separate hardcoded target");
  assert.match(leftText("2000-01-01T00:00:00Z"), /Projection elapsed/);
  assert.doesNotMatch(leftText("2000-01-01T00:00:00Z"), /reached/);
});
test("old verified sales remain dated historical receipts, not fresh 24h prices", async () => {
  const market = await readSalesPulse({
    json: async () => ({ items: [feed[0]], next_page_params: null }),
    call: async (method) => method === "renderer" ? [RENDERER] : [8n],
    typeName: async () => "UNDEFINED",
    rpc: async (method, params) => method === "eth_getTransactionReceipt" ? RECEIPTS[TX_ASK]
      : { number: params[0], hash: RECEIPTS[TX_ASK].blockHash, timestamp: hex(params[0] === hex(NOW) ? 300000 : 100000) },
  }, { contract: SIM_CONTRACT, block: hex(NOW) });
  assert.equal(market.stats.count, 1);
  assert.equal(market.recentStats, null);
  const html = marketCard({ ok: true, ...market });
  assert.match(html, /historical prices, not a live quote/);
  assert.match(html, /Sale time/);
  assert.match(html, /Newest verified sale in this sample/);
});
test("receipt outages must not be displayed as an absence of sales", async () => {
  await assert.rejects(readSalesPulse({
    json: async () => ({ items: [feed[0]], next_page_params: null }),
    call: async () => [RENDERER],
    rpc: async () => { throw new Error("RPC unavailable"); },
  }, { contract: SIM_CONTRACT, block: hex(NOW) }), /receipts were unreadable/);
});
test("API rejects an unknown view instead of silently serving recipes", async () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "GET", query: { view: "everything" } }, res);
  assert.equal(res.code, 400);
  assert.match(res.body.error, /view=pulse/);
  assert.equal(res.headers["Cache-Control"], "no-store");
});
