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
  chips: document.getElementById("pwChips"),
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

function render(summary, events) {
  const s = summary ?? {};
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
      .join(" · ") || "github.com/sst/opencode";
  }

  if (els.chips) {
    els.chips.innerHTML = ghosts.length
      ? ghosts.map((g) => `<span class="chip">${escapeHtml(g)}</span>`).join("")
      : `<span class="chip empty">shelf empty</span>`;
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
