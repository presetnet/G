import { evidenceState, EVIDENCE_WINDOW } from "./evidence.js";
import { packPace } from "./pack-pace.js";
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
const baho = "FaAtvEXHrvUbpD7FZCPm3n8vhsvRM2f4DDe2PJFaGMhJ";
// Official generic image from TRIX collection metadata, not the revealed card.
const mysteryArt = '<img src="/pack-art/trix-mystery.webp" alt="TRIX mystery artwork; exact art unknown" title="TRIX mystery artwork · exact art unknown">';
export function packSalesFeed(flow, packArt = {}, now = Date.now()) {
  if (!["CURRENT", "DELAYED"].includes(evidenceState(flow, now)) || !Array.isArray(flow.records)) return "Pack sales feed unavailable.";
  const tiles = [];
  function sellerArtwork(wallet) {
    const name = flow.profiles?.[wallet]?.username;
    const art = name && flow.playerArt?.[name];
    if (!art || !/^https:\/\//i.test(art.url)) return `<figure class="ranked-rip">${mysteryArt}<figcaption>Card unknown</figcaption></figure>`;
    const details = [art.tier, art.rarity].filter(Boolean).join(" · ");
    const description = `@${name}’s ranked rip: ${details} ${art.symbol || ""}. Sold card unverified.`;
    return `<figure class="ranked-rip" title="${esc(description)}"><a href="${esc(art.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`View artwork: ${description}`)}"><img src="${esc(art.url)}" alt="${esc(description)}" loading="lazy" decoding="async"></a><figcaption><strong>${esc(art.symbol || "TRIX")}</strong>${esc(details)}</figcaption></figure>`;
  }
  function participant(wallet) {
    if (!wallet) return "unavailable";
    const name = flow.profiles?.[wallet]?.username;
    if (!name) return esc(`${wallet.slice(0, 5)}…${wallet.slice(-4)}`);
    return link(`https://www.trix.market/profile/${encodeURIComponent(name)}`, `@${name}`);
  }
  const payoutRows = (flow.payouts || []).filter(p => Date.parse(p.at) >= now - EVIDENCE_WINDOW && Date.parse(p.at) <= now &&
    Number.isSafeInteger(p.lamports) && p.lamports > 0 && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(p.signature));
  const reported = payoutRows.filter(p => p.seller === baho);
  const totalPaid = reported.reduce((sum, p) => sum + p.lamports, 0);
  const spotlight = reported.length ? `<div class="payout-spotlight">${sellerArtwork(baho)}<small>Shop → ${participant(baho)} · observed payouts</small><b>${(totalPaid / 1e9).toFixed(3)} SOL</b><span>${reported.map(p => link(`https://solscan.io/tx/${p.signature}`, `${(p.lamports / 1e9).toFixed(3)}`)).join(" + ")}</span></div>` : "";
  for (const p of payoutRows) {
    tiles.push({ at: p.at, html: `<div class="sale-tile shop-payout">${sellerArtwork(p.seller)}<span><b>${link(`https://solscan.io/tx/${p.signature}`, `${(p.lamports / 1e9).toFixed(3)} SOL`)}</b><small>Shop paid ${participant(p.seller)}</small></span></div>` });
  }
  let purchases = 0;
  for (const r of flow.records) {
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
    tiles.push({ at: r.at, html: `<div class="sale-tile" title="${esc(`${r.packs} pack(s) · ${r.at} · ${buyer || "buyer unavailable"}`)}"><i>${art || mysteryArt}</i><span><b>${link(`https://solscan.io/tx/${r.signature}`, `${sol < 0.001 ? "<0.001" : sol.toFixed(3)} SOL`)}</b><small>Buyer ${participant(buyer)}</small></span></div>` });
    if (++purchases === 20) break;
  }
  return spotlight + tiles.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map(t => t.html).join("") || "No purchases or shop buybacks observed in the current sample.";
}
let lastPackSales = "";
const age = (at) => {
  const minutes = (Date.now() - Date.parse(at)) / 60000;
  return !Number.isFinite(minutes) || minutes < 0 ? "age unknown" : minutes < 1 ? "just checked" : minutes < 60 ? `${Math.floor(minutes)}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
};
export function initOverview() {
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
  const rail = document.getElementById("packSalesRail");
  if (rail) {
    const html = packSalesFeed(sources["trix.packflow"], sources["trix.packmints"]?.packArt);
    if (html !== lastPackSales) { rail.innerHTML = html; lastPackSales = html; }
  }
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
  const docs = sources["geoff.docs.surface"], boxes = sources["trix.boxboard"], mining = sources["surface.mining"], azy = sources["azy.chain"];
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
  const pace = current(boxes) ? packPace(boxes.chain, boxes.pace?.samples || []) : null;
  const flow = sources["trix.packflow"];
  const census = sources["trix.packcensus"];
  const treasury = sources["trix.holdings"];
  const listings = sources["trix.cardlistings"];
  const deposited = Array.isArray(flow?.depositsLamports24h) && flow.depositsLamports24h.length === 2 && flow.depositsLamports24h.every(Number.isSafeInteger)
    ? flow.depositsLamports24h.reduce((a, b) => a + b, 0) / 1e9 : null;
  const card = (title, value, note, src, target, action, exact = "") => `<article><h3>${esc(title)}</h3><p class="glance-value"${exact ? ` title="${esc(exact)}" aria-label="${esc(exact)}"` : ""}>${esc(value)}</p><small>${esc(note)}</small><small>${evidenceState(src)} · ${age(src?.dataUpdatedAt || src?.checkedAt)}</small><a class="glance-drill" href="#${target}">${action} ↓</a></article>`;
  document.getElementById("quickFacts").innerHTML = [
    card("TRIX void treasury", current(treasury) && Number.isFinite(treasury.pricedValue) ? `≈ ${fmt(treasury.pricedValue)} USDC` : "Valuation unavailable", current(treasury) ? `${fmt(treasury.nativeSol, 3)} native SOL separately · ${fmt(treasury.priced)} / ${fmt(treasury.total)} mints priced` : "Token values exclude native SOL", treasury, "trixDesk", "Inspect treasury holdings"),
    card("Card marketplace", current(listings) ? `${fmt(listings.count)} card listings` : "Listings unavailable", current(listings) && listings.lowest != null ? `Lowest reported ask ${fmt(listings.lowest, 3)} SOL` : "Public asks · not completed sales", listings, "trixDesk", "Inspect marketplace"),
    card("TRIX pack shop", shop ? shop.open === true ? "Open" : shop.open === false ? "Closed" : "Status unknown" : "Shop unavailable", `Opening ${gate?.globalState?.canOpen === true ? "enabled" : gate?.globalState?.canOpen === false ? "disabled" : "unknown"} · global gate`, gate, "trixDesk", "Inspect pack shop"),
    card("Packs · last 24h", current(flow) && Number.isSafeInteger(flow?.packs24h) ? `At least ${fmt(flow.packs24h)} observed` : "Awaiting scan", current(flow) && deposited !== null ? `${fmt(deposited, 4)} SOL matched · partial scan` : "Partial deposit scan · not total sales", flow, "trixDesk", "Inspect activity"),
    card("Pack receipts by tier", current(census) && census.counts ? `${fmt(census.counts.base)} / ${fmt(census.counts.hype)} / ${fmt(census.counts.viral)}` : "Census unavailable", current(census) && census.counts ? `Base / Hype / Viral · ${fmt(census.total)} accounts${census.counts.unknown ? ` · ${fmt(census.counts.unknown)} unknown tier` : ""} · empirical mapping` : "Current receipt accounts · tier mapping is empirical", census, "trixDesk", "Inspect packs"),
    card("Hype / Viral", shop ? `≈ ${price(hype)} / ${price(viral)} SOL` : "Prices unavailable", "Rounded · mint fee reported separately", gate, "trixDesk", "Exact prices & fees", shop ? `Exact Hype price ${exactPrice(hype)}; exact Viral price ${exactPrice(viral)}` : ""),
    card("TRIX pack pace", pace?.perHour != null ? `${fmt(pace.perHour, 1)} packs/hour` : "Pace unavailable", pace?.perHour != null ? `Estimated census growth · ${fmt(pace.minutes, 1)}m window` : pace?.reason || "Awaiting fresh receipt census", boxes, "trixDesk", "Inspect pack activity"),
    card("Geoff documentation", current(docs) ? `${docs.scraped}/${docs.total} pages responding` : "Snapshot unavailable", "Tracked sample · fingerprints, not release confirmations", docs, "docsDesk", "Inspect docs & changes"),
    card("The Simulation · NFTs", nftUsable ? `Outstanding supply ${fmt(nft.magmaSupply)}` : "Awaiting corrected supply", nftUsable ? `${fmt(Math.max(0, nft.magmaSupply - 4500))} to 4,500 · Ethereum NFTs` : "Old peak-held counts withheld · direct chain reads in the panel", nft, "simCollapse", "Inspect supply & sales"),
    card("DIBZI auctions", usable ? `${fmt(d.openAuctionsTotal)} open · ${fmt(d.namesReported)} reported names` : "Snapshot unavailable", "Full-response count · auctions, not settled sales", d, "dibziDesk", "Inspect auctions"),
    card("Mining payouts", current(mining) ? `${fmt(mining.miners60m)} paid recipients / 60m` : "Payout read unavailable", current(mining) ? `Latest payout ${age(mining.payoutLatestAt)} · not active rig count` : "Prepaid entitlement and productive mining require separate evidence", mining, "miningWorkspace", "Inspect payout evidence"),
    card("AZY activity", current(azy) ? `${fmt(azy.azySolDepositsSol, 4)} SOL observed` : "Intake unavailable", "Campaign-only intake · not a separate Geoff node-key revenue stream", azy, "simDesk", "Inspect campaign records"),
  ].join("");
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
