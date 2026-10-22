const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (v) => `${v.slice(0, 5)}…${v.slice(-5)}`;
const stamp = (v) => Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString() : "not observed";
const explorer = (type, value, label) => `<a href="https://solscan.io/${type}/${encodeURIComponent(value)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
// An unnamed wallet is still a person: show enough of the address to recognise
// it, and keep the full address in the tooltip for copying.
const walletTag = (wallet) => `<a class="void-wallet" href="https://solscan.io/account/${encodeURIComponent(wallet)}" target="_blank" rel="noopener noreferrer" title="${esc(wallet)}">${esc(wallet.slice(0, 10))}…${esc(wallet.slice(-8))} ↗</a>`;
const optionCache = new WeakMap();
const boardState = new WeakMap();

export function voidAmount(raw, decimals) {
  const digits = String(raw).padStart(decimals + 1, "0");
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return BigInt(whole).toLocaleString("en-US") + (fraction ? `.${fraction}` : "");
}

export function rankVoiders(rows, asset = "") {
  return [...rows].filter((row) => !asset || row.assets[asset]).sort((a, b) => {
    if (!asset) return b.transactions - a.transactions || a.wallet.localeCompare(b.wallet);
    const x = BigInt(a.assets[asset].amountRaw), y = BigInt(b.assets[asset].amountRaw);
    return x === y ? a.wallet.localeCompare(b.wallet) : x > y ? -1 : 1;
  });
}

// One box finds a coin, its creator, or a wallet. A coin match ranks those rows
// first so the answer is at the top, not buried in fifty rows.
export function filterVoiders(rows, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return { rows, coinMatches: 0 };
  const coin = [], rest = [];
  for (const row of rows) {
    const coinHit = Object.values(row.assets || {}).some((a) => `${a.symbol} ${a.mint} ${a.creator || ""} ${a.name || ""}`.toLowerCase().includes(needle));
    const walletHit = `${row.username || ""} ${row.wallet}`.toLowerCase().includes(needle);
    if (coinHit) coin.push(row);
    else if (walletHit) rest.push(row);
  }
  return { rows: [...coin, ...rest], coinMatches: coin.length };
}

// The payload ranks 50 wallets overall and 50 per coin. Searching has to see the
// union, or a wallet that only ranks inside its own coin would look absent.
export function mergeVoidRows(rows) {
  const byWallet = new Map();
  for (const row of rows || []) {
    const seen = byWallet.get(row.wallet);
    if (!seen) { byWallet.set(row.wallet, { ...row, assets: { ...row.assets } }); continue; }
    seen.transactions = Math.max(seen.transactions, row.transactions || 0);
    for (const [mint, asset] of Object.entries(row.assets || {})) seen.assets[mint] = { ...(seen.assets[mint] || {}), ...asset };
  }
  return [...byWallet.values()];
}

export function voidCoinOptions(source) {
  const coins = new Map((source.catalogAssets || []).map((coin) => [coin.mint, { ...coin, verified: false }]));
  for (const coin of source.assets || []) coins.set(coin.mint, { ...coins.get(coin.mint), ...coin, verified: true });
  return [...coins.values()].sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)) || a.mint.localeCompare(b.mint));
}

export function allVoidRows(source) {
  if (!Array.isArray(source.walletIndex)) return null;
  const metadata = new Map((source.assets || []).map((a) => [a.mint, a]));
  return source.walletIndex.map(([wallet, username, transactions, points, latestAt, assets]) => ({
    wallet, username, transactions, points, latestAt,
    assets: Object.fromEntries(assets.map(([mint, amountRaw, decimals, deposits, sharePct, valueUsd, unitPriceUsd, at, latestSignature, supplyPct, supplyCheckedAt]) => [mint, {
      ...metadata.get(mint), mint, symbol: metadata.get(mint)?.symbol || mint,
      amountRaw, decimals, transactions: deposits, sharePct, valueUsd, unitPriceUsd, latestAt: at, latestSignature, supplyPct, supplyCheckedAt,
    }])),
  }));
}

// Column sorting. Every metric here is measured; a null metric sorts last
// rather than being treated as zero, so "no price data" never looks like "$0".
const COLUMNS = {
  rank: { label: "#", get: (row, ctx) => ctx.rank.get(row.wallet) ?? ctx.rank.get(row) ?? Number.MAX_SAFE_INTEGER, asc: true },
  wallet: { label: "VOIDer", get: (row) => row.username || row.wallet, asc: true, text: true },
  deposits: { label: "Deposits", get: (row, ctx) => ctx.deposits(row) },
  amount: { label: "Amount", get: (row, ctx) => ctx.amount(row), big: true },
  share: { label: "Share of coin", get: (row, ctx) => ctx.share(row), pct: true },
  value: { label: "Value", get: (row, ctx) => ctx.value(row), usd: true },
  points: { label: "Points", get: (row) => row.points ?? null },
  latest: { label: "Latest", get: (row) => Date.parse(row.latestAt) || 0 },
};

export function sortVoidRows(rows, key, asset, rank = new Map()) {
  const column = COLUMNS[key] || COLUMNS.rank;
  const ctx = {
    rank,
    deposits: (row) => asset ? (row.assets[asset]?.transactions ?? 0) : (row.transactions ?? 0),
    amount: (row) => { const a = asset ? row.assets[asset] : null; return a ? BigInt(a.amountRaw) : null; },
    share: (row) => (asset ? row.assets[asset]?.sharePct : null) ?? Math.max(...Object.values(row.assets || {}).map((a) => a.sharePct ?? -1), -1),
    value: (row) => {
      if (asset) return row.assets?.[asset]?.valueUsd ?? null;
      const best = Object.values(row.assets || {}).reduce((b, x) => (x.valueUsd ?? -1) > (b?.valueUsd ?? -1) ? x : b, null);
      return best?.valueUsd ?? null;
    },
  };
  const dir = column.asc ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = column.get(a, ctx), y = column.get(b, ctx);
    if ((x === null || x === undefined) && (y === null || y === undefined)) return a.wallet.localeCompare(b.wallet);
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (x < y) return -dir;
    if (x > y) return dir;
    return a.wallet.localeCompare(b.wallet);
  });
}

const usd = (v) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;

export function renderVoidBoard(source, ui) {
  const root = document.getElementById("voidRows"), select = document.getElementById("voidAsset"), search = document.getElementById("voidSearch");
  if (!root || !select) return;
  ui = boardState.get(root) || ui || {};
  boardState.set(root, ui);
  const oldScroll = root.querySelector?.(".desk-table-scroll");
  const scroll = [oldScroll?.scrollTop || 0, oldScroll?.scrollLeft || 0];
  const openDetails = new Set([...(root.querySelectorAll?.('details[data-void-detail][open]') || [])].map((n) => n.dataset.voidDetail));
  if (!source?.ok || !source?.ledger) {
    root.innerHTML = `<p class="desk-context">${esc(source?.reason || "The collector is discovering historical void events and verifying receipts. No holdings are required to appear here.")} Stored credits are retained across refreshes; an unavailable read is not zero activity.</p>`;
    return;
  }
  if (search) search.oninput = () => renderVoidBoard(source, ui);
  const clickSort = (event) => {
    if (event.target.closest('[data-void-more]')?.hasAttribute?.('data-void-more')) { ui.limit = (ui.limit || 50) + 50; renderVoidBoard(source, ui); return; }
    const th = event.target.closest("th[data-sort]");
    if (!th) return;
    ui.sort = th.dataset.sort;
    renderVoidBoard(source, ui);
  };
  root.onclick = clickSort;
  root.onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest("th[data-sort]")) { e.preventDefault(); clickSort(e); } };
  const selected = select.value;
  const coins = voidCoinOptions(source);
  const options = '<option value="">All verified coins · most deposits</option>' + coins.map((a) => `<option value="${esc(a.mint)}">${esc(a.symbol)}${a.mint !== "SOL" ? ` · ${esc(short(a.mint))}` : ""}${a.outsideScope ? ` · ${esc(a.chain)} (catalog only)` : a.verified ? "" : " · not yet verified"}</option>`).join("")
    + (selected && !coins.some((a) => a.mint === selected) ? `<option value="${esc(selected)}">${esc(short(selected))} · unavailable in this update</option>` : "");
  if (optionCache.get(select) !== options) { select.innerHTML = options; select.value = selected; optionCache.set(select, options); }
  select.onchange = () => renderVoidBoard(source, ui);
  const completeRows = allVoidRows(source);
  const boardRows = completeRows || (select.value && source.assetLeaderboards ? source.assetLeaderboards[select.value] || [] : source.leaderboard);
  const query = search?.value || "";
  const corpus = completeRows || (query.trim() && source.assetLeaderboards ? mergeVoidRows([...(source.leaderboard || []), ...Object.values(source.assetLeaderboards).flat()]) : boardRows);
  const found = filterVoiders(rankVoiders(corpus, select.value), query);
  const baseRank = new Map(found.rows.map((row, i) => [row.wallet, i + 1]));
  const sortKey = ui.sort || "rank";
  const ranked = sortVoidRows(found.rows, sortKey, select.value, baseRank);
  const matchNote = query.trim()
    ? `<p class="desk-context"><b>Search "${esc(query.trim())}":</b> ${ranked.length} row${ranked.length === 1 ? "" : "s"}${found.coinMatches ? `, ${found.coinMatches} credited that coin or its creator` : ""}. Results cover the rankings included in this response; absence does not prove zero deposits. Catalog-only coins are available in the coin picker.</p>`
    : "";
  const asset = select.value ? coins.find((a) => a.mint === select.value) : null;
  const header = (key, title) => `<th class="void-sortable${sortKey === key ? " sorted" : ""}" data-sort="${key}" title="${title}" tabindex="0" role="button">${COLUMNS[key].label}</th>`;
  const rowLimit = ui.limit || 50;
  const rows = ranked.slice(0, rowLimit).map((row, index) => {
    if (select.value && row.assets[select.value]?.latestAt) row = { ...row, latestAt: row.assets[select.value].latestAt };
    const amounts = Object.values(row.assets).filter((a) => !select.value || a.mint === select.value);
    const receipts = source.ledger.records.filter((r) => r.status === "verified" && r.wallet === row.wallet && (!select.value || r.asset === select.value)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    const main = select.value ? row.assets[select.value] : null;
    // One wrapped line per row instead of a stacked block per asset.
    const chip = (a) => `<span class="void-amount" title="${esc(a.mint)}${a.creator ? ` · created by ${esc(a.creator)}` : ""}${Number.isFinite(a.sharePct) ? ` · ${a.sharePct.toFixed(2)}% of this coin's void volume` : ""}${Number.isFinite(a.valueUsd) ? ` · ${usd(a.valueUsd)} at ${usd(a.unitPriceUsd)}/token` : ""}${Number.isFinite(a.supplyPct) ? ` · ${a.supplyPct.toFixed(4)}% of sampled supply` : ""}">${esc(voidAmount(a.amountRaw, a.decimals))} ${esc(a.symbol)}${a.creator ? ` <i>· ${esc(a.creator)}</i>` : ""}${Number.isFinite(a.valueUsd) ? ` <u>${usd(a.valueUsd)}</u>` : ""}${Number.isFinite(a.supplyPct) ? ` <b>${a.supplyPct.toFixed(4)}%</b>` : ""}</span>`;
    const value = main ? main.valueUsd : amounts.reduce((best, a) => Math.max(best, a.valueUsd ?? -1), -1);
    const share = main ? main.sharePct : Math.max(...amounts.map((a) => a.sharePct ?? -1), -1);
    const extraCoins = amounts.length > 6 ? `<details data-void-detail="coins:${esc(row.wallet)}"><summary>Show ${amounts.length - 6} more coins</summary>${amounts.slice(6).map(chip).join("")}</details>` : "";
    const latestProofs = amounts.filter((a) => a.latestSignature && !receipts.some((r) => r.signature === a.latestSignature))
      .map((a) => `<p>${explorer("tx", a.latestSignature, `${a.symbol} · latest receipt`)}<br><small>${esc(stamp(a.latestAt))}</small></p>`).join("");
    return `<tr><td class="void-rank">${baseRank.get(row.wallet) ?? index + 1}</td><td><b title="${esc(row.wallet)}">${esc(row.username || `Unnamed wallet`)}</b> <small>${walletTag(row.wallet)}</small></td><td class="desk-number">${select.value ? row.assets[select.value].transactions : row.transactions}</td><td class="desk-number">${Number.isFinite(share) && share >= 0 ? `${share.toFixed(2)}%` : "—"}</td><td class="desk-number">${Number.isFinite(value) && value >= 0 ? usd(value) : `<span class="void-nodata" title="No published market cap for this coin">n/a</span>`}</td><td class="desk-number">${Number.isFinite(row.points) ? row.points.toLocaleString("en-US") : `<span class="void-nodata" title="Not in TRIX's published points table">—</span>`}</td><td class="void-assets">${amounts.slice(0, 6).map(chip).join("")}${extraCoins}</td><td class="void-when">${esc(stamp(row.latestAt))}</td><td><details data-void-detail="proof:${esc(row.wallet)}"><summary>Receipt evidence</summary>${receipts.map((r) => `<p>${explorer("tx", r.signature, short(r.signature))}<br><small>${esc(stamp(r.at))} · ${esc(voidAmount(r.amountRaw, r.decimals))} ${esc(r.symbol)}</small></p>`).join("")}${latestProofs}${!receipts.length && !latestProofs ? '<p>No inline proof sample in this response; stored totals are retained.</p>' : ""}</details></td></tr>`;
  }).join("");
  const l = source.ledger;
  const accounts = l.chainAccountCount ?? l.chainAccounts?.length ?? 0;
  const queued = l.chainPendingCount ?? l.chainPending?.length ?? 0;
  const complete = l.chainCompleteCount ?? l.chainAccounts?.filter((a) => a.complete).length ?? 0;
  const sweep = accounts ? `${complete}/${accounts} accounts` : "";
  // "Finished" is a real, checkable state: every discovered account paginated to
  // its end with nothing queued. Until then the ranking is partial.
  const sweepComplete = accounts > 0 && complete >= accounts && queued === 0;
  const head = `${source.totalWallets ?? source.leaderboard.length} wallets · ${source.verifiedEvents.toLocaleString("en-US")} verified deposits${Number.isFinite(source.catalogTotal) ? ` · ${source.catalogCovered}/${source.catalogTotal} Solana catalog coins credited` : ""}${sweep ? ` · sweep ${sweep}${sweepComplete ? " paginated" : ""}` : ""}${source.stale ? " · last check " + stamp(source.dataUpdatedAt) : ""}`;
  root.innerHTML = `${matchNote}
    ${completeRows ? `<p class="desk-context">Search and sorting cover all ${completeRows.length.toLocaleString("en-US")} stored wallets. Showing ${Math.min(ranked.length, rowLimit)} of ${ranked.length.toLocaleString("en-US")} matching rows. Stored evidence is not a guarantee of complete on-chain history.</p>` : ""}
    <p class="void-head"><b>${esc(head)}</b>${source.stale ? " · showing stored history, feed is not current" : ""}</p>
    ${l.duplicateCreditsPending || l.correctedCredits ? `<p class="desk-context">Duplicate-credit audit: ${l.correctedCredits || 0} corrected after receipt verification; ${l.duplicateCreditsPending || 0} pending.${l.duplicateRepairError ? ` ${esc(l.duplicateRepairError)}.` : ""}</p>` : ""}
    <p class="desk-context">${source.catalogOtherChains ? `${source.catalogOtherChains} other-chain catalog coins are listed separately; this receipt collector covers Solana. ` : ""}${l.chainRetryCount || 0} receipts retained for retry. ${l.chainUnreadable || 0} historical unreadable checks; ${l.chainUnverified || 0} rejected transfer checks.${l.chainToken2022Unavailable ? " Token-2022 inventory is unavailable." : ""}${l.chainClassicUnavailable ? " Classic SPL inventory is unavailable." : ""}${l.recoveryStartedAt ? ` Recovery rescan started ${esc(stamp(l.recoveryStartedAt))}.` : ""}${l.recoveryBlockedReason ? ` ${esc(l.recoveryBlockedReason)}.` : ""}</p>
    ${asset && !asset.verified ? `<p class="desk-context"><b>${esc(asset.symbol)}</b> is in the launch catalog. ${asset.outsideScope ? `${esc(asset.chain)} deposits are outside this Solana collector's coverage.` : "No deposit for this coin has been verified in the stored evidence yet; its balance and deposit count are unknown."}</p>` : ""}
    ${rows ? `<div class="desk-table-scroll"><table class="desk-table void-table"><caption class="sr-only">Top VOIDers — observed receipt-verified transfers</caption><thead><tr>${header("rank", "Default ranking order")}${header("wallet", "Sort by VOIDer name")}${header("deposits", "Sort by number of verified deposits")}${header("share", "Share of this coin's total verified void volume")}${header("value", "Value at the published market price")}${header("points", "TRIX points, where published")}<th>Amounts verified</th>${header("latest", "Sort by latest verified deposit")}<th>Proof</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : query.trim() ? '<p class="desk-context">No verified row matches that search in this response. The scan is still running, so a coin or wallet can appear later without anything changing.</p>'
      : '<p class="desk-context">No verified rows yet for this view. Pending or failed checks are not counted as credits.</p>'}
    ${ranked.length > rowLimit ? '<button type="button" data-void-more>Show 50 more wallets</button>' : ""}
    <details class="void-notes"><summary>How this is measured</summary>
      <p>Receipts verify transfers into ${explorer("account", source.treasury, "the TRIX treasury")} — not token burning or awarded points. Current holdings never affect inclusion. Missing rows may reflect unscanned history, unreadable receipts or compact ranking limits. Percentages use on-chain supply sampled at the time shown.</p>
      <p>Discovery reads both TRIX's void feed and the treasury's own token-account history, including Token-2022 and zero-balance accounts. Every verified receipt is rolled into permanent totals; only the most recent ${source.proofSamples ?? source.retainedProofs ?? 250} are kept as inline proof. ${l.historyComplete && !l.recentGapBefore ? "The feed's available history is exhausted; the sweep below is the remainder." : "Feed history backfill is still running."} Oldest feed page: ${esc(stamp(l.historyOldestAt))}.${l.coverageGaps ? " High-volume gaps were detected; coverage is incomplete." : ""}</p>
      <p>Sweep: ${l.chainReceiptsChecked || 0} historical receipts inspected, ${queued} queued, ${l.chainUnverified || 0} transfer checks did not verify${l.chainUnreadable ? `, ${l.chainUnreadable} historical unreadable checks` : ""}.${l.chainAccountErrors ? ` ${l.chainAccountErrors} account scan(s) deferred; each retries later instead of blocking the rest.` : ""}${l.chainInventoryCapped ? " Account inventory cap reached." : ""} Pagination completion is not receipt verification.${l.chainRateLimited ? ` ${l.chainRateLimited} calls were rate-limited by the provider. These delays and unresolved receipt failures limit coverage.` : ""}</p>
      <p>Rows preview six coins per wallet; expand the row for the rest or select a coin above. Search and sorting use every wallet in the complete index when available. Click any column heading to re-sort${asset ? `; with ${esc(asset.symbol)} selected, amount, share and value refer to that coin only` : ""}. ${!completeRows && source.rankingsLimited ? "Some coin rankings are omitted from this older response; missing rows do not imply zero credit." : ""} This is observed evidence, not a guaranteed all-time ranking.</p>
      <p><b>Value</b> is the verified amount multiplied by TRIX's published market cap for that coin divided by the on-chain supply read from chain${source.marketAt ? ` (caps sampled ${esc(stamp(source.marketAt))})` : ""}. It is a marked-at-cap estimate of what the voided amount would be worth today, not a realised sale: TRIX publishes caps for ${source.marketTotal ?? "most"} of its coins, and a coin without one shows <b>n/a</b> rather than $0. <b>Share</b> is that wallet's slice of every verified void of that coin. <b>Points</b> comes from TRIX's published points table${source.pointsEntries ? ` (top ${source.pointsEntries}${source.pointsCapped ? "+, capped" : ""})` : ""} and is joined by wallet, so a wallet outside that table shows —.</p>
      ${source.reason ? `<p>Partial verification: ${esc(source.reason)}</p>` : ""}
    </details>`;
  for (const detail of root.querySelectorAll?.('details[data-void-detail]') || []) detail.open = openDetails.has(detail.dataset.voidDetail);
  const newScroll = root.querySelector?.(".desk-table-scroll");
  if (newScroll) [newScroll.scrollTop, newScroll.scrollLeft] = scroll;
}
