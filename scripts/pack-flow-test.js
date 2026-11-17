import test from "node:test";
import assert from "node:assert/strict";
import { PACK_PROGRAM, parsePackFlow, collectPackFlow } from "../server/pack-flow.js";

const payer = "payer";
const destinations = ["D8LYYHufXvEVAfMKfmv9amKLJjdJejpXAwsM5Wqp3iQe", "78zsqg7rhoBGMra57Nq1kiLGM8KxFBYefoKZDXDRFhHb"];
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
  assert.deepEqual(parsePackFlow(tx).lamports, [3060391734, 340043526]);
  tx.meta.innerInstructions[0].instructions[0] = transfer(0, "someone else");
  assert.equal(parsePackFlow(tx).packs, 1);
  tx.transaction.message.instructions[1].data = "2";
  assert.equal(parsePackFlow(tx), null);
  tx.meta.err = { failed: true };
  assert.equal(parsePackFlow(tx), null);
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
