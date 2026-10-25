import test from "node:test";
import assert from "node:assert/strict";
import { voidCandidate, verifyVoidTransfer, collectVoids, summarizeVoids, summarizeVoidsWith, restoreVoidHistory, candidatesFromTreasuryReceipt, publicVoidSource, VOID_TREASURY, SHOCKER_MINT, TOKEN_2022 } from "../server/trix-voids.js";
import { rankVoiders, voidAmount, filterVoiders, mergeVoidRows, sortVoidRows, voidCoinOptions, renderVoidBoard, allVoidRows, voidRecoveryStatus } from "../public/trix-void-board.js";
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

test("recovery status distinguishes rechecking, queued receipts and a finished pass", () => {
  const s = { ok: true, ledger: { verificationRescanStartedAt: "2026-10-25T00:00:00Z", chainAccountCount: 654,
    chainCompleteCount: 136, chainPendingCount: 1200, historyComplete: true } };
  assert.equal(voidRecoveryStatus(s).title, "Historical re-verification in progress");
  assert.match(voidRecoveryStatus(s).note, /Previously verified records remain available/);
  s.ledger.chainCompleteCount = 654;
  assert.notEqual(voidRecoveryStatus(s).title, "Current recheck pass finished", "pagination cannot hide pending verification");
  s.ledger.chainPendingCount = 0;
  assert.equal(voidRecoveryStatus(s).title, "Current recheck pass finished");
  assert.match(voidRecoveryStatus(s).note, /does not establish complete all-time coverage/);
  s.stale = true;
  assert.equal(voidRecoveryStatus(s).title, "Recovery status is stale");
});

test("a rate-limited receipt batch pauses instead of hammering every queued receipt", async () => {
  let calls = 0;
  const ledger = { version: 1, verificationVersion: 2, receiptRetentionVersion: 2, records: [], totals: {}, keys: [], samples: [], verifiedCount: 0,
    historyComplete: true, chainPending: Array.from({ length: 30 }, (_, i) => ({ signature: `${signature}${i}`, mint, symbol: "COIN", attempts: 0 })) };
  const rpc = async (method) => {
    if (method === "getTokenAccountsByOwner") return { value: [] };
    if (method === "getTransaction") { calls++; throw Error("Solana RPC HTTP 429"); }
    throw Error(method);
  };
  const first = await collectVoids({ previous: { ledger }, rpc, fetchJson: async () => json([]) });
  assert.ok(calls > 0 && calls < 30);
  assert.equal(first.ledger.chainPending.length, 30);
  assert.equal(first.ledger.chainPending.every((r) => r.attempts === 0), true);
  assert.ok(Date.parse(first.ledger.chainRpcRetryAt) > Date.now());
  const before = calls;
  await collectVoids({ previous: first, rpc, fetchJson: async () => json([]) });
  assert.equal(calls, before, "persisted cooldown prevents another burst next pass");
});

test("signed alternate-authority transfers verify without bypassing ownership or signatures", () => {
  const tx = receipt();
  const info = tx.transaction.message.instructions[0].parsed.info;
  delete info.authority;
  info.multisigAuthority = wallet;
  info.signers = [wallet];
  assert.equal(verifyVoidTransfer(voidCandidate(event), tx).amountRaw, "5000000");
  info.multisigAuthority = "Z".repeat(32);
  assert.throws(() => verifyVoidTransfer(voidCandidate(event), tx), /No matching transfer/);
  info.multisigAuthority = wallet;
  tx.transaction.message.accountKeys[0].signer = false;
  assert.throws(() => verifyVoidTransfer(voidCandidate(event), tx), /did not sign/);
});

test("catalog coverage separates no-account coins from uncredited treasury accounts", () => {
  const second = "F".repeat(32), third = "G".repeat(32);
  const s = summarizeVoids({ records: [verifyVoidTransfer(voidCandidate(event), receipt())],
    catalog: { total: 3, solanaTotal: 3, mints: { [mint]: { symbol: "ONE" }, [second]: { symbol: "TWO" }, [third]: { symbol: "THREE" } } },
    chainInventoryVersion: 2, chainAccounts: [{ mint }, { mint: second }] });
  assert.equal(s.coverage.catalogCoins, 3);
  assert.equal(s.coverage.creditedCoins, 1);
  assert.equal(s.coverage.withoutDiscoveredAccount, 1);
  assert.deepEqual(s.coverage.uncreditedTreasuryCoins, [{ mint: second, symbol: "TWO" }]);
});

test("Token-2022 discovery works even when classic SPL inventory is unavailable", async () => {
  const filters = [];
  const tx = receipt();
  tx.transaction.message.instructions[0].programId = TOKEN_2022;
  const out = await collectVoids({ fetchJson: async () => json([]), rpc: async (method, params) => {
    if (method === "getTokenAccountsByOwner") {
      filters.push(params[1]);
      if (params[1].programId === TOKEN) throw Error("classic unavailable");
      return { value: [{ pubkey: destination, account: { data: { parsed: { info: { owner: VOID_TREASURY, mint, tokenAmount: { amount: "0" } } } } } }] };
    }
    if (method === "getSignaturesForAddress") return [{ signature, err: null }];
    if (method === "getTokenSupply") return { value: { amount: "100000000", decimals: 6 } };
    if (method === "getTransaction") return tx;
    throw Error(method);
  } });
  assert.deepEqual(filters, [{ programId: TOKEN }, { programId: TOKEN_2022 }]);
  assert.equal(out.verifiedEvents, 1);
  assert.equal(out.ledger.chainToken2022Unavailable, false);
  assert.equal(out.ledger.chainClassicUnavailable, true);
});

test("a retained null receipt can be recovered later without losing its identity", async () => {
  let available = false;
  const rpc = async (method) => method === "getTokenAccountsByOwner" ? { value: [] } : method === "getTransaction" ? available ? receipt() : null : null;
  const previous = { ledger: { version: 1, receiptRetentionVersion: 2, records: [], totals: {}, keys: [], samples: [], verifiedCount: 0,
    historyComplete: true, chainPending: [{ signature, mint, symbol: "COIN", attempts: 0 }] } };
  const first = await collectVoids({ previous, rpc, fetchJson: async () => json([]) });
  assert.equal(first.ledger.chainRetry.length, 1);
  first.ledger.chainRetry[0].deferUntil = 0;
  available = true;
  const second = await collectVoids({ previous: first, rpc, fetchJson: async () => json([]) });
  assert.equal(second.verifiedEvents, 1);
  assert.equal(second.ledger.chainRetry.length, 0);
  assert.equal(second.leaderboard[0].latestAt, new Date(receipt().blockTime * 1000).toISOString());
  assert.equal(second.leaderboard[0].assets[mint].latestSignature, signature);
});

test("feed and treasury discovery cannot credit the same deposit twice in one pass", async () => {
  const out = await collectVoids({ fetchJson: async (url) => url.includes("/feed/") ? json([event]) : json([]), rpc: async (method) => {
    if (method === "getTokenAccountsByOwner") return { value: [{ pubkey: destination, account: { data: { parsed: { info: { owner: VOID_TREASURY, mint, tokenAmount: { amount: "0" } } } } } }] };
    if (method === "getSignaturesForAddress") return [{ signature, err: null }];
    if (method === "getTokenSupply") return { value: { amount: "100000000", decimals: 6 } };
    if (method === "getTransaction") return receipt();
    throw Error(method);
  } });
  assert.equal(out.verifiedEvents, 1);
  assert.equal(out.leaderboard[0].assets[mint].amountRaw, "5000000");
});

test("catalog distinguishes other-chain launches from unverified Solana coins", async () => {
  const evm = `0x${"a".repeat(40)}`;
  const out = await collectVoids({ rpc: async () => ({ value: [] }), fetchJson: async (url) => url.includes('/launches')
    ? { ok: true, json: { total: 2, items: [{ mintAddress: mint, symbol: "SOLCOIN" }, { mintAddress: evm, symbol: "OTHER", chain: "robinhood" }] } }
    : json([]) });
  assert.equal(out.catalogTotal, 1);
  assert.equal(out.catalogAllChainsTotal, 2);
  assert.equal(out.catalogOtherChains, 1);
  assert.equal(out.catalogComplete, true);
  assert.equal(voidCoinOptions(out).find((a) => a.mint === evm).outsideScope, true);
});

test("legacy recovery starts only with a complete dedup journal", async () => {
  const base = { version: 1, records: [], totals: {}, keys: [], samples: [], verifiedCount: 0, chainUnreadable: 3,
    chainAccounts: [{ address: destination, mint, complete: true, before: signature, named: true }], historyComplete: true };
  const run = (ledger) => collectVoids({ previous: { ledger }, fetchJson: async () => json([]), rpc: async (method) => {
    if (method === "getTokenAccountsByOwner") return { value: [] };
    if (method === "getSignaturesForAddress") return [];
    if (method === "getTokenSupply") return { value: { amount: "1", decimals: 6 } };
    throw Error(method);
  } });
  const safe = await run(base);
  assert.ok(safe.ledger.recoveryStartedAt);
  assert.equal(safe.ledger.chainAccounts[0].before, null);
  const blocked = await run({ ...base, verifiedCount: 4 });
  assert.equal(blocked.ledger.recoveryStartedAt, undefined);
  assert.match(blocked.ledger.recoveryBlockedReason, /dedup/);
  assert.equal(blocked.ledger.chainAccounts[0].before, signature);
});

test("legacy double credits are corrected only after re-verifying the receipt", async () => {
  const key = `${signature}:${wallet}:${mint}`;
  const ledger = { version: 1, records: [], keys: [key, key], samples: [], verifiedCount: 2, historyComplete: true,
    totals: { [`${wallet}|${mint}`]: { wallet, asset: mint, symbol: "COIN", decimals: 6, deposits: 2, amountRaw: "10000000" } } };
  const run = (tx) => collectVoids({ previous: { ledger }, fetchJson: async () => json([]), rpc: async (method) => method === "getTransaction" ? tx : { value: [] } });
  const failed = await run(null);
  assert.equal(failed.verifiedEvents, 2);
  assert.equal(failed.ledger.duplicateCreditsPending, 1);
  const fixed = await run(receipt());
  assert.equal(fixed.verifiedEvents, 1);
  assert.equal(fixed.ledger.totals[`${wallet}|${mint}`].amountRaw, "5000000");
  assert.deepEqual(fixed.ledger.keys, [key]);
  assert.equal(fixed.ledger.corrections[0].removedDeposits, 1);
  assert.equal(fixed.ledger.corrections[0].removedAmountRaw, "5000000");
  assert.equal(ledger.verifiedCount, 2, "repair works on the collector copy, not the caller's saved ledger");
});

test("wallets beyond the top 50 remain searchable and can lead the Value ranking", () => {
  const leaderboard = Array.from({ length: 70 }, (_, i) => ({ wallet: `wallet${i}`, username: i === 69 ? "jimmy" : null,
    transactions: 100 - i, assets: { [mint]: { mint, symbol: "HOE", amountRaw: "100", decimals: 0,
      transactions: 1, valueUsd: i === 69 ? 103588 : 1, unitPriceUsd: i === 69 ? 1035.88 : 0.01 } } }));
  const published = publicVoidSource({ ledger: { records: [] }, assets: [{ mint, symbol: "HOE" }], leaderboard });
  const all = allVoidRows(published);
  assert.equal(all.length, 70);
  assert.equal(filterVoiders(all, "jimmy").rows[0].wallet, "wallet69");
  assert.equal(sortVoidRows(all, "value", "")[0].username, "jimmy");
  assert.equal(rankVoiders(all, mint).length, 70);
});

test("catalog coins remain discoverable without manufacturing verified deposits", () => {
  const ledger = { records: [], catalog: { total: 1, mints: { [mint]: { symbol: "COIN", name: "Catalog coin" } } } };
  const board = summarizeVoids(ledger);
  const published = publicVoidSource({ ...board, ledger });
  assert.equal(published.leaderboard.length, 0);
  assert.equal(published.assets.length, 0);
  assert.deepEqual(voidCoinOptions(published).map((a) => [a.mint, a.verified]), [[mint, false]]);
  assert.equal(voidCoinOptions({ ...published, assets: [{ mint, symbol: "COIN" }] })[0].verified, true);
});

test("compact overall rows preserve coins beyond the former four-coin cutoff", () => {
  const assets = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`coin${i}`, { mint: `coin${i}`, amountRaw: "1" }]));
  const published = publicVoidSource({ ledger: { records: [] }, leaderboard: [{ wallet, assets }], assets: [] });
  assert.equal(Object.keys(published.leaderboard[0].assets).length, 7);
});

test("default rank restores deposit order after another column is selected", () => {
  const rows = [{ wallet: "a", assets: {} }, { wallet: "b", assets: {} }];
  assert.deepEqual(sortVoidRows(rows, "rank", "", new Map([["b", 1], ["a", 2]])).map((r) => r.wallet), ["b", "a"]);
});

test("search and sort use the refreshed snapshot rather than the initial render", () => {
  const previousDocument = globalThis.document;
  const elements = { voidRows: { innerHTML: "" }, voidAsset: { innerHTML: "", value: "" }, voidSearch: { value: "" } };
  globalThis.document = { getElementById: (id) => elements[id] };
  try {
    const board = { ok: true, ledger: { records: [] }, assets: [], leaderboard: [], verifiedEvents: 0, totalWallets: 1 };
    renderVoidBoard(board);
    renderVoidBoard({ ...board, totalWallets: 2 });
    elements.voidSearch.oninput();
    assert.match(elements.voidRows.innerHTML, /2 wallets/);
    elements.voidRows.onclick({ target: { closest: () => ({ dataset: { sort: "latest" } }) } });
    assert.match(elements.voidRows.innerHTML, /2 wallets/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("refresh preserves scroll, sort and a selected coin missing from a partial update", () => {
  const previousDocument = globalThis.document;
  const scroller = { scrollTop: 230, scrollLeft: 40 };
  const root = { innerHTML: "", querySelector: () => scroller };
  const select = { innerHTML: "", value: mint };
  globalThis.document = { getElementById: (id) => ({ voidRows: root, voidAsset: select, voidSearch: { value: "" } })[id] };
  try {
    const ui = { sort: "value" };
    renderVoidBoard({ ok: true, ledger: { records: [] }, assets: [], leaderboard: [], verifiedEvents: 0 }, ui);
    assert.equal(select.value, mint);
    assert.match(select.innerHTML, /unavailable in this update/);
    assert.equal(ui.sort, "value");
    assert.deepEqual(scroller, { scrollTop: 230, scrollLeft: 40 });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("Value selection survives automatic renders even without caller-owned state", () => {
  const previousDocument = globalThis.document;
  const scroller = { scrollTop: 300, scrollLeft: 0 };
  const root = { innerHTML: "", querySelector: () => scroller };
  const select = { value: "", innerHTML: "" };
  globalThis.document = { getElementById: (id) => ({ voidRows: root, voidAsset: select, voidSearch: { value: "" } })[id] };
  try {
    const row = (wallet, transactions, valueUsd) => ({ wallet, transactions, latestAt: "2026-10-22T00:00:00Z", assets: {
      [mint]: { mint, symbol: "COIN", amountRaw: "1", decimals: 0, transactions, valueUsd, unitPriceUsd: valueUsd },
    } });
    const source = { ok: true, ledger: { records: [] }, assets: [{ mint, symbol: "COIN" }], verifiedEvents: 11,
      leaderboard: [row("depositLeader", 10, 1), row("valueLeader", 1, 100)] };
    renderVoidBoard(source);
    root.onclick({ target: { closest: () => ({ dataset: { sort: "value" } }) } });
    renderVoidBoard({ ...source });
    assert.match(root.innerHTML, /sorted[^>]*data-sort="value"/);
    const body = root.innerHTML.split("<tbody>")[1];
    assert.ok(body.indexOf('title="valueLeader"') < body.indexOf('title="depositLeader"'));
    assert.equal(scroller.scrollTop, 300);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

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
  first.ledger.chainRpcRetryAt = new Date(Date.now() - 1).toISOString(); // provider cooldown has elapsed
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
      assert.ok([TOKEN, TOKEN_2022].includes(params[1].programId), "each token program uses a standard programId filter");
      assert.equal(params[1].programIds, undefined);
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

test("provider rate limiting is counted apart from bad data", async () => {
  const GOOD = "W".repeat(32);
  const tx = receipt();
  for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) b.mint = SHOCKER_MINT;
  const rpc = async (method, params) => {
    if (method === "getTokenAccountsByOwner") return { value: [{ pubkey: GOOD, account: { data: { parsed: { info: { owner: VOID_TREASURY, mint: SHOCKER_MINT, tokenAmount: { amount: "0" } } } } } }] };
    if (method === "getTokenSupply") return { value: { amount: "100000000", decimals: 6 } };
    if (method === "getSignaturesForAddress") return [{ signature, err: null, blockTime: tx.blockTime }];
    if (method === "getTransaction") throw Error("Solana RPC HTTP 429");
    throw Error(`Unexpected ${method}`);
  };
  const fetchJson = async (url) => url.includes("/holders/") ? { ok: true, json: { holders: [] } } : json([]);
  const out = await collectVoids({ rpc, fetchJson });
  assert.equal(out.ledger.chainRateLimited, 1, "a throttled call is reported as capacity, not as missing evidence");
  assert.ok(!out.ledger.chainUnreadable, "a throttled call is never mistaken for unreadable history");
  assert.equal(out.verifiedEvents, 0);
  // Repeated throttling must never turn a readable receipt into discarded evidence.
  const throttled = await collectVoids({ previous: out, rpc, fetchJson });
  const throttledAgain = await collectVoids({ previous: throttled, rpc, fetchJson });
  assert.equal(throttledAgain.ledger.chainRateLimited, 1, "a parked receipt is not re-burned on the next run");
  assert.ok(!throttledAgain.ledger.chainUnreadable, "throttling spends no retry budget, so nothing is discarded");
  assert.equal(throttledAgain.ledger.chainPending.length, 1, "the receipt stays queued for when capacity frees up");
  assert.ok(throttledAgain.ledger.chainPending[0].deferUntil > Date.now(), "a throttled receipt is parked, not dropped");
});

test("a page larger than the queue room still advances the account cursor", async () => {
  // The failure this guards: a 1000-signature page that never fits in the free
  // queue slots, so the cursor never moves and the account never completes.
  const GOOD = "V".repeat(32);
  const tx = receipt();
  for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) b.mint = SHOCKER_MINT;
  const sigs = Array.from({ length: 40 }, (_, i) => `4${String.fromCharCode(65 + (i % 26))}`.repeat(32));
  let served = 0;
  const rpc = async (method, params) => {
    if (method === "getTokenAccountsByOwner") return { value: [{ pubkey: GOOD, account: { data: { parsed: { info: { owner: VOID_TREASURY, mint: SHOCKER_MINT, tokenAmount: { amount: "0" } } } } } }] };
    if (method === "getTokenSupply") return { value: { amount: "100000000", decimals: 6 } };
    if (method === "getSignaturesForAddress") {
      const before = params[1].before;
      const rows = before ? sigs.filter((s) => sigs.indexOf(s) > sigs.indexOf(before)) : sigs;
      served += rows.length;
      return rows.map((s) => ({ signature: s, err: null, blockTime: tx.blockTime }));
    }
    if (method === "getTransaction") return tx;
    throw Error(`Unexpected ${method}`);
  };
  const fetchJson = async (url) => url.includes("/holders/") ? { ok: true, json: { holders: [] } } : json([]);
  const first = await collectVoids({ rpc, fetchJson });
  const account = first.ledger.chainAccounts.find((a) => a.address === GOOD);
  assert.ok(account.before, "the cursor advanced past the signatures it could not queue");
  assert.ok(first.ledger.chainReceiptsChecked > 0, "the queued receipts were actually sent for verification");
  assert.ok(served > 20, "a later run re-reads history instead of skipping it");
  const second = await collectVoids({ previous: first, rpc, fetchJson });
  assert.ok(second.ledger.chainAccounts.find((a) => a.address === GOOD).before, "the cursor survives to the next run");
});

test("columns sort by real metrics and a missing metric never sorts as zero", () => {
  const A = "P".repeat(32), B = "Q".repeat(32), C = "R".repeat(32);
  const rows = [
    { wallet: A, username: "Zed", transactions: 5, points: 10, assets: { [mint]: { mint, symbol: "CRACK", amountRaw: "900", decimals: 6, transactions: 5, valueUsd: 3, sharePct: 40 } } },
    { wallet: B, username: "Amy", transactions: 9, assets: { [mint]: { mint, symbol: "CRACK", amountRaw: "100", decimals: 6, transactions: 9, valueUsd: 1, sharePct: 10 } } },
    { wallet: C, username: "Mid", transactions: 7, points: 99, assets: { [mint]: { mint, symbol: "CRACK", amountRaw: "500", decimals: 6, transactions: 7 } } }];
  const rank = new Map(rows.map((r, i) => [r.wallet, i + 1]));
  assert.deepEqual(sortVoidRows(rows, "deposits", "", rank).map((r) => r.wallet), [B, C, A]);
  assert.deepEqual(sortVoidRows(rows, "value", "", rank).map((r) => r.wallet).slice(0, 2), [A, B], "value sorts by the real number");
  assert.equal(sortVoidRows(rows, "value", "", rank)[2].wallet, C, "a wallet with no price sorts last, never as $0");
  assert.deepEqual(sortVoidRows(rows, "points", "", rank).map((r) => r.wallet).slice(0, 2), [C, A]);
  assert.equal(sortVoidRows(rows, "points", "", rank)[2].wallet, B, "unranked wallets sort last");
  assert.deepEqual(sortVoidRows(rows, "wallet", "", rank).map((r) => r.username), ["Amy", "Mid", "Zed"]);
  assert.deepEqual(sortVoidRows(rows, "amount", mint, rank).map((r) => r.wallet), [A, C, B], "amount compares exact raw integers");
  assert.deepEqual(sortVoidRows(rows, "latest", "", rank)[0].wallet, rows[0].wallet, "latest is stable for equal timestamps");
});

test("share is coin-specific; an unrelated sole-depositor coin cannot inflate the overall column", () => {
  const rows = [
    { wallet: "b", assets: { [mint]: { sharePct: 10 }, OTHER: { sharePct: 100 } } },
    { wallet: "a", assets: { [mint]: { sharePct: 90 } } },
  ];
  assert.deepEqual(sortVoidRows(rows, "share", "").map((r) => r.wallet), ["a", "b"], "all-coins shares are unavailable and tie deterministically");
  assert.deepEqual(sortVoidRows(rows, "share", mint).map((r) => r.wallet), ["a", "b"]);
  const original = globalThis.document;
  const root = { innerHTML: "" }, select = { value: "", innerHTML: "" };
  globalThis.document = { getElementById: (id) => ({ voidRows: root, voidAsset: select, voidSearch: { value: "" } })[id] };
  try {
    const source = { ok: true, ledger: { records: [] }, verifiedEvents: 1, assets: [{ mint, symbol: "COIN" }],
      leaderboard: [{ wallet: "b", transactions: 1, assets: { [mint]: { mint, symbol: "COIN", sharePct: 100, amountRaw: "1", decimals: 0, transactions: 1 } } }] };
    renderVoidBoard(source);
    assert.match(root.innerHTML, /Select a coin to compare shares/);
    assert.doesNotMatch(root.innerHTML, /class="desk-number">100\.00%/);
    select.value = mint;
    renderVoidBoard(source);
    assert.match(root.innerHTML, /class="desk-number">100\.00%/);
    assert.match(root.innerHTML, /not its circulating supply/);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test("published market cap and TRIX points join the rows without inventing values", async () => {
  const other = "G".repeat(32);
  const ledger = { version: 1, records: [], totals: {}, keys: [], samples: [], verifiedCount: 0 };
  const forSig = (s, w) => {
    const tx = receipt();
    tx.transaction.signatures = [s];
    tx.transaction.message.accountKeys[0] = { pubkey: w, signer: true };
    tx.transaction.message.instructions[0].parsed.info.authority = w;
    tx.meta.preTokenBalances[0].owner = w;
    return tx;
  };
  const sigA = "9".repeat(64), sigB = "9".repeat(63) + "8";
  const v1 = verifyVoidTransfer(voidCandidate({ ...event, txSignature: sigA }), forSig(sigA, wallet));
  const v2 = verifyVoidTransfer(voidCandidate({ ...event, txSignature: sigB, walletAddress: other }), forSig(sigB, other));
  absorb(v1); absorb(v2);
  function absorb(v) {
    const id = `${v.wallet}|${v.asset}`;
    const row = ledger.totals[id] || (ledger.totals[id] = { wallet: v.wallet, asset: v.asset, symbol: v.symbol, decimals: v.decimals, amountRaw: "0", deposits: 0 });
    row.amountRaw = (BigInt(row.amountRaw) + BigInt(v.amountRaw)).toString();
    row.deposits++;
    ledger.verifiedCount++;
  }
  ledger.assetSupplies = { [mint]: { amountRaw: "100000000", decimals: 6, checkedAt: "2026-10-01T00:00:00Z" } };
  const base = { checkedAt: "2026-10-01T00:00:00Z" };
  const s1 = summarizeVoidsWith(ledger, { ...base, coins: [{ mintAddress: mint, ticker: "RUG", tokenName: "Rug Coin", logoUrl: "https://x.test/l.png", currentMarketCap: 1000, marketCapUpdatedAt: "2026-10-01T00:00:00Z" }], catalogTotal: 1077 },
    { ...base, leaderboard: { entries: 100, capped: true, rows: [{ rank: 7, username: "hunter", wallet: other, points: 4242 }] } });
  const top = s1.leaderboard.find((r) => r.wallet === other);
  const a = top.assets[mint];
  assert.equal(a.valueUsd, 50, "5 tokens at $10 (a $1000 cap over 100 tokens of supply) is $50");
  assert.equal(a.unitPriceUsd, 10);
  assert.equal(top.points, 4242);
  assert.equal(top.pointsRank, 7);
  assert.equal(top.username, "hunter", "a points row names a wallet that had no other name");
  assert.equal(s1.assets[0].logo, "https://x.test/l.png");
  const fresh = { version: 1, records: [], totals: JSON.parse(JSON.stringify(ledger.totals)), keys: [], samples: [], verifiedCount: 2,
    assetSupplies: ledger.assetSupplies };
  const s2 = summarizeVoidsWith(fresh, base, base);
  assert.equal(s2.leaderboard.find((r) => r.wallet === other).assets[mint].valueUsd, undefined, "no published cap means no value, never $0");
  assert.ok(s2.leaderboard.find((r) => r.wallet === other).assets[mint].sharePct > 0, "share of coin volume still works without market data");
  assert.equal(s1.leaderboard.find((r) => r.wallet === other).assets[mint].valueUsd, 50, "a later empty read keeps the last known cap rather than erasing value");
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

test("an unavailable receipt leaves the active queue but retains its identity for recovery", async () => {
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
  assert.equal(out.ledger.chainPruned, undefined, "a null response does not prove permanently pruned history");
  assert.equal(out.ledger.chainRetry[0].signature, deadSig);
  assert.ok(out.ledger.chainRetry[0].deferUntil > Date.now());
  assert.equal(out.verifiedEvents, 1);
});
