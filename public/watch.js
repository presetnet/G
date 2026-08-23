const els = {
  connection: document.getElementById("pwConnection"),
  refresh: document.getElementById("pwRefresh"),
  heroGhosts: document.getElementById("heroGhosts"),
  heroZenTotal: document.getElementById("heroZenTotal"),
  heroOxAlpha: document.getElementById("heroOxAlpha"),
  heroOxAlphaFree: document.getElementById("heroOxAlphaFree"),
  ghosts: document.getElementById("pwGhosts"),
  ghostMeta: document.getElementById("pwGhostMeta"),
  zenCount: document.getElementById("pwZenCount"),
  zenMeta: document.getElementById("pwZenMeta"),
  registry: document.getElementById("pwRegistry"),
  registryMeta: document.getElementById("pwRegistryMeta"),
  oxAlpha: document.getElementById("pwOxAlpha"),
  oxAlphaMeta: document.getElementById("pwOxAlphaMeta"),
  release: document.getElementById("pwRelease"),
  releaseMeta: document.getElementById("pwReleaseMeta"),
  chips: document.getElementById("pwChips"),
  specs: document.getElementById("pwSpecs"),
  feed: document.getElementById("pwFeed"),
};

function esc(v) {
  return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

function rel(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function setConn(s) { if (els.connection) { els.connection.textContent = s; els.connection.className = `pill ${s === "live" ? "live" : s === "offline" ? "offline" : ""}`; } }

function render(s, events) {
  const ghosts = Array.isArray(s.zenGhostIds) ? s.zenGhostIds : [];
  const ladder = Array.isArray(s.goLadder) ? s.goLadder : [];
  const ox = ladder.find(r => r.name === "Ox Alpha Free");

  // Hero
  if (els.heroGhosts) els.heroGhosts.textContent = ghosts.length;
  if (els.heroZenTotal) els.heroZenTotal.textContent = s.zenModelCount ?? "—";
  if (els.heroOxAlpha) els.heroOxAlpha.textContent = ox ? (ox.quota === "unlimited" ? "∞" : ox.quota?.toLocaleString() ?? "?") : "—";
  if (els.heroOxAlphaFree) els.heroOxAlphaFree.textContent = s.goFreeDailyRequests != null ? `${s.goFreeDailyRequests}/day` : "—";

  // Cards
  if (els.ghosts) els.ghosts.textContent = ghosts.length;
  if (els.ghostMeta) {
    const miss = Array.isArray(s.zenMissingGhosts) ? s.zenMissingGhosts : [];
    els.ghostMeta.textContent = miss.length ? `${miss.length} missing: ${miss.join(",")}` : "all present";
  }
  if (els.zenCount) els.zenCount.textContent = s.zenModelCount ?? "—";
  if (els.zenMeta) els.zenMeta.textContent = s.zenFreeCount != null ? `${s.zenFreeCount} free` : "";
  if (els.registry) els.registry.textContent = s.ocRegistryModels ?? "—";
  if (els.registryMeta) {
    const hits = Array.isArray(s.ocGhostHits) ? s.ocGhostHits.length : 0;
    els.registryMeta.textContent = [hits ? `${hits} ghost hits` : null, s.ocRegistryProviders ? `${s.ocRegistryProviders} providers` : null].filter(Boolean).join(" · ") || "tracked";
  }
  if (els.oxAlpha) els.oxAlpha.textContent = ox ? (ox.quota === "unlimited" ? "∞" : ox.quota?.toLocaleString() ?? "?") : "—";
  if (els.oxAlphaMeta) {
    const parts = [];
    if (ox?.contextLimit) parts.push(`ctx ${(ox.contextLimit / 1000).toFixed(0)}K`);
    if (ox?.knowledge) parts.push(`cutoff ${ox.knowledge}`);
    if (ox?.releaseDate) parts.push(ox.releaseDate);
    els.oxAlphaMeta.textContent = parts.join(" · ") || "x-preview-f-free";
  }
  if (els.release) els.release.textContent = s.ocReleaseTag || "—";
  if (els.releaseMeta) {
    const t = rel(s.ocReleaseAt);
    els.releaseMeta.textContent = t ? `${t} · anomalyco/opencode` : "anomalyco/opencode";
  }

  // Chips
  if (els.chips) {
    els.chips.innerHTML = ghosts.length
      ? ghosts.map(g => `<span class="chip">${esc(g)}</span>`).join("")
      : `<span class="chip empty">empty</span>`;
  }

  // Specs
  if (els.specs) {
    const specs = Array.isArray(s.ocGhostSpecs) ? s.ocGhostSpecs : [];
    const fmtT = n => Number.isFinite(n) ? (n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : `${Math.round(n/1e3)}K`) : "?";
    els.specs.innerHTML = specs.map(sp => `<article class="spec-card${sp.status==="deprecated"?" deprecated":""}">
      <header><strong>${esc(sp.displayName||sp.id)}</strong><span class="spec-id">${esc(sp.id)}</span></header>
      ${sp.description?`<p class="spec-desc">${esc(sp.description)}</p>`:""}
      <div class="spec-limits"><span>ctx <b>${fmtT(sp.contextLimit)}</b></span><span>in <b>${fmtT(sp.inputLimit)}</b></span><span>out <b>${fmtT(sp.outputLimit)}</b></span></div>
      <div class="spec-badges">
        <span class="spec-badge ${sp.openWeights?"yes":"no"}">${sp.openWeights?"open":"closed"}</span>
        <span class="spec-badge ${sp.reasoning?"yes":"no"}">${sp.reasoning?"reasoning":"—"}</span>
        <span class="spec-badge ${sp.toolCall?"yes":"no"}">${sp.toolCall?"tools":"—"}</span>
      </div>
      <p class="spec-meta">knowledge ${esc(sp.knowledge||"?")} · ${esc(sp.releaseDate||"?")} · $${sp.costInput??0}/$${sp.costOutput??0}${sp.status==="deprecated"?' · <b class="dep">DEPRECATED</b>':""}</p>
    </article>`).join("");
  }

  // Feed
  const zen = (Array.isArray(events) ? events : []).filter(e => e.kind === "zen").sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  if (els.feed) {
    els.feed.innerHTML = zen.length
      ? zen.slice(0, 24).map(e => `<article class="feed-item rank-${esc(e.rank||"note")}"><header><strong>${esc(e.title)}</strong><time>${esc(rel(e.at)||"")}</time></header><p>${esc(e.summary)}</p></article>`).join("")
      : `<p class="feed-empty">No moves yet — tape builds from here.</p>`;
  }
}

async function load() {
  setConn("loading");
  try {
    const [sr, er] = await Promise.all([
      fetch("/api/status", { cache: "no-store" }),
      fetch("/api/events?limit=120", { cache: "no-store" }).catch(() => null),
    ]);
    if (!sr.ok) throw new Error(`HTTP ${sr.status}`);
    const status = await sr.json();
    let events = [];
    if (er?.ok) { const d = await er.json().catch(() => null); events = Array.isArray(d?.events) ? d.events : []; }
    render(status?.latest?.summary ?? {}, events);
    setConn("live");
  } catch { setConn("offline"); }
}

els.refresh?.addEventListener("click", load);
load();
setInterval(load, 60_000);
