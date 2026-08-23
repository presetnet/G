const els = {
  connection: document.getElementById("pwConnection"),
  refresh: document.getElementById("pwRefresh"),
  headline: document.getElementById("pwHeadline"),
  sentence: document.getElementById("pwSentence"),
  ghosts: document.getElementById("pwGhosts"),
  ghostMeta: document.getElementById("pwGhostMeta"),
  zenCount: document.getElementById("pwZenCount"),
  zenMeta: document.getElementById("pwZenMeta"),
  registry: document.getElementById("pwRegistry"),
  registryMeta: document.getElementById("pwRegistryMeta"),
  release: document.getElementById("pwRelease"),
  releaseMeta: document.getElementById("pwReleaseMeta"),
  hpGeoff: document.getElementById("pwHpGeoff"),
  hpGeoffMeta: document.getElementById("pwHpGeoffMeta"),
  hpCtx: document.getElementById("pwHpCtx"),
  hpCtxMeta: document.getElementById("pwHpCtxMeta"),
  chips: document.getElementById("pwChips"),
  specs: document.getElementById("pwSpecs"),
  goIntro: document.getElementById("pwGoIntro"),
  goMonthly: document.getElementById("pwGoMonthly"),
  goTiers: document.getElementById("pwGoTiers"),
  goMeta: document.getElementById("pwGoMeta"),
  goLadderBody: document.getElementById("pwGoLadderBody"),
  feed: document.getElementById("pwFeed"),
  feedMeta: document.getElementById("pwFeedMeta"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setConn(state) {
  els.connection.textContent = state;
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

function fmtCtx(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B tok`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M tok`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K tok`;
  return `${n} tok`;
}

let lastPayload = { summary: null, events: [] };

function render(summary, events) {
  const s = summary ?? {};
  lastPayload = { summary: s, events };
  const ghosts = Array.isArray(s.zenGhostIds) ? s.zenGhostIds : [];

  if (els.ghosts) {
    els.ghosts.textContent = s.zenGhostIds ? String(ghosts.length) : "—";
    els.ghosts.title = `Watchlist: ${ghosts.join(", ") || "none"}`;
  }
  if (els.ghostMeta) {
    const missing = Array.isArray(s.zenMissingGhosts) ? s.zenMissingGhosts : [];
    els.ghostMeta.textContent = missing.length
      ? `${missing.length} off shelf: ${missing.join(", ")}`
      : "all watchlist models present";
  }
  if (els.zenCount) {
    els.zenCount.textContent = s.zenModelCount != null ? String(s.zenModelCount) : "—";
  }
  if (els.zenMeta) {
    els.zenMeta.textContent =
      s.zenFreeCount != null ? `${s.zenFreeCount} free tier` : "opencode.ai/zen models";
  }
  if (els.registry) {
    els.registry.textContent =
      s.ocRegistryModels != null ? String(s.ocRegistryModels) : "—";
  }
  if (els.registryMeta) {
    const hits = Array.isArray(s.ocGhostHits) ? s.ocGhostHits.length : 0;
    const bits = [];
    if (hits) bits.push(`${hits} ghost hits`);
    if (s.ocRegistryProviders != null) bits.push(`${s.ocRegistryProviders} providers`);
    els.registryMeta.textContent = bits.length ? bits.join(" · ") : "tracked entries";
  }
  if (els.release) {
    els.release.textContent = s.ocReleaseTag || "—";
  }
  if (els.releaseMeta) {
    const when = relTime(s.ocReleaseAt);
    const recent = Array.isArray(s.ocReleaseRecentTags) ? s.ocReleaseRecentTags.length : 0;
    els.releaseMeta.textContent = [
      when ? `published ${when}` : null,
      recent ? `last ${recent} tags tracked` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "github.com/anomalyco/opencode";
  }

  if (els.hpGeoff) {
    els.hpGeoff.textContent =
      s.nodes != null && s.gpus != null ? `${s.nodes} nodes · ${s.gpus} GPUs` : "—";
  }
  if (els.hpGeoffMeta) {
    const vram = Number(s.vramGb);
    const load = s.averageLoad != null ? `load ${s.averageLoad}` : null;
    els.hpGeoffMeta.textContent = [
      vram > 0 ? `${Math.round(vram)} GB VRAM` : null,
      load,
      "public /network/summary",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (els.hpCtx) {
    els.hpCtx.textContent =
      s.zenFreeContextTotal != null ? fmtCtx(Number(s.zenFreeContextTotal)) : "n/a";
  }
  if (els.hpCtxMeta) {
    const ghostCtx =
      s.zenGhostContextTotal != null ? fmtCtx(Number(s.zenGhostContextTotal)) : null;
    els.hpCtxMeta.textContent = [
      `${s.zenFreeCount ?? "?"} free slots combined`,
      ghostCtx ? `ghosts alone: ${ghostCtx}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (els.goIntro) {
    els.goIntro.textContent =
      s.goPriceIntroUsd != null ? `$${s.goPriceIntroUsd}` : "—";
  }
  if (els.goMonthly) {
    els.goMonthly.textContent =
      s.goPriceMonthlyUsd != null ? `$${s.goPriceMonthlyUsd}/mo` : "—";
  }
  if (els.goTiers) {
    const tiers = Array.isArray(s.goTierTabs) ? s.goTierTabs : [];
    els.goTiers.textContent = tiers.length
      ? ` · tier multipliers seen: ${tiers.map((t) => `${t}×`).join(" / ")}`
      : "";
  }
  if (els.goLadderBody) {
    const ladder = Array.isArray(s.goLadder) ? s.goLadder : [];
    const notes = {
      Hy3: "8× usage badge",
      "Muse Spark 1.2 Contributor": "Meta region lock",
      "Ox Alpha Free":
        s.goOxAlphaPromo ? "limited-time promo · the ∞ slot" : "promo ended?",
      "GPT 5.6 Luna": "OpenAI-named slot in an open-source pitch",
    };
    if (!ladder.length) {
      els.goLadderBody.innerHTML =
        '<tr><td colspan="3" class="go-empty">ladder not parsed yet</td></tr>';
    } else {
      els.goLadderBody.innerHTML = ladder
        .map((row) => {
          const quota =
            row.quota === "unlimited"
              ? "∞"
              : row.quota != null
                ? Number(row.quota).toLocaleString("en-US")
                : "?";
          return `<tr><td>${escapeHtml(row.name)}</td><td class="go-num">${escapeHtml(quota)}</td><td class="go-note">${escapeHtml(notes[row.name] || "")}</td></tr>`;
        })
        .join("");
    }
  }
  if (els.goMeta) {
    els.goMeta.textContent =
      s.goFingerprint != null
        ? `parsed from live page · fingerprint ${s.goFingerprint}`
        : "reading opencode.ai/go…";
  }

  if (els.chips) {
    els.chips.innerHTML = ghosts.length
      ? ghosts.map((g) => `<span class="chip">${escapeHtml(g)}</span>`).join("")
      : `<span class="chip empty">shelf empty</span>`;
  }

  if (els.specs) {
    const specs = Array.isArray(s.ocGhostSpecs) ? s.ocGhostSpecs : [];
    if (!specs.length) {
      els.specs.innerHTML = "";
    } else {
      const fmtTok = (n) =>
        Number.isFinite(n)
          ? n >= 1e6
            ? `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`
            : `${Math.round(n / 1e3)}K`
          : "?";
      const badge = (on, yes, no) =>
        `<span class="spec-badge ${on ? "yes" : "no"}">${on ? yes : no}</span>`;
      const costLine = (sp) => {
        if (sp.costInput == null && sp.costOutput == null) return "cost: not listed";
        const zero = Number(sp.costInput) === 0 && Number(sp.costOutput) === 0;
        return zero
          ? "cost: $0 / $0 — subsidy on paper"
          : `cost: $${sp.costInput} in · $${sp.costOutput} out`;
      };
      els.specs.innerHTML = specs
        .map(
          (sp) => `
            <article class="pw-spec${sp.status === "deprecated" ? " deprecated" : ""}">
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
                ${badge(sp.reasoning, "reasoning", "no reasoning flag")}
                ${badge(sp.toolCall, "tools", "no tools")}
              </div>
              <p class="spec-meta">
                knowledge ${escapeHtml(sp.knowledge || "?")} · released ${escapeHtml(
                  sp.releaseDate || "?",
                )} · ${escapeHtml(costLine(sp))}${
                  sp.status === "deprecated" ? ' · <b class="dep">DEPRECATED</b>' : ""
                }
              </p>
            </article>`,
        )
        .join("");
    }
  }

  const zenEvents = events
    .filter((e) => e.kind === "zen")
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  const latestMove = zenEvents[0];
  const freshCutoff = Date.now() - 36 * 60 * 60 * 1000;
  const movedRecently =
    latestMove && Date.parse(latestMove.at || 0) > freshCutoff;

  if (els.headline) {
    if (!latestMove && !ghosts.length) {
      els.headline.textContent = "Waiting for first sniff";
    } else if (movedRecently) {
      els.headline.textContent = latestMove.title || "Shelf moved";
    } else {
      els.headline.textContent = "Shelf quiet";
    }
  }
  if (els.sentence) {
    if (movedRecently) {
      els.sentence.textContent =
        latestMove.summary ||
        "A public move landed in the last day — details below.";
    } else {
      els.sentence.textContent = `Watching ${ghosts.length} anonymous models across ${
        s.ocRegistryProviders != null ? `${s.ocRegistryProviders} registry providers` : "the public registry"
      }. Last recorded move: ${
        latestMove ? `${latestMove.title} · ${relTime(latestMove.at) || "unknown when"}` : "nothing on tape yet"
      }.`;
    }
  }

  if (els.feed) {
    if (!zenEvents.length) {
      els.feed.innerHTML = `<p class="pw-empty">No shelf moves on tape yet. The desk just started watching — history builds from here.</p>`;
    } else {
      els.feed.innerHTML = zenEvents
        .slice(0, 24)
        .map(
          (e) => `
            <article class="pw-item rank-${escapeHtml(e.rank || "note")}">
              <header>
                <strong>${escapeHtml(e.title)}</strong>
                <time>${escapeHtml(relTime(e.at) || "")}</time>
              </header>
              <p>${escapeHtml(e.summary)}</p>
            </article>`,
        )
        .join("");
    }
  }
  if (els.feedMeta) {
    els.feedMeta.textContent = zenEvents.length
      ? `${zenEvents.length} zen-lane events on tape`
      : "tape empty";
  }
}

async function load() {
  setConn("loading");
  try {
    const [statusRes, eventsRes] = await Promise.all([
      fetch("/api/status", { cache: "no-store" }),
      fetch("/api/events?limit=120", { cache: "no-store" }).catch(() => null),
    ]);
    if (!statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
    const status = await statusRes.json();
    let events = [];
    if (eventsRes && eventsRes.ok) {
      const data = await eventsRes.json().catch(() => null);
      events = Array.isArray(data?.events) ? data.events : [];
    }
    render(status?.latest?.summary ?? {}, events);
    setConn(eventsRes && eventsRes.ok ? "live" : "live · tape offline");
  } catch (error) {
    setConn("offline");
    if (els.headline) els.headline.textContent = "Sniff unreachable";
    if (els.sentence) els.sentence.textContent = error.message;
  }
}

els.refresh?.addEventListener("click", load);
load();
setInterval(load, 60_000);
