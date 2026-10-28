const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (v) => `${v.slice(0, 7)}…${v.slice(-5)}`;
const stamp = (v) => Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString() : "not reported";
const fmt = (v, digits = 4) => v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });
const integer = (v) => v == null ? "—" : Number(v).toLocaleString("en-US");
const headlineNumber = (v) => v == null ? "—" : Math.abs(Number(v)) >= 1_000_000
  ? Number(v).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 }) : fmt(v);
const ADDRESS = /^0x[\da-f]{40}$/i;
const METRICS = { eth: "ETH", points: "Points", achievements: "Achievements", transactions: "Transactions" };
const states = new WeakMap();

// Sort decimal strings exactly; points may exceed Number.MAX_SAFE_INTEGER.
export function comparePoolNumbers(a, b) {
  const split = (v) => { const s = String(v); const [whole, fraction = ""] = s.replace(/^-/, "").split("."); return { negative: s.startsWith("-"), whole, fraction }; };
  const x = split(a), y = split(b), scale = Math.max(x.fraction.length, y.fraction.length);
  const scaled = (v) => BigInt(v.whole + v.fraction.padEnd(scale, "0")) * (v.negative ? -1n : 1n);
  const left = scaled(x), right = scaled(y);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rankPoolRows(rows, metric = "eth") {
  if (!Object.hasOwn(METRICS, metric)) metric = "eth";
  return [...(rows || [])].sort((a, b) => {
    const x = a[metric], y = b[metric];
    if (x == null && y == null) return a.address.localeCompare(b.address);
    if (x == null) return 1;
    if (y == null) return -1;
    return comparePoolNumbers(y, x) || a.address.localeCompare(b.address);
  }).map((row, index) => ({ ...row, viewRank: index + 1 }));
}

export function renderPoolBadge(badge, earned = false) {
  const tier = ["red", "chartreuse", "gold", "blue", "violet", "orange"].includes(badge.tier) ? badge.tier : "neutral";
  const proof = earned && [1, 8453].includes(badge.chainId) && /^0x[\da-f]{64}$/i.test(badge.hash || "")
    ? `<a href="https://${badge.chainId === 8453 ? "basescan.org" : "etherscan.io"}/tx/${badge.hash}" target="_blank" rel="noopener noreferrer">Receipt ↗</a>` : "";
  return `<article class="pvh-badge pvh-tier-${tier}"><div class="pvh-seal" aria-hidden="true">${badge.kind === "artwork" ? "◇" : badge.kind === "multiplier" ? "×" : "✦"}</div><small>${esc(badge.kind || "source rule")} · ${badge.chainId === 8453 ? "Base" : badge.chainId === 1 ? "Ethereum" : "Chain not reported"}</small><h5>${esc(badge.name)}</h5><p>${earned ? `Unlocked ${esc(stamp(badge.unlockedAt))}` : `${integer(badge.wallets)} wallets · published rule`}</p><footer><span>${earned ? `${integer(badge.occurrences)} occurrence(s)` : badge.amount != null ? `${esc(badge.amount)} ${esc(badge.asset || "")}` : "Any amount (source rule)"}</span>${proof}</footer>${badge.multiplier != null && badge.multiplier !== "1" ? `<span class="pvh-effect">${esc(badge.multiplier)}× source modifier</span>` : ""}</article>`;
}

export function initPoolVoidHall(active = false) {
  const root = document.getElementById("poolVoidHall");
  if (!root) return;
  const existing = states.get(root);
  if (existing) { if (active && !existing.started) existing.load(); return; }
  const state = { started: false, data: null, period: "all", metric: "eth", query: "", limit: 50, badgeQuery: "", badgeLimit: 24,
    selected: null, names: new Map(), orders: new Map(), profileRequest: 0, busy: false };
  states.set(root, state);
  root.classList.add("pvh");
  root.innerHTML = `<header class="pvh-hero"><div><p class="pvh-kicker">PUBLIC RECORD / ETHEREUM + BASE</p><h3>HALL OF <em>VOID</em></h3><p>The wallets. The milestones. The receipts.</p></div><div class="pvh-hero-mark" aria-hidden="true">V<span>THE ARCHIVE</span></div></header>
    <p class="pvh-disclosure">Pool Void-reported rankings and achievements. Separate from the receipt-verified Solana board. No wallet connection needed.</p>
    <div class="pvh-controls"><label>Window<select data-control="period"><option value="all">All-time leaderboard</option><option value="week">Rolling 7 days · ETH</option></select></label><label>Rank by<select data-control="metric"><option value="eth">ETH deposited</option><option value="points">Points</option><option value="achievements">Achievements</option><option value="transactions">Transactions</option></select></label><label class="pvh-search">Find a wallet<input data-control="query" type="search" placeholder="Full or partial 0x address" autocomplete="off"></label><button type="button" data-action="lookup">Open address</button><button type="button" data-action="refresh">Refresh data</button></div>
    <p class="pvh-status" data-slot="status" role="status">Open this tab to read the public archive.</p>
    <div class="pvh-podium" data-slot="podium"></div><div data-slot="ranking"></div>
    <section class="pvh-passport" data-slot="passport" aria-label="Wallet passport" tabindex="-1"><p class="pvh-kicker">WALLET PASSPORT</p><h4>A history worth opening.</h4><p>Select any wallet to explore its source-reported achievements and receipt evidence.</p></section>
    <section class="pvh-gallery"><div class="pvh-section-head"><div><p class="pvh-kicker">THE BADGE CABINET</p><h4>Marks left behind.</h4></div><label>Find an achievement<input data-control="badge-query" type="search" placeholder="Name, kind or tier" autocomplete="off"></label></div><p class="pvh-note" data-slot="rule-status"></p><div class="pvh-badges" data-slot="badges"></div><button type="button" data-action="more-badges" hidden>Show 24 more rules</button></section>
    <details class="pvh-proof"><summary>Where the numbers come from</summary><p>Every published leaderboard row is searchable; the table loads 50 at a time. The podium is the top three of the selected metric and window, not the search subset. Source rank is retained in row tooltips. Points, ETH and achievement counts are different measures and are never added together.</p><p>Achievement unlocks are reported by Pool Void’s profile API. A receipt link lets you inspect the underlying transaction; it is not independent verification of Pool Void’s scoring rules. Rule and score timestamps may differ while the source recalculates. Leaderboard entry counts may differ from archive wallet counts.</p><p>Public GET requests only. Server cache: five minutes; refresh may return the cached check. Profiles load only when selected. No background polling.</p><p><a href="https://poolvoid.app/api/leaderboard" target="_blank" rel="noopener noreferrer">Leaderboard JSON ↗</a> · <a href="https://poolvoid.app/api/leaderboard/weekly?period=week" target="_blank" rel="noopener noreferrer">Weekly JSON ↗</a> · <a href="https://poolvoid.app/api/scoring/rules" target="_blank" rel="noopener noreferrer">Rules JSON ↗</a></p><code>curl 'https://poolvoid.app/api/leaderboard'</code></details>`;
  const slot = (name) => root.querySelector(`[data-slot="${name}"]`);
  const control = (name) => root.querySelector(`[data-control="${name}"]`);
  const name = (address) => state.names.get(address) || short(address);
  const badgeButton = root.querySelector('[data-action="more-badges"]');

  function renderRanking() {
    const source = state.period === "week" ? state.data?.weekly : state.data?.board;
    const key = `${state.period}:${state.metric}`;
    if (!state.orders.has(key)) state.orders.set(key, rankPoolRows(source?.items, state.metric));
    const ordered = state.orders.get(key), needle = state.query.trim().toLowerCase();
    const rows = ordered.filter((r) => r.address.includes(needle));
    const stale = source?.stale || source?.ok !== true;
    slot("status").textContent = `${stale ? "Unavailable / last known" : "Checked"} ${stamp(source?.checkedAt)} · ${ordered.length.toLocaleString()} source-listed wallets · ${METRICS[state.metric]} ranking${state.metric === 'points' && state.data?.rules?.recalculating ? " · source scoring is recalculating" : ""}${source?.since ? ` · ${stamp(source.since)} to ${stamp(source.until)}` : ""}${source?.omitted ? ` · ${source.omitted} invalid or duplicate source rows excluded` : ""}${source?.hasMore ? " · source indicates additional rows not included" : ""}${source?.reason ? ` · ${source.reason}` : ""}`;
    slot("podium").innerHTML = ordered.slice(0, 3).map((r, i) => `<button type="button" class="pvh-place pvh-place-${i + 1}" data-address="${r.address}" aria-label="Open wallet ${esc(name(r.address))}"><span class="pvh-place-number">0${i + 1}</span><span class="pvh-kicker">${state.period === "week" ? "7-DAY" : "ALL-TIME"} / ${METRICS[state.metric]}</span><strong title="${esc(r[state.metric])}">${headlineNumber(r[state.metric])}</strong><span class="pvh-person">${esc(name(r.address))} ↗</span><small>${r.achievements == null ? "Open wallet passport" : `${integer(r.achievements)} source-reported achievements`}</small></button>`).join("");
    const ranking = slot("ranking"), previousScroll = ranking.querySelector('.pvh-table-scroll');
    const scroll = [previousScroll?.scrollTop || 0, previousScroll?.scrollLeft || 0];
    ranking.innerHTML = `<div class="pvh-result-count">${rows.length.toLocaleString()} match(es) · showing ${Math.min(state.limit, rows.length)}${needle ? " · ranks remain relative to the full selected board" : ""}</div>${rows.length ? `<div class="pvh-table-scroll" tabindex="0" aria-label="Pool Void leaderboard"><table><thead><tr><th>Rank</th><th>Wallet / passport</th><th>ETH</th><th>Points</th><th>Achievements</th><th>Transactions</th></tr></thead><tbody>${rows.slice(0, state.limit).map((r) => `<tr${r.address === state.selected ? ' class="pvh-selected"' : ""}><td title="Source rank: ${r.sourceRank ?? 'not reported'}">${r.viewRank}</td><td><button type="button" data-address="${r.address}" title="${r.address}">${esc(name(r.address))}</button><small>${esc(short(r.address))}</small></td><td title="${esc(r.eth)}">${fmt(r.eth)}</td><td title="${esc(r.points)}">${fmt(r.points, 2)}</td><td>${integer(r.achievements)}</td><td>${integer(r.transactions)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="pvh-empty">${source?.ok ? "No published wallet matches this address. Use Open address for a direct profile lookup." : "Leaderboard unavailable. Missing data is not zero activity."}</p>`}${rows.length > state.limit ? '<button type="button" data-action="more">Show 50 more wallets</button>' : ""}`;
    const nextScroll = ranking.querySelector('.pvh-table-scroll');
    if (nextScroll) [nextScroll.scrollTop, nextScroll.scrollLeft] = scroll;
  }
  function renderGallery() {
    const source = state.data?.rules;
    const all = (source?.items || []).filter((b) => b.enabled && !b.merged);
    const needle = state.badgeQuery.toLowerCase().trim();
    const matches = all.filter((b) => `${b.name} ${b.kind} ${b.tier}`.toLowerCase().includes(needle));
    slot("rule-status").textContent = `${matches.length} active, unmerged source rules${source?.recalculating ? " · source scoring is recalculating" : ""} · checked ${stamp(source?.checkedAt)}${!source?.ok ? ` · ${source?.reason || 'unavailable'}` : ''}. These are published rules, not awards assigned by this dashboard.`;
    slot("badges").innerHTML = matches.slice(0, state.badgeLimit).map((b) => renderPoolBadge(b)).join("") || '<p class="pvh-empty">No matching rules available.</p>';
    badgeButton.hidden = matches.length <= state.badgeLimit;
  }
  async function load() {
    if (state.busy) return;
    state.started = true; state.busy = true;
    slot("status").textContent = "Reading the public leaderboard and achievement catalog…";
    root.querySelector('[data-action="refresh"]').disabled = true;
    try {
      const response = await fetch('/api/poolvoid?view=hall');
      if (!response.ok) throw Error(`Dashboard API HTTP ${response.status}`);
      const data = await response.json();
      if (!data.board || !data.weekly || !data.rules) throw Error("Incomplete Hall response");
      state.data = data; state.orders.clear(); renderRanking(); renderGallery();
    } catch (error) {
      slot("status").textContent = `Refresh failed: ${error.message}. ${state.data ? 'Previously loaded rankings remain displayed; they are not current.' : 'No data loaded.'}`;
    } finally { state.busy = false; root.querySelector('[data-action="refresh"]').disabled = false; }
  }
  async function openProfile(address) {
    if (!ADDRESS.test(address)) { slot("status").textContent = "Enter a full 0x wallet address to open a passport."; return; }
    address = address.toLowerCase(); state.selected = address;
    const ticket = ++state.profileRequest;
    const passport = slot("passport");
    passport.innerHTML = '<p class="pvh-kicker">WALLET PASSPORT</p><p role="status">Reading identity and earned achievements…</p>';
    passport.focus({ preventScroll: true }); passport.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    renderRanking();
    try {
      const response = await fetch(`/api/poolvoid?view=profile&address=${address}`);
      if (!response.ok) throw Error(`Profile lookup HTTP ${response.status}`);
      const data = await response.json();
      if (ticket !== state.profileRequest) return;
      const p = data.profile;
      if (!p?.address) throw Error(p?.reason || "No profile available");
      const displayName = data.identity?.name || p.displayName || short(address);
      state.names.set(address, displayName);
      passport.innerHTML = `<div class="pvh-section-head"><div><p class="pvh-kicker">WALLET PASSPORT / ${p.receipt ? `RECEIPT ${esc(p.receipt)}` : 'PUBLIC PROFILE'}</p><h4>${esc(displayName)}</h4></div><a href="https://poolvoid.app/#profile/${address}" target="_blank" rel="noopener noreferrer">Original profile ↗</a></div><p class="pvh-full-address">${address}</p>${p.bio ? `<p>${esc(p.bio)}</p>` : ""}<p class="pvh-note">${p.ok ? "Profile checked" : "Last-known profile"} ${esc(stamp(p.checkedAt))} · score calculated ${esc(stamp(p.calculatedAt))}${p.recalculating ? " · source recalculating" : ""}${p.reason ? ` · ${esc(p.reason)}` : ""}</p><div class="pvh-profile-stats"><div><small>ETH reported</small><strong>${fmt(p.eth)}</strong></div><div><small>Points reported</small><strong title="${esc(p.points)}">${fmt(p.points, 2)}</strong></div><div><small>Achievement score count</small><strong>${integer(p.achievementCount)}</strong></div><div><small>Unlock records</small><strong>${integer(p.unlocks?.length)}</strong></div></div><p class="pvh-note">First seen ${esc(stamp(p.firstSeen))} · latest transfer ${esc(stamp(p.latestTransfer))}. Unlock records include different rule kinds and can differ from the achievement score count.</p><div class="pvh-unlocks pvh-badges">${(p.unlocks || []).map((b) => renderPoolBadge(b, true)).join("") || '<p>No unlock records published for this profile.</p>'}</div><p class="pvh-note"><a href="https://poolvoid.app/api/profile/${address}" target="_blank" rel="noopener noreferrer">Profile JSON / proof ↗</a> · Source-reported unlocks, not independently awarded here.</p>`;
      renderRanking();
    } catch (error) { if (ticket === state.profileRequest) passport.innerHTML = `<p class="pvh-kicker">WALLET PASSPORT</p><p role="status">${esc(error.message)}. No achievements inferred.</p>`; }
  }
  root.addEventListener('click', (event) => {
    const wallet = event.target.closest('button[data-address]');
    if (wallet) { openProfile(wallet.dataset.address); return; }
    const action = event.target.closest('button[data-action]')?.dataset.action;
    if (action === 'refresh') load();
    if (action === 'lookup') openProfile(state.query.trim());
    if (action === 'more') { state.limit += 50; renderRanking(); }
    if (action === 'more-badges') { state.badgeLimit += 24; renderGallery(); }
  });
  control('period').addEventListener('change', (e) => {
    state.period = e.target.value; state.limit = 50;
    if (state.period === 'week') { state.previousMetric = state.metric; state.metric = 'eth'; }
    else state.metric = state.previousMetric || 'eth';
    control('metric').value = state.metric; control('metric').disabled = state.period === 'week'; renderRanking();
  });
  control('metric').addEventListener('change', (e) => { state.metric = e.target.value; state.limit = 50; renderRanking(); });
  control('query').addEventListener('input', (e) => { state.query = e.target.value; state.limit = 50; renderRanking(); });
  control('query').addEventListener('keydown', (e) => { if (e.key === 'Enter') openProfile(state.query.trim()); });
  control('badge-query').addEventListener('input', (e) => { state.badgeQuery = e.target.value; state.badgeLimit = 24; renderGallery(); });
  state.load = load;
  if (active) load();
}
