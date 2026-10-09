import { evidenceState, EVIDENCE_WINDOW } from "./evidence.js";
const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const groups = [["Geoff","geoff.","https://www.geoff.ai/"],["StackNet","stacknet.","https://stacknet.magma-rpc.com/health"],["TRIX","trix.","https://trix.market/"],["DIBZI","dibzi.","https://dibzi.ai/"],["SIM","sim.","https://sim.tech/"],["AZY","azy.","https://azy.life/"],["MAGMA","magma.","https://opensea.io/collection/the-simulation-958481099"]];
const link = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const age = (at) => Number.isFinite(Date.parse(at)) ? `${Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60000))}m ago` : "age unknown";
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
  document.getElementById("quickFacts").innerHTML = `
    <article><h3>DIBZI auctions</h3><p>${usable ? `${fmt(d.openAuctionsTotal)} open · ${fmt(d.namesReported)} reported names` : "Values unavailable"}</p>
      <p>${usable && d.openFloorName ? link(`https://dibzi.ai/name/${encodeURIComponent(d.openFloorName)}`, `${fmt(d.openFloorSol, 4)} SOL · cheapest open ${d.openFloorName}`) : "No open-auction floor reported"}</p><small>Full-response board · observed ${age(d?.checkedAt)} · not a sales total</small></article>
    <article><h3>TRIX activity</h3><p>${link("https://trix.market/", "Inspect market")}</p><small>Market: ${evidenceState(sources["trix.market"])} · ${age(sources["trix.market"]?.checkedAt)}<br>Generations: ${evidenceState(sources["trix.geoff"])} · ${age(sources["trix.geoff"]?.checkedAt)}</small><p>8,000-box watch and DOSWAPZ receipt census in the full desk below.</p></article>
    <article><h3>SIM · sim.tech</h3><p>${link("https://sim.tech/", "Inspect sim.tech")}</p><small>Site v${esc(sources["sim.site"]?.siteVersion ?? "?")} · public configuration<br>Solana SIM token supply ${fmt(sources["sim.chain"]?.simSupply)} · ${age(sources["sim.chain"]?.checkedAt)}<br>This is a separate fungible token, not the Ethereum NFT supply.<br>Campaign SOL intake ${fmt(sources["sim.chain"]?.solDepositsSol, 4)} SOL · Ethereum mainnet intake ${fmt(sources["sim.ethm"]?.ethDepositsEth, 4)} ETH<br>Sepolia testnet intake ${fmt(sources["sim.eth"]?.ethDepositsEth, 4)} test ETH</small><p>Live Ethereum NFT supply and the 4,500 watch are in the supply panel.</p></article>
    <article><h3>AZY · azy.life</h3><p>${link("https://azy.life/", "Inspect azy.life")}</p><small>SOL intake ${fmt(sources["azy.chain"]?.azySolDepositsSol, 4)} SOL · ${fmt(sources["azy.chain"]?.azyDepositCount)} deposits · ${fmt(sources["azy.chain"]?.azyUniquePayers)} retained payers<br>Campaign-only SOL walk · custody ${esc(sources["azy.chain"]?.destWallet ?? "…")} · last ${age(sources["azy.chain"]?.destLatestAt)}</small></article>
    <article><h3>Ethereum NFTs · The Simulation</h3><p>${link("https://opensea.io/collection/the-simulation-958481099", "Inspect OpenSea")} · ${link("https://eth.blockscout.com/token/0xc3706195ff60658585b58716717ee7acc5ebca60", "Blockscout")}</p>
      <small>${nftUsable ? `Outstanding supply ${fmt(nft.magmaSupply)} · ${fmt(nft.magmaHolders)} holders · ${fmt(nft.magmaTransfers)} transfers<br>Observed ${age(nft.magmaDataAt || nft.checkedAt)} · explorer index; supply can fall through burns` : "Awaiting corrected supply snapshot — old peak-held counts withheld. The live supply panel reads Ethereum directly."}</small></article>`;
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
