import { sourceDescription } from "./provenance.js";

const TABS = ["coins", "boxes", "activity", "points", "art", "money"];
const STATUS = { coins: "coinSummary", boxes: "boxStatus", activity: "activityStatus", points: "pointsStatus", art: "artStatus", money: "moneyStatus" };
const SOURCES = { coins: ["trix.meme.market", "trix.frontpage"], boxes: ["trix.boxes", "trix.boxboard"], activity: ["trix.money"], points: ["trix.market", "trix.tiers"], art: ["trix.market"], money: ["trix.money", "trix.fee.config"] };
const state = { tab: "coins", view: "all", search: "", chain: "", limit: 20 };
const htmlCache = new WeakMap();
const brokenImages = new Set();
let root = null;
let latest = null;

const el = (id) => root?.querySelector(`#${id}`);
const esc = (value) => String(value ?? "--").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const rows = (value) => Array.isArray(value) ? value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) : [];
const short = (value) => typeof value === "string" && value.length > 16 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
const good = (src) => src?.ok === true && !src.stale && !src.partial && !src.cached && !src.lastError && !(Number(src.status) >= 400);
const stamp = (value) => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;

function fmt(value, digits = 4) {
  const n = number(value);
  return n === null ? "--" : n !== 0 && Math.abs(n) < 10 ** -digits ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: digits });
}
const sol = (value) => number(value) === null ? "--" : `${fmt(value, 9)} SOL`;
const usd = (value) => number(value) === null ? "--" : Math.abs(value) > 0 && Math.abs(value) < 0.01 ? `$${fmt(value)}` : value.toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 2 });

function clock(value, label = "Event time") {
  const time = stamp(value);
  if (!Number.isFinite(time)) return `<span title="${esc(`${label}: unknown`)}">age unknown</span>`;
  const seconds = (Date.now() - time) / 1000;
  const age = seconds < 0 ? "clock mismatch" : seconds < 60 ? "<1m ago" : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
  const iso = new Date(time).toISOString();
  return `<time datetime="${esc(iso)}" title="${esc(`${label}: ${iso} (UTC)`)}">${esc(age)}</time>`;
}

function safeURL(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function currentLaunches(src) {
  const value = safeURL(src?.sourceUrl);
  if (!value) return false;
  const url = new URL(value);
  return ["trix.market", "www.trix.market"].includes(url.hostname) && url.pathname === "/api/launches";
}

function link(base, id, label, title = id) {
  return id == null || id === "" ? esc(label) : `<a href="${esc(base + encodeURIComponent(String(id)))}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">${esc(label)}</a>`;
}
const coinLink = (mint, label) => typeof mint === "string" && /^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[\da-fA-F]{40})$/.test(mint)
  ? link("https://trix.market/coin/", mint, label) : esc(label);
const badge = (label) => `<span class="desk-badge">${esc(label)}</span>`;
const empty = (text) => `<div class="desk-empty"><span aria-hidden="true">[ - ]</span><span>${esc(text)}</span></div>`;

function image(value, label) {
  const url = safeURL(value);
  const usable = url && !brokenImages.has(url);
  return `<span class="coin-placeholder" aria-hidden="true"${usable ? " hidden" : ""}>${esc(String(label || "?").slice(0, 1))}</span>${usable ? `<img class="coin-logo" src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}`;
}

function setHTML(id, html) {
  const node = el(id);
  if (!node || htmlCache.get(node) === html) return;
  const focused = node.contains(document.activeElement) && document.activeElement !== node ? document.activeElement : null;
  const href = focused?.getAttribute("href");
  const regions = [node, ...node.querySelectorAll(".desk-table-scroll")];
  const regionIndex = regions.indexOf(focused);
  const scroll = regions.map((item) => [item.scrollTop, item.scrollLeft]);
  node.innerHTML = html;
  htmlCache.set(node, html);
  const updated = [node, ...node.querySelectorAll(".desk-table-scroll")];
  updated.forEach((item, i) => { if (scroll[i]) [item.scrollTop, item.scrollLeft] = scroll[i]; });
  if (focused) ([...node.querySelectorAll("a[href]")].find((a) => href && a.getAttribute("href") === href) || updated[regionIndex] || node.closest('[role="tabpanel"]'))?.focus({ preventScroll: true });
}

function endpoint(src, key) {
  const part = src?.endpoints?.[key];
  if (!part) return src?.partial ? { ...src, ok: false } : src;
  return { ...part, stale: Boolean(src?.stale || part.stale), checkedAt: part.checkedAt ?? src?.checkedAt, reason: part.reason || (part.ok === false ? src?.reason : null) };
}

function status(tab, src, hasData, detail = "") {
  const failed = !src || src.ok === false || src.lastError || Number(src.status) >= 400;
  const old = Date.now() - stamp(src?.checkedAt) > 20 * 60_000;
  const label = src?.stale || old ? hasData ? "Stale data" : "Unavailable" : failed ? hasData ? "Last known" : "Unavailable" : src.cached ? "Cached" : src.partial ? "Partial" : src.ok === true ? "Checked" : "No clock";
  const report = `${label} · ${clock(src?.checkedAt, "Source check (not publication time)")}`;
  setHTML(STATUS[tab], detail ? esc(detail) : report);
  const button = root?.querySelector(`[data-desk-tab="${tab}"]`);
  if (button) { button.dataset.state = failed || src?.stale ? "unavailable" : old ? "stale" : "available"; button.title = label; }
  if (state.tab === tab) setHTML("trixDeskStatus", report);
}

function unavailable(src, label = "Unavailable") {
  return `${label}${Number(src?.status) >= 400 ? ` (HTTP ${src.status})` : ""}. Details under Sources.`;
}

function emptyRows(src, raw, message) {
  return empty(good(src) && Array.isArray(raw) ? message : unavailable(src, src?.stale ? "No retained rows" : "Rows unavailable"));
}

function table(label, headers, body) {
  return `<div class="desk-table-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table class="desk-table"><thead><tr>${headers.map(([text, cls = "", sort = ""]) => `<th scope="col" class="${esc(cls)}"${sort ? ` aria-sort="${esc(sort)}"` : ""}>${esc(text)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderCoins(catalog, frontpage) {
  const homepage = state.view !== "all";
  let src = homepage ? frontpage : catalog;
  const group = homepage ? src?.[state.view] : src?.coins;
  const labels = { all: "Market cap", featured: "Featured", boosted: "Boosted", recent: "New launches" };
  const raw = rows(group);
  if (homepage && src) {
    // Preserve homepage order; its categories are not market-cap rankings.
    src = { ...src, coins: raw.map(r => ({
      mintAddress: r.mintAddress, ticker: r.symbol, tokenName: r.name, logoUrl: r.logoUrl,
      chain: r.chain, type: r.isCoinAgent === true ? "Agent" : "Token", status: r.status,
      currentMarketCap: number(r.marketCap), marketCapUpdatedAt: r.marketCapUpdatedAt,
      createdAt: r.createdAt,
    })) };
  }
  const accepted = homepage ? Array.isArray(group) : currentLaunches(src);
  const coins = accepted ? rows(src?.coins) : [];
  if (!homepage) coins.sort((a, b) => (number(b.currentMarketCap) ?? -Infinity) - (number(a.currentMarketCap) ?? -Infinity));
  const chains = [...new Set(coins.map((coin) => coin.chain).filter((chain) => typeof chain === "string" && chain))];
  if (state.chain && !chains.includes(state.chain)) chains.push(state.chain);
  setHTML("coinChain", `<option value="">All networks</option>${chains.sort().map((chain) => `<option value="${esc(chain)}">${esc(chain)}</option>`).join("")}`);
  if (el("coinChain") && el("coinChain").value !== state.chain) el("coinChain").value = state.chain;
  const query = state.search.trim().toLowerCase();
  const filtered = coins.map((coin, index) => ({ coin, rank: index + 1 })).filter(({ coin }) => (!state.chain || coin.chain === state.chain) && [coin.ticker, coin.tokenName, coin.mintAddress].some((value) => String(value ?? "").toLowerCase().includes(query)));
  const shown = filtered.slice(0, state.limit);
  const check = accepted ? src : { ok: false, checkedAt: src?.checkedAt };
  const knownRows = Array.isArray(src?.coins) && (coins.length > 0 || good(check));
  status("coins", check, coins.length > 0, !accepted ? `${labels[state.view]} feed unavailable` : knownRows ? `${shown.length} / ${filtered.length} coins${homepage ? ` · ${labels[state.view]} on TRIX` : ` · ${usd(src?.totalMarketCap)} sample cap${src?.catalogTotal > coins.length ? ` · ${fmt(src.catalogTotal)} in catalog` : ""}`}` : "Launch rows unavailable");
  const context = el("frontpageStatus");
  if (context) context.hidden = !homepage;
  setHTML("frontpageStatus", homepage ? `Homepage built ${clock(frontpage?.builtAt, "TRIX homepage build")} · categories can overlap` : "");
  const body = shown.map(({ coin, rank }) => `<tr><td class="desk-number">${rank}</td><td><div class="coin-identity">${image(coin.logoUrl, coin.ticker || coin.tokenName)}<div class="coin-copy"><b>${coinLink(coin.mintAddress, coin.ticker || coin.tokenName || "--")}</b><small title="${esc(coin.tokenName)}">${esc(coin.tokenName)}</small><div class="coin-tags">${["Agent", "Token"].includes(coin.type) ? badge(coin.type) : ""}${coin.chain ? badge(coin.chain) : ""}<span class="desk-badge">${state.view === "recent" ? `Launched ${clock(coin.createdAt, "Launch creation")}` : `MCap ${clock(coin.marketCapUpdatedAt, "Reported market-cap update")}`}</span></div></div></div></td><td class="desk-number" title="${esc(`TRIX-reported MCap (USD): ${number(coin.currentMarketCap) ?? "unknown"}`)}">${esc(usd(coin.currentMarketCap))}${state.view === "recent" ? `<small class="value-age">${clock(coin.marketCapUpdatedAt, "Reported market-cap update")}</small>` : ""}</td><td class="desk-secondary">${esc(coin.status)}</td></tr>`).join("");
  setHTML("coinRows", shown.length ? table(homepage ? `${labels[state.view]} on TRIX` : "Coins ranked by reported market cap", [["#", "desk-number"], ["Coin"], ["MCap", "desk-number", homepage ? "" : "descending"], ["Status", "desk-secondary"]], body) : !accepted ? empty(homepage ? "Homepage feed unavailable." : src ? "Current /api/launches data unavailable; legacy snapshots are not shown." : "Launch ranking unavailable.") : coins.length ? empty("No coins match these filters.") : emptyRows(src, group, "No launches reported."));
  const more = el("coinMore");
  if (more) {
    const remaining = filtered.length - shown.length;
    if (!remaining && document.activeElement === more) el("desk-coins")?.focus({ preventScroll: true });
    more.hidden = remaining <= 0;
    more.disabled = remaining <= 0;
    more.textContent = `Show next ${Math.min(20, Math.max(0, remaining))}`;
  }
}

function renderBoxes(official, board) {
  const fromBoard = good(board) && (board.collectors.length + board.boxes.length > 0);
  const src = fromBoard ? board : official;
  const hasData = fromBoard || [official?.topCoins, official?.biggestPulls, official?.topCollectors].some((list) => rows(list).length);
  status("boxes", src, hasData, fromBoard
    ? `Round ${fmt(board.round, 0)} ${esc(board.roundStatus || "warming")} · ${fmt(board.mintedTotal, 0)} minted · ${fmt(board.boxesLeft, 0)} left`
    : !good(official) && hasData ? unavailable(official, "Last-known box results") : "Official box leaderboard");
  if (fromBoard) {
    const chainBit = board.chain?.walletsScanned != null
      ? `On-chain scan · ${fmt(board.chain.walletsScanned, 0)} wallets · ${fmt(board.chain.boxEvents, 0)} box events · treasury ${short(board.chain.treasury)}`
      : "";
    const stamp = `Aggregator snapshot ${clock(board.dataUpdatedAt, "Aggregator snapshot")} · ${chainBit}${board.fallbackReason ? ` · TRIX source fallback: ${esc(board.fallbackReason)}` : ""}`;
    const boxTiles = board.boxes.map((b) => `<section class="box-tile${b.inRound ? " in-round" : ""}" style="--box-hex:${esc(b.hex || "#444")}">
      <b>${esc(b.type)}</b><span class="box-color">${esc(b.color)}</span>
      <dl><dt>Minted</dt><dd>${fmt(b.minted, 0)}</dd><dt>Left</dt><dd>${fmt(b.left, 0)}</dd><dt>Price</dt><dd>${usd(b.priceUsd)} · ${sol(b.priceSol)}</dd></dl>
      <span class="desk-badge">${b.inRound ? "In round" : "Not in round"}</span>
    </section>`).join("");
    const collectorBody = board.collectors.slice(0, 50).map((c) => `<tr>
      <td class="desk-number">${fmt(c.rank, 0)}</td>
      <td><b>${esc(c.username || short(c.wallet) || "--")}</b>${c.verified === true ? ' <span class="desk-badge">Verified</span>' : ""}</td>
      <td class="desk-number">${fmt(c.boxes, 0)}</td>
      <td>${c.kinds ? Object.entries(c.kinds).map(([kind, n]) => `${esc(kind)} ${fmt(n, 0)}`).join(" · ") : "--"}</td>
      <td class="desk-secondary">${link("https://solscan.io/account/", c.wallet, short(c.wallet))}</td>
    </tr>`).join("");
    const rarityChips = board.rarities.map((r) => `<span class="rarity-chip" title="${esc(`${r.type} odds from snapshot`)}">${esc(r.type)} ${fmt(r.oddsPct)}%</span>`).join("");
    const cardChips = board.cards.map((c) => `<span class="rarity-chip muted" title="${esc(`${c.type} shop card`)}">${esc(c.type)} ${fmt(c.multiplier)}x · ${sol(c.priceSol)}</span>`).join("");
    setHTML("boxRows", `<p class="desk-context">${stamp}</p>
      <div class="box-type-grid">${boxTiles}</div>
      <h4 class="board-subhead">Most boxes · on-chain wallet scan</h4>
      ${collectorBody ? table("Most boxes per public wallet", [["#", "desk-number"], ["User"], ["Boxes", "desk-number"], ["Kinds"], ["Wallet", "desk-secondary"]], collectorBody) : empty("No collector rows reported.")}
      ${rarityChips ? `<div class="rarity-strip"><small>Rarity odds · snapshot</small>${rarityChips}</div>` : ""}
      ${cardChips ? `<div class="rarity-strip"><small>Shop card types</small>${cardChips}</div>` : ""}`);
    return;
  }
  const data = [official?.topCoins, official?.biggestPulls, official?.topCollectors];
  if (!hasData && (!good(official) || !data.some(Array.isArray))) {
    setHTML("boxRows", empty(unavailable(official, "Box leaderboard unavailable")));
    return;
  }
  const boards = [
    ["Most-ripped coins", [["Coin"], ["Rips", "desk-number"]], official?.topCoins, (r) => `<td><div class="coin-identity">${image(r.logoUrl, r.symbol || r.name)}<div class="coin-copy"><b>${coinLink(r.mint, r.symbol || r.name || "--")}</b><small>${esc(r.name)}</small></div></div></td><td class="desk-number">${fmt(r.rips)}</td>`],
    ["Biggest pulls by rarity", [["Ripper"], ["Rarity"], ["Coin"], ["USD", "desk-number"]], official?.biggestPulls, (r) => `<td>${esc(r.ripper)}</td><td>${esc(r.rarity)}</td><td>${esc(r.coinSymbol)}</td><td class="desk-number">${usd(r.rewardUsd)}</td>`],
    ["Collectors", [["User"], ["Rips", "desk-number"], ["Mythics", "desk-number"], ["USD", "desk-number"]], official?.topCollectors, (r) => `<td>${esc(r.username)}</td><td class="desk-number">${fmt(r.rips)}</td><td class="desk-number">${fmt(r.mythics)}</td><td class="desk-number">${usd(r.earnedUsd)}</td>`],
  ];
  setHTML("boxRows", `<div class="box-board-grid">${boards.map(([name, heads, raw, row]) => `<section><h3>${esc(name)}</h3>${rows(raw).length ? table(name, heads, rows(raw).slice(0, 20).map((r) => `<tr>${row(r)}</tr>`).join("")) : emptyRows(official, raw, "No entries reported.")}</section>`).join("")}</div>`);
}

function renderActivity(money, geoff) {
  const trades = rows(money?.recentTrades).slice(0, 12);
  const check = endpoint(money, "trades");
  const knownTrades = good(check) && Array.isArray(money?.recentTrades);
  const generations = trades.length || knownTrades ? [] : rows(geoff?.records).filter((r) => r.id != null).slice(0, 12);
  const fallback = generations.length > 0;
  const heading = el("desk-activity")?.querySelector("h3");
  if (heading) heading.textContent = fallback ? "Paid generations" : "Recent feed events";
  status("activity", fallback ? geoff : check, trades.length > 0 || fallback, fallback ? "Paid generations · trade feed unavailable" : trades.length || knownTrades ? `${trades.length} shown · API feed events` : "Feed unavailable");
  const body = (fallback ? generations : trades).map((r) => {
    const side = fallback ? r.inferred === true ? "Inferred gen" : "Paid gen" : r.side;
    const label = fallback ? short(String(r.id)) : r.symbol || short(r.mint) || "--";
    const amount = fallback ? number(r.feeLamports) === null ? null : r.feeLamports / 1e9 : r.solAmount;
    const signature = fallback ? r.txSignature : r.signature;
    return `<div class="activity-row"><span>${esc(side)}</span><span class="coin-copy"><b>${fallback ? esc(label) : coinLink(r.mint, label)}</b><small title="${esc(r.id)}">${esc(fallback ? `Generation ${r.id}` : r.id == null ? "Feed event" : `Event ${short(String(r.id))}`)}</small></span><span class="desk-number">${sol(amount)}</span>${clock(r.createdAt, fallback ? "Generation event" : "Feed event")}${link("https://solscan.io/tx/", signature, signature ? "Receipt" : "--")}</div>`;
  }).join("");
  setHTML("activityRows", body || emptyRows(check, money?.recentTrades, "No trades reported in this sample."));
  const flows = rows(money?.fees?.topCoins);
  const flowRows = flows.map(r => `<tr><td>${coinLink(r.mint, r.symbol || short(r.mint) || "--")}</td><td class="desk-number">${fmt(r.buySol)}</td><td class="desk-number">${fmt(r.sellSol)}</td><td class="desk-number">${fmt(r.count, 0)}</td></tr>`).join("");
  setHTML("activityFlow", flowRows ? table("Per-coin flow in the 50-event sample", [["Coin / event"], ["Buy SOL", "desk-number"], ["Sell SOL", "desk-number"], ["Events", "desk-number"]], flowRows) : emptyRows(check, money?.fees?.topCoins, "No per-coin flow in this sample."));
  return fallback;
}

function renderPoints(market, tierSource) {
  const check = endpoint(market, "leaderboard");
  const items = rows(market?.leaderboard?.rows).slice(0, 100);
  // A missing threshold could change the result; do not guess around incomplete definitions.
  const rawTiers = Array.isArray(tierSource) ? tierSource : tierSource?.tiers;
  const validTiers = Array.isArray(rawTiers) && rawTiers.every((tier) => typeof tier?.name === "string" && tier.name && number(tier.minPoints) !== null && tier.minPoints >= 0);
  const definitions = good(check) && (Array.isArray(tierSource) || good(tierSource)) && validTiers ? [...rawTiers].sort((a, b) => b.minPoints - a.minPoints) : [];
  status("points", check, items.length > 0, `Top ${items.length} public users${market?.leaderboard?.capped ? " · capped page" : ""}${number(market?.leaderboard?.totalPoints) !== null ? ` · ${fmt(market.leaderboard.totalPoints, 0)} points in this page` : ""}`);
  const body = items.map((r) => {
    const tier = number(r.points) === null ? null : definitions.find((entry) => r.points >= entry.minPoints);
    return `<tr><td class="desk-number">${fmt(r.rank)}</td><td><b>${esc(r.username || short(r.wallet) || "--")}</b>${r.verified === true ? '<span class="desk-badge" title="TRIX-reported verification">Verified</span>' : ""}</td><td class="desk-number">${fmt(r.points)}</td><td title="${esc(tier ? `From ${fmt(tier.minPoints, 0)} reported points` : "Tier unavailable")}">${esc(tier?.name)}</td><td class="desk-secondary">${link("https://solscan.io/account/", r.wallet, short(r.wallet))}</td></tr>`;
  }).join("");
  setHTML("pointsRows", items.length ? table("Top 100 user points", [["#", "desk-number"], ["User"], ["User points", "desk-number"], ["Loyalty tier"], ["Wallet", "desk-secondary"]], body) : emptyRows(check, market?.leaderboard?.rows, "No user points entries reported."));
}

function renderArt(market) {
  const check = endpoint(market, "recentMints");
  const items = rows(market?.recentMints).slice(0, 20);
  const catalog = market?.artworks;
  status("art", check, items.length > 0, items.length ? `${items.length} shown${number(catalog?.total) !== null ? ` · ${fmt(catalog.total)} in catalog sample${catalog.capped ? ` (cap ${fmt(catalog.window)})` : ""}` : ""}${number(catalog?.printedSupply) !== null ? ` · ${fmt(catalog.printedSupply)} printed copies` : ""}` : good(check) && Array.isArray(market?.recentMints) ? "No artworks reported" : "Artwork rows unavailable");
  const body = items.map((r) => `<tr><td><div class="coin-identity">${image(r.imageUrl, r.name)}<div class="coin-copy"><b>${link("https://trix.market/artwork/", r.id, r.name || "Untitled")}</b><div class="coin-tags">${r.artworkType ? badge(r.artworkType) : ""}${r.status ? badge(r.status) : ""}</div><small title="${esc(r.id)}">${esc(short(r.id))}</small></div></div></td><td>${coinLink(r.linkedCoinMint, r.linkedCoinSymbol || short(r.linkedCoinMint) || "--")}${r.linkedCoinMint && number(r.currentMarketCap) !== null ? `<small class="value-age" title="Linked coin's market cap, not the artwork price">MCap ${usd(r.currentMarketCap)} · ${clock(r.marketCapUpdatedAt, "Linked coin market-cap update")}</small>` : ""}</td><td class="desk-secondary">${link("https://solscan.io/token/", r.mintAddress, short(r.mintAddress))}</td></tr>`).join("");
  setHTML("artRows", items.length ? table("Reported artwork sample", [["Artwork"], ["Linked coin"], ["Mint", "desk-secondary"]], body) : emptyRows(check, market?.recentMints, "No artworks reported."));
}

function renderMoney(src, feeConfig) {
  const treasury = src?.treasury || {};
  const leg = src?.geoffLeg1 || {};
  const split = src?.feeSplit || {};
  const fees = src?.fees || {};
  const hasData = [treasury.balanceSol, treasury.balanceSolOnChain, treasury.totalPoints, leg.balanceSol, split.platformFeeBps, split.creatorFeeBps, split.platformLaunchFeeSol, fees.recentBuysSol, fees.recentSellsSol, fees.recentNetSol, fees.buyCount, fees.sellCount, fees.uniqueWallets, feeConfig?.feeBps].some((v) => number(v) !== null) || Boolean(feeConfig?.feeWallet || feeConfig?.treasuryWallet);
  status("money", src || feeConfig, hasData, "Configured fees · balances · sampled trades");
  if (!hasData) { setHTML("moneyRows", empty(unavailable(src, "Money feed unavailable"))); return; }
  const address = (value) => link("https://solscan.io/account/", value, short(value));
  const bps = (value) => number(value) === null ? "--" : `${fmt(value)} bps (${fmt(value / 100)}%)`;
  const tiles = [
    ["Fee settings (TRIX)", [["Platform", bps(split.platformFeeBps)], ["Creator", bps(split.creatorFeeBps)], ["Launch", sol(split.platformLaunchFeeSol)]]],
    ["Treasury (TRIX)", [["API balance", sol(treasury.balanceSol)], ["Total points", fmt(treasury.totalPoints)], ["Wallet", address(treasury.address)]]],
    ["Treasury (on-chain)", [["SOL balance", sol(treasury.balanceSolOnChain)], ["Balance read", clock(treasury.balanceSolOnChainAt, "On-chain treasury balance read")], ["Wallet", address(treasury.address)]]],
    ["Geoff leg 1 (separate wallet)", [["SOL balance", sol(leg.balanceSol)], ["Balance read", clock(leg.balanceSolOnChainAt ?? src?.endpoints?.geoffLeg1?.checkedAt, "Geoff leg 1 balance read")], ["Wallet", address(leg.address)]]],
    ["Trades (sample, not fees)", [["Buys", sol(fees.recentBuysSol)], ["Sells", sol(fees.recentSellsSol)], ["Buy - sell", sol(fees.recentNetSol)], ["Buy / sell count", `${fmt(fees.buyCount)} / ${fmt(fees.sellCount)}`], ["Wallets", fmt(fees.uniqueWallets)]]],
  ];
  if (feeConfig) {
    const match = (configured, watched) => !good(feeConfig) || !good(src) || !configured || !watched ? "Unknown" : configured === watched ? "Match" : "Different";
    tiles.unshift(["Fee configuration (TRIX)", [["Configured rate", bps(feeConfig.feeBps)], ["Fee recipient", address(feeConfig.feeWallet)], ["Treasury recipient", address(feeConfig.treasuryWallet)], ["Fee / watched leg", match(feeConfig.feeWallet, leg.address)], ["Treasury / watched", match(feeConfig.treasuryWallet, treasury.address)], ["Config checked", `${good(feeConfig) ? "" : "Unavailable / retained · "}${clock(feeConfig.checkedAt, "Fee configuration check")}`]]]);
  }
  setHTML("moneyRows", `<div class="desk-money-grid">${tiles.map(([name, fields]) => `<section class="desk-money-tile"><h3>${esc(name)}</h3><dl>${fields.map(([key, value]) => `<dt>${esc(key)}</dt><dd class="desk-number">${value}</dd>`).join("")}</dl></section>`).join("")}</div>`);
}

function selectTab(tab, focus = false) {
  if (!TABS.includes(tab)) return;
  state.tab = tab;
  for (const name of TABS) {
    const button = root?.querySelector(`[data-desk-tab="${name}"]`);
    if (button) {
      button.setAttribute("aria-selected", String(name === tab));
      button.tabIndex = name === tab ? 0 : -1;
      if (focus && name === tab) button.focus();
    }
    if (el(`desk-${name}`)) el(`desk-${name}`).hidden = name !== tab;
  }
}

/** Wire the existing desk once. The shared collector owns all requests. */
export function initTrixDesk() {
  const desk = document.getElementById("trixDesk");
  if (!desk || desk === root) return;
  root = desk;
  state.search = el("coinSearch")?.value || state.search;
  root.addEventListener("click", (event) => {
    const button = event.target.closest?.(".desk-tabs [data-desk-tab]");
    if (!button || !root.contains(button)) return;
    selectTab(button.dataset.deskTab);
    renderTrixDesk(latest);
  });
  root.addEventListener("keydown", (event) => {
    const button = event.target.closest?.(".desk-tabs [data-desk-tab]");
    if (!button || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.indexOf(button.dataset.deskTab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    selectTab(TABS[next], true);
    renderTrixDesk(latest);
  });
  root.addEventListener("error", (event) => {
    const img = event.target;
    if (!img.matches?.("img.coin-logo")) return;
    brokenImages.add(img.src);
    const placeholder = img.previousElementSibling;
    if (placeholder?.classList.contains("coin-placeholder")) placeholder.hidden = false;
    img.remove();
  }, true);
  el("coinSearch")?.addEventListener("input", (event) => { state.search = event.target.value; renderTrixDesk(latest); });
  el("coinChain")?.addEventListener("change", (event) => { state.chain = event.target.value; renderTrixDesk(latest); });
  el("coinView")?.addEventListener("change", (event) => {
    if (!["all", "featured", "boosted", "recent"].includes(event.target.value)) return;
    state.view = event.target.value;
    state.limit = 20;
    renderTrixDesk(latest);
  });
  el("coinMore")?.addEventListener("click", () => { state.limit += 20; renderTrixDesk(latest); });
  selectTab(state.tab);
}

/** Render only shared latest.sources; never substitute dashboard summary snapshots. */
export function renderTrixDesk(value) {
  latest = value;
  initTrixDesk();
  if (!root) return;
  const sources = latest?.sources || {};
  renderCoins(sources["trix.meme.market"], sources["trix.frontpage"]);
  renderBoxes(sources["trix.boxes"], sources["trix.boxboard"]);
  const generations = renderActivity(sources["trix.money"], sources["trix.geoff"]);
  renderPoints(sources["trix.market"], sources["trix.tiers"]);
  renderArt(sources["trix.market"]);
  renderMoney(sources["trix.money"], sources["trix.fee.config"]);
  const names = [...SOURCES[state.tab], ...(state.tab === "activity" && generations ? ["trix.geoff"] : [])];
  const descriptions = names.flatMap((name) => {
    const src = sources[name];
    const keys = state.tab === "points" ? ["leaderboard"] : state.tab === "art" ? ["recentMints", "artworks", "launches"] : state.tab === "activity" ? ["trades"] : Object.keys(src?.endpoints || {});
    return [sourceDescription(name, src), ...keys.filter((key) => src?.endpoints?.[key]).map((key) => sourceDescription(`${name}.${key}`, endpoint(src, key)))];
  });
  const disclosure = el("deskSourceText");
  const text = descriptions.join("\n\n");
  if (disclosure && disclosure.textContent !== text) disclosure.textContent = text;
}
