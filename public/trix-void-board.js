const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (v) => `${v.slice(0, 5)}…${v.slice(-5)}`;
const stamp = (v) => Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString() : "not observed";
const explorer = (type, value, label) => `<a href="https://solscan.io/${type}/${encodeURIComponent(value)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;

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

export function renderVoidBoard(source) {
  const root = document.getElementById("voidRows"), select = document.getElementById("voidAsset"), search = document.getElementById("voidSearch");
  if (!root || !select) return;
  if (!source?.ok || !source?.ledger) {
    root.innerHTML = `<p class="desk-context">${esc(source?.reason || "The collector is discovering historical void events and verifying receipts. No holdings are required to appear here.")} Stored credits are retained across refreshes; an unavailable read is not zero activity.</p>`;
    return;
  }
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", () => renderVoidBoard(source));
  }
  const selected = select.value;
  const options = '<option value="">Most verified void deposits</option>' + source.assets.map((a) => `<option value="${esc(a.mint)}">Amount · ${esc(a.symbol)}${a.mint !== "SOL" ? ` · ${esc(short(a.mint))}` : ""}</option>`).join("");
  if (select.innerHTML !== options) { select.innerHTML = options; select.value = source.assets.some((a) => a.mint === selected) ? selected : ""; }
  select.onchange = () => renderVoidBoard(source);
  const boardRows = select.value && source.assetLeaderboards ? source.assetLeaderboards[select.value] || [] : source.leaderboard;
  const query = search?.value || "";
  const corpus = query.trim() && source.assetLeaderboards ? mergeVoidRows([...(source.leaderboard || []), ...Object.values(source.assetLeaderboards).flat()]) : boardRows;
  const found = filterVoiders(rankVoiders(corpus, select.value), query);
  const ranked = found.rows;
  const matchNote = query.trim()
    ? `<p class="desk-context"><b>Search "${esc(query.trim())}":</b> ${ranked.length} row${ranked.length === 1 ? "" : "s"}${found.coinMatches ? `, ${found.coinMatches} credited that coin or its creator` : ""}${ranked.length ? "" : " in this ranking"}. A wallet or coin outside the current ranking has no verified deposit yet — it is not ranked as zero.</p>`
    : "";
  const rows = ranked.slice(0, 50).map((row, index) => {
    if (select.value && row.assets[select.value]?.latestAt) row = { ...row, latestAt: row.assets[select.value].latestAt };
    const amounts = Object.values(row.assets).filter((a) => !select.value || a.mint === select.value);
    const receipts = source.ledger.records.filter((r) => r.status === "verified" && r.wallet === row.wallet && (!select.value || r.asset === select.value)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    // One wrapped line per row instead of a stacked block per asset.
    const chip = (a) => `<span class="void-amount" title="${esc(a.mint)}${a.creator ? ` · created by ${esc(a.creator)}` : ""}${Number.isFinite(a.supplyPct) ? ` · ${a.supplyPct.toFixed(4)}% of sampled supply` : ""}">${esc(voidAmount(a.amountRaw, a.decimals))} ${esc(a.symbol)}${a.creator ? ` <i>· ${esc(a.creator)}</i>` : ""}${Number.isFinite(a.supplyPct) ? ` <b>${a.supplyPct.toFixed(4)}%</b>` : ""}</span>`;
    return `<tr><td class="void-rank">${index + 1}</td><td><b>${esc(row.username || short(row.wallet))}</b> <small>${explorer("account", row.wallet, short(row.wallet))}</small></td><td class="desk-number">${select.value ? row.assets[select.value].transactions : row.transactions}</td><td class="void-assets">${amounts.slice(0, 6).map(chip).join("")}${amounts.length > 6 ? `<span class="void-more">+${amounts.length - 6}</span>` : ""}</td><td class="void-when">${esc(stamp(row.latestAt))}</td><td><details><summary>${receipts.length} receipt${receipts.length === 1 ? "" : "s"}</summary>${receipts.map((r) => `<p>${explorer("tx", r.signature, short(r.signature))}<br><small>${esc(stamp(r.at))} · ${esc(voidAmount(r.amountRaw, r.decimals))} ${esc(r.symbol)}</small></p>`).join("")}</details></td></tr>`;
  }).join("");
  const l = source.ledger;
  const accounts = l.chainAccountCount ?? l.chainAccounts?.length ?? 0;
  const queued = l.chainPendingCount ?? l.chainPending?.length ?? 0;
  const complete = l.chainCompleteCount ?? l.chainAccounts?.filter((a) => a.complete).length ?? 0;
  const sweep = accounts ? `${complete}/${accounts} accounts` : "";
  // "Finished" is a real, checkable state: every discovered account paginated to
  // its end with nothing queued. Until then the ranking is partial.
  const sweepComplete = accounts > 0 && complete >= accounts && queued === 0;
  const head = `${source.totalWallets ?? source.leaderboard.length} wallets · ${source.verifiedEvents.toLocaleString("en-US")} verified deposits${Number.isFinite(source.catalogTotal) ? ` · ${source.catalogCovered}/${source.catalogTotal} coins` : ""}${sweep ? ` · sweep ${sweep}${sweepComplete ? " complete" : ""}` : ""}${source.stale ? " · last check " + stamp(source.dataUpdatedAt) : ""}`;
  root.innerHTML = `${matchNote}
    <p class="void-head"><b>${esc(head)}</b>${source.stale ? " · showing stored history, feed is not current" : ""}</p>
    ${rows ? `<div class="desk-table-scroll"><table class="desk-table void-table"><caption class="sr-only">Top VOIDers — observed receipt-verified transfers</caption><thead><tr><th>#</th><th>VOIDer</th><th>Deposits</th><th>Amounts verified</th><th>Latest</th><th>Proof</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : query.trim() ? '<p class="desk-context">No verified row matches that search in this response. The scan is still running, so a coin or wallet can appear later without anything changing.</p>'
      : '<p class="desk-context">No verified rows yet for this view. Pending or failed checks are not counted as credits.</p>'}
    <details class="void-notes"><summary>How this is measured</summary>
      <p>Receipts verify transfers into ${explorer("account", source.treasury, "the TRIX treasury")} — not token burning or awarded points. Current holdings never affect inclusion, and a coin missing here has no verified deposit yet rather than an excluded holder. Percentages use on-chain supply sampled at the time shown.</p>
      <p>Discovery reads both TRIX's void feed and the treasury's own token-account history, including Token-2022 and zero-balance accounts. Every verified receipt is rolled into permanent totals; only the most recent ${source.proofSamples ?? source.retainedProofs ?? 250} are kept as inline proof. ${l.historyComplete && !l.recentGapBefore ? "The feed's available history is exhausted; the sweep below is the remainder." : "Feed history backfill is still running."} Oldest feed page: ${esc(stamp(l.historyOldestAt))}.${l.coverageGaps ? " High-volume gaps were detected; coverage is incomplete." : ""}</p>
      <p>Sweep: ${l.chainReceiptsChecked || 0} historical receipts inspected, ${queued} queued, ${l.chainUnverified || 0} transfer checks did not verify${l.chainUnreadable ? `, ${l.chainUnreadable} unreadable (${l.chainPruned || 0} pruned beyond provider history)` : ""}.${l.chainAccountErrors ? ` ${l.chainAccountErrors} account scan(s) deferred; each retries later instead of blocking the rest.` : ""}${l.chainInventoryCapped ? " Account inventory cap reached." : ""} Pagination completion is not receipt verification.${l.chainRateLimited ? ` ${l.chainRateLimited} calls were rate-limited by the provider — that is RPC capacity, not missing data, and it is the only thing slowing the sweep.` : ""}</p>
      <p>Rows show up to six coins per wallet; pick a coin above to rank by its amount. ${source.rankingsLimited ? "Some coin rankings are omitted from this compact response; missing rows do not imply zero credit." : ""} This is an observed, bounded leaderboard, not a guaranteed all-time ranking.</p>
      ${source.reason ? `<p>Partial verification: ${esc(source.reason)}</p>` : ""}
    </details>`;
}
