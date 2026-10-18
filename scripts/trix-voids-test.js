import test from "node:test";
import assert from "node:assert/strict";
import { voidCandidate, verifyVoidTransfer, collectVoids, summarizeVoids, restoreVoidHistory, candidatesFromTreasuryReceipt, publicVoidSource, VOID_TREASURY, SHOCKER_MINT } from "../server/trix-voids.js";
import { rankVoiders, voidAmount } from "../public/trix-void-board.js";
import { normalizeBundle } from "../server/shared-store.js";
import { filterEvidence } from "../public/evidence.js";

const wallet = "A".repeat(32), mint = "B".repeat(32), signature = "3".repeat(64);
const source = "D".repeat(32), destination = "E".repeat(32);
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const event = { side: "void", walletAddress: wallet, mint, txSignature: signature, tokenAmount: 5, solAmount: 0, username: "emptied-wallet", createdAt: "2026-10-01T00:00:00Z" };
const balance = (accountIndex, owner, amount) => ({ accountIndex, owner, mint, uiTokenAmount: { amount, decimals: 6 } });
const receipt = () => ({ slot: 42, blockTime: 1790812800,
  meta: { err: null, innerInstructions: [], preTokenBalances: [balance(1, wallet, "5000000"), balance(2, VOID_TREASURY, "0")],
    postTokenBalances: [balance(2, VOID_TREASURY, "5000000")] },
  transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: wallet, signer: true }, { pubkey: source }, { pubkey: destination }],
    instructions: [
      { programId: TOKEN, parsed: { type: "transfer", info: { authority: wallet, source, destination, amount: "5000000" } } },
      { programId: "11111111111111111111111111111111", parsed: { type: "transfer", info: { source: wallet, destination: VOID_TREASURY, lamports: 5000000 } } },
    ] } },
});
const json = (items, nextBefore = null) => ({ ok: true, json: { items, nextBefore } });

test("an emptied token account remains credited, without counting its SOL fee", () => {
  const verified = verifyVoidTransfer(voidCandidate(event), receipt());
  assert.equal(verified.amountRaw, "5000000");
  assert.equal(verified.asset, mint);
  const board = summarizeVoids({ records: [verified] });
  assert.equal(board.leaderboard[0].transactions, 1);
  assert.equal(board.leaderboard[0].wallet, wallet);
  assert.equal(board.leaderboard[0].assets.SOL, undefined);
  assert.equal(voidCandidate({ ...event, side: "sell" }), null, "selling a VOID-named token is not voiding");
});

test("verification rejects failed, foreign, unsigned and short-credit transactions", () => {
  const candidate = voidCandidate(event);
  const failed = receipt(); failed.meta.err = { failed: true };
  assert.throws(() => verifyVoidTransfer(candidate, failed), /unsuccessful/);
  const foreign = receipt(); foreign.meta.postTokenBalances[0].owner = wallet;
  foreign.meta.preTokenBalances[1].owner = wallet;
  assert.throws(() => verifyVoidTransfer(candidate, foreign), /No matching transfer/);
  const unsigned = receipt(); unsigned.transaction.message.accountKeys[0].signer = false;
  assert.throws(() => verifyVoidTransfer(candidate, unsigned), /did not sign/);
  const feeToken = receipt(); feeToken.meta.postTokenBalances[0].uiTokenAmount.amount = "4990000";
  assert.throws(() => verifyVoidTransfer(candidate, feeToken), /credit/);
  const wrongSignature = receipt(); wrongSignature.transaction.signatures = ["4".repeat(64)];
  assert.throws(() => verifyVoidTransfer(candidate, wrongSignature), /signature mismatch/);
});

test("native voids require an exact feed-to-receipt amount, not inferred treasury fees", () => {
  const native = voidCandidate({ ...event, mint: null, tokenAmount: 0, solAmount: 0.005 });
  assert.equal(verifyVoidTransfer(native, receipt()).amountRaw, "5000000");
  assert.throws(() => verifyVoidTransfer({ ...native, reportedSol: 1 }, receipt()), /does not match/);
});

test("deduped credits survive later sales, empty feeds and RPC outages", async () => {
  const rpc = async (method, params) => {
    if (method === "getTokenAccountsByOwner") { assert.equal(params[0], VOID_TREASURY, "only treasury accounts are inventoried, never individual current holdings"); return { value: [] }; }
    assert.equal(method, "getTransaction"); return receipt();
  };
  const first = await collectVoids({ fetchJson: async () => json([event, event]), rpc });
  assert.equal(first.verifiedEvents, 1);
  const again = await collectVoids({ previous: first, fetchJson: async () => json([{ ...event, side: "sell" }]), rpc });
  assert.equal(again.verifiedEvents, 1);
  assert.equal(again.leaderboard[0].transactions, 1);
  const empty = await collectVoids({ previous: again, fetchJson: async () => json([]), rpc });
  assert.equal(empty.leaderboard[0].assets[mint].amountRaw, "5000000");
  const original = JSON.stringify(empty);
  const outage = await collectVoids({ previous: empty, fetchJson: async () => { throw Error("offline"); }, rpc });
  assert.equal(outage.stale, true);
  assert.equal(outage.verifiedEvents, 1);
  assert.equal(JSON.stringify(empty), original, "previous persisted ledger is immutable");
});

test("pending receipts retry after outages and history cursor advances without duplicate credits", async () => {
  const urls = [];
  const fetchJson = async (url) => { urls.push(url); return url.includes("before=") ? json([event]) : json([event], 1790812000000); };
  const first = await collectVoids({ fetchJson, rpc: async () => { throw Error("429"); } });
  assert.equal(first.pendingEvents, 1);
  assert.equal(first.verifiedEvents, 0);
  assert.equal(first.ledger.historyComplete, true);
  assert.equal(urls.length, 2);
  const next = await collectVoids({ previous: first, fetchJson, rpc: async () => receipt() });
  assert.equal(next.verifiedEvents, 1);
  assert.equal(next.pendingEvents, 0);
});

test("ledger backup outlives the display snapshot's 24h expiry", () => {
  const ledger = { version: 1, records: [verifyVoidTransfer(voidCandidate(event), receipt())] };
  const bundle = normalizeBundle({ latest: { takenAt: "2020-01-01", sources: { "trix.voids": { ledger } } } });
  assert.equal(bundle.latest, null);
  assert.deepEqual(bundle.voidLedger, ledger);
  assert.deepEqual(restoreVoidHistory(bundle.latest, bundle.voidLedger).sources["trix.voids"].ledger, ledger);
  const historical = filterEvidence(restoreVoidHistory(bundle.latest, bundle.voidLedger)).sources["trix.voids"];
  assert.equal(historical.stale, true);
  assert.equal(historical.leaderboard[0].transactions, 1, "display expiry cannot erase historical credit");
});

test("asset-specific ranking is exact and never sums different coins", () => {
  const rows = [{ wallet: "a", transactions: 2, assets: { [mint]: { amountRaw: "9007199254740993" } } },
    { wallet: "b", transactions: 4, assets: { [mint]: { amountRaw: "9007199254740992" }, OTHER: { amountRaw: "999999999999999999" } } }];
  assert.equal(rankVoiders(rows)[0].wallet, "b");
  assert.equal(rankVoiders(rows, mint)[0].wallet, "a");
  assert.equal(voidAmount("9007199254740993", 6), "9,007,199,254.740993");
});

test("direct treasury history recovers a depositor missing from both feed and holder lists", async () => {
  const tx = receipt();
  for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) b.mint = SHOCKER_MINT;
  const rpc = async (method, params) => {
    if (method === "getTokenAccountsByOwner") {
      assert.equal(params[0], VOID_TREASURY);
      return { value: [{ pubkey: destination, account: { data: { parsed: { info: { owner: VOID_TREASURY, mint: SHOCKER_MINT, tokenAmount: { amount: "0" } } } } } }] };
    }
    if (method === "getSignaturesForAddress") { assert.equal(params[0], destination); return [{ signature, err: null, blockTime: tx.blockTime }]; }
    if (method === "getTokenSupply") return { value: { amount: "100000000", decimals: 6 } };
    if (method === "getTransaction") return tx;
    throw Error(`Unexpected ${method}`);
  };
  const s = await collectVoids({ rpc, fetchJson: async url => url.includes('/holders/') ? { ok: true, json: { holders: [] } } : json([]) });
  assert.equal(s.verifiedEvents, 1);
  assert.equal(s.leaderboard[0].wallet, wallet);
  assert.equal(s.leaderboard[0].assets[SHOCKER_MINT].amountRaw, "5000000");
  assert.equal(s.leaderboard[0].assets[SHOCKER_MINT].supplyPct, 5);
  assert.equal(s.ledger.chainPending.length, 0);
  assert.equal(s.ledger.chainReceiptsChecked, 1);
  const again = await collectVoids({ previous: s, rpc, fetchJson: async()=>json([]) });
  assert.equal(again.verifiedEvents, 1, "history and feed overlap do not duplicate credits");
  assert.equal(candidatesFromTreasuryReceipt({ ...tx, meta: { ...tx.meta, err: { failed: true } } }, signature, SHOCKER_MINT, "SHOCKER").length, 0);
  const projected = publicVoidSource(s);
  assert.equal(projected.totalWallets, 1);
  assert.equal(projected.ledger.chainAccountCount, 1);
  assert.equal(projected.ledger.chainAccounts, undefined, "scan inventory is not shipped to every browser");
  assert.equal(projected.ledger.chainSeen, undefined);
  assert.equal(projected.assetLeaderboards[SHOCKER_MINT][0].assets[SHOCKER_MINT].supplyPct, 5);
  assert.equal(s.ledger.chainAccounts.length, 1, "projection must not remove persisted scan state");
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) < 600000);
});
