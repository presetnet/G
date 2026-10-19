export const VOID_TREASURY = "H1HU4Bfg6hsMz8SP2JB27urLM1TeB7UhKREsukRtvoid";
export const VOID_FEED = "https://www.trix.market/api/feed/trades";
export const TRIX_CATALOG = "https://www.trix.market/api/launches";
export const SHOCKER_MINT = "E6LwzUpR2NsdUzAiGzZb1K5PbffkXANagXHt1R4BTRiX";
const TOKENS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
// Verified deposits roll up into durable per-wallet, per-asset totals. The receipt
// list itself is only a recent proof sample: retaining every event once would cap
// discovery at a few thousand rows and silently truncate all-time rankings.
const SAMPLE_WINDOW = 600;
const KEY_WINDOW = 20000;
const PENDING_LIMIT = 400;
const ACCOUNT_LIMIT = 1500;
// A keyed provider serves the historical scan far faster than the shared public
// endpoint, which answers in bursts and then returns HTTP 429. The collector
// still honours its own deadline; only the per-tick budget changes.
const RPC_TIER = process.env.HELIUS_API_KEY || process.env.SOLANA_RPC_URL
  ? { receiptBatch: 120, receiptParallel: 8, accountQueue: 240, accountsPerTick: 8, signaturePage: 1000 }
  : { receiptBatch: 24, receiptParallel: 3, accountQueue: 12, accountsPerTick: 1, signaturePage: 100 };
const SIGNATURE_PAGE = RPC_TIER.signaturePage;
// A 1000-signature page can queue far more receipts than one run verifies, which
// starves the account walk behind the backlog. Enqueue at most this many new
// receipts per run; an unfinished page is re-read next run rather than skipped.
const ENQUEUE_PER_RUN = RPC_TIER.receiptBatch * 2;
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

// Creator attribution comes from TRIX's own launch catalog, which names the
// wallet behind every coin. It never depends on whether that wallet still holds
// anything, so a creator such as JLEE stays attributed after selling out.
function catalogName(ledger, wallet) {
  return ledger.names?.[wallet] || ledger.catalog?.wallets?.[wallet] || null;
}

function absorbVerified(ledger, record) {
  const id = `${record.wallet}|${record.asset}`;
  const row = ledger.totals[id] || (ledger.totals[id] = { wallet: record.wallet, asset: record.asset, symbol: record.symbol,
    decimals: record.decimals, amountRaw: "0", deposits: 0, latestAt: null, latestSignature: null });
  if (row.decimals !== record.decimals) return false;
  row.amountRaw = (BigInt(row.amountRaw) + BigInt(record.amountRaw)).toString();
  row.deposits++;
  if (!row.latestAt || record.at > row.latestAt) { row.latestAt = record.at; row.latestSignature = record.signature; }
  ledger.verifiedCount = (ledger.verifiedCount || 0) + 1;
  ledger.keys.push(record.key);
  ledger.samples.push({ wallet: record.wallet, asset: record.asset, signature: record.signature, amountRaw: record.amountRaw,
    decimals: record.decimals, symbol: record.symbol, at: record.at, status: "verified" });
  if (ledger.keys.length > KEY_WINDOW) ledger.keys.splice(0, ledger.keys.length - KEY_WINDOW);
  if (ledger.samples.length > SAMPLE_WINDOW) ledger.samples.splice(0, ledger.samples.length - SAMPLE_WINDOW);
  return true;
}

// Ledgers written before rollups existed kept every verified event in `records`
// and stopped the whole scan at the retention limit. Fold those rows into totals
// once, then keep only unverified work in the queue.
function migrateLedger(ledger) {
  ledger.totals = {};
  ledger.keys = [];
  ledger.samples = [];
  ledger.verifiedCount = 0;
  const verified = ledger.records.filter((r) => r.status === "verified");
  for (const record of verified) absorbVerified(ledger, record);
  ledger.records = ledger.records.filter((r) => r.status !== "verified");
  ledger.migratedFrom = verified.length;
  ledger.capped = false;
}

export function summarizeVoids(ledger) {
  const wallets = new Map(), assets = new Map();
  const rolled = ledger.totals && Object.keys(ledger.totals).length ? Object.values(ledger.totals) : null;
  const events = rolled || ledger.records.filter((r) => r.status === "verified");
  for (const event of events) {
    const wallet = wallets.get(event.wallet) || { wallet: event.wallet, username: null, assets: {}, latestAt: null, latestSignature: null, transactions: 0 };
    const name = catalogName(ledger, event.wallet) || event.username;
    if (name) wallet.username = name;
    const coin = ledger.catalog?.mints?.[event.asset];
    const asset = wallet.assets[event.asset] || { mint: event.asset, symbol: coin?.symbol || event.symbol, creator: coin?.creator || null, amountRaw: "0", decimals: event.decimals, transactions: 0 };
    if (asset.decimals !== event.decimals) continue;
    asset.amountRaw = rolled ? event.amountRaw : (BigInt(asset.amountRaw) + BigInt(event.amountRaw)).toString();
    asset.transactions += rolled ? event.deposits : 1;
    if (!asset.latestAt || event.at > asset.latestAt) { asset.latestAt = event.at; asset.latestSignature = event.signature; }
    wallet.assets[event.asset] = asset;
    wallet.transactions += rolled ? event.deposits : 1;
    assets.set(event.asset, { mint: event.asset, symbol: coin?.symbol || event.symbol, decimals: event.decimals,
      name: coin?.name || null, creator: coin?.creator || null, creatorWallet: coin?.creatorWallet || null });
    if (!wallet.latestAt || event.at > wallet.latestAt) { wallet.latestAt = event.at; wallet.latestSignature = event.signature; }
    wallets.set(event.wallet, wallet);
  }
  const leaderboard = [...wallets.values()].map((w) => {
    for (const asset of Object.values(w.assets)) {
      const supply = ledger.assetSupplies?.[asset.mint];
      if (supply?.amountRaw && supply.decimals === asset.decimals && BigInt(supply.amountRaw) > 0n) {
        const scaled = BigInt(asset.amountRaw) * 1000000n / BigInt(supply.amountRaw);
        if (scaled <= BigInt(Number.MAX_SAFE_INTEGER)) asset.supplyPct = Number(scaled) / 10000;
        asset.supplyCheckedAt = supply.checkedAt;
      }
    }
    return w;
  });
  leaderboard.sort((a, b) => b.transactions - a.transactions || a.wallet.localeCompare(b.wallet));
  const list = [...assets.values()];
  const covered = ledger.catalog?.total ? list.filter((a) => ledger.catalog.mints[a.mint]).length : null;
  return { leaderboard, assets: list, verifiedEvents: rolled ? (ledger.verifiedCount || 0) : events.length,
    pendingEvents: ledger.records.filter((r) => r.status === "pending").length,
    unverifiedEvents: ledger.records.filter((r) => r.status === "unverified").length,
    catalogTotal: ledger.catalog?.total ?? null, catalogCovered: covered, catalogAt: ledger.catalog?.at ?? null };
}

// TRIX publishes every launch with its creator's wallet. This is the complete
// coin catalog plus attribution that does not depend on current holdings.
async function collectTrixCatalog(ledger, fetchJson, now) {
  if (ledger.catalog?.at && Date.parse(now) - Date.parse(ledger.catalog.at) < 6 * 3600_000) return ledger.catalog;
  const mints = {}, wallets = {};
  let offset = 0, total = 0, seen = 0;
  for (let page = 0; page < 8; page++) {
    const response = await fetchJson(`${TRIX_CATALOG}?sort=latest&limit=500&offset=${offset}`, { timeoutMs: 9000 });
    const items = response.json?.items;
    assert(Array.isArray(items) && items.length, "TRIX launch catalog unavailable");
    total = Number(response.json.total) || total;
    for (const item of items) {
      const mint = item?.mintAddress;
      if (!ADDRESS.test(mint || "")) continue;
      const creator = String(item.creator?.username || "").slice(0, 80) || null;
      const creatorWallet = ADDRESS.test(item.creator?.walletAddress || "") ? item.creator.walletAddress : null;
      if (creator && creatorWallet) wallets[creatorWallet] = creator;
      mints[mint] = { symbol: String(item.symbol || item.name || mint.slice(0, 6)).slice(0, 32), name: String(item.name || "").slice(0, 60) || null,
        creator, creatorWallet, launchedAt: item.createdAt || null };
    }
    seen += items.length; offset += items.length;
    // A short page or a repeated page means the catalog is exhausted; never spin.
    if (items.length < 500 || (total && offset >= total)) break;
  }
  assert(seen > 0 && Object.keys(mints).length > 0, "TRIX launch catalog empty");
  ledger.catalog = { at: now, total: total || seen, mints, wallets };
  return ledger.catalog;
}

export function candidatesFromTreasuryReceipt(tx, signature, mint, symbol) {
  if (!tx?.meta || tx.meta.err !== null) return [];
  const keys = tx.transaction?.message?.accountKeys || [];
  const balances = [...(tx.meta.preTokenBalances || []), ...(tx.meta.postTokenBalances || [])];
  const instructions = [...(tx.transaction?.message?.instructions || []), ...(tx.meta.innerInstructions || []).flatMap((g) => g.instructions || [])];
  const found = new Map();
  for (const instruction of instructions) {
    if (!TOKENS.has(instruction.programId) || !["transfer", "transferChecked"].includes(instruction.parsed?.type)) continue;
    const i = instruction.parsed.info;
    const dest = balances.find((b) => keys[b.accountIndex]?.pubkey === i.destination && b.owner === VOID_TREASURY && b.mint === mint);
    const from = balances.find((b) => keys[b.accountIndex]?.pubkey === i.source && b.mint === mint);
    if (!dest || !from || from.owner === VOID_TREASURY || !ADDRESS.test(from.owner || "")) continue;
    const wallet = from.owner, key = `${signature}:${wallet}:${mint}`;
    found.set(key, { key, signature, wallet, asset: mint, symbol, username: null, discovery: "treasury-token-history", status: "pending", attempts: 0 });
  }
  return [...found.values()];
}

async function discoverTreasuryHistory(ledger, rpc, fetchJson, now) {
  ledger.chainAccounts ||= [];
  ledger.chainPending ||= [];
  ledger.chainSeen ||= [];
  ledger.names ||= {};
  ledger.assetSupplies ||= {};
  if (!ledger.chainInventoryAt || Date.parse(now) - Date.parse(ledger.chainInventoryAt) > 6 * 3600_000) {
    // The treasury's inventory selects account histories, not eligible people.
    // Keep zero-balance accounts and previously seen accounts as well.
    const response = await rpc("getTokenAccountsByOwner", [VOID_TREASURY, { programId: [...TOKENS][0] }, { encoding: "jsonParsed", commitment: "finalized" }], { timeoutMs: 4500 });
    assert(Array.isArray(response?.value), "Treasury token-account inventory unavailable");
    const known = new Set(ledger.chainAccounts.map((a) => a.address));
    const inventory = [...response.value].sort((a, b) => Number(b.account?.data?.parsed?.info?.mint === SHOCKER_MINT) - Number(a.account?.data?.parsed?.info?.mint === SHOCKER_MINT));
    for (const row of inventory) {
      const info = row.account?.data?.parsed?.info;
      if (info?.owner !== VOID_TREASURY || !ADDRESS.test(info.mint || "")) continue;
      if (known.has(row.pubkey)) {
        const existing = ledger.chainAccounts.find((a) => a.address === row.pubkey);
        if (existing.complete && existing.balanceRaw !== info.tokenAmount?.amount) { existing.complete = false; existing.before = null; }
        existing.balanceRaw = info.tokenAmount?.amount;
        continue;
      }
      if (ledger.chainAccounts.length >= ACCOUNT_LIMIT) { ledger.chainInventoryCapped = true; break; }
      const coin = ledger.catalog?.mints?.[info.mint];
      ledger.chainAccounts.push({ address: row.pubkey, mint: info.mint, symbol: coin?.symbol || (info.mint === SHOCKER_MINT ? "SHOCKER" : info.mint.slice(0, 6)), balanceRaw: info.tokenAmount?.amount, before: null, complete: false });
      known.add(row.pubkey);
    }
    ledger.chainAccounts.sort((a, b) => Number(b.mint === SHOCKER_MINT) - Number(a.mint === SHOCKER_MINT));
    ledger.chainInventoryAt = now;
  }
  if (ledger.chainPending.length >= RPC_TIER.accountQueue) return;
  const deadline = Date.now() + 12000;
  const deferred = [];
  let enqueued = 0;
  // One account per tick left the receipt queue empty while 500+ accounts sat
  // unscanned. Walk several accounts until the queue is full or the budget ends.
  for (let scanned = 0; scanned < RPC_TIER.accountsPerTick; scanned++) {
    if (Date.now() >= deadline || ledger.chainPending.length >= RPC_TIER.accountQueue || enqueued >= ENQUEUE_PER_RUN) break;
    // An account that fails or refuses to advance its cursor is parked briefly.
    // Without this, one stubborn account is re-picked every run and the 500
    // accounts behind it are never reached.
    const account = ledger.chainAccounts.find((a) => !a.complete && (!a.retryAfter || Date.parse(a.retryAfter) <= Date.now()));
    if (!account) break;
    try {
      if (!account.named) {
        // Holder profiles supply optional names ONLY. Absence from this list never
        // excludes an on-chain depositor or requires them to retain any holdings.
        try {
          const response = await fetchJson(`https://www.trix.market/api/holders/${account.mint}?limit=50`, { timeoutMs: 3500 });
          for (const row of response.json?.holders || []) if (ADDRESS.test(row.address || "") && row.trixUsername && !row.isPool && !row.isVoid) ledger.names[row.address] = String(row.trixUsername).slice(0, 80);
        } catch { /* Receipt discovery does not depend on the profile service. */ }
        account.named = true;
      }
      if (!ledger.assetSupplies[account.mint]) {
        try {
          const supply = await rpc("getTokenSupply", [account.mint, { commitment: "finalized" }], { timeoutMs: 3500 });
          if (supply?.value?.amount && Number.isInteger(supply.value.decimals)) ledger.assetSupplies[account.mint] = { amountRaw: supply.value.amount, decimals: supply.value.decimals, checkedAt: now, slot: supply.context?.slot };
        } catch { /* Missing supply never prevents ranking exact transfer amounts. */ }
      }
      const signatures = await rpc("getSignaturesForAddress", [account.address, { limit: SIGNATURE_PAGE, commitment: "finalized", ...(account.before ? { before: account.before } : {}) }], { timeoutMs: 4500 });
      assert(Array.isArray(signatures), "Treasury token history unavailable");
      const known = new Set([...ledger.chainSeen, ...ledger.chainPending.map((p) => `${p.signature}:${p.mint}`)]);
      let consumedAll = true;
      for (const row of signatures) {
        if (row.err || !SIGNATURE.test(row.signature || "")) continue;
        const key = `${row.signature}:${account.mint}`;
        if (known.has(key)) continue;
        // Stop cleanly mid-page: the cursor stays put, so the remainder is
        // re-read next run instead of being skipped for good.
        if (enqueued >= ENQUEUE_PER_RUN) { consumedAll = false; break; }
        ledger.chainPending.push({ signature: row.signature, mint: account.mint, symbol: account.symbol, attempts: 0 });
        known.add(key); enqueued++;
      }
      if (!consumedAll) { account.pendingPage = true; continue; }
      account.pendingPage = false;
      const next = signatures.at(-1)?.signature;
      assert(!next || next !== account.before, "Chain history cursor did not advance");
      account.before = next || account.before;
      account.complete = signatures.length < SIGNATURE_PAGE;
      account.retryAfter = null;
      const oldest = signatures.at(-1)?.blockTime;
      if (oldest) account.oldestAt = new Date(oldest * 1000).toISOString();
    } catch (e) {
      account.retryAfter = new Date(Date.now() + 10 * 60_000).toISOString();
      account.lastError = String(e.message).slice(0, 160);
      ledger.chainAccountErrors = (ledger.chainAccountErrors || 0) + 1;
      deferred.push(`${account.symbol}: ${e.message}`);
    }
  }
  if (deferred.length) {
    ledger.chainDeferred = [...new Set(deferred)].slice(0, 4);
    const error = new Error(`Deferred ${deferred.length} account scan(s): ${ledger.chainDeferred.join("; ")}`);
    error.deferred = true;
    throw error;
  }
}

export async function collectVoids({ previous, fetchJson, rpc, now = new Date().toISOString() }) {
  const deadline = Date.now() + 25000;
  const old = previous?.ledger?.version === 1 ? previous.ledger : null;
  const ledger = old ? JSON.parse(JSON.stringify(old)) : { version: 1, startedAt: now, records: [], before: null, historyComplete: false,
    historyOldestAt: null, recentGapBefore: null, recentHead: null, coverageGaps: false, capped: false };
  if (!ledger.totals) migrateLedger(ledger);
  ledger.capped = false;
  const failures = [];
  let recentOk = false, pagesRead = 0;
  // Catalog first: it supplies coin symbols and creator wallets for this tick.
  if (Date.now() < deadline) {
    try { await collectTrixCatalog(ledger, fetchJson, now); }
    catch (e) { failures.push(`TRIX catalog: ${e.message}`); }
  }
  const known = new Set([...(ledger.keys || []), ...ledger.records.map((r) => r.key)]);
  const ingest = (items) => {
    for (const row of items) {
      const candidate = voidCandidate(row);
      if (!candidate || known.has(candidate.key)) continue;
      if (ledger.records.length >= PENDING_LIMIT) return false;
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
  if (before) {
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
  if (recentOk && Date.now() < deadline) {
    try { await discoverTreasuryHistory(ledger, rpc, fetchJson, now); }
    catch (e) { failures.push(`Chain discovery: ${e.message}`); }
  }
  const pending = ledger.records.filter((r) => r.status === "pending").sort((a, b) => a.attempts - b.attempts).slice(0, 4);
  // Two at a time to respect public RPC limits and the collector's deadline.
  for (let offset = 0; offset < pending.length; offset += 2) await Promise.all(pending.slice(offset, offset + 2).map(async (record) => {
    if (Date.now() >= deadline) return;
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
    try {
      Object.assign(record, verifyVoidTransfer(record, tx));
      // Roll the receipt into durable totals; only a recent sample is retained.
      absorbVerified(ledger, record);
      known.delete(record.key);
      ledger.records = ledger.records.filter((r) => r !== record);
    } catch (e) {
      record.reason = String(e.message).slice(0, 200); record.status = "unverified";
      failures.push(`Receipt evidence: ${record.reason}`);
    }
  }));
  const chainBatch = (ledger.chainPending || []).sort((a, b) => a.attempts - b.attempts).slice(0, RPC_TIER.receiptBatch);
  for (let offset = 0; offset < chainBatch.length; offset += RPC_TIER.receiptParallel) await Promise.all(chainBatch.slice(offset, offset + RPC_TIER.receiptParallel).map(async (entry) => {
    if (Date.now() >= deadline) return;
    entry.attempts++;
    try {
      const tx = await rpc("getTransaction", [entry.signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }], { timeoutMs: 4500 });
      assert(tx, "Historical receipt not available");
      const candidates = candidatesFromTreasuryReceipt(tx, entry.signature, entry.mint, entry.symbol);
      ledger.chainReceiptsChecked = (ledger.chainReceiptsChecked || 0) + 1;
      for (const candidate of candidates) {
        if (known.has(candidate.key)) continue;
        try {
          const verified = verifyVoidTransfer(candidate, tx);
          absorbVerified(ledger, verified); known.add(verified.key);
        } catch (e) { ledger.chainUnverified = (ledger.chainUnverified || 0) + 1; failures.push(`Historical verification: ${e.message}`); }
      }
      ledger.chainSeen.push(`${entry.signature}:${entry.mint}`);
      ledger.chainPending = ledger.chainPending.filter((p) => p !== entry);
      // History cursors prevent rescans; this is only an overlap guard.
      if (ledger.chainSeen.length > 5000) ledger.chainSeen = ledger.chainSeen.slice(-5000);
    } catch (e) {
      // An unreadable or permanently rejected receipt used to stay queued for
      // ever, and those repeats ate the whole per-run batch and stalled every
      // account behind them. Give up after a few tries and say so.
      if (entry.attempts >= 3) {
        ledger.chainUnreadable = (ledger.chainUnreadable || 0) + 1;
        ledger.chainPending = ledger.chainPending.filter((p) => p !== entry);
      }
      failures.push(`Historical receipt: ${e.message}`);
    }
  }));
  return { source: "trix.voids", ok: recentOk || (ledger.verifiedCount || 0) > 0 || ledger.records.length > 0, stale: !recentOk, status: recentOk ? 200 : 0,
    checkedAt: now, dataUpdatedAt: ledger.lastFeedAt || null, treasury: VOID_TREASURY, sourceUrl: VOID_FEED,
    ...summarizeVoids(ledger), ledger, proofSamples: SAMPLE_WINDOW, receiptBatch: RPC_TIER.receiptBatch, pagesRead, partial: true,
    reason: failures.length ? [...new Set(failures)].join("; ") : null,
    note: "Receipt-verified treasury deposits discovered from TRIX's void feed and the treasury's SPL-token account histories, including zero-balance accounts. Individual holdings never determine inclusion. Direct transfers may not have TRIX points attached and are not token burns. Coin symbols and creator names come from TRIX's launch catalog, so a creator stays attributed even after selling out; a coin with no verified treasury deposit is absent here, not excluded. Chain coverage starts with SHOCKER and advances across discovered treasury accounts; closed accounts absent from inventory, Token-2022 histories, unsupported transfer forms and unread receipts can be missing. Rankings remain partial while historical scans run." };
}

export function restoreVoidHistory(latest, ledger) {
  if (ledger?.version !== 1 || !Array.isArray(ledger.records) || latest?.sources?.["trix.voids"]?.ledger) return latest;
  return { ...(latest || {}), sources: { ...(latest?.sources || {}), "trix.voids": {
    source: "trix.voids", ok: true, stale: true, ledger, proofSamples: SAMPLE_WINDOW, treasury: VOID_TREASURY, sourceUrl: VOID_FEED,
    checkedAt: null, dataUpdatedAt: ledger.lastFeedAt || null, ...summarizeVoids(ledger),
    reason: "No current collector snapshot. Showing stored historical receipt evidence.",
  } } };
}

// Keep the durable scan state in storage, not in every browser status response.
export function publicVoidSource(source) {
  if (!source?.ledger || source.publicView) return source;
  const { ledger, leaderboard = [], ...summary } = source;
  const compactRow = (row, asset) => ({ ...row, assets: asset ? { [asset]: row.assets[asset] } : Object.fromEntries(Object.entries(row.assets).slice(0, 4)) });
  const output = { ...summary, publicView: true, totalWallets: leaderboard.length, retainedProofs: (ledger.samples || []).length,
    verifiedEvents: ledger.verifiedCount ?? summary.verifiedEvents,
    leaderboard: leaderboard.slice(0, 50).map((r) => compactRow(r)), assetLeaderboards: {}, rankingsLimited: false,
    ledger: { version: ledger.version, historyOldestAt: ledger.historyOldestAt, historyComplete: ledger.historyComplete,
      recentGapBefore: ledger.recentGapBefore, coverageGaps: ledger.coverageGaps,
      chainAccountCount: ledger.chainAccounts?.length || 0, chainPendingCount: ledger.chainPending?.length || 0,
      chainCompleteCount: ledger.chainAccounts?.filter((a) => a.complete).length || 0,
      chainReceiptsChecked: ledger.chainReceiptsChecked || 0, chainUnverified: ledger.chainUnverified || 0,
      chainUnreadable: ledger.chainUnreadable || 0, chainAccountErrors: ledger.chainAccountErrors || 0, chainDeferred: ledger.chainDeferred || [],
      chainInventoryCapped: ledger.chainInventoryCapped, records: [] },
  };
  let bytes = Buffer.byteLength(JSON.stringify(output));
  const assets = [...(source.assets || [])].sort((a, b) => Number(b.mint === SHOCKER_MINT) - Number(a.mint === SHOCKER_MINT));
  for (const asset of assets) {
    const ranked = leaderboard.filter((r) => r.assets[asset.mint]).sort((a, b) => {
      const x = BigInt(a.assets[asset.mint].amountRaw), y = BigInt(b.assets[asset.mint].amountRaw);
      return x === y ? a.wallet.localeCompare(b.wallet) : x > y ? -1 : 1;
    }).slice(0, 50).map((r) => compactRow(r, asset.mint));
    const size = Buffer.byteLength(JSON.stringify(ranked)) + asset.mint.length + 5;
    if (bytes + size > 500000) { output.rankingsLimited = true; continue; }
    output.assetLeaderboards[asset.mint] = ranked; bytes += size;
  }
  const proofWallets = new Set([...output.leaderboard, ...Object.values(output.assetLeaderboards).flat()].map((r) => r.wallet));
  const proofs = (ledger.samples?.length ? ledger.samples : ledger.records.filter((r) => r.status === "verified"))
    .filter((r) => proofWallets.has(r.wallet)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 250);
  for (const r of proofs) {
    const proof = { wallet: r.wallet, asset: r.asset, signature: r.signature, amountRaw: r.amountRaw, decimals: r.decimals, symbol: r.symbol, at: r.at, status: r.status };
    const size = Buffer.byteLength(JSON.stringify(proof)) + 1;
    if (bytes + size > 600000) break;
    output.ledger.records.push(proof); bytes += size;
  }
  return output;
}
