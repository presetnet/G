export const VOID_TREASURY = "H1HU4Bfg6hsMz8SP2JB27urLM1TeB7UhKREsukRtvoid";
export const VOID_FEED = "https://www.trix.market/api/feed/trades";
const TOKENS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const LIMIT = 2500;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const rawAmount = (value) => { assert(/^\d+$/.test(String(value)), "Invalid transfer amount"); return BigInt(value); };

export function voidCandidate(row) {
  if (row?.side !== "void" || !ADDRESS.test(row.walletAddress || "") || !SIGNATURE.test(row.txSignature || "")) return null;
  const token = ADDRESS.test(row.mint || "") && Number(row.tokenAmount) > 0;
  const native = !token && Number(row.solAmount) > 0 && !Number(row.tokenAmount);
  if (!token && !native) return null;
  const asset = token ? row.mint : "SOL";
  return { key: `${row.txSignature}:${row.walletAddress}:${asset}`, signature: row.txSignature, wallet: row.walletAddress,
    asset, symbol: token ? String(row.symbol || "TOKEN").slice(0, 32) : "SOL",
    username: typeof row.username === "string" ? row.username.slice(0, 80) : null,
    reportedSol: native ? row.solAmount : null, reportedAt: row.createdAt || null, status: "pending", attempts: 0 };
}

// Feed classification identifies intent. The receipt proves a successful transfer
// by that wallet into this treasury; it does NOT prove burning or point awards.
export function verifyVoidTransfer(candidate, tx) {
  assert(tx?.meta && tx.meta.err === null, "Transaction missing or unsuccessful");
  assert(tx.transaction?.signatures?.includes(candidate.signature), "Receipt signature mismatch");
  const keys = tx.transaction.message?.accountKeys || [];
  assert(keys.some((k) => k.pubkey === candidate.wallet && k.signer === true), "Reported wallet did not sign");
  const instructions = [...(tx.transaction.message.instructions || []), ...(tx.meta.innerInstructions || []).flatMap((g) => g.instructions || [])];
  let amount = 0n, decimals = candidate.asset === "SOL" ? 9 : null;
  const balances = [...(tx.meta.preTokenBalances || []), ...(tx.meta.postTokenBalances || [])];
  const account = (address, owner) => balances.find((b) => keys[b.accountIndex]?.pubkey === address && b.owner === owner && b.mint === candidate.asset);
  for (const instruction of instructions) {
    const p = instruction.parsed;
    const i = p?.info;
    if (!i) continue;
    if (candidate.asset === "SOL") {
      if (instruction.programId === "11111111111111111111111111111111" && p.type === "transfer" && i.source === candidate.wallet && i.destination === VOID_TREASURY) amount += rawAmount(i.lamports);
    } else if (TOKENS.has(instruction.programId) && ["transfer", "transferChecked"].includes(p.type) && i.authority === candidate.wallet) {
      const from = account(i.source, candidate.wallet), to = account(i.destination, VOID_TREASURY);
      if (!from || !to) continue;
      const d = from.uiTokenAmount?.decimals;
      assert(Number.isInteger(d) && d >= 0 && d <= 18 && d === to.uiTokenAmount?.decimals, "Token decimals mismatch");
      assert(decimals === null || decimals === d, "Inconsistent token decimals");
      decimals = d;
      amount += rawAmount(i.amount ?? i.tokenAmount?.amount);
    }
  }
  assert(amount > 0n && decimals !== null, "No matching transfer to the void treasury");
  if (candidate.asset !== "SOL") {
    const total = (rows, owner) => rows.filter((b) => b.owner === owner && b.mint === candidate.asset).reduce((sum, b) => sum + rawAmount(b.uiTokenAmount.amount), 0n);
    const pre = tx.meta.preTokenBalances || [], post = tx.meta.postTokenBalances || [];
    assert(total(post, VOID_TREASURY) - total(pre, VOID_TREASURY) >= amount, "Treasury token credit does not confirm the transfer amount");
    assert(total(pre, candidate.wallet) - total(post, candidate.wallet) >= amount, "Sender token debit does not confirm the transfer amount");
  }
  if (candidate.asset === "SOL") {
    const lamports = Number(candidate.reportedSol) * 1e9;
    assert(Number.isSafeInteger(lamports) && BigInt(lamports) === amount, "SOL transfer does not match the reported void amount; fees are not inferred as voids");
  }
  assert(Number.isSafeInteger(tx.blockTime) && tx.blockTime > 0, "Transaction time unavailable");
  return { ...candidate, status: "verified", amountRaw: amount.toString(), decimals, slot: tx.slot,
    at: new Date(tx.blockTime * 1000).toISOString(), reason: null };
}

export function summarizeVoids(ledger) {
  const wallets = new Map(), assets = new Map();
  for (const event of ledger.records.filter((r) => r.status === "verified")) {
    const wallet = wallets.get(event.wallet) || { wallet: event.wallet, username: event.username, signatures: new Set(), assets: {}, latestAt: null, latestSignature: null };
    if (event.username) wallet.username = event.username;
    wallet.signatures.add(event.signature);
    const asset = wallet.assets[event.asset] || { mint: event.asset, symbol: event.symbol, amountRaw: "0", decimals: event.decimals, transactions: 0 };
    if (asset.decimals !== event.decimals) continue;
    asset.amountRaw = (BigInt(asset.amountRaw) + BigInt(event.amountRaw)).toString();
    asset.transactions++;
    wallet.assets[event.asset] = asset;
    assets.set(event.asset, { mint: event.asset, symbol: event.symbol, decimals: event.decimals });
    if (!wallet.latestAt || event.at > wallet.latestAt) { wallet.latestAt = event.at; wallet.latestSignature = event.signature; }
    wallets.set(event.wallet, wallet);
  }
  const leaderboard = [...wallets.values()].map(({ signatures, ...w }) => ({ ...w, transactions: signatures.size }));
  leaderboard.sort((a, b) => b.transactions - a.transactions || a.wallet.localeCompare(b.wallet));
  return { leaderboard, assets: [...assets.values()], verifiedEvents: ledger.records.filter((r) => r.status === "verified").length,
    pendingEvents: ledger.records.filter((r) => r.status === "pending").length,
    unverifiedEvents: ledger.records.filter((r) => r.status === "unverified").length };
}

export async function collectVoids({ previous, fetchJson, rpc, now = new Date().toISOString() }) {
  const old = previous?.ledger?.version === 1 ? previous.ledger : null;
  const ledger = old ? JSON.parse(JSON.stringify(old)) : { version: 1, startedAt: now, records: [], before: null, historyComplete: false,
    historyOldestAt: null, recentGapBefore: null, recentHead: null, coverageGaps: false, capped: false };
  const known = new Set(ledger.records.map((r) => r.key));
  const failures = [];
  let recentOk = false, pagesRead = 0;
  const ingest = (items) => {
    for (const row of items) {
      const candidate = voidCandidate(row);
      if (!candidate || known.has(candidate.key)) continue;
      if (ledger.records.length >= LIMIT) { ledger.capped = true; return false; }
      ledger.records.push(candidate); known.add(candidate.key);
    }
    return true;
  };
  const page = async (before) => {
    const response = await fetchJson(`${VOID_FEED}?limit=100${before ? `&before=${before}` : ""}`, { timeoutMs: 5000 });
    assert(response.ok && Array.isArray(response.json?.items), "Void discovery feed unavailable");
    pagesRead++;
    return response.json;
  };
  const cursor = (j) => {
    if (j.nextBefore == null) return null;
    assert(Number.isSafeInteger(j.nextBefore) && j.nextBefore > 0, "Invalid history cursor");
    return j.nextBefore;
  };
  const earliest = (items) => items.map((r) => Date.parse(r.createdAt)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  if (!ledger.capped) {
    try {
      const recent = await page(null);
      recentOk = true;
      const end = cursor(recent), oldest = earliest(recent.items);
      const newest = Math.max(...recent.items.map((r) => Date.parse(r.createdAt)).filter(Number.isFinite));
      if (ledger.recentHead && oldest > ledger.recentHead && end && !ledger.recentGapBefore) ledger.recentGapBefore = end;
      else if (ledger.recentHead && oldest > ledger.recentHead && ledger.recentGapBefore) ledger.coverageGaps = true;
      ingest(recent.items);
      if (!old) { ledger.before = end; ledger.historyComplete = !end; ledger.historyOldestAt = Number.isFinite(oldest) ? new Date(oldest).toISOString() : null; }
      if (Number.isFinite(newest)) ledger.recentHead = newest;
      ledger.lastFeedAt = now;
    } catch (e) { failures.push(e.message); }
    // One historical page per tick. Never drop existing credits to make room.
    const before = ledger.recentGapBefore || (!ledger.historyComplete ? ledger.before : null);
    if (before && !ledger.capped) {
      try {
        const historical = await page(before);
        const next = cursor(historical);
        assert(!next || next < before, "History cursor did not advance");
        if (ingest(historical.items)) {
          const oldest = earliest(historical.items);
          if (ledger.recentGapBefore) {
            // Gap scans may overlap history; receipt keys make overlap idempotent.
            ledger.recentGapBefore = next && (!ledger.before || next > ledger.before) ? next : null;
          } else {
            ledger.before = next; ledger.historyComplete = !next;
            if (Number.isFinite(oldest)) ledger.historyOldestAt = new Date(oldest).toISOString();
          }
        }
      } catch (e) { failures.push(e.message); }
    }
  }
  const pending = ledger.records.filter((r) => r.status === "pending").sort((a, b) => a.attempts - b.attempts).slice(0, 4);
  // Two at a time to respect public RPC limits and the collector's deadline.
  for (let offset = 0; offset < pending.length; offset += 2) await Promise.all(pending.slice(offset, offset + 2).map(async (record) => {
    record.attempts++;
    let tx;
    try {
      tx = await rpc("getTransaction", [record.signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }], { timeoutMs: 4500 });
      assert(tx, "Receipt not yet available");
    } catch (e) {
      record.reason = String(e.message).slice(0, 200);
      failures.push(`Receipt check: ${record.reason}`);
      return;
    }
    try { Object.assign(record, verifyVoidTransfer(record, tx)); }
    catch (e) {
      record.reason = String(e.message).slice(0, 200); record.status = "unverified";
      failures.push(`Receipt evidence: ${record.reason}`);
    }
  }));
  return { source: "trix.voids", ok: recentOk || ledger.records.length > 0, stale: !recentOk, status: recentOk ? 200 : 0,
    checkedAt: now, dataUpdatedAt: ledger.lastFeedAt || null, treasury: VOID_TREASURY, sourceUrl: VOID_FEED,
    ...summarizeVoids(ledger), ledger, retainedLimit: LIMIT, pagesRead, partial: true,
    reason: failures.length ? [...new Set(failures)].join("; ") : null,
    note: "Observed TRIX-classified voids with successful treasury transfers verified from receipts. Transfers are not token burns. No current holdings are queried. Ranking is transaction count or amounts within one asset, never a sum of unrelated token units. Historical discovery progresses one page per tick; coverage and retained-event limits are disclosed." };
}

export function restoreVoidHistory(latest, ledger) {
  if (ledger?.version !== 1 || !Array.isArray(ledger.records) || latest?.sources?.["trix.voids"]?.ledger) return latest;
  return { ...(latest || {}), sources: { ...(latest?.sources || {}), "trix.voids": {
    source: "trix.voids", ok: true, stale: true, ledger, retainedLimit: LIMIT, treasury: VOID_TREASURY, sourceUrl: VOID_FEED,
    checkedAt: null, dataUpdatedAt: ledger.lastFeedAt || null, ...summarizeVoids(ledger),
    reason: "No current collector snapshot. Showing stored historical receipt evidence.",
  } } };
}
