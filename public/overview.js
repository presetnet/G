import { evidenceState, EVIDENCE_WINDOW } from "./evidence.js";
const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const groups = [["Geoff","geoff.","https://www.geoff.ai/"],["StackNet","stacknet.","https://stacknet.magma-rpc.com/health"],["TRIX","trix.","https://trix.market/"],["DIBZI","dibzi.","https://dibzi.ai/"],["SIM","sim.","https://sim.tech/"],["AZY","azy.","https://azy.life/"],["MAGMA","magma.","https://opensea.io/collection/the-simulation-958481099"]];
const link = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const age = (at) => {
  const minutes = (Date.now() - Date.parse(at)) / 60000;
  return !Number.isFinite(minutes) || minutes < 0 ? "age unknown" : minutes < 1 ? "just checked" : minutes < 60 ? `${Math.floor(minutes)}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
};
export function initOverview() {
  document.querySelector(".desk-intro").insertAdjacentHTML("afterend", '<section id="glance" aria-label="Public visibility overview"><div id="sourceStrip" class="source-strip"></div><div id="quickFacts" class="quick-facts"></div><h3>What changed · last 24 hours</h3><div id="quickChanges"></div></section>');
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
  const card = (title, value, note, src, target, action) => `<article><h3>${esc(title)}</h3><p class="glance-value">${esc(value)}</p><small>${esc(note)}</small><small>${evidenceState(src)} · ${age(src?.dataUpdatedAt || src?.checkedAt)}</small><a class="glance-drill" href="#${target}">${action} ↓</a></article>`;
  document.getElementById("quickFacts").innerHTML = [
    card("Geoff documentation", current(docs) ? `${docs.scraped}/${docs.total} pages responding` : "Snapshot unavailable", "Tracked sample · fingerprints, not release confirmations", docs, "docsDesk", "Inspect docs & changes"),
    card("TRIX boxes", current(boxes) ? `${fmt(boxes.mintedTotal)} reported` : "Count unavailable", "8,000 watch target · DOSWAPZ census, not an unlock promise", boxes, "trixDesk", "Inspect box watch"),
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
