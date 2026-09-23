import { evidenceState, EVIDENCE_WINDOW } from "./evidence.js";
const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const groups = [["Geoff","geoff.","https://www.geoff.ai/"],["StackNet","stacknet.","https://stacknet.magma-rpc.com/health"],["TRIX","trix.","https://trix.market/"],["DIBZI","dibzi.","https://dibzi.ai/"]];
const link = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const age = (at) => Number.isFinite(Date.parse(at)) ? `${Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60000))}m ago` : "age unknown";
export function initOverview() {
  document.querySelector(".desk-intro").insertAdjacentHTML("afterend", '<section id="glance" aria-label="Public visibility overview"><div id="sourceStrip" class="source-strip"></div><div id="quickFacts" class="quick-facts"></div><h3>What changed · last 24 hours</h3><div id="quickChanges"></div></section>');
  for (const [selector,title] of [[".metrics","Public network measurements"],["#trixDesk","TRIX · open full market desk"],["#dibziDesk","DIBZI · open full auction desk"],[".dibzi-about","About DIBZI · editorial brief"],[".dibzi-sales","Top sales · historical ranking"],[".audio-lab","Experiments · local audio synthesizer"]]) {
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
  const highest = usable ? (d.names || []).filter(n => !n.settled && Number.isFinite(n.amountSol)).sort((a,b) => b.amountSol-a.amountSol)[0] : null;
  document.getElementById("quickFacts").innerHTML = `<article><h3>DIBZI auctions</h3><p>${usable ? `${esc(d.activeNames)} active · ${esc(d.namesTotal)} total including ${esc(d.cashtagNames)} cashtags` : "Values unavailable"}</p><p>${highest ? link(`https://dibzi.ai/name/${encodeURIComponent(highest.name)}`, `${highest.amountSol} SOL · ${highest.name}`) : "Highest bid unavailable"}</p><small>Observed ${age(d?.checkedAt)} · not a 24h sales total</small></article><article><h3>TRIX activity</h3><p>${link("https://trix.market/","Inspect market")}</p><small>Market: ${evidenceState(sources["trix.market"])} · ${age(sources["trix.market"]?.checkedAt)}<br>Generations: ${evidenceState(sources["trix.geoff"])} · ${age(sources["trix.geoff"]?.checkedAt)}</small><p>Records and receipts in the full desk below.</p></article>`;
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
