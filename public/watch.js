const els = {
  connection: document.getElementById("pwConnection"),
  refresh: document.getElementById("pwRefresh"),
  // Hero stats
  heroGhosts: document.getElementById("heroGhosts"),
  heroZenTotal: document.getElementById("heroZenTotal"),
  heroOxAlpha: document.getElementById("heroOxAlpha"),
  heroOxAlphaFree: document.getElementById("heroOxAlphaFree"),
  // Metric cards
  ghosts: document.getElementById("pwGhosts"),
  ghostMeta: document.getElementById("pwGhostMeta"),
  zenCount: document.getElementById("pwZenCount"),
  zenMeta: document.getElementById("pwZenMeta"),
  registry: document.getElementById("pwRegistry"),
  registryMeta: document.getElementById("pwRegistryMeta"),
  oxAlpha: document.getElementById("pwOxAlpha"),
  oxAlphaMeta: document.getElementById("pwOxAlphaMeta"),
  registry: document.getElementById("pwRegistry"),
  registryMeta: document.getElementById("pwRegistryMeta"),
  release: document.getElementById("pwRelease"),
  releaseMeta: document.getElementById("pwReleaseMeta"),
  // Ghost shelf
  chips: document.getElementById("pwChips"),
  specs: document.getElementById("pwSpecs"),
  // Feed
  feed: document.getElementById("pwFeed"),
  feedMeta: document.getElementById("pwFeedMeta"),
  // Hero stats
  heroGhosts: document.getElementById("heroGhosts"),
  heroZenTotal: document.getElementById("heroZenTotal"),
  heroOxAlpha: document.getElementById("heroOxAlpha"),
  heroOxAlphaFree: document.getElementById("heroOxAlphaFree"),
  // Ox Alpha card
  oxAlpha: document.getElementById("pwOxAlpha"),
  oxAlphaMeta: document.getElementById("pwOxAlphaMeta"),
  // Ghost spec cards
  specs: document.getElementById("pwSpecs"),
  // Feed
  feed: document.getElementById("pwFeed"),
  feedMeta: document.getElementById("pwFeedMeta"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&")
    .replaceAll("<", "<")
    .replaceAll(">", ">")
    .replaceAll('"', '""');
}

function relTime(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function fmtCompact(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtCompactUsd(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}


function setConn(state) {
  const el = document.getElementById("pwConnection");
  if (el) {
    el.textContent = state;
    el.className = `pill ${state === "live" ? "live" : state === "offline" ? "offline" : ""}`;
  }
}

let lastPayload = { summary: null, events: [] };

function render(summary, events) {
  const s = summary ?? {};
  lastPayload = { summary: s, events };

  // Hero stats
  if (els.heroGhosts) {
    const ghosts = Array.isArray(s.zenGhostIds) ? s.zenGhostIds : [];
    els.heroGhosts.textContent = ghosts.length || "0";
  }
  if (els.heroZenTotal) {
    els.heroZenTotal.textContent = s.zenModelCount != null ? s.zenModelCount : "—";
  }
  if (els.heroOxAlpha) {
    const ladder = Array.isArray(s.goLadder) ? s.goLadder : [];
    const ox = ladder.find(r => r.name === "Ox Alpha Free" || r.name === "x-preview-f-free");
    if (ox && ox.quota) {
      els.heroOxAlpha.textContent = ox.quota === "unlimited" ? "∞" : Number(ox.quota).toLocaleString("en-US");
    } else {
      els.heroOxAlpha.textContent = "—";
    }
  }
  if (els.heroOxAlphaFree) {
    const n = s.goFreeDailyRequests;
    els.heroOxAlphaFree.textContent = n != null ? `${Number(n).toLocaleString()} req/day` : "—";
  }

  // Ghosts card
  const ghosts = Array.isArray(s.zenGhostIds) ? s.zenGhostIds : [];
  if (els.ghosts) {
    els.ghosts.textContent = ghosts.length || "0";
  }
  if (els.ghostMeta) {
    const missing = Array.isArray(s.zenMissingGhosts) ? s.zenMissingGhosts : [];
    els.ghostMeta.textContent = missing.length
      ? `${missing.length} off shelf: ${missing.join(", ")}`
      : "all watchlist models present";
  }

  // Zen catalog
  if (els.zenCount) {
    els.zenCount.textContent = s.zenModelCount != null ? s.zenModelCount : "—";
  }
  if (els.zenMeta) {
    els.zenMeta.textContent = s.zenFreeCount != null ? `${s.zenFreeCount} free tier` : "opencode.ai/zen models";
  }

  // Registry
  if (els.registry) {
    els.registry.textContent = s.ocRegistryModels != null ? s.ocRegistryModels : "—";
  }
  if (els.registryMeta) {
    const hits = Array.isArray(s.ocGhostHits) ? s.ocGhostHits.length : 0;
    const bits = [];
    if (hits) bits.push(`${hits} ghost hits`);
    if (s.ocRegistryProviders != null) bits.push(`${s.ocRegistryProviders} providers`);
    els.registryMeta.textContent = bits.length ? bits.join(" · ") : "tracked entries";
  }

  // Ox Alpha card
  if (els.oxAlpha) {
    const ladder = Array.isArray(s.goLadder) ? s.goLadder : [];
    const ox = ladder.find(r => r.name === "Ox Alpha Free" || r.name === "x-preview-f-free");
    if (ox) {
      const quota = ox.quota === "unlimited" ? "∞" : ox.quota != null ? Number(ox.quota).toLocaleString("en-US") : "?";
      els.heroOxAlpha.textContent = quota === "∞" ? "∞" : quota;
      const parts = [];
      if (ox.contextLimit != null) parts.push(`ctx ${Number(ox.contextLimit).toLocaleString()}`);
      if (ox.inputLimit != null) parts.push(`in ${Number(ox.inputLimit).toLocaleString()}`);
      if (ox.outputLimit != null) parts.push(`out ${Number(ox.outputLimit).toLocaleString()}`);
      if (ox.knowledge) parts.push(`cutoff ${ox.knowledge}`);
      if (ox.releaseDate) parts.push(`rel ${ox.releaseDate}`);
      if (ox.status) parts.push(ox.status);
      if (els.oxAlphaMeta) els.oxAlphaMeta.textContent = parts.join(" · ") || "x-preview-f-free";
    } else {
      if (els.heroOxAlpha) els.heroOxAlpha.textContent = "—";
    }
  }

  // Registry
  if (els.registry) {
    els.registry.textContent = s.ocRegistryModels != null ? s.ocRegistryModels : "—";
  }
  if (els.registryMeta) {
    const hits = Array.isArray(s.ocGhostHits) ? s.ocGhostHits.length : 0;
    const bits = [];
    if (hits) bits.push(`${hits} ghost hits`);
    if (s.ocRegistryProviders != null) bits.push(`${s.ocRegistryProviders} providers`);
    els.registryMeta.textContent = bits.length ? bits.join(" · ") : "tracked entries";
  }

  // Ghost chips
  if (els.chips) {
    els.chips.innerHTML = ghosts.length
      ? ghosts.map(g => `<span class="chip">${escapeHtml(g)}</span>`).join("")
      : `<span class="chip empty">shelf empty</span>`;
  }

  // Ghost specs
  if (els.specs) {
    const specs = Array.isArray(s.ocGhostSpecs) ? s.ocGhostSpecs : [];
    if (!specs.length) {
      els.specs.innerHTML = "";
    } else {
      const fmtTok = n => Number.isFinite(n) ? (n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : `${Math.round(n/1e3)}K`) : "?";
      const badge = (on, yes, no) => `<span class="spec-badge ${on ? "yes" : "no"}">${on ? yes : no}</span>`;
      const costLine = sp => {
        if (sp.costInput == null && sp.costOutput == null) return "cost: not listed";
        const zero = Number(sp.costInput) === 0 && Number(sp.costOutput) === 0;
        return zero ? "cost: $0 / $0 — subsidy on paper" : `cost: $${sp.costInput} in · $${sp.costOutput} out`;
      };
      els.specs.innerHTML = specs.map(sp => `
        <article class="spec-card${sp.status === "deprecated" ? " deprecated" : ""}">
          <header>
            <strong>${escapeHtml(sp.displayName || sp.id)}</strong>
            <span class="spec-id">${escapeHtml(sp.id)}</span>
          </header>
          ${sp.description ? `<p class="spec-desc">${escapeHtml(sp.description)}</p>` : ""}
          <div class="spec-limits">
            <span>ctx <b>${fmtTok(sp.contextLimit)}</b></span>
            <span>in <b>${fmtTok(sp.inputLimit)}</b></span>
            <span>out <b>${fmtTok(sp.outputLimit)}</b></span>
          </div>
          <div class="spec-badges">
            ${badge(sp.openWeights, "open weights", "closed weights")}
            ${badge(sp.reasoning, "reasoning", "no reasoning")}
            ${badge(sp.toolCall, "tools", "no tools")}
          </div>
          <p class="spec-meta">
            knowledge ${escapeHtml(sp.knowledge || "?")} · released ${escapeHtml(sp.releaseDate || "?")} · ${escapeHtml(costLine(sp))}${sp.status === "deprecated" ? ' · <b class="dep">DEPRECATED</b>' : ""}
          </p>
        </article>`).join("");
    }
  }

  // Feed
  const zenEvents = events
    .filter(e => e.kind === "zen")
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));

  if (els.feed) {
    if (!zenEvents.length) {
      els.feed.innerHTML = `<p class="feed-empty">No shelf moves on tape yet. The desk just started watching — history builds from here.</p>`;
    } else {
      els.feed.innerHTML = zenEvents.slice(0, 24).map(e => `
        <article class="feed-item rank-${escapeHtml(e.rank || "note")}">
          <header>
            <strong>${escapeHtml(e.title)}</strong>
            <time>${escapeHtml(relTime(e.at) || "")}</time>
          </header>
          <p>${escapeHtml(e.summary)}</p>
        </article>
      `).join("");
    }
  }

  if (els.feedMeta) {
    els.feedMeta.textContent = zenEvents.length ? `${zenEvents.length} zen-lane events on tape` : "tape empty";
  }
}
