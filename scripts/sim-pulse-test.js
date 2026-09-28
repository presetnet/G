// Run: node --test scripts/sim-pulse-test.js. Fixtures perform no network I/O.
import test from "node:test";
import assert from "node:assert/strict";
import { Interface, parseEther } from "ethers";
import { SIM_ABI, SIM_CONTRACT, createCollapseReader } from "../server/sim-collapse.js";
import { SEAPORT, WETH, SUPPLY_TARGET, SEAPORT_ABI, buildSupplyPulse, supplyWindow, decodeSeaportSales, saleStats } from "../server/sim-pulse.js";
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

function fixture() {
  const calls = [];
  const fetchImpl = async (url, init) => {
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
  assert.equal(pulse.current, 6387);
  assert.equal(pulse.remaining, 387);
  assert.equal(pulse.burnedLifetime, 11070 - 6387);
  assert.deepEqual(pulse.windows.map((w) => w.ok), [true, true, false]);
  assert.equal(pulse.windows[1].burned, 236);
  assert.equal(pulse.projection.basis, "6h");
  assert.ok(pulse.shortProjection.at !== pulse.projection.at);
  assert.equal(pulse.paceUnstable, true, "13/h against 33/h is not a stable pace");
  assert.throws(() => buildSupplyPulse(sample(9000, 1, 6387, 100), []), /disagree/);
  const flat = buildSupplyPulse(now, [{ ok: true, label: "6h", sample: sample(7200, 12 * 7200, 6387, 11070) }]);
  assert.equal(flat.projection, null, "a flat supply gets no date");
  const below = buildSupplyPulse(sample(9000, 12 * 9000, 5900, 11070), []);
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
test("pulse view reads supply, verified sales, and recipe changes, and caches a success", async () => {
  const { reader, calls } = fixture();
  const p = await reader.pulse();
  assert.equal(p.supply.ok, true);
  assert.equal(p.supply.current, 6387);
  assert.equal(p.supply.remaining, 387);
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
test("API rejects an unknown view instead of silently serving recipes", async () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "GET", query: { view: "everything" } }, res);
  assert.equal(res.code, 400);
  assert.match(res.body.error, /view=pulse/);
  assert.equal(res.headers["Cache-Control"], "no-store");
});
