// Run: node --test scripts/sim-collapse-test.js. Fixtures perform no network I/O.
import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { SIM_ABI, SIM_CONTRACT, createCollapseReader, parseLookup, predictTraits, unpackFormula, verifyCollapseReceipt } from "../server/sim-collapse.js";
import handler from "../api/sim-collapse.js";

const HOLDER = "0x1111111111111111111111111111111111111111";
const RENDERER = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";
const TX = "0x" + "a".repeat(64);
const BLOCK_HASH = "0x" + "b".repeat(64);
const INPUTS = [1n, 2n, 3n, 4n, 5n, 6n];
const OUTPUT = 1001n;
const R_ABI = new Interface(["function name(uint256) view returns (string)"]);
const TYPE_NAMES = ["", "UNREAL", "UNSEEN", "UNDO", "UNHOLY", "UNKNOWN", "UNNATURAL", "UNREALITY", "UNDEFINED", "BURNED", "VOID", "MIND", "ENIGMA", "EN1GMA", "DESCENT", "FRACTURE"];
const BASE_TYPES = [1, 2, 3, 4, 5, 6, 7, 8];
const FORMULAS = {
  1: [0, 6, BASE_TYPES, [], [9], [1], true],
  2: [0, 12, BASE_TYPES, [], [3], [1], false],
  3: [0, 12, BASE_TYPES, [], [10], [1], true],
  4: [1, 6, [8], [], [11], [1], true],
  5: [1, 6, [8], [], [11], [1], false],
  6: [1, 18, BASE_TYPES, [], [12], [1], false],
  7: [0, 24, BASE_TYPES, [], [13], [1], true],
  8: [1, 4, BASE_TYPES, [], [14], [1], true],
  9: [0, 2, BASE_TYPES, [], [15], [1], true],
};
function event(name, args, address = SIM_CONTRACT) {
  return { address, ...SIM_ABI.encodeEventLog(SIM_ABI.getEvent(name), args) };
}
function transaction() {
  return { hash: TX, from: HOLDER, to: SIM_CONTRACT, blockHash: BLOCK_HASH, value: "0x0", gasPrice: "0x3b9aca00",
    input: SIM_ABI.encodeFunctionData("collapse", [1, INPUTS]) };
}
function receipt() {
  return { transactionHash: TX, blockHash: BLOCK_HASH, blockNumber: "0x64", status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00",
    logs: [...INPUTS.map((id) => event("Transfer", [HOLDER, ZERO, id])), event("Transfer", [ZERO, HOLDER, OUTPUT]), event("Collapsed", [1, OUTPUT, INPUTS])] };
}
function fixture(options = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (url.includes("blockscout")) {
      calls.push({ explorer: url });
      return { ok: true, json: async () => ({ items: [{ from: { hash: ZERO }, token: { address_hash: SIM_CONTRACT }, total: { token_id: String(OUTPUT) }, transaction_hash: TX }], next_page_params: null }) };
    }
    const { method, params } = JSON.parse(init.body);
    calls.push({ method, params });
    const success = (result) => ({ ok: true, json: async () => ({ result }) });
    if (method === "eth_chainId") return success("0x1");
    if (method === "eth_blockNumber") return success("0x100");
    if (method === "eth_getTransactionByHash") return success(transaction());
    if (method === "eth_getTransactionReceipt") return success(receipt());
    assert.equal(method, "eth_call");
    const [request, block] = params;
    const isRenderer = request.to.toLowerCase() === RENDERER;
    const abi = isRenderer ? R_ABI : SIM_ABI;
    const parsed = abi.parseTransaction({ data: request.data });
    const id = parsed.args.length ? parsed.args[0] : null;
    if (options.archiveDown && parsed.name === "tokenCategory") throw new Error("historical state unavailable");
    let values;
    switch (parsed.name) {
      case "formulaCount": values = [9]; break;
      case "collapseFee": values = [2000000000000000n]; break;
      case "renderer": values = [RENDERER]; break;
      case "getTypeFormula":
        assert.ok(id > 0n && id <= 9n, "formulas are one-based and include formulaCount");
        values = [FORMULAS[Number(id)]]; break;
      case "name": values = [TYPE_NAMES[Number(id)]]; break;
      case "tokenCategory": assert.equal(block, "0x63"); values = [id]; break;
      case "tokenTraits": {
        const t = predictTraits(HOLDER, OUTPUT, 9).traits;
        values = [[9, t.observe ? 1 : 0, t.memetic, t.consensus, t.intent, t.anomaly ? 1 : 0]];
        break;
      }
      case "tokenSeed": values = [options.wrongSeed ? "0x" + "c".repeat(64) : predictTraits(HOLDER, OUTPUT, 9).seed]; break;
      default: throw new Error("Unstubbed call: " + parsed.name);
    }
    return success(abi.encodeFunctionResult(parsed.name, values));
  };
  return { reader: createCollapseReader({ fetchImpl, rpcUrls: ["https://rpc.test"] }), calls };
}

test("lookup validation accepts IDs and hashes, rejects wallets and arbitrary URLs", () => {
  assert.deepEqual(parseLookup("#1001"), { kind: "token", value: "1001" });
  assert.equal(parseLookup(TX).kind, "transaction");
  for (const bad of [HOLDER, "https://evil.invalid/", "0", "-1", "1.2", "1e9", "9".repeat(100)]) assert.throws(() => parseLookup(bad));
});
test("receipt groups indexed Collapsed fields with the exact burn and mint events", () => {
  const [b] = verifyCollapseReceipt(transaction(), receipt(), TX);
  assert.deepEqual(b.inputs, INPUTS.map(String));
  assert.equal(b.outputId, String(OUTPUT));
  assert.equal(b.formulaId, "1");
});
test("receipt verification rejects reverted transactions, foreign events and mismatched calldata", () => {
  assert.throws(() => verifyCollapseReceipt(transaction(), { ...receipt(), status: "0x0" }, TX), /failed/);
  const wrong = receipt(); wrong.logs[0].address = RENDERER;
  assert.throws(() => verifyCollapseReceipt(transaction(), wrong, TX), /Burn receipt mismatch/);
  const input = { ...transaction(), input: SIM_ABI.encodeFunctionData("collapse", [3, INPUTS]) };
  assert.throws(() => verifyCollapseReceipt(input, receipt(), TX), /Calldata/);
  assert.throws(() => verifyCollapseReceipt(transaction(), { ...receipt(), blockHash: TX }, TX), /block/);
});
test("formula ABI decoder preserves zero-length arrays and exact-count/weighted recipes", () => {
  const encoded = SIM_ABI.encodeFunctionResult("getTypeFormula", [[2, 5, [1, 2], [2, 3], [9, 10], [1, 3], true]]);
  const f = unpackFormula(SIM_ABI.decodeFunctionResult("getTypeFormula", encoded), 10);
  assert.deepEqual(f.counts, [2, 3]); assert.deepEqual(f.weights, [1, 3]);
  const any = SIM_ABI.encodeFunctionResult("getTypeFormula", [FORMULAS[1]]);
  assert.deepEqual(unpackFormula(SIM_ABI.decodeFunctionResult("getTypeFormula", any), 1).counts, []);
});
test("recipes read every formula 1..count, names and fee at a single block", async () => {
  const { reader, calls } = fixture();
  const r = await reader.recipes();
  assert.equal(r.formulas.length, 9); assert.equal(r.formulas.at(-1).id, "9");
  assert.equal(r.types[13], "EN1GMA"); assert.equal(r.types[12], "ENIGMA");
  assert.equal(r.feeEth, "0.002");
  assert.equal(r.formulas.find((f) => f.id === "6").active, false);
  assert.ok(calls.filter((c) => c.method === "eth_call").every((c) => c.params[1] === "0x100"));
  const before = calls.length;
  assert.equal((await reader.recipes()).cached, true); assert.equal(calls.length, before);
  await reader.recipes({ fresh: true }); assert.ok(calls.length > before);
});
test("decoder recovers pre-burn names, validates traits and separates gas from value", async () => {
  const { reader } = fixture();
  const r = await reader.decode(TX);
  assert.equal(r.verified, true); assert.equal(r.historicalBlock, 99);
  assert.deepEqual(r.batches[0].burns.map((b) => b.name), TYPE_NAMES.slice(1, 7));
  assert.equal(r.batches[0].output.name, "BURNED");
  assert.equal(r.batches[0].output.traitProof, "matched");
  assert.equal(r.transactionValueEth, "0.0"); assert.equal(r.gasEth, "0.000021");
  assert.ok(!JSON.stringify(r).includes(HOLDER), "no holder address in returned dashboard data");
});
test("output-ID lookup uses total.token_id and transaction_hash, then checks the actual receipt", async () => {
  const { reader, calls } = fixture();
  const r = await reader.decode("#1001");
  assert.equal(r.tx, TX); assert.ok(calls.some((c) => c.explorer?.includes("/instances/1001/transfers")));
  await assert.rejects(() => reader.decode("1002"), /Could not find/);
});
test("archive failure preserves verified burn IDs but never fabricates TYPEs", async () => {
  const { reader } = fixture({ archiveDown: true });
  const r = await reader.decode(TX);
  assert.equal(r.verified, true);
  assert.ok(r.batches[0].burns.every((b) => b.name === null && b.typeId === null && b.reason));
  assert.ok(r.batches[0].warnings.some((w) => /pre-burn TYPEs/.test(w)));
});
test("a trait mismatch is reported, not silently called predictable", async () => {
  const { reader } = fixture({ wrongSeed: true });
  const r = await reader.decode(TX);
  assert.equal(r.batches[0].output.traitProof, "mismatch");
});
test("invalid or oversized batches fail before any reads; repeated calls retain no personal history", async () => {
  const { reader, calls } = fixture();
  await assert.rejects(() => reader.decodeMany([TX, HOLDER]));
  await assert.rejects(() => reader.decodeMany(Array(5).fill(TX)));
  assert.equal(calls.length, 0);
  await reader.decodeMany([TX]);
  const before = calls.length;
  await reader.decodeMany([TX]);
  assert.ok(calls.length > before);
});
test("API uses no-store and rejects unsupported methods and missing lookups", async () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "DELETE" }, res);
  assert.equal(res.code, 405); assert.equal(res.headers["Cache-Control"], "no-store");
  await handler({ method: "POST", body: {} }, res);
  assert.equal(res.code, 400);
});
