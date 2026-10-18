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
  const options = '<option value="">Most verified void transactions</option>' + source.assets.map((a) => `<option value="${esc(a.mint)}">Amount · ${esc(a.symbol)}${a.mint !== "SOL" ? ` · ${esc(short(a.mint))}` : ""}</option>`).join("");
  if (select.innerHTML !== options) { select.innerHTML = options; select.value = source.assets.some((a) => a.mint === selected) ? selected : ""; }
  select.onchange = () => renderVoidBoard(source);
  const ranked = rankVoiders(source.leaderboard, select.value);
  const rows = ranked.slice(0, 50).map((row, index) => {
    const amounts = Object.values(row.assets).filter((a) => !select.value || a.mint === select.value);
    const receipts = source.ledger.records.filter((r) => r.status === "verified" && r.wallet === row.wallet && (!select.value || r.asset === select.value)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    return `<tr><td>${index + 1}</td><td><b>${esc(row.username || short(row.wallet))}</b><small>${explorer("account", row.wallet, short(row.wallet))}</small></td><td class="desk-number">${select.value ? row.assets[select.value].transactions : row.transactions}</td><td>${amounts.slice(0, 4).map((a) => `<div title="${esc(a.mint)}">${esc(voidAmount(a.amountRaw, a.decimals))} ${esc(a.symbol)}</div>`).join("")}${amounts.length > 4 ? `<small>+ ${amounts.length - 4} other assets</small>` : ""}</td><td>${esc(stamp(row.latestAt))}</td><td><details><summary>Proof (${receipts.length} shown)</summary>${receipts.map((r) => `<p>${explorer("tx", r.signature, short(r.signature))}<br><small>${esc(stamp(r.at))} · ${esc(voidAmount(r.amountRaw, r.decimals))} ${esc(r.symbol)}</small></p>`).join("")}</details></td></tr>`;
  }).join("");
  const l = source.ledger;
  root.innerHTML = `${source.stale ? '<p class="desk-context"><b>Collection is not current. Showing stored receipt-verified history.</b></p>' : ""}<p class="desk-context"><b>${source.leaderboard.length} wallets · ${source.verifiedEvents} verified asset transfers</b> · ${source.pendingEvents} awaiting receipt checks · ${source.unverifiedEvents} receipts did not verify.</p>
    <p class="desk-context">${l.capped ? "Retained-event limit reached: discovery paused; existing credits kept." : l.historyComplete && !l.recentGapBefore ? "Reached the end of the public feed's available history." : "Historical backfill in progress."} ${l.records.length}/${source.retainedLimit} discoveries retained. Oldest history page: ${esc(stamp(l.historyOldestAt))}. Last feed check: ${esc(stamp(source.dataUpdatedAt))}.${l.coverageGaps ? " High-volume gaps were detected; coverage is incomplete." : ""} This is an observed, bounded leaderboard—not a complete all-time ranking.</p>
    <p class="desk-context">Current balances do not affect inclusion. “Void” is TRIX's feed classification; receipts verify transfers into ${explorer("account", source.treasury, "the TRIX treasury")}, not token burning or awarded points. Token-void SOL fees are excluded. Compare amounts within one asset; different coins are never added together.</p>
    ${source.reason ? `<p class="desk-context">Partial verification: ${esc(source.reason)}</p>` : ""}
    ${rows ? `<div class="desk-table-scroll"><table class="desk-table"><caption class="sr-only">Top VOIDers — observed receipt-verified transfers</caption><thead><tr><th>#</th><th>VOIDer</th><th>Transactions</th><th>Transferred amounts</th><th>Latest void</th><th>Receipts</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="desk-context">No verified rows yet for this view. Pending or failed checks are not counted as credits.</p>'}`;
}
