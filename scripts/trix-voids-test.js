import test from "node:test";
import assert from "node:assert/strict";
import { voidCandidate, verifyVoidTransfer, collectVoids, summarizeVoids, restoreVoidHistory, candidatesFromTreasuryReceipt, publicVoidSource, VOID_TREASURY, SHOCKER_MINT, TOKEN_2022 } from "../server/trix-voids.js";
import { rankVoiders, voidAmount, filterVoiders, mergeVoidRows } from "../public/trix-void-board.js";
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
  const fetchJson = async (url) => {
    urls.push(url);
    if (url.includes("/api/launches")) return { ok: true, json: { total: 1, items: [{ mintAddress: mint, symbol: "SHOCKER", name: "Shocker", creator: { username: "JLEE", walletAddress: wallet } }] } };
    return url.includes("before=") ? json([event]) : json([event], 1790812000000);
  };
  const first = await collectVoids({ fetchJson, rpc: async () => { throw Error("429"); } });
  assert.equal(first.pendingEvents, 1);
  assert.equal(first.verifiedEvents, 0);
  assert.equal(first.ledger.historyComplete, true);
  assert.equal(urls.filter((u) => u.includes("/api/launches")).length, 1, "the launch catalog is read once per refresh, not per page");
  assert.equal(urls.filter((u) => u.includes("feed/trades")).length, 2);
  const next = await collectVoids({ previous: first, fetchJson, rpc: async () => receipt() });
  assert.equal(next.verifiedEvents, 1);
  assert.equal(next.pendingEvents, 0);
  // Creator attribution survives an empty catalog refresh and a wallet that holds nothing.
  assert.equal(next.ledger.verifiedCount, 1);
  assert.equal(next.catalogTotal, 1);
  assert.equal(next.catalogCovered, 1);
  assert.equal(next.assets[0].creator, "JLEE");
  const emptyCatalog = await collectVoids({ previous: next, fetchJson: async (u) => u.includes("/api/launches") ? { ok: true, json: { total: 1, items: [] } } : (u.includes("before=") ? json([event]) : json([event], 1790812000000)), rpc: async () => { throw Error("429"); } });
  assert.equal(emptyCatalog.ledger.verifiedCount, 1, "a failed catalog refresh never drops verified credits");
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

test("search finds a coin, its creator or a wallet, and coin matches rank first", () => {
  const OTHER_MINT = "F".repeat(32);
  const rows = [
    { wallet: "w1", username: "UmpaLumpa", transactions: 9, assets: { [mint]: { mint, symbol: "CRACK", creator: "burgher", amountRaw: "1", decimals: 6, transactions: 3 } } },
    { wallet: "w2", username: null, transactions: 5, assets: { [mint]: { mint, symbol: "SELLER", creator: "JLEE", amountRaw: "2", decimals: 6, transactions: 2 } } },
    { wallet: "w3", username: "burgher", transactions: 1, assets: { [OTHER_MINT]: { mint: OTHER_MINT, symbol: "RLL", amountRaw: "3", decimals: 6, transactions: 1 } } }];
  assert.equal(filterVoiders(rows, "jlee").rows[0].wallet, "w2", "a creator name finds the creator's row even with no username");
  assert.equal(filterVoiders(rows, "jlee").coinMatches, 1);
  assert.equal(filterVoiders(rows, "seller").rows[0].username, null, "an unnamed wallet is still found by its coin");
  assert.equal(filterVoiders(rows, "burgher").rows.length, 2, "creator of CRACK and the wallet named burgher both match");
  assert.equal(filterVoiders(rows, "w1").rows[0].username, "UmpaLumpa");
  assert.equal(filterVoiders(rows, OTHER_MINT).rows[0].wallet, "w3", "a full mint is searchable");
  assert.equal(filterVoiders(rows, "").rows.length, 3, "an empty query keeps the full ranking");
  assert.equal(filterVoiders(rows, "not-here").rows.length, 0);
  const merged = mergeVoidRows([{ wallet: "w1", transactions: 9, assets: { [mint]: { symbol: "CRACK" } } }, { wallet: "w1", transactions: 9, assets: { [OTHER_MINT]: { symbol: "RLL" } } }]);
  assert.equal(merged.length, 1);
  assert.deepEqual(Object.keys(merged[0].assets).sort(), [mint, OTHER_MINT].sort(), "per-coin rankings merge back into one wallet row");
});

test("direct treasury history recovers a depositor missing from both feed and holder lists", async () => {
  const tx = receipt();
  for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) b.mint = SHOCKER_MINT;
  const rpc = async (method, params) => {
    if (method === "getTokenAccountsByOwner") {
      assert.equal(params[0], VOID_TREASURY);
      assert.deepEqual(params[1].programIds, [TOKEN, TOKEN_2022], "both token programs are inventoried, not just classic SPL");
      return { value: [{ pubkey: destination, account: { data: { program: TOKEN_2022, parsed: { info: { owner: VOID_TREASURY, mint: SHOCKER_MINT, tokenAmount: { amount: "0" } } } } } }] };
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
  assert.equal(s.ledger.chainToken2022Accounts, 1, "Token-2022 treasury accounts are inventoried and reported");
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

test("a sender with no reported pre-balance is still a real transfer, not a failure", () => {
  // Solana omits zero balances, so a sender holding nothing beforehand has no
  // pre-balance row. Rejecting those discarded real voids; a contradiction is
  // still rejected.
  const candidate = voidCandidate(event);
  const unreported = receipt();
  unreported.meta.preTokenBalances = unreported.meta.preTokenBalances.filter((b) => b.owner !== wallet);
  unreported.meta.postTokenBalances = unreported.meta.postTokenBalances.filter((b) => b.owner !== wallet);
  const verified = verifyVoidTransfer(candidate, unreported);
  assert.equal(verified.status, "verified");
  assert.equal(verified.amountRaw, "5000000");
  assert.equal(verified.debitUnreported, true, "the missing debit row is disclosed, not silently assumed");
  const contradicted = receipt();
  contradicted.meta.preTokenBalances[0].uiTokenAmount.amount = "1000000";
  assert.throws(() => verifyVoidTransfer(candidate, contradicted), /contradicts/, "a reported debit smaller than the transfer is still rejected");
});

test("a ledger that reached the old retention cap keeps every credit and resumes discovery", async () => {
  // The pre-rollup ledger stored one row per receipt and stopped the entire scan
  // at 2500 rows. That silently truncated every all-time ranking from there on.
  const legacy = { version: 1, capped: true, records: [], before: null, historyComplete: true };
  const base58 = (i) => "ABCDEFGHJKLMNPQRSTUVWXYZ"[i % 24];
  const pair = (i) => base58(Math.floor(i / 24) % 24) + base58(Math.floor(i / 576)) + base58(i);
  const sig = (i) => `3${pair(i)}`.repeat(16);
  const who = (i) => `A${pair(i)}${"A".repeat(28)}`;
  const txFor = (s, w) => {
    const tx = receipt();
    tx.transaction.signatures = [s];
    tx.transaction.message.accountKeys[0] = { pubkey: w, signer: true };
    tx.transaction.message.instructions[0].parsed.info.authority = w;
    tx.meta.preTokenBalances[0].owner = w;
    return tx;
  };
  for (let i = 0; i < 2500; i++) legacy.records.push(verifyVoidTransfer(voidCandidate({ ...event, txSignature: sig(i), walletAddress: who(i) }), txFor(sig(i), who(i))));
  const freshSig = "7".repeat(64), freshWho = "C".repeat(32);
  const fresh = { ...event, txSignature: freshSig, walletAddress: freshWho };
  const out = await collectVoids({
    previous: { ledger: legacy },
    fetchJson: async (url) => url.includes("/api/launches")
      ? { ok: true, json: { total: 1, items: [{ mintAddress: mint, symbol: "SHOCKER", creator: { username: "JLEE", walletAddress: freshWho } }] } }
      : json([fresh], null),
    rpc: async () => txFor(freshSig, freshWho),
  });
  assert.equal(out.ledger.migratedFrom, 2500);
  assert.equal(out.verifiedEvents, 2501, "the capped ledger's credits are kept and discovery continues past the old limit");
  assert.equal(out.ledger.capped, false, "the retention cap no longer stops discovery");
  assert.equal(out.ledger.records.filter((r) => r.status === "verified").length, 0, "verified receipts roll up instead of occupying the queue");
  assert.equal(out.ledger.keys.length, 2501, "dedup keys survive retention so overlap never double-counts");
  assert.ok(out.ledger.samples.length <= 600 && out.ledger.samples.length > 0, "receipts are kept as a bounded recent proof sample");
  assert.equal(out.leaderboard.length, 2501);
  // Creator attribution comes from the catalog, not from current holdings.
  assert.equal(out.leaderboard.find((r) => r.wallet === freshWho).username, "JLEE");
  assert.equal(out.catalogTotal, 1);
});

test("one unreadable account is deferred, not retried forever while the rest wait", async () => {
  const STUCK = "Z".repeat(32), GOOD = "Y".repeat(32);
  const tx = receipt();
  for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) b.mint = SHOCKER_MINT;
  const tried = [];
  const rpc = async (method, params) => {
    if (method === "getTokenAccountsByOwner") {
      return { value: [
        { pubkey: STUCK, account: { data: { parsed: { info: { owner: VOID_TREASURY, mint: SHOCKER_MINT, tokenAmount: { amount: "0" } } } } } },
        { pubkey: GOOD, account: { data: { parsed: { info: { owner: VOID_TREASURY, mint: SHOCKER_MINT, tokenAmount: { amount: "0" } } } } } }] };
    }
    if (method === "getTokenSupply") return { value: { amount: "100000000", decimals: 6 } };
    if (method === "getSignaturesForAddress") {
      tried.push(params[0]);
      if (params[0] === STUCK) return null; // unreadable history, every time
      return [{ signature, err: null, blockTime: tx.blockTime }];
    }
    if (method === "getTransaction") return tx;
    throw Error(`Unexpected ${method}`);
  };
  const fetchJson = async (url) => url.includes("/holders/") ? { ok: true, json: { holders: [] } } : json([]);
  const first = await collectVoids({ rpc, fetchJson });
  assert.equal(first.verifiedEvents, 0, "the unreadable account yields nothing rather than a guess");
  assert.ok(first.reason && /Deferred/.test(first.reason), "the deferred account is reported, not hidden");
  const stuck = first.ledger.chainAccounts.find((a) => a.address === STUCK);
  assert.equal(stuck.complete, false);
  assert.ok(stuck.retryAfter && Date.parse(stuck.retryAfter) > Date.now(), "a stuck account is parked instead of re-picked");
  const again = await collectVoids({ previous: first, rpc, fetchJson });
  assert.equal(again.verifiedEvents, 1, "the readable account behind the stuck one is still scanned");
  assert.equal(tried.filter((a) => a === STUCK).length, 1, "the parked account is not retried every run");
  assert.equal(again.ledger.chainAccounts.find((a) => a.address === GOOD).complete, true);
});

test("a receipt that stays unreadable is dropped instead of retried forever", async () => {
  const GOOD = "X".repeat(32);
  const tx = receipt();
  for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) b.mint = SHOCKER_MINT;
  const deadSig = "8".repeat(64);
  let deadCalls = 0;
  const rpc = async (method, params) => {
    if (method === "getTokenAccountsByOwner") {
      return { value: [{ pubkey: GOOD, account: { data: { parsed: { info: { owner: VOID_TREASURY, mint: SHOCKER_MINT, tokenAmount: { amount: "0" } } } } } }] };
    }
    if (method === "getTokenSupply") return { value: { amount: "100000000", decimals: 6 } };
    if (method === "getSignaturesForAddress") return [{ signature: deadSig, err: null, blockTime: tx.blockTime }, { signature, err: null, blockTime: tx.blockTime }];
    if (method === "getTransaction") {
      if (params[0] === deadSig) { deadCalls++; return null; } // pruned history: never retry
      return tx;
    }
    throw Error(`Unexpected ${method}`);
  };
  const fetchJson = async (url) => url.includes("/holders/") ? { ok: true, json: { holders: [] } } : json([]);
  const out = await collectVoids({ rpc, fetchJson });
  assert.equal(out.verifiedEvents, 1, "the readable receipt is still credited beside the pruned one");
  assert.equal(deadCalls, 1, "a signature the provider does not hold is asked for exactly once");
  assert.equal(out.ledger.chainPending.some((p) => p.signature === deadSig), false, "pruned history leaves the queue immediately");
  assert.equal(out.ledger.chainPruned, 1);
  assert.equal(out.verifiedEvents, 1);
});
