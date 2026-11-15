import { evidenceState, EVIDENCE_WINDOW } from "./evidence.js";

const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usable = (s) => ["CURRENT", "DELAYED"].includes(evidenceState(s));
const fmt = (v) => Number.isFinite(v) ? v.toLocaleString("en-US") : "—";
const time = (at) => Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString() : "Not observed";
const age = (at) => {
  const minutes = (Date.now() - Date.parse(at)) / 60000;
  return !Number.isFinite(minutes) || minutes < 0 ? "Age unknown" : minutes < 1 ? "Just checked" : minutes < 60 ? `${Math.floor(minutes)}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
};
const external = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`;
const put = (id, html) => { const node = document.getElementById(id); if (node && node.innerHTML !== html) node.innerHTML = html; };

export function sourceCondition(s) {
  if (!s) return "Not observed";
  if (s.status === 401 || s.status === 403 || s.skipped) return "Access required";
  if (s.status === 404) return "Route unavailable";
  if (s.status === 429) return "Rate limited";
  if (/abort|timeout|timed out/i.test(s.reason || s.error || "")) return "Timed out";
  return ({ CURRENT: "Current", DELAYED: "Delayed", EXPIRED: "Expired", UNAVAILABLE: "Unavailable" })[evidenceState(s)] || "Unavailable";
}

export function docsView(source, catalog, events = [], historical = null) {
  const available = usable(source);
  const observation = available ? source : historical;
  const pages = observation?.pages || [];
  const docsModels = observation?.publishedModelLayers || [];
  const apiModels = usable(catalog) ? (catalog.models || []).map((m) => typeof m === "string" ? m : m.id).filter(Boolean) : [];
  return {
    available, pages, docsModels, apiModels, observation,
    historical: !available && pages.length > 0,
    missingFromCatalog: available && usable(catalog) ? docsModels.filter((id) => !apiModels.includes(id)) : [],
    changes: events.filter((e) => e.kind === "docs" && Date.now() - Date.parse(e.at) >= 0 && Date.now() - Date.parse(e.at) <= EVIDENCE_WINDOW).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6),
    failures: pages.filter((p) => !p.ok),
  };
}

function makeSection(id, title, subtitle, open = false) {
  const node = document.createElement("details");
  node.id = id;
  node.className = "enterprise-section workspace-section";
  node.open = open;
  node.innerHTML = `<summary><span class="section-title">${esc(title)}<small>${esc(subtitle)}</small></span><span class="workspace-chevron" aria-hidden="true">⌄</span></summary><div class="section-body"></div>`;
  return node;
}

export function openWorkspaceTarget(hash = location.hash) {
  if (!/^#[A-Za-z][\w-]*$/.test(hash)) return;
  const node = document.getElementById(hash.slice(1));
  if (!node) return;
  let parent = node;
  while (parent) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
  node.scrollIntoView({ block: "start" });
}

export function initWorkspace() {
  if (document.getElementById("workspaceNav")) return;
  const shell = document.querySelector("main.shell");
  const glance = document.getElementById("glance");
  const nav = document.createElement("nav");
  nav.id = "workspaceNav";
  nav.setAttribute("aria-label", "Dashboard sections");
  const sections = [
    ["geoffWorkspace", "Geoff · docs & platform", "Page changes, model catalog and published pricing", true],
    ["marketWorkspace", "Markets · TRIX & DIBZI", "Pack activity, auctions and attributed community data"],
    ["simulationWorkspace", "The Simulation", "4,500 supply watch, paid sales and collapse recipes"],
    ["miningWorkspace", "Mining · payout evidence", "Activation, sessions and payouts are separate signals"],
    ["toolsWorkspace", "Research tools", "On-demand asset and listing checks"],
    ["diagnosticsWorkspace", "Diagnostics & evidence", "Unavailable sources, observations and historical context"],
  ];
  nav.innerHTML = `<a href="#glance">Overview</a>${sections.map(([id, title]) => `<a href="#${id}">${esc(title.split(" · ")[0])}</a>`).join("")}`;
  glance.before(nav);
  const health = document.createElement("div");
  health.id = "workspaceHealth";
  health.setAttribute("role", "status");
  glance.prepend(health);
  const panels = Object.fromEntries(sections.map(([id, title, subtitle, open]) => {
    const node = makeSection(id, title, subtitle, open);
    shell.append(node);
    return [id, node.querySelector(".section-body")];
  }));
  const move = (selector, target, fold = false) => {
    const node = document.querySelector(selector);
    if (node) panels[target].append(fold ? node.closest("details") || node : node);
  };
  panels.geoffWorkspace.innerHTML = `<section id="docsDesk" aria-labelledby="docsDeskTitle"><div class="workspace-heading"><div><p class="eyebrow">DOCUMENTATION INTELLIGENCE</p><h3 id="docsDeskTitle">What the docs actually say</h3></div>${external("https://docs.geoff.ai", "Open Geoff docs")}</div><div id="docsOverview"></div><details class="workspace-drill" open><summary>Tracked pages <span id="docsPageCount"></span></summary><div id="docsPages"></div></details><details class="workspace-drill"><summary>Observed changes & model differences</summary><div id="docsChanges"></div></details></section><div id="workspaceServices" class="metrics"></div>`;
  move(".price-panel", "geoffWorkspace", true);
  move("#trixDesk", "marketWorkspace", true);
  move("#dibziDesk", "marketWorkspace", true);
  move("#simCollapse", "simulationWorkspace", true);
  move("#simDesk", "simulationWorkspace", true);
  move("#assetViewer", "toolsWorkspace", true);
  move("#simListing", "toolsWorkspace", true);
  panels.miningWorkspace.innerHTML = '<div id="miningEvidence"></div>';
  move("#sourceStrip", "diagnosticsWorkspace");
  panels.diagnosticsWorkspace.insertAdjacentHTML("afterbegin", '<section aria-labelledby="sourceIssuesTitle"><div class="workspace-heading"><h3 id="sourceIssuesTitle">Source health</h3><label>View <select id="sourceHealthFilter"><option value="issues">Needs attention</option><option value="all">All sources</option></select></label></div><div id="sourceIssues"></div></section>');
  panels.diagnosticsWorkspace.insertAdjacentHTML("beforeend", '<section><h3>Last observed details · historical</h3><p class="workspace-note">Stored observations retain their original dates. These values are not current quotes, balances or availability.</p><div id="historicalSources"></div><details class="workspace-drill"><summary>Recorded event archive · up to 30 days / 2,000 events</summary><div id="historicalEvents"></div></details></section>');
  move(".metrics", "diagnosticsWorkspace", true);
  move(".signal-details", "diagnosticsWorkspace");
  move(".feed-panel", "diagnosticsWorkspace", true);
  move(".raw-drawer", "diagnosticsWorkspace");
  move(".section-heading", "diagnosticsWorkspace");
  for (const id of ["stackVersion", "x402Downloads", "subscriptionCount"]) {
    const card = document.getElementById(id)?.closest(".metric");
    if (card) document.getElementById("workspaceServices").append(card);
  }
  document.addEventListener("click", (event) => {
    const a = event.target.closest?.('a[href^="#"]');
    if (a && document.getElementById(a.hash.slice(1))) openWorkspaceTarget(a.hash);
  });
  window.addEventListener("hashchange", () => openWorkspaceTarget());
  document.getElementById("sourceHealthFilter").addEventListener("change", () => renderIssues(lastSnapshot));
  openWorkspaceTarget();
  renderWorkspace(null, []);
}

let lastSnapshot = null;
function renderIssues(latest) {
  const all = document.getElementById("sourceHealthFilter")?.value === "all";
  const sources = Object.entries(latest?.sources || {}).filter(([, s]) => all || sourceCondition(s) !== "Current");
  put("sourceIssues", sources.length ? `<div class="workspace-table"><table><thead><tr><th>Source</th><th>State</th><th>Observed</th><th>Detail</th></tr></thead><tbody>${sources.map(([id, s]) => `<tr><td>${esc(id)}</td><td><span class="source-badge ${usable(s) ? "is-current" : "is-unavailable"}">${esc(sourceCondition(s))}</span></td><td title="${esc(time(s.checkedAt))}">${esc(age(s.dataUpdatedAt || s.checkedAt))}</td><td>${esc(s.reason || s.error || (s.status ? `HTTP ${s.status}` : "No detail"))}</td></tr>`).join("")}</tbody></table></div>` : '<p class="workspace-note">No matching observations. A timeout is not proof a service is retired.</p>');
}

export function renderWorkspace(latest, events = [], history = [], state = {}) {
  if (!document.getElementById("docsDesk")) return;
  lastSnapshot = latest;
  const sources = latest?.sources || {};
  const all = Object.values(sources);
  const current = all.filter((s) => evidenceState(s) === "CURRENT").length;
  put("workspaceHealth", `<span><strong>${current}/${all.length}</strong> source checks current</span><span>${all.length - current} delayed, restricted or unavailable</span><a href="#diagnosticsWorkspace">Inspect source health ↓</a>`);
  const source = sources["geoff.docs.surface"];
  const view = docsView(source, sources["stacknet.models"], events, latest?.historicalSources?.["geoff.docs.surface"]);
  const hasPages = view.pages.length > 0;
  put("docsOverview", `<div class="workspace-kpis"><div><strong>${hasPages ? `${view.pages.filter((p) => p.ok).length}/${view.observation.total ?? view.pages.length}` : "—"}</strong><span>${view.historical ? "pages responding at last observation" : "tracked pages responding"}</span></div><div><strong>${hasPages ? fmt(view.failures.length) : "—"}</strong><span>${view.historical ? "failed reads in that observation" : "unavailable page reads"}</span></div><div><strong>${view.changes.length}</strong><span>recent fingerprint events shown</span></div></div><p class="workspace-note">${view.historical ? "Historical observation — not a live docs check" : esc(sourceCondition(source))} · ${esc(time(view.observation?.checkedAt || source?.checkedAt))}. Last full collection: ${esc(time(state.lastPollAt))}. This is a tracked sample, not a complete docs inventory. A changed hash is not a verified feature release; a 404 is not evidence of when a page disappeared.</p>`);
  put("docsPageCount", hasPages ? `(${view.pages.length}${view.historical ? " · historical" : ""})` : "");
  put("docsPages", hasPages ? [
    ["Introduction", "/introduction/"], ["Geoff Code", "/geoff-code/"], ["API reference", "/api-reference/"], ["Token plans", "/token-plan/"],
   ].map(([title, prefix]) => `<section class="docs-group"><h4>${title}</h4><div>${view.pages.filter((p) => p.path?.startsWith(prefix)).map((p) => `<a class="docs-page" href="https://docs.geoff.ai${esc(p.path)}" target="_blank" rel="noopener noreferrer"><span>${esc(p.label || p.id)} ↗</span><small class="${p.ok && !view.historical ? "is-current" : "is-unavailable"}">${view.historical ? "Last read: " : ""}${p.ok ? "Responding" : p.status ? `HTTP ${p.status}` : "Read failed"}</small></a>`).join("")}</div></section>`).join("") : '<p class="workspace-note">No docs observation in this desk yet. Minute TRIX checks do not collect docs; a successful full collection or backup recovery is needed.</p>');
  put("docsChanges", `<p><b>Documented model layers:</b> ${esc(view.docsModels.join(", ") || "Unavailable")}</p><p><b>Anonymous API catalog:</b> ${esc(view.apiModels.join(", ") || "Unavailable")}</p>${view.missingFromCatalog.length ? `<p class="workspace-note">Docs-only in these samples: ${esc(view.missingFromCatalog.join(", "))}. This does not establish release timing or authenticated availability.</p>` : ""}${view.changes.map((e) => `<article class="docs-event"><strong>${esc(e.title)}</strong><time>${esc(time(e.at))}</time><p>${esc(e.summary)}</p></article>`).join("") || '<p class="workspace-note">No docs changes recorded in the retained 24-hour event window. This does not prove the docs are unchanged.</p>'}`);
  const mining = sources["surface.mining"];
  put("miningEvidence", `<div class="workspace-kpis"><div><strong>${usable(mining) ? fmt(mining.miners60m) : "—"}</strong><span>paid recipients · 60m sample</span></div><div><strong>${usable(mining) ? fmt(mining.payouts60m) : "—"}</strong><span>payouts · 60m sample</span></div><div><strong>${usable(mining) ? mining.claimsOn === true ? "On" : mining.claimsOn === false ? "Off" : "Unknown" : "Unknown"}</strong><span>third-party claims indicator</span></div></div><p class="workspace-note">${esc(sourceCondition(mining))} · checked ${esc(time(mining?.checkedAt))}. ${usable(mining) ? `Latest observed payout: ${esc(time(mining.payoutLatestAt))}.` : "Payout values withheld."} Paid recipients are not a count of running rigs. Prepaid activation requires account recognition; this public desk cannot confirm an individual entitlement.</p><details class="workspace-drill"><summary>Scope & historical archive</summary><p>Historical archive generated ${esc(usable(mining) ? time(mining.archiveGeneratedAt) : "not available")}. Archive windows are not live activity.</p><p>${external("https://www.pond0x.com/mining", "Pond mining")} · ${external("https://wpond-mining-dashboard.vercel.app/", "Reward source")}</p></details>`);
  const metricSources = { stackVersion: "stacknet.health", trixGeoffCount: "trix.geoff", pileValue: "stacknet.pile", keys9gValue: "geoff.keys.9g", x402Downloads: "stacknet.x402", subscriptionCount: "geoff.subscription", miningMiners: "surface.mining", simSupplyWatch: "magma.eth" };
  for (const [id, key] of Object.entries(metricSources)) {
    const card = document.getElementById(id)?.closest(".metric");
    if (card) card.hidden = !usable(sources[key]);
  }
  renderIssues(latest);
  put("historicalSources", Object.entries(latest?.historicalSources || {}).map(([id, s]) => `<details class="workspace-drill"><summary>${esc(id)} · observed ${esc(time(s.dataUpdatedAt || s.checkedAt))}</summary><p class="workspace-note">${esc(s.reason || s.error || "Last stored source response; not current.")}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:28rem;overflow:auto">${esc(JSON.stringify(s, null, 2))}</pre></details>`).join("") || '<p class="workspace-note">No older source detail is available in this response.</p>');
  put("historicalEvents", history.filter((e) => Date.now() - Date.parse(e.at) > EVIDENCE_WINDOW).map((e) => `<article class="docs-event"><strong>${esc(e.title)}</strong><time>${esc(time(e.at))}</time><p>${esc(e.summary)}</p></article>`).join("") || '<p class="workspace-note">No older events retained yet. This archive does not imply there were no earlier changes.</p>');
}
