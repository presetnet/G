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

export function renderVoidBoard(source) {
  const root = document.getElementById("voidRows"), select = document.getElementById("voidAsset");
  if (!root || !select) return;
  if (!source?.ok || !source.ledger) {
    root.innerHTML = `<p class="desk-context">${esc(source?.reason || "The collector is discovering historical void events and verifying receipts. No holdings are required to appear here.")} Stored credits are retained across refreshes; an unavailable read is not zero activity.</p>`;
    return;
  }
  const selected = select.value;
  const options = '<option value="">Most verified void deposits</option>' + source.assets.map((a) => `<option value="${esc(a.mint)}">Amount · ${esc(a.symbol)}${a.mint !== "SOL" ? ` · ${esc(short(a.mint))}` : ""}</option>`).join("");
  if (select.innerHTML !== options) { select.innerHTML = options; select.value = source.assets.some((a) => a.mint === selected) ? selected : ""; }
  select.onchange = () => renderVoidBoard(source);
  const boardRows = select.value && source.assetLeaderboards ? source.assetLeaderboards[select.value] || [] : source.leaderboard;
  const ranked = rankVoiders(boardRows, select.value);
  const rows = ranked.slice(0, 50).map((row, index) => {
    if (select.value && row.assets[select.value]?.latestAt) row = { ...row, latestAt: row.assets[select.value].latestAt };
    const amounts = Object.values(row.assets).filter((a) => !select.value || a.mint === select.value);
    const receipts = source.ledger.records.filter((r) => r.status === "verified" && r.wallet === row.wallet && (!select.value || r.asset === select.value)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    return `<tr><td>${index + 1}</td><td><b>${esc(row.username || short(row.wallet))}</b><small>${explorer("account", row.wallet, short(row.wallet))}</small></td><td class="desk-number">${select.value ? row.assets[select.value].transactions : row.transactions}</td><td>${amounts.slice(0, 4).map((a) => `<div title="${esc(a.mint)}${a.creator ? ` · created by ${esc(a.creator)}` : ""}">${esc(voidAmount(a.amountRaw, a.decimals))} ${esc(a.symbol)}${a.creator ? `<small>created by ${esc(a.creator)}</small>` : ""}${Number.isFinite(a.supplyPct) ? `<small title="Supply sampled ${esc(stamp(a.supplyCheckedAt))}">${a.supplyPct.toFixed(4)}% of sampled token supply</small>` : ""}</div>`).join("")}${amounts.length > 4 ? `<small>+ ${amounts.length - 4} other assets</small>` : ""}</td><td>${esc(stamp(row.latestAt))}</td><td><details><summary>Proof (${receipts.length} shown)</summary>${receipts.map((r) => `<p>${explorer("tx", r.signature, short(r.signature))}<br><small>${esc(stamp(r.at))} · ${esc(voidAmount(r.amountRaw, r.decimals))} ${esc(r.symbol)}</small></p>`).join("")}</details></td></tr>`;
  }).join("");
  const l = source.ledger;
  const accounts = l.chainAccountCount ?? l.chainAccounts?.length ?? 0;
  const queued = l.chainPendingCount ?? l.chainPending?.length ?? 0;
  const complete = l.chainCompleteCount ?? l.chainAccounts?.filter((a) => a.complete).length ?? 0;
  root.innerHTML = `${source.stale ? '<p class="desk-context"><b>Collection is not current. Showing stored receipt-verified history.</b></p>' : ""}<p class="desk-context"><b>${source.totalWallets ?? source.leaderboard.length} wallets · ${source.verifiedEvents} verified asset transfers</b> · ${source.pendingEvents} awaiting feed receipt checks · ${source.unverifiedEvents} feed receipts did not verify.</p>
    <p class="desk-context">${l.historyComplete && !l.recentGapBefore ? "Reached the end of the public feed's available history." : "Historical backfill in progress."} Every verified receipt is rolled into permanent per-wallet, per-asset totals; only the most recent ${source.proofSamples ?? source.retainedProofs ?? 250} receipts are kept as inline proof. Oldest feed page: ${esc(stamp(l.historyOldestAt))}. Last feed check: ${esc(stamp(source.dataUpdatedAt))}.${l.coverageGaps ? " High-volume gaps were detected; coverage is incomplete." : ""} This is an observed, bounded leaderboard—not a complete all-time ranking.</p>
    ${Number.isFinite(source.catalogTotal) ? `<p class="desk-context"><b>Coin coverage:</b> ${source.catalogCovered} of ${source.catalogTotal} coins in TRIX's launch catalog have a receipt-verified treasury deposit. A coin missing here has no verified deposit yet, not an excluded holder. Names and creators come from that catalog${source.catalogAt ? ` (read ${esc(stamp(source.catalogAt))})` : ""}, so a creator is still credited after selling out.</p>` : ""}
    <p class="desk-context"><b>Direct chain history:</b> ${accounts} treasury token accounts discovered · ${l.chainReceiptsChecked || 0} historical receipts inspected · ${queued} queued · ${l.chainUnverified || 0} historical transfer checks unresolved · ${complete} account histories paginated to the end. ${l.chainInventoryCapped ? "Account inventory cap reached." : ""} SHOCKER is scanned first, up to 24 historical receipts per collector run. Pagination completion is not the same as completing receipt verification.</p>
    <p class="desk-context">Top 50 per ranking. Default rows show up to four assets per wallet; choose an asset for its amount ranking. Inline receipts are a bounded recent sample. ${source.rankingsLimited ? "Some asset rankings are omitted from this compact response; missing rows do not imply zero credit." : ""}</p>
    <p class="desk-context">Current holdings do not affect inclusion. Discovery uses both TRIX's feed and treasury token-account history, including accounts with zero balances. Receipts verify transfers into ${explorer("account", source.treasury, "the TRIX treasury")}, not token burning or awarded points. Direct deposits can be included even without a TRIX feed entry. Token-void SOL fees are excluded. Percentages use on-chain supply at the displayed sample time, not a wallet's current holding percentage. Closed treasury accounts absent from inventory and Token-2022 history are not covered by the direct scan.</p>
    ${source.reason ? `<p class="desk-context">Partial verification: ${esc(source.reason)}</p>` : ""}
    ${rows ? `<div class="desk-table-scroll"><table class="desk-table"><caption class="sr-only">Top VOIDers — observed receipt-verified transfers</caption><thead><tr><th>#</th><th>VOIDer</th><th>Verified deposits</th><th>Amounts verified so far</th><th>Latest void</th><th>Receipts</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="desk-context">No verified rows yet for this view. Pending or failed checks are not counted as credits.</p>'}`;
}
