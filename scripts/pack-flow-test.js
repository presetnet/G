import test from "node:test";
import assert from "node:assert/strict";
import { PACK_PROGRAM, parsePackFlow, parseShopPayouts, collectPackFlow, collectPackCensus } from "../server/pack-flow.js";

const payer = "payer";
const destinations = ["D8LYYHufXvEVAfMKfmv9amKLJjdJejpXAwsM5Wqp3iQe", "78zsqg7rhoBGMra57Nq1kiLGM8KxFBYefoKZDXDRFhHb"];
test("shop payouts require a successful ShopBuyShared transfer from its vault to its recipient", () => {
  const accounts = Array(10).fill("");
  accounts[3] = destinations[0];
  accounts[8] = payer;
  const tx = transaction(Date.now());
  tx.transaction.message.instructions[1] = { programId: PACK_PROGRAM, accounts, data: "aqyWW67znve" };
  tx.meta.logMessages.push("Program log: Instruction: ShopBuyShared");
  const info = { source: destinations[0], destination: payer, lamports: 54917167224 };
  tx.meta.innerInstructions[1].instructions = [{ program: "system", parsed: { type: "transfer", info } }];
  assert.deepEqual(parseShopPayouts(tx).map(p => [p.seller, p.lamports]), [[payer, 54917167224]]);
  info.destination = "other";
  assert.deepEqual(parseShopPayouts(tx), []);
});
const transfer = (i, source = payer) => ({ program: "system", parsed: { type: "transfer", info: { source, destination: destinations[i], lamports: [1530195867, 170021763][i] } } });
function transaction(now, signature = "sig") {
  return { blockTime: Math.floor(now / 1000), transaction: { signatures: [signature], message: { accountKeys: [{ signer: true, pubkey: payer }], instructions: [
    { programId: PACK_PROGRAM, data: "2RQA4Gj9iaq5JX8bkncJDHq6" }, { programId: PACK_PROGRAM, data: "2RQA4Gj9iaq5JX8bkncJDHq6" },
  ] } }, meta: { err: null, logMessages: ["Program log: Instruction: BuyPack"], innerInstructions: [
    { index: 0, instructions: [transfer(0), transfer(1)] }, { index: 1, instructions: [transfer(0), transfer(1)] },
  ] } };
}
test("counts multiple instructions in one transaction and rejects unmatched or failed deposits", () => {
  const tx = transaction(Date.now());
  assert.equal(parsePackFlow(tx).packs, 2);
  assert.equal(parsePackFlow(tx).buyer, payer);
  assert.deepEqual(parsePackFlow(tx).tiers, ["viral"]);
  assert.deepEqual(parsePackFlow(tx).lamports, [3060391734, 340043526]);
  tx.meta.innerInstructions[0].instructions[0] = transfer(0, "someone else");
  assert.equal(parsePackFlow(tx).packs, 1);
  tx.transaction.message.instructions[1].data = "2";
  assert.equal(parsePackFlow(tx), null);
  tx.meta.err = { failed: true };
  assert.equal(parsePackFlow(tx), null);
});

test("receipt census counts tier bytes, reports unknown tiers, and caches the scan", async () => {
  const now = Date.now();
  let calls = 0;
  const rpc = async (method, params) => {
    calls++;
    assert.equal(method, "getProgramAccounts");
    assert.deepEqual(params[1].dataSlice, { offset: 104, length: 1 });
    return { context: { slot: 123 }, value: [0, 0, 1, 2, 9].map((n) => ({ account: { data: [Buffer.from([n]).toString("base64"), "base64"] } })) };
  };
  const census = await collectPackCensus(rpc, null, now);
  assert.deepEqual(census.counts, { base: 2, hype: 1, viral: 1, unknown: 1 });
  assert.equal(census.total, 5);
  assert.equal(census.slot, 123);
  assert.equal(await collectPackCensus(rpc, census, now + 60000), census);
  assert.equal(calls, 1);
  const failed = await collectPackCensus(async () => { throw Error("offline"); }, census, now + 16 * 60000);
  assert.equal(failed.ok, false);
  assert.equal(failed.stale, true);
  assert.equal(failed.counts.hype, 1);
  const invalid = await collectPackCensus(async () => ({ context: { slot: 1 }, value: [{ account: { data: ["", "base64"] } }] }), null, now);
  assert.equal(invalid.ok, false);
});
test("bounded collector deduplicates and reports unresolved observations without fabricating totals", async () => {
  const now = Date.now(), tx = transaction(now);
  const rpc = async (method) => method === "getSignaturesForAddress" ? [{ signature: "sig" }, { signature: "missing" }] : tx;
  let state = await collectPackFlow(rpc, null, now);
  assert.equal(state.packs24h, 2);
  state = await collectPackFlow(rpc, state, now + 1000);
  assert.equal(state.packs24h, 2);
  const failed = await collectPackFlow(async () => { throw Error("offline"); }, state, now + 2000);
  assert.equal(failed.ok, false);
  assert.equal(failed.records.length, 1);
});
