import { evidenceState, EVIDENCE_WINDOW } from "./evidence.js";
import { packPace } from "./pack-pace.js";
const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const groups = [["Geoff","geoff.","https://www.geoff.ai/"],["StackNet","stacknet.","https://stacknet.magma-rpc.com/health"],["TRIX","trix.","https://trix.market/"],["DIBZI","dibzi.","https://dibzi.ai/"],["SIM","sim.","https://sim.tech/"],["AZY","azy.","https://azy.life/"],["MAGMA","magma.","https://opensea.io/collection/the-simulation-958481099"]];
const link = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const age = (at) => {
  const minutes = (Date.now() - Date.parse(at)) / 60000;
  return !Number.isFinite(minutes) || minutes < 0 ? "age unknown" : minutes < 1 ? "just checked" : minutes < 60 ? `${Math.floor(minutes)}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
};
export function initOverview() {
  document.querySelector(".desk-intro").insertAdjacentHTML("afterend", '<section id="glance" aria-label="Public visibility overview"><div id="sourceStrip" class="source-strip"></div><div id="quickFacts" class="quick-facts"></div><details class="data-disclosure"><summary>TRIX winner routes · access check, Nov 17</summary><p>The client routes <a href="https://www.trix.market/cards/winners" target="_blank" rel="noopener noreferrer">winners</a>, <a href="https://www.trix.market/cards/winners/above-%241k" target="_blank" rel="noopener noreferrer">above $1k</a> and <a href="https://www.trix.market/cards/winners/above-%2410k" target="_blank" rel="noopener noreferrer">above $10k</a> map to an admin sign-in component. No winner data or payout amounts were publicly verified. Route names are not proof of winners or a release date.</p></details><h3>What changed · last 24 hours</h3><div id="quickChanges"></div></section>');
  const briefing = document.querySelector(".stacknet-brief");
  if (briefing) document.getElementById("glance").after(briefing);
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
  const fmt = (n, digits = 0) => Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: digits }) : "unread";
  const current = (s) => ["CURRENT", "DELAYED"].includes(evidenceState(s));
  const docs = sources["geoff.docs.surface"], boxes = sources["trix.boxboard"], mining = sources["surface.mining"], azy = sources["azy.chain"];
  const gate = sources["trix.preorder"];
  const shop = current(gate) ? gate.shop : null;
  const packs = Array.isArray(shop?.levels) ? shop.levels : [];
  const hype = packs.find((p) => p.id === "hype"), viral = packs.find((p) => p.id === "viral");
  const price = (p) => Number.isSafeInteger(p?.priceLamports) && p.priceLamports >= 0 ? `${fmt(p.priceLamports / 1e9, 9)} SOL` : "Not reported";
  const pace = current(boxes) ? packPace(boxes.chain, boxes.pace?.samples || []) : null;
  const flow = sources["trix.packflow"];
  const deposited = Array.isArray(flow?.depositsLamports24h) && flow.depositsLamports24h.length === 2 && flow.depositsLamports24h.every(Number.isSafeInteger)
    ? flow.depositsLamports24h.reduce((a, b) => a + b, 0) / 1e9 : null;
  const card = (title, value, note, src, target, action) => `<article><h3>${esc(title)}</h3><p class="glance-value">${esc(value)}</p><small>${esc(note)}</small><small>${evidenceState(src)} · ${age(src?.dataUpdatedAt || src?.checkedAt)}</small><a class="glance-drill" href="#${target}">${action} ↓</a></article>`;
  document.getElementById("quickFacts").innerHTML = [
    card("TRIX pack shop", shop ? shop.open === true ? "Open" : shop.open === false ? "Closed" : "Status unknown" : "Shop unavailable", `Opening ${gate?.globalState?.canOpen === true ? "enabled" : gate?.globalState?.canOpen === false ? "disabled" : "unknown"} · global gate`, gate, "trixDesk", "Inspect pack shop"),
    card("Packs · last 24h", current(flow) && Number.isSafeInteger(flow?.packs24h) ? `At least ${fmt(flow.packs24h)} observed` : "Awaiting deposit scan", current(flow) && deposited !== null ? `${fmt(deposited, 4)} SOL matched · partial scan, not total sales` : "Matched on-chain deposits · incomplete scan, not total sales", flow, "trixDesk", "Inspect pack activity"),
    card("Hype / Viral", shop ? `${price(hype)} / ${price(viral)}` : "Prices unavailable", "Reported prices · mint fees and checkout details in pack shop", gate, "trixDesk", "Inspect pack prices"),
    card("TRIX pack pace", pace?.perHour != null ? `${fmt(pace.perHour, 1)} packs/hour` : "Pace unavailable", pace?.perHour != null ? `Estimated census growth · ${fmt(pace.minutes, 1)}m window` : pace?.reason || "Awaiting fresh receipt census", boxes, "trixDesk", "Inspect pack activity"),
    card("Geoff documentation", current(docs) ? `${docs.scraped}/${docs.total} pages responding` : "Snapshot unavailable", "Tracked sample · fingerprints, not release confirmations", docs, "docsDesk", "Inspect docs & changes"),
    card("The Simulation · NFTs", nftUsable ? `Outstanding supply ${fmt(nft.magmaSupply)}` : "Awaiting corrected supply", nftUsable ? `${fmt(Math.max(0, nft.magmaSupply - 4500))} to 4,500 · Ethereum NFTs` : "Old peak-held counts withheld · direct chain reads in the panel", nft, "simCollapse", "Inspect supply & sales"),
    card("DIBZI auctions", usable ? `${fmt(d.openAuctionsTotal)} open · ${fmt(d.namesReported)} reported names` : "Snapshot unavailable", "Full-response count · auctions, not settled sales", d, "dibziDesk", "Inspect auctions"),
    card("Mining payouts", current(mining) ? `${fmt(mining.miners60m)} paid recipients / 60m` : "Payout read unavailable", current(mining) ? `Latest payout ${age(mining.payoutLatestAt)} · not active rig count` : "Prepaid entitlement and productive mining require separate evidence", mining, "miningWorkspace", "Inspect payout evidence"),
    card("AZY activity", current(azy) ? `${fmt(azy.azySolDepositsSol, 4)} SOL observed` : "Intake unavailable", "Campaign-only intake · not a separate Geoff node-key revenue stream", azy, "simDesk", "Inspect campaign records"),
  ].join("");
  const seen = new Set();
  const changes = events.filter(e => { const delta=Date.now()-Date.parse(e.at); return delta>=0 && delta<=EVIDENCE_WINDOW && !["agent","baseline"].includes(e.kind); }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).filter(e => {
    const key = `${e.kind}:${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0,3);
  document.getElementById("quickChanges").innerHTML = changes.map(e => {
    return `<article><strong>${esc(e.title)}</strong><small>${age(e.at)} · recorded public change</small><p>${esc(e.summary)}</p><a href="#sourceStrip">Inspect source visibility ↑</a></article>`;
  }).join("") || '<p>No recent public changes recorded. This does not imply zero activity.</p>';
}
