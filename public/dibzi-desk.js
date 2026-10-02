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
const nameLink = (name, label = name) => name ? `<a href="https://dibzi.ai/name/${encodeURIComponent(name)}?utm_source=geoff-thermometer&utm_medium=dashboard&utm_campaign=dibzi-desk" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "--";

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
  const aboutStatus = document.getElementById("dibziAboutStatus");
  const aboutBody = document.getElementById("dibziAboutBody");
  const walletRows = document.getElementById("dibziWalletRows");
  const bidRows = document.getElementById("dibziBidRows");
  const cashtagRows = document.getElementById("dibziCashtagRows");
  const openRows = document.getElementById("dibziOpenRows");
  const salesRows = document.getElementById("dibziSalesRows");
  const sourceText = document.getElementById("dibziSourceText");
  if (!status || !summary || !walletRows || !bidRows || !cashtagRows || !salesRows) return;
  status.textContent = sourceState(src);
  const names = rows(src?.names);
  const about = latest?.sources?.["dibzi.about"];
  if (aboutStatus && aboutBody) {
    aboutStatus.textContent = about?.ok === true ? `Editorial summary observed Sep 23, 2026 · page reachable ${stamp(about.checkedAt)} · copy not automatically reverified` : `Unavailable · ${about?.reason || "waiting for public About page"}`;
    aboutBody.innerHTML = about?.ok === true
      ? `<p class="dibzi-about-thesis">${esc(about.thesis)}</p><div class="dibzi-about-grid">${rows(about.sections).map((section) => `<article><strong>${esc(section.title)}</strong><span>${esc(section.text)}</span></article>`).join("")}</div><div class="dibzi-about-economics">${about.economics ? `<span><b>${esc(about.economics.openingBidSol)} SOL</b> opening bids</span><span><b>${esc(about.economics.buyItNowSol)} SOL</b> buy it now</span><span><b>${esc(about.economics.auctionHours)}h</b> auctions</span><span><b>${esc(about.economics.renewalSolPerYear)} SOL</b> yearly resolution</span>` : ""}</div>`
      : `<div class="desk-empty"><span>[ - ]</span><span>About claims are not displayed until the public page response is complete.</span></div>`;
  }
  const wallets = rows(src?.topWallets);
  const bids = rows(src?.recentBids);
  if (src?.ok !== true) {
    summary.innerHTML = `<span class="dibzi-stat"><b>--</b><small>${esc(src?.reason || "Waiting for public DIBZI data")}</small></span>`;
    walletRows.innerHTML = `<div class="desk-empty"><span>[ - ]</span><span>DIBZI wallet activity unavailable. The desk does not retain invented balances.</span></div>`;
    bidRows.innerHTML = "";
    cashtagRows.innerHTML = "";
    if (openRows) openRows.innerHTML = "";
    salesRows.innerHTML = "";
  } else {
    summary.innerHTML = [
      [fmt(src.namesTotal, 0), "all names · current snapshot"],
      [fmt(src.cashtagNames, 0), "cashtag names · current snapshot"],
      [fmt(src.activeNames, 0), "active auctions · current snapshot"],
      [num(src.openAuctionsTotal) === null ? "--" : fmt(src.openAuctionsTotal, 0), "open auctions · full board, endsAt later than site clock"],
      [fmt(src.soldNames, 0), "sold names · current snapshot"],
      [fmt(src.uniqueWallets, 0), "wallets · current snapshot"],
      [sol(src.activeBoardSol), `current leading bids · ${num(src.bidsPerMinute60m) === null ? "bid velocity unavailable · no recent event rows" : `${fmt(src.bidsPerMinute60m, 3)} reported bids/min · last 60m`} · ${src.nameSampleTruncated ? `${fmt(src.names?.length, 0)}-name sample` : "all reported names"}`],
      [fmt(src.totalBids, 0), "bid rows · current snapshot"],
      [sol(src.highestBidSol), "highest current bid", src.highestBidName ? nameLink(src.highestBidName, `${sol(src.highestBidSol)} · ${src.highestBidName}`) : null],
    ].map(([value, label, target]) => `<span class="dibzi-stat"><b>${target || esc(value)}</b><small>${esc(label)}</small></span>`).join("");
    const open = rows(src.openAuctions);
    const openBody = open.map((row) => `<tr>
      <td><b>${nameLink(row.name)}</b>${row.morphed ? ` <span class="desk-badge">morphed${num(row.morphStyle) === null ? "" : ` ${fmt(row.morphStyle, 0)}`}</span>` : ""}<small class="value-age">${row.leaderUsername ? esc(row.leaderUsername) : short(row.leader) || "--"} leading</small></td>
      <td class="desk-number">${sol(row.currentBidSol)}</td>
      <td class="desk-number" title="${esc(`Current bid plus the site's increment rule${src.incrementRule ? ` (${src.incrementRule})` : ""}. Computed, not a quoted price.`)}">${sol(row.minNextBidSol)}</td>
      <td class="desk-number">${fmt(row.bidCount, 0)}</td>
      <td>${row.minutesLeft <= 0 ? "closing" : row.minutesLeft >= 1440 ? `${fmt(Math.round(row.minutesLeft / 1440), 0)}d` : `${fmt(row.minutesLeft, 0)}m`}</td>
    </tr>`).join("");
    if (openRows) openRows.innerHTML = openBody
      ? `<p class="desk-context">Cheapest open entry ${sol(src.openFloorSol)} at <b>${esc(src.openFloorName || "--")}</b>${src.incrementRule ? ` · step rule ${esc(src.incrementRule)}` : ""}${src.incrementRuleParsed === false ? " (unparsed, minimum bid withheld)" : ""}${num(src.openingSol) !== null ? ` · opening ${sol(src.openingSol)}` : ""} · ${fmt(src.openSingleBidCount, 0)} of ${fmt(src.openAuctionsTotal, 0)} still at their first bid${src.morphEnabled === true ? ` · morphing enabled, ${fmt(src.morphedNamesTotal, 0)} names morphed (styles ${esc((src.morphStyles || []).join(", ") || "none")})` : src.morphEnabled === false ? " · morphing disabled by the site" : ""}${src.flashSale?.active === true ? " · flash sale active" : src.flashSale?.exists === true ? ` · flash sale ended ${stamp(src.flashSale.endsAt)}` : ""}</p>` + table("DIBZI open auctions · cheapest first", [["Name"], ["Current bid", "desk-number"], ["Next bid ≥", "desk-number"], ["Bids", "desk-number"], ["Ends in"]], openBody)
      : `<div class="desk-empty"><span>[ - ]</span><span>No open auctions reported: every name in the public response has an end time at or before the site's own clock.</span></div>`;
    const walletBody = wallets.map((wallet) => `<tr><td class="desk-number">${fmt(wallet.rank, 0)}</td><td><b>${esc(wallet.username || short(wallet.wallet))}</b><small class="value-age">${wallet.username ? walletLink(wallet.wallet) : ""}</small></td><td class="desk-number">${sol(wallet.totalBidSol)}</td><td class="desk-number">${fmt(wallet.bids, 0)}</td><td>${fmt(wallet.leading, 0)} lead${wallet.leading === 1 ? "" : "s"}</td></tr>`).join("");
    walletRows.innerHTML = walletBody ? table("DIBZI bidder wallets in current snapshot", [["#", "desk-number"], ["Wallet"], ["Reported bid rows", "desk-number"], ["Rows", "desk-number"], ["Leads"]], walletBody) : `<div class="desk-empty"><span>[ - ]</span><span>No bidder wallets reported.</span></div>`;
    const bidBody = bids.map((bid) => `<tr><td><b>${nameLink(bid.name)}</b><small class="value-age">${esc(bid.username || short(bid.wallet))}</small></td><td class="desk-number">${sol(bid.amountSol)}</td><td>${stamp(bid.at)}</td><td>${walletLink(bid.wallet)}</td><td>${txLink(bid.signature)}</td></tr>`).join("");
    bidRows.innerHTML = bidBody ? table("Recent DIBZI bids", [["Name"], ["Bid", "desk-number"], ["When"], ["Wallet"], ["Tx"]], bidBody) : `<div class="desk-empty"><span>[ - ]</span><span>No bids reported in the current public snapshot.</span></div>`;
    const cashtags = names
      .filter((name) => name.name.trim().startsWith("$"))
      .sort((a, b) => (b.amountSol ?? -Infinity) - (a.amountSol ?? -Infinity) || (Date.parse(a.endsAt || 0) || Infinity) - (Date.parse(b.endsAt || 0) || Infinity));
    const cashtagBody = cashtags.map((name) => `<tr><td><b>${nameLink(name.name)}</b><small class="value-age">${name.settled ? "settled" : "active auction"}</small></td><td class="desk-number">${sol(name.amountSol)}</td><td><b>${esc(name.leaderUsername || short(name.leader))}</b><small class="value-age">${walletLink(name.leader)}</small></td><td>${stamp(name.endsAt)}</td></tr>`).join("");
    cashtagRows.innerHTML = cashtagBody ? table("DIBZI cashtag names", [["Cashtag"], ["Current bid", "desk-number"], ["Leader"], ["Ends"]], cashtagBody) : `<div class="desk-empty"><span>[ - ]</span><span>No dollar-prefixed names reported in the current snapshot.</span></div>`;
    const sales = rows(src.topSales);
    salesRows.innerHTML = sales.length ? `<div class="dibzi-sales-feed">${sales.map((sale, index) => `<article class="dibzi-sale"><strong>${nameLink(sale.name, `${index + 1}. ${sale.name}`)}</strong><b>${sol(sale.amountSol)}</b><small>${sale.ownerUsername ? `${esc(sale.ownerUsername)} · ` : ""}${walletLink(sale.owner)}</small><small>${sale.settledAt ? stamp(sale.settledAt) : "settled time not reported"}</small></article>`).join("")}</div>` : `<div class="desk-empty"><span>[ - ]</span><span>No settled sales reported in the current snapshot.</span></div>`;
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
