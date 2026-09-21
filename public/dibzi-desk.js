const esc = (value) => String(value ?? "--").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rows = (value) => Array.isArray(value) ? value : [];
const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const short = (value) => typeof value === "string" && value.length > 16 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
const fmt = (value, digits = 2) => num(value) === null ? "--" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
const sol = (value) => num(value) === null ? "--" : `${fmt(value, 4)} SOL`;
const stamp = (value) => {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "age unknown";
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  return seconds < 60 ? "<1m ago" : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
};
const link = (base, value, label) => value ? `<a href="${esc(base + encodeURIComponent(value))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "--";
const walletLink = (wallet) => link("https://solscan.io/account/", wallet, short(wallet));
const txLink = (signature) => link("https://solscan.io/tx/", signature, "receipt");

function table(label, headers, body) {
  return `<div class="desk-table-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table class="desk-table"><thead><tr>${headers.map(([text, cls = ""]) => `<th class="${cls}">${esc(text)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function sourceState(src) {
  if (!src) return "Unavailable";
  if (src.ok !== true) return `Unavailable${src.status ? ` · HTTP ${src.status}` : ""}`;
  if (src.stale) return "Stale data";
  return `Checked ${stamp(src.checkedAt)}`;
}

export function renderDibziDesk(latest) {
  const src = latest?.sources?.["dibzi.names"];
  const status = document.getElementById("dibziDeskStatus");
  const summary = document.getElementById("dibziSummary");
  const walletRows = document.getElementById("dibziWalletRows");
  const bidRows = document.getElementById("dibziBidRows");
  const cashtagRows = document.getElementById("dibziCashtagRows");
  const sourceText = document.getElementById("dibziSourceText");
  if (!status || !summary || !walletRows || !bidRows || !cashtagRows) return;
  status.textContent = sourceState(src);
  const names = rows(src?.names);
  const wallets = rows(src?.topWallets);
  const bids = rows(src?.recentBids);
  if (src?.ok !== true) {
    summary.innerHTML = `<span class="dibzi-stat"><b>--</b><small>${esc(src?.reason || "Waiting for public DIBZI data")}</small></span>`;
    walletRows.innerHTML = `<div class="desk-empty"><span>[ - ]</span><span>DIBZI wallet activity unavailable. The desk does not retain invented balances.</span></div>`;
    bidRows.innerHTML = "";
    cashtagRows.innerHTML = "";
  } else {
    summary.innerHTML = [
      [fmt(src.activeNames, 0), "active auctions · current snapshot"],
      [fmt(src.uniqueWallets, 0), "wallets · current snapshot"],
      [sol(src.activeBoardSol), "current leading bids · snapshot"],
      [fmt(src.totalBids, 0), "bid rows · current snapshot"],
      [sol(src.highestBidSol), "highest current bid"],
    ].map(([value, label]) => `<span class="dibzi-stat"><b>${esc(value)}</b><small>${esc(label)}</small></span>`).join("");
    const walletBody = wallets.map((wallet) => `<tr><td class="desk-number">${fmt(wallet.rank, 0)}</td><td><b>${esc(wallet.username || short(wallet.wallet))}</b><small class="value-age">${wallet.username ? walletLink(wallet.wallet) : ""}</small></td><td class="desk-number">${sol(wallet.totalBidSol)}</td><td class="desk-number">${fmt(wallet.bids, 0)}</td><td>${fmt(wallet.leading, 0)} lead${wallet.leading === 1 ? "" : "s"}</td></tr>`).join("");
    walletRows.innerHTML = walletBody ? table("DIBZI bidder wallets in current snapshot", [["#", "desk-number"], ["Wallet"], ["Reported bid rows", "desk-number"], ["Rows", "desk-number"], ["Leads"]], walletBody) : `<div class="desk-empty"><span>[ - ]</span><span>No bidder wallets reported.</span></div>`;
    const bidBody = bids.map((bid) => `<tr><td><b>${esc(bid.name)}</b><small class="value-age">${esc(bid.username || short(bid.wallet))}</small></td><td class="desk-number">${sol(bid.amountSol)}</td><td>${stamp(bid.at)}</td><td>${walletLink(bid.wallet)}</td><td>${txLink(bid.signature)}</td></tr>`).join("");
    bidRows.innerHTML = bidBody ? table("Recent DIBZI bids", [["Name"], ["Bid", "desk-number"], ["When"], ["Wallet"], ["Tx"]], bidBody) : `<div class="desk-empty"><span>[ - ]</span><span>No bids reported in the current public snapshot.</span></div>`;
    const cashtags = names
      .filter((name) => name.name.trim().startsWith("$"))
      .sort((a, b) => (b.amountSol ?? -Infinity) - (a.amountSol ?? -Infinity) || (Date.parse(a.endsAt || 0) || Infinity) - (Date.parse(b.endsAt || 0) || Infinity));
    const cashtagBody = cashtags.map((name) => `<tr><td><b>${esc(name.name)}</b><small class="value-age">${name.settled ? "settled" : "active auction"}</small></td><td class="desk-number">${sol(name.amountSol)}</td><td><b>${esc(name.leaderUsername || short(name.leader))}</b><small class="value-age">${walletLink(name.leader)}</small></td><td>${stamp(name.endsAt)}</td></tr>`).join("");
    cashtagRows.innerHTML = cashtagBody ? table("DIBZI cashtag names", [["Cashtag"], ["Current bid", "desk-number"], ["Leader"], ["Ends"]], cashtagBody) : `<div class="desk-empty"><span>[ - ]</span><span>No dollar-prefixed names reported in the current snapshot.</span></div>`;
  }
  if (sourceText) sourceText.textContent = [
    `Names: ${src?.sourceUrl || "https://dibzi.ai/api/names"}`,
    `Profiles: ${src?.profileUrl || "https://dibzi.ai/api/profiles"}`,
    `Config: ${src?.configUrl || "https://dibzi.ai/api/config"}`,
    `Program: ${src?.programId || "3VQDLcMiUrqLHXhkinwj9AW9h5BHdqYkv4AY2cyTv7gS"}`,
    `Checked: ${src?.checkedAt || "unknown"}`,
    `Limit: ${names.length} names · ${bids.length} recent bids · ${wallets.length} wallet rows`,
    src?.note || "",
  ].filter(Boolean).join("\n");
}
