import { evidenceState, EVIDENCE_WINDOW } from "./evidence.js";
const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export function compactChange(value) {
  return String(value ?? "").replace(/(?<![\w.])-?\d+\.\d{4,}(?![\w.])/g, (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) >= Number.MAX_SAFE_INTEGER) return raw;
    if (n !== 0 && Math.abs(n) < 0.001) return n > 0 ? "<0.001" : ">-0.001";
    return `≈${n.toLocaleString("en-US", { maximumFractionDigits: 3 })}`;
  });
}
const groups = [["Geoff","geoff.","https://www.geoff.ai/"],["StackNet","stacknet.","https://stacknet.magma-rpc.com/health"],["TRIX","trix.","https://trix.market/"],["DIBZI","dibzi.","https://dibzi.ai/"],["SIM","sim.","https://sim.tech/"],["AZY","azy.","https://azy.life/"],["MAGMA","magma.","https://opensea.io/collection/the-simulation-958481099"]];
const link = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const localPackArt = {
  base: "/pack-art/base-68ba406bb54c0152caed.webp",
  hype: "/pack-art/hype-5d856152021f89a3cded.webp",
  viral: "/pack-art/viral-835f33d9aa6157cfb7dc.webp",
};
export function packSalesFeed(flow, packArt = {}, now = Date.now()) {
  const packAvailable = ["CURRENT", "DELAYED"].includes(evidenceState(flow, now));
  if (!flow || (!packAvailable && !flow.payouts?.length && !flow.sellbackScan?.ok)) return "Sales feed unavailable.";
  const tiles = [];
  function participant(wallet) {
    if (!wallet) return "unavailable";
    const name = flow.profiles?.[wallet]?.username;
    if (!name) return esc(`${wallet.slice(0, 5)}…${wallet.slice(-4)}`);
    return link(`https://www.trix.market/profile/${encodeURIComponent(name)}`, `@${name}`);
  }
  const payoutRows = (flow.payouts || []).filter(p => Date.parse(p.at) >= now - EVIDENCE_WINDOW && Date.parse(p.at) <= now &&
    Number.isSafeInteger(p.lamports) && p.lamports > 0 && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(p.signature));
  for (const p of payoutRows) {
    const amount = p.lamports < 1000000 ? "<0.001" : (p.lamports / 1e9).toFixed(3);
    tiles.push({ at: p.at, sol: p.lamports / 1e9, id: `${p.signature}:${Number(p.index)}`, style: "shop-payout", body: `<span><small>SHOP BUYBACK · ${esc(new Date(p.at).toISOString().slice(11,19))} UTC</small><b title="${p.lamports} lamports">${link(`https://solscan.io/tx/${p.signature}`, `${amount} SOL`)}</b><small>Paid ${participant(p.seller)}</small><small title="The payout identifies the recipient and amount, not a verified card mint or rip ID.">Sold card unknown · no art match</small></span>` });
  }
  for (const r of packAvailable ? flow.records || [] : []) {
    const time = Date.parse(r?.at);
    if (!(time <= now && time >= now - EVIDENCE_WINDOW) || !Number.isSafeInteger(r.packs) || r.packs < 1 ||
        !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(r.signature) || !Array.isArray(r.lamports) || r.lamports.length !== 2 ||
        !r.lamports.every(n => Number.isSafeInteger(n) && n > 0)) continue;
    const sol = (r.lamports[0] + r.lamports[1]) / 1e9;
    const buyer = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.buyer || "") ? r.buyer : null;
    const tiers = (r.tiers || []).filter(t => ["base", "hype", "viral"].includes(t));
    const art = tiers.map(t => {
      const remote = packArt[t];
      const knownImage = localPackArt[t].split("-").pop().replace(".webp", ".png");
      const url = /^https:\/\//.test(remote || "") && !remote.endsWith("/" + knownImage) ? remote : localPackArt[t];
      return `<img src="${esc(url)}" alt="${t} pack" decoding="async">`;
    }).join("");
    tiles.push({ at: r.at, sol, id: `${r.signature}:pack`, style: "pack-purchase", body: `${art ? `<i>${art}</i>` : ""}<span><b>${link(`https://solscan.io/tx/${r.signature}`, `${sol < 0.001 ? "<0.001" : sol.toFixed(3)} SOL`)}</b><small>Buyer ${participant(buyer)}</small><small>${r.packs} pack${r.packs === 1 ? "" : "s"}</small></span>` });
  }
  tiles.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // Spread replays around one circuit. Originals retain their chronological order.
  const circuit = [];
  for (const [position, tile] of tiles.entries()) {
    const appearances = tiles.length < 2 ? 1 : tile.sol >= 10 ? 3 : tile.sol >= 1 ? 2 : 1;
    for (let n = 0; n < appearances; n++) {
      circuit.push({ tile, n, position: (position + n * tiles.length / appearances) % tiles.length });
    }
  }
  return circuit.sort((a, b) => a.position - b.position || a.n - b.n)
    .map(({ tile, n }) => `<div class="sale-tile ${tile.style}" data-receipt="${tile.id}:${n}">${tile.body}${n ? '<small class="receipt-replay">Replay</small>' : ""}</div>`)
    .join("") || "No purchases or shop buybacks observed in the current sample.";
}
let lastPackSales = "";
let feedSources;
function updateSalesRail() {
  const rail = document.getElementById("packSalesRail");
  if (!rail || !feedSources) return;
  const flow = feedSources["trix.packflow"];
  const scan = flow?.sellbackScan;
  const coverage = document.getElementById("sellbackCoverage");
  if (coverage) coverage.textContent = !scan?.ok ? "Live scan unavailable · observed receipts only." :
    scan.end ? "Catching up on finalized receipts." : `Live scan through slot ${scan.through} · earlier history sampled.`;
  const html = packSalesFeed(flow, feedSources["trix.packmints"]?.packArt);
  if (html === lastPackSales) return;
  const left = rail.getBoundingClientRect().left;
  const anchor = rail.scrollLeft > 1 && [...rail.children].find(el => el.getBoundingClientRect().right > left);
  const offset = anchor && anchor.getBoundingClientRect().left;
  const template = document.createElement("template");
  template.innerHTML = html;
  const retained = new Map([...rail.children].filter(el => el.dataset.receipt).map(el => [el.dataset.receipt, el]));
  let cursor = rail.firstChild;
  for (const next of [...template.content.childNodes]) {
    const existing = next.dataset?.receipt && retained.get(next.dataset.receipt);
    const node = existing && existing.isEqualNode(next) ? existing : next;
    if (node !== cursor) rail.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
  while (cursor) { const obsolete = cursor; cursor = cursor.nextSibling; obsolete.remove(); }
  if (anchor?.dataset?.receipt) {
    const el = [...rail.children].find(el => el.dataset.receipt === anchor.dataset.receipt);
    if (el) rail.scrollLeft += el.getBoundingClientRect().left - offset;
  }
  lastPackSales = html;
}
const age = (at) => {
  const minutes = (Date.now() - Date.parse(at)) / 60000;
  return !Number.isFinite(minutes) || minutes < 0 ? "age unknown" : minutes < 1 ? "just checked" : minutes < 60 ? `${Math.floor(minutes)}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
};
export function initOverview() {
  const rail = document.getElementById("packSalesRail");
  const loop = document.getElementById("salesLoop");
  if (rail && loop) {
    rail.addEventListener("error", e => {
      const img = e.target;
      if (img.tagName === "IMG") img.replaceWith(document.createTextNode(img.alt));
    }, true);
    let paused = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const label = () => { loop.textContent = paused ? "Play loop" : "Pause loop"; };
    label();
    loop.onclick = () => { paused = !paused; label(); };
    window.setInterval(() => {
      if (paused || document.hidden || rail.matches(":hover, :focus-within") || rail.scrollWidth <= rail.clientWidth) return;
      const left = rail.getBoundingClientRect().left;
      const next = [...rail.children].find(el => el.getBoundingClientRect().left > left + 2);
      if (!next || rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1) rail.scrollLeft = 0;
      else rail.scrollBy({ left: next.getBoundingClientRect().left - left, behavior: "smooth" });
    }, 3000);
  }
  document.querySelector(".desk-intro").insertAdjacentHTML("afterend", '<section id="glance" aria-label="Public visibility overview"><div id="sourceStrip" class="source-strip"></div><div id="latestSignal" class="latest-signal"></div><div class="glance-heading"><div><p class="eyebrow">THE LIVE DESK / OVERVIEW</p><h2>Signals at a glance<span>.</span></h2></div><a href="#diagnosticsWorkspace">Source health ↗</a></div><div id="quickFacts" class="quick-facts"></div><div id="packActivity" class="pack-activity"></div><details class="data-disclosure"><summary>TRIX winner routes · access check, Nov 17</summary><p>The client routes <a href="https://www.trix.market/cards/winners" target="_blank" rel="noopener noreferrer">winners</a>, <a href="https://www.trix.market/cards/winners/above-%241k" target="_blank" rel="noopener noreferrer">above $1k</a> and <a href="https://www.trix.market/cards/winners/above-%2410k" target="_blank" rel="noopener noreferrer">above $10k</a> map to an admin sign-in component. No winner data or payout amounts were publicly verified. Route names are not proof of winners or a release date.</p></details><div class="glance-heading changes-heading"><div><p class="eyebrow">THE LATEST / PUBLIC SOURCES</p><h2>What changed<span>.</span></h2></div><span>LAST 24 HOURS</span></div><div id="quickChanges"></div></section>');
  const briefing = document.querySelector(".stacknet-brief");
  if (briefing) { const fold = document.createElement("details"); fold.className = "briefing-fold"; fold.innerHTML = "<summary>Research archive · Stacknet calculator</summary>"; briefing.before(fold); fold.append(briefing); }
  for (const [selector,title] of [[".metrics","Public network measurements"],["#trixDesk","TRIX · open full market desk"],["#dibziDesk","DIBZI · open full auction desk"],[".dibzi-about","About DIBZI · editorial brief"],[".dibzi-sales","Top sales · historical ranking"],["#simDesk","SIM · open the simulation desk"],[".audio-lab","Experiments · local audio synthesizer"]]) {
    const node = document.querySelector(selector);
    if (!node) continue;
    const details = document.createElement("details"); details.className = "section-fold overview-fold";
    const summary = document.createElement("summary"); summary.textContent = title;
    node.before(details); details.append(summary,node);
  }
  renderOverview(null, []);
}
export function renderOverview(latest, events = []) {
  const sources = latest?.sources || {};
  feedSources = sources;
  updateSalesRail();
  document.getElementById("sourceStrip").innerHTML = groups.map(([title,prefix,url]) => {
    const rows = Object.entries(sources).filter(([id]) => id.startsWith(prefix));
    const current = rows.filter(([,s]) => evidenceState(s) === "CURRENT").length;
    const state = rows.length && current === rows.length ? "CURRENT" : current ? "PARTIAL" : "UNAVAILABLE";
    return `<article><h3>${link(url,title)}</h3><b>${state}</b><small>${current}/${rows.length} checks current · not service guarantees</small><details><summary>Source status</summary>${rows.map(([id,s]) => `<p>${esc(id)}<br><strong>${evidenceState(s)}</strong> · HTTP ${esc(s.status)} · ${age(s.dataUpdatedAt || s.checkedAt)}</p>`).join("") || "No observations"}</details></article>`;
  }).join("");
  const d = sources["dibzi.names"];
  const usable = d && ["CURRENT","DELAYED"].includes(evidenceState(d));
  const nft = sources["magma.eth"];
  const nftUsable = nft?.magmaSupplyVersion === 2 && ["CURRENT", "DELAYED"].includes(evidenceState(nft));
  const fmt = (n, digits = 0) => {
    if (!Number.isFinite(n)) return "unread";
    const precision = Math.min(3, digits);
    if (precision && n !== 0 && Math.abs(n) < 10 ** -precision) return n > 0 ? `<${(10 ** -precision).toFixed(precision)}` : `>-${(10 ** -precision).toFixed(precision)}`;
    return n.toLocaleString("en-US", { maximumFractionDigits: precision });
  };
  const current = (s) => ["CURRENT", "DELAYED"].includes(evidenceState(s));
  const docs = sources["geoff.docs.surface"], mining = sources["surface.mining"], azy = sources["azy.chain"];
  const gate = sources["trix.preorder"];
  const shop = current(gate) ? gate.shop : null;
  const packs = Array.isArray(shop?.levels) ? shop.levels : [];
  const hype = packs.find((p) => p.id === "hype"), viral = packs.find((p) => p.id === "viral");
  const price = (p) => {
    if (!Number.isSafeInteger(p?.priceLamports) || p.priceLamports < 0) return "—";
    if (p.priceLamports > 0 && p.priceLamports < 1000000) return "<0.001";
    return (p.priceLamports / 1e9).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  };
  const exactPrice = (p) => Number.isSafeInteger(p?.priceLamports) && p.priceLamports >= 0 ? `${(p.priceLamports / 1e9).toFixed(9)} SOL` : "not reported";
  const flow = sources["trix.packflow"];
  const census = sources["trix.packcensus"];
  const treasury = sources["trix.holdings"];
  const listings = sources["trix.cardlistings"];
  const deposited = Array.isArray(flow?.depositsLamports24h) && flow.depositsLamports24h.length === 2 && flow.depositsLamports24h.every(Number.isSafeInteger)
    ? flow.depositsLamports24h.reduce((a, b) => a + b, 0) / 1e9 : null;
  const card = (title, value, note, src, target, action, exact = "") => `<article><h3><a href="#${target}" title="${esc(action)}">${esc(title)} ↗</a></h3><p class="glance-value"${exact ? ` title="${esc(exact)}" aria-label="${esc(exact)}"` : ""}>${esc(value)}</p><small>${esc(note)}</small><small class="fact-age">${esc(age(src?.dataUpdatedAt || src?.checkedAt))}</small></article>`;
  const now = Date.now();
  function paceCard(title, records, quantity) {
    if (!current(flow) || !Array.isArray(records)) return "";
    let hour = 0, quarter = 0;
    for (const r of records) {
      const elapsed = now - Date.parse(r?.at);
      if (!(elapsed >= 0 && elapsed < 3600000)) continue;
      const n = quantity(r);
      if (!Number.isSafeInteger(n) || n < 1) continue;
      hour += n;
      if (elapsed < 900000) quarter += n;
    }
    return card(title, `${fmt(hour)} observed / 60m`, `${fmt(quarter)} in last 15m · partial coverage`, flow, "packSalesTitle", "View receipts");
  }
  document.getElementById("quickFacts").innerHTML = [
    paceCard("Sellback pace", flow?.payouts, r => Number.isSafeInteger(r.lamports) && r.lamports > 0 ? 1 : 0),
    paceCard("Pack purchase pace", flow?.records, r => r.packs),
    current(treasury) && Number.isFinite(treasury.pricedValue) && card("TRIX void treasury", `≈ ${fmt(treasury.pricedValue)} USDC`, [
      Number.isFinite(treasury.nativeSol) && `${fmt(treasury.nativeSol, 3)} SOL separately`,
      [treasury.priced, treasury.total].every(Number.isFinite) && `${fmt(treasury.priced)}/${fmt(treasury.total)} priced`,
    ].filter(Boolean).join(" · "), treasury, "trixDesk", "Inspect holdings"),
    current(listings) && Number.isSafeInteger(listings.count) && card("Card marketplace", `${fmt(listings.count)} listings`, Number.isFinite(listings.lowest) ? `Lowest ask ${fmt(listings.lowest, 3)} SOL` : "Public asks", listings, "trixDesk", "Inspect marketplace"),
    typeof shop?.open === "boolean" && card("TRIX pack shop", shop.open ? "Open" : "Closed", typeof gate.globalState?.canOpen === "boolean" ? `Opening ${gate.globalState.canOpen ? "enabled" : "disabled"}` : "Global shop gate", gate, "trixDesk", "Inspect shop"),
    current(flow) && Number.isSafeInteger(flow.packs24h) && card("Packs · last 24h", `${fmt(flow.packs24h)} observed`, deposited !== null ? `${fmt(deposited, 3)} SOL · partial scan` : "Partial scan", flow, "packActivity", "Inspect activity"),
    current(census) && ["base","hype","viral"].every(t => Number.isSafeInteger(census.counts?.[t])) && card("Pack receipts by tier", ["base","hype","viral"].map(t => fmt(census.counts[t])).join(" / "), `Base / Hype / Viral${census.counts.unknown ? ` · ${fmt(census.counts.unknown)} unclassified` : ""}`, census, "packActivity", "Inspect receipts"),
    [hype, viral].every(p => Number.isSafeInteger(p?.priceLamports) && p.priceLamports >= 0) && card("Hype / Viral", `≈ ${price(hype)} / ${price(viral)} SOL`, "Mint fee separate", gate, "trixDesk", "Exact prices & fees", `Exact Hype price ${exactPrice(hype)}; exact Viral price ${exactPrice(viral)}`),
    current(docs) && [docs.scraped, docs.total].every(Number.isSafeInteger) && card("Geoff documentation", `${docs.scraped}/${docs.total} responding`, "Tracked pages", docs, "docsDesk", "Inspect docs"),
    nftUsable && Number.isSafeInteger(nft.magmaSupply) && card("The Simulation · NFTs", `Outstanding supply ${fmt(nft.magmaSupply)}`, `${fmt(Math.max(0, nft.magmaSupply - 4500))} to 4,500`, nft, "simCollapse", "Inspect supply"),
    usable && Number.isSafeInteger(d.openAuctionsTotal) && card("DIBZI auctions", `${fmt(d.openAuctionsTotal)} open`, Number.isSafeInteger(d.namesReported) ? `${fmt(d.namesReported)} reported names` : "Auction feed", d, "dibziDesk", "Inspect auctions"),
    current(mining) && Number.isSafeInteger(mining.miners60m) && card("Mining payouts", `${fmt(mining.miners60m)} recipients / 60m`, mining.payoutLatestAt ? `Last payout ${age(mining.payoutLatestAt)}` : "Paid recipients", mining, "miningWorkspace", "Inspect payouts"),
    current(azy) && Number.isFinite(azy.azySolDepositsSol) && card("AZY activity", `${fmt(azy.azySolDepositsSol, 3)} SOL`, "Observed campaign intake", azy, "simDesk", "Inspect intake"),
  ].filter(Boolean).join("") || '<small>No current readings. <a href="#diagnosticsWorkspace">Source health ↗</a></small>';
  const activity = document.getElementById("packActivity");
  if (activity) activity.innerHTML = renderPackGaps(sources["trix.packmints"], census) + renderPackActivity(current(flow) ? flow : null);
  const seen = new Set();
  const changes = events.filter(e => { const delta=Date.now()-Date.parse(e.at); return delta>=0 && delta<=EVIDENCE_WINDOW && !["agent","baseline"].includes(e.kind); }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).filter(e => {
    const key = `${e.kind}:${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0,3);
  const latestSignal = document.getElementById("latestSignal");
  if (latestSignal) latestSignal.innerHTML = changes.length ? `<span class="signal-live">LATEST</span><span class="signal-dot"></span><strong title="${esc(changes[0].title)}">${esc(compactChange(changes[0].title))}</strong><small>${age(changes[0].at)}</small><a href="#quickChanges">All updates ↗</a>` : '<span class="signal-live">LATEST</span><span class="signal-dot"></span><span>No recent public changes recorded</span><a href="#diagnosticsWorkspace">Source health ↗</a>';
  document.getElementById("quickChanges").innerHTML = changes.map(e => {
    return `<article><strong title="${esc(e.title)}">${esc(compactChange(e.title))}</strong><small>${age(e.at)} · recorded public change</small><p title="${esc(e.summary)}">${esc(compactChange(e.summary))}</p><a href="#sourceStrip">Inspect source visibility ↑</a></article>`;
  }).join("") || '<p>No recent public changes recorded. This does not imply zero activity.</p>';
}

export function renderPackGaps(mints, census, now = Date.now()) {
  const heading = '<h3>Estimated pack rips</h3>';
  const missing = `${heading}<p class="activity-footnote">Awaiting comparable TRIX mint counts and a fresh on-chain receipt census.</p>`;
  const times = [mints?.dataUpdatedAt, census?.checkedAt];
  const fresh = times.every((at) => {
    const ageMs = now - Date.parse(at);
    return ageMs >= 0 && ageMs <= 15 * 60000;
  });
  if (!fresh || !mints?.ok || !census?.ok || census.stale || mints.stale || census.counts?.unknown !== 0) return missing;
  const tiers = ["base", "hype", "viral"];
  const fmt = (value) => value.toLocaleString("en-US");
  let total = 0, receipts = 0;
  const rows = [];
  for (const tier of tiers) {
    const minted = mints.counts?.[tier], held = census.counts[tier];
    if (!Number.isSafeInteger(minted) || !Number.isSafeInteger(held) || held < 0 || held > minted) return missing;
    total += minted - held;
    receipts += held;
    rows.push(`<tr><th scope="row">${tier[0].toUpperCase() + tier.slice(1)}</th><td>${fmt(minted)}</td><td>${fmt(held)}</td><td><b>${fmt(minted - held)}</b></td></tr>`);
  }
  if (receipts !== census.total) return missing;
  return `${heading}<div class="activity-total"><strong>≈ ${fmt(total)}</strong><span>minted minus current receipts</span></div>
    <table class="sc-table"><thead><tr><th>Tier</th><th>Minted</th><th>Receipts</th><th>Gap</th></tr></thead><tbody>${rows.join("")}</tbody></table>
    <p class="activity-footnote">The gap estimates opens if each mint creates one receipt and each rip consumes it. No verified 10 AM PST baseline; this is not a confirmed count since opening.</p>
    <p class="activity-footnote">${link(mints.sourceUrl, "TRIX minted")} · ${esc(times[0])} · ${link(census.sourceUrl, "On-chain receipt census")} · ${esc(times[1])}. Receipt tiers are empirically mapped.</p>`;
}

export function renderPackActivity(flow, now = Date.now()) {
  const end = now;
  const start = end - 24 * 3600000;
  const bins = Array.from({ length: 12 }, () => 0);
  const records = Array.isArray(flow?.records) ? flow.records : [];
  for (const record of records) {
    const at = Date.parse(record?.at);
    if (!Number.isFinite(at) || at < start || at >= end || at > now || !Number.isSafeInteger(record?.packs) || record.packs < 1) continue;
    bins[Math.floor((at - start) / 7200000)] += record.packs;
  }
  const hasData = Boolean(flow?.ok && bins.some((count) => count > 0));
  const max = Math.max(1, ...bins);
  const bars = bins.map((count, i) => `<div class="activity-column"><span class="activity-bar" style="--bar-height:${Math.round(count / max * 100)}%" title="${count} observed · ${new Date(start + i * 7200000).toISOString().slice(11, 16)} UTC"></span>${i % 3 === 0 ? `<small>${new Date(start + i * 7200000).toISOString().slice(11, 16)}</small>` : "<small></small>"}</div>`).join("");
  return `<div class="activity-header"><div><p class="eyebrow">ON-CHAIN / TRIX</p><h3>Pack activity</h3><p>Observed BuyPack instructions · UTC · last 24h</p></div><a href="#trixDesk">Open TRIX desk ↗</a></div>${hasData ? `<div class="activity-total"><strong>${bins.reduce((a, b) => a + b, 0).toLocaleString("en-US")}</strong><span>minimum observed · partial scan</span></div><div class="activity-chart" role="img" aria-label="Observed packs in two-hour UTC bins; partial scan, blank bars do not establish zero activity">${bars}</div><p class="activity-footnote">Two-hour bins. Bounded collection can miss transactions; empty bars do not establish zero activity. Last checked ${esc(age(flow.checkedAt))}.</p>` : '<div class="activity-empty">No current pack observations available yet.<small>The chart will appear as the bounded on-chain scan collects records.</small></div>'}`;
}
