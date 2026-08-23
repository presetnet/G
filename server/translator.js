/**
 * Diff two sniff snapshots into plain-English events.
 * Ranks are dialed so routine noise stays quiet and only measurable spikes float.
 *
 * rank: whisper < note < move < spike < crazy
 */

const RANK = {
  whisper: { weight: 1, severity: "info", heat: 0 },
  note: { weight: 2, severity: "low", heat: 1 },
  move: { weight: 3, severity: "medium", heat: 2 },
  spike: { weight: 4, severity: "high", heat: 4 },
  crazy: { weight: 5, severity: "high", heat: 6 },
};

function listDiff(before = [], after = []) {
  const a = new Set(before);
  const b = new Set(after);
  const added = [...b].filter((x) => !a.has(x)).sort();
  const removed = [...a].filter((x) => !b.has(x)).sort();
  return { added, removed, changed: added.length + removed.length > 0 };
}

function event(partial) {
  const rank = partial.rank || "note";
  const meta = RANK[rank] || RANK.note;
  return {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    ...partial,
    rank,
    severity: partial.severity || meta.severity,
    heat: partial.heat ?? meta.heat,
  };
}

function rankForListChange(count) {
  if (count >= 8) return "crazy";
  if (count >= 5) return "spike";
  if (count >= 2) return "move";
  if (count >= 1) return "note";
  return "whisper";
}

/** Empty↔full catalog swaps are scrape flaps, not real product changes. */
function isScrapeFlap(prevList, currList, diff) {
  const prevN = Array.isArray(prevList) ? prevList.length : 0;
  const currN = Array.isArray(currList) ? currList.length : 0;
  if (!prevN || !currN) return true;
  const added = diff?.added?.length || 0;
  const removed = diff?.removed?.length || 0;
  // Entire menu appeared or vanished in one poll
  if (added === currN && removed === 0) return true;
  if (removed === prevN && added === 0) return true;
  if (added >= 8 && removed === 0) return true;
  if (removed >= 8 && added === 0) return true;
  if (added >= 8 && removed >= 8) return true;
  return false;
}

function isFlapEvent(e) {
  if (
    !["models", "apiModels", "widgets", "capabilities", "catalog"].includes(e.kind)
  ) {
    return false;
  }
  const added = e.details?.added?.length || e.details?.raw?.added?.length || 0;
  const removed = e.details?.removed?.length || e.details?.raw?.removed?.length || 0;
  // One-sided bulk appear/disappear = incomplete previous/current sniff
  if (removed === 0 && added >= 4) return true;
  if (added === 0 && removed >= 4) return true;
  if (added >= 8 && removed >= 8) return true;
  if (/\+\d{2,} (models|capabilities|widgets|powers|API models)/i.test(e.summary || "")) {
    return true;
  }
  if (/-\d{2,} (models|capabilities|widgets|powers|API models)/i.test(e.summary || "")) {
    return true;
  }
  return false;
}

const VIBE = {
  crazy: "Crazy",
  spike: "Spike",
  move: "Move",
  note: "Note",
  whisper: "Whisper",
};

/**
 * Always derive rank from kind/content.
 * Website deploys are common (Vercel) → Note. Spike/Crazy are rare.
 * Never trust legacy severity:high / "Big deal".
 */
export function inferRank(e = {}) {
  const blob = `${e.title || ""} ${e.summary || ""}`;

  // Explicit rare full-stack marker wins
  if (/full-stack ship/i.test(blob)) return "crazy";

  if (e.kind === "baseline" || e.kind === "treasury") return "whisper";
  if (e.kind === "metaproofs") {
    if (/first|paid|settl/i.test(blob)) return "spike";
    if (/booked|paperwork|outstanding/i.test(blob)) return "note";
    return "whisper";
  }
  if (e.kind === "fleet") {
    if (/ghost|brain|new engine/i.test(blob)) return "spike";
    return /retired|reshap/i.test(blob) ? "move" : "note";
  }
  if (e.kind === "zen") return /ghost/i.test(blob) ? "spike" : "note";
  if (e.kind === "solana") {
    if (/funded/i.test(blob)) return "spike";
    return /disagree/i.test(blob) ? "move" : "note";
  }
  if (e.kind === "docs") return "note";
  if (e.kind === "agent") return "note";
  if (e.kind === "agentCluster") {
    if (/crazy|full-stack/i.test(blob)) return "crazy";
    if (/spike/i.test(blob)) return "spike";
    return "move";
  }
  if (e.kind === "deploy") {
    // Routine site ships stay quiet — not a parade
    return "note";
  }
  if (e.kind === "version") return /mcp|plug-in|contract/i.test(blob) ? "note" : "spike";
  if (e.kind === "health") {
    if (/unhealthy|degrad|down|fail/i.test(blob)) return "spike";
    return "note";
  }
  if (e.kind === "network") return "note";
  if (
    e.kind === "models" ||
    e.kind === "apiModels" ||
    e.kind === "widgets" ||
    e.kind === "capabilities" ||
    e.kind === "catalog"
  ) {
    const n =
      (e.details?.added?.length || 0) +
      (e.details?.removed?.length || 0) +
      (e.details?.raw?.added?.length || 0) +
      (e.details?.raw?.removed?.length || 0);
    if (n > 0) return rankForListChange(n);
    const m = blob.match(/\+(\d+)/);
    if (m) return rankForListChange(Number(m[1]));
    return "note";
  }
  if (e.severity === "high" || e.severity === "medium") return "note";
  if (e.severity === "low" || e.severity === "info") return "whisper";
  return "note";
}

export function vibeForRank(rank) {
  return VIBE[rank] || "Note";
}

export function normalizeEvent(e) {
  if (!e || typeof e !== "object") return e;
  const rank = inferRank(e);
  const meta = RANK[rank] || RANK.note;
  const heat =
    typeof e.heat === "number" && e.heat >= 7
      ? meta.heat
      : (e.heat ?? meta.heat);
  return {
    ...e,
    rank,
    severity: meta.severity,
    heat,
    vibe: vibeForRank(rank),
  };
}

function deployFingerprint(e) {
  const d = e.details || {};
  const to =
    d.to ||
    d.build?.to ||
    d.deploy?.to ||
    d.chunks?.to ||
    e.summary ||
    e.title ||
    "";
  const from =
    d.from ||
    d.build?.from ||
    d.deploy?.from ||
    d.chunks?.from ||
    "";
  return `${e.kind}|${from}|${to}|${(e.title || "").replace(/\s+/g, " ").slice(0, 48)}`;
}

/** Collapse legacy deploy triplets + repeated identical ship spam. */
export function dedupeDeployBursts(events = []) {
  const sorted = [...events].sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  const used = new Set();
  const out = [];
  const seenFingerprints = new Set();

  for (const e of sorted) {
    if (!e?.id || used.has(e.id)) continue;
    if (e.kind !== "deploy") {
      // Collapse identical health/version/catalog spam
      if (["health", "version", "models", "apiModels", "widgets", "capabilities", "catalog"].includes(e.kind)) {
        const fp = deployFingerprint(e);
        if (seenFingerprints.has(fp)) {
          used.add(e.id);
          continue;
        }
        seenFingerprints.add(fp);
      }
      out.push(e);
      used.add(e.id);
      continue;
    }
    const t = Date.parse(e.at || 0);
    const siblings = sorted.filter(
      (o) =>
        o.kind === "deploy" &&
        o.id &&
        !used.has(o.id) &&
        Math.abs(Date.parse(o.at || 0) - t) < 120_000,
    );
    for (const s of siblings) used.add(s.id);
    const keep =
      siblings.find((s) => /shipped|build/i.test(s.title || "")) || siblings[0] || e;
    const coalesced = siblings.length > 1;
    const normalized = normalizeEvent({
      ...keep,
      title: coalesced ? "Geoff website shipped" : keep.title,
      summary: coalesced
        ? `Coalesced ${siblings.length} deploy signals from the same window: ${siblings
            .map((s) => s.title)
            .join(" · ")}`
        : keep.summary,
      details: {
        ...(keep.details || {}),
        coalesced: siblings.length,
        legacyIds: siblings.map((s) => s.id),
      },
    });
    const fp = deployFingerprint(normalized);
    if (seenFingerprints.has(fp)) continue;
    seenFingerprints.add(fp);
    out.push(normalized);
  }
  return out;
}

export function normalizeEvents(events = []) {
  return dedupeDeployBursts(events.filter((e) => !isFlapEvent(e)).map(normalizeEvent));
}

export function translate(previous, current) {
  if (!current) return [];
  if (!previous) {
    return [
      event({
        kind: "baseline",
        rank: "whisper",
        title: "First reading locked in",
        summary:
          "Captured a baseline of the app, network, models, and tools. Next sniffs will call out what changed — quietly unless something real moves.",
        details: {
          geoffBuildId: current.summary.geoffBuildId,
          stacknetVersion: current.summary.stacknetVersion,
          models: current.summary.models,
          nodes: current.summary.nodes,
          inFlight: current.summary.inFlight,
          taskCount: current.summary.taskCount,
        },
      }),
    ];
  }

  // Stale-baseline guard: if the previous snapshot predates the poll cadence,
  // every drift accumulated during the blind window would fire as "news"
  // stamped right now. Collapse it into one catch-up event instead.
  const STALE_BASELINE_MS = 6 * 60 * 60 * 1000;
  const prevAtMs = Date.parse(previous.takenAt || "");
  const currAtMs = Date.parse(current.takenAt || "") || Date.now();
  if (Number.isFinite(prevAtMs) && currAtMs - prevAtMs > STALE_BASELINE_MS) {
    const gapH = Math.round((currAtMs - prevAtMs) / 3_600_000);
    const vPrev =
      previous.sources?.["stacknet.health"]?.version ||
      previous.sources?.["stacknet.root"]?.version;
    const vCurr =
      current.sources?.["stacknet.health"]?.version ||
      current.sources?.["stacknet.root"]?.version;
    const verNote =
      vPrev && vCurr && vPrev !== vCurr
        ? ` Stacknet read ${vPrev} before the gap and ${vCurr} now — any move happened inside the blind window, not just now.`
        : "";
    return [
      event({
        kind: "baseline",
        rank: "note",
        title: `Catch-up: desk was dark ~${gapH}h`,
        summary: `Last reading ${previous.takenAt}, this sniff ${current.takenAt}. Per-change diffs across a blind window are not news${verNote}`,
        details: {
          inferred: true,
          previousAt: previous.takenAt,
          currentAt: current.takenAt,
          gapHours: gapH,
          versionBeforeGap: vPrev ?? null,
          versionAfterGap: vCurr ?? null,
        },
      }),
    ];
  }

  const events = [];
  const prev = previous.sources;
  const curr = current.sources;

  // --- Deploy: coalesce build + deployId + chunks into ONE event ---
  const prevBuild = prev["geoff.version"]?.buildId;
  const currBuild = curr["geoff.version"]?.buildId;
  const prevDeploy = prev["geoff.deploy"]?.deployId;
  const currDeploy = curr["geoff.deploy"]?.deployId;
  const prevChunk = prev["geoff.deploy"]?.chunks?.hash;
  const currChunk = curr["geoff.deploy"]?.chunks?.hash;
  const buildChanged = Boolean(prevBuild && currBuild && prevBuild !== currBuild);
  const deployChanged = Boolean(prevDeploy && currDeploy && prevDeploy !== currDeploy);
  const chunkChanged = Boolean(prevChunk && currChunk && prevChunk !== currChunk);

  if (buildChanged || deployChanged || chunkChanged) {
    const bits = [];
    if (buildChanged) bits.push(`build ${short(prevBuild)} → ${short(currBuild)}`);
    if (deployChanged) bits.push(`deploy ${short(prevDeploy)} → ${short(currDeploy)}`);
    if (chunkChanged) bits.push(`assets ${prevChunk} → ${currChunk}`);
    // Website ships are Notes — Vercel can roll often. Spike/Crazy only for rare full-stack.
    const rank = "note";
    events.push(
      event({
        kind: "deploy",
        rank,
        title: buildChanged || deployChanged ? "Geoff website shipped" : "Site assets refreshed",
        summary:
          buildChanged || deployChanged
            ? `Live app update detected (${bits.join("; ")}). Routine unless the network version moves too.`
            : `JS bundles changed (${bits.join("; ")}). Often a small UI tweak.`,
        details: {
          build: buildChanged ? { from: prevBuild, to: currBuild } : null,
          deploy: deployChanged ? { from: prevDeploy, to: currDeploy } : null,
          chunks: chunkChanged
            ? {
                from: prevChunk,
                to: currChunk,
                chunkCount: curr["geoff.deploy"]?.chunks?.count ?? null,
              }
            : null,
        },
      }),
    );
  }

  // --- Stacknet version + MCP contract: coalesce ---
  const prevVer = prev["stacknet.health"]?.version || prev["stacknet.root"]?.version;
  const currVer = curr["stacknet.health"]?.version || curr["stacknet.root"]?.version;
  const verChanged = Boolean(prevVer && currVer && prevVer !== currVer);
  const mcpPrev = prev["stacknet.health"]?.remoteMcp?.contract_id;
  const mcpCurr = curr["stacknet.health"]?.remoteMcp?.contract_id;
  const mcpChanged = Boolean(mcpPrev && mcpCurr && mcpPrev !== mcpCurr);

  if (verChanged || mcpChanged) {
    const bits = [];
    if (verChanged) bits.push(`${prevVer} → ${currVer}`);
    if (mcpChanged) bits.push(`MCP ${short(mcpPrev)} → ${short(mcpCurr)}`);
    events.push(
      event({
        kind: "version",
        rank: verChanged ? "spike" : "move",
        title: verChanged ? "AI network software upgraded" : "Agent plug-in contract updated",
        summary: verChanged
          ? `Stacknet moved ${bits.join("; ")}. Under-the-hood runtime change for generation and agents.`
          : `Outside AI agents may need the new MCP contract (${bits.join("; ")}).`,
        details: {
          version: verChanged ? { from: prevVer, to: currVer } : null,
          mcp: mcpChanged ? { from: mcpPrev, to: mcpCurr } : null,
        },
      }),
    );
  }

  // If website + network version both moved in the same sniff → that IS the rare crazy
  if (events.some((e) => e.kind === "deploy") && verChanged) {
    const deployEvt = events.find((e) => e.kind === "deploy");
    if (deployEvt) {
      deployEvt.rank = "crazy";
      deployEvt.severity = RANK.crazy.severity;
      deployEvt.heat = RANK.crazy.heat;
      deployEvt.vibe = vibeForRank("crazy");
      deployEvt.title = "Full-stack ship: app + network";
      deployEvt.summary = `${deployEvt.summary} Stacknet also moved ${prevVer} → ${currVer} in the same window.`;
    }
  }

  const prevPriceFp = prev["geoff.docs.pricing"]?.fingerprint;
  const currPriceFp = curr["geoff.docs.pricing"]?.fingerprint;
  if (prevPriceFp && currPriceFp && prevPriceFp !== currPriceFp) {
    const prevPlans = prev["geoff.docs.pricing"]?.plans || [];
    const currPlans = curr["geoff.docs.pricing"]?.plans || [];
    const bits = currPlans
      .map((p) => {
        const before = prevPlans.find((x) => x.id === p.id);
        if (!before) return `${p.name} ${p.price} / ${p.tokens}`;
        if (before.price !== p.price || before.tokens !== p.tokens) {
          return `${p.name}: ${before.price}/${before.tokens} → ${p.price}/${p.tokens}`;
        }
        return null;
      })
      .filter(Boolean);
    events.push(
      event({
        kind: "pricing",
        rank: "spike",
        title: "Token plan / pricing updated",
        summary: bits.length
          ? `Public docs rates moved: ${bits.join(" · ")}. Source: docs.geoff.ai/token-plan.`
          : "Public Token Plan tables changed on docs.geoff.ai.",
        details: {
          from: prevPriceFp,
          to: currPriceFp,
          plans: currPlans,
        },
      }),
    );
  }

  const prevDocsFp = prev["geoff.docs.surface"]?.fingerprint;
  const currDocsFp = curr["geoff.docs.surface"]?.fingerprint;
  if (prevDocsFp && currDocsFp && prevDocsFp !== currDocsFp) {
    const prevPages = prev["geoff.docs.surface"]?.pages || [];
    const currPages = curr["geoff.docs.surface"]?.pages || [];
    const moved = currPages
      .filter((p) => p.ok && p.hash)
      .filter((p) => {
        const before = prevPages.find((x) => x.id === p.id);
        return before?.hash && before.hash !== p.hash;
      })
      .map((p) => p.label || p.id);
    events.push(
      event({
        kind: "docs",
        rank: "note",
        title: "Public docs surface moved",
        summary: moved.length
          ? `Docs moved: ${moved.slice(0, 8).join(" · ")}${moved.length > 8 ? ` (+${moved.length - 8} more)` : ""}. Full Stacknet docs surface (intro · token-plan · MCP · features · Geoff Code · cookbook).`
          : "Public docs fingerprint changed on docs.geoff.ai.",
        details: {
          from: prevDocsFp,
          to: currDocsFp,
          pages: moved,
          scraped: curr["geoff.docs.surface"]?.scraped,
          total: curr["geoff.docs.surface"]?.total,
        },
      }),
    );
  }

  // Product lanes (HQ / Studio / Skills / Code / Claw / Max) — public connect-gate.
  const prevLanes = prev["geoff.product.lanes"];
  const currLanes = curr["geoff.product.lanes"];
  if (prevLanes?.fingerprint && currLanes?.fingerprint && prevLanes.fingerprint !== currLanes.fingerprint) {
    const prevLive = new Set((prevLanes.routes || []).filter((r) => r.live).map((r) => r.id));
    const currLive = new Set((currLanes.routes || []).filter((r) => r.live).map((r) => r.id));
    const added = [...currLive].filter((id) => !prevLive.has(id));
    const removed = [...prevLive].filter((id) => !currLive.has(id));
    const labels = Object.fromEntries((currLanes.routes || []).map((r) => [r.id, r.label || r.path]));
    events.push(
      event({
        kind: "productLanes",
        rank: added.length || removed.length ? "move" : "note",
        title: added.length
          ? "Product lane surface expanded"
          : removed.length
            ? "Product lane surface shrank"
            : "Product lanes shifted",
        summary: [
          added.length ? `+${added.map((id) => labels[id] || id).join(", ")}` : null,
          removed.length ? `-${removed.map((id) => labels[id] || id).join(", ")}` : null,
          `${currLanes.liveCount ?? 0}/${currLanes.total ?? "?"} lanes answering (connect-gate)`,
          "HQ · Studio · Skills · Code · Claw · Social · Max — public probe only.",
        ]
          .filter(Boolean)
          .join(" · "),
        details: {
          from: prevLanes.fingerprint,
          to: currLanes.fingerprint,
          added,
          removed,
          liveLabels: currLanes.liveLabels,
        },
      }),
    );
  }

  // Max × Solana route table (public 307→connect proves the lanes exist).
  const prevMax = prev["geoff.max.solana"];
  const currMax = curr["geoff.max.solana"];
  if (prevMax?.fingerprint && currMax?.fingerprint && prevMax.fingerprint !== currMax.fingerprint) {
    const prevLive = new Set((prevMax.routes || []).filter((r) => r.live).map((r) => r.id));
    const currLive = new Set((currMax.routes || []).filter((r) => r.live).map((r) => r.id));
    const added = [...currLive].filter((id) => !prevLive.has(id));
    const removed = [...prevLive].filter((id) => !currLive.has(id));
    const labels = Object.fromEntries((currMax.routes || []).map((r) => [r.id, r.label || r.path]));
    events.push(
      event({
        kind: "maxSolana",
        rank: added.length || removed.length ? "move" : "note",
        title: added.length
          ? "Max × Solana surface expanded"
          : removed.length
            ? "Max × Solana surface shrank"
            : "Max × Solana routes shifted",
        summary: [
          added.length
            ? `+${added.map((id) => labels[id] || id).join(", ")}`
            : null,
          removed.length
            ? `-${removed.map((id) => labels[id] || id).join(", ")}`
            : null,
          `${currMax.liveCount ?? 0}/${currMax.total ?? "?"} lanes answering (connect-gate or open)`,
          "Public route probe — not wallet/portfolio contents.",
        ]
          .filter(Boolean)
          .join(" · "),
        details: {
          from: prevMax.fingerprint,
          to: currMax.fingerprint,
          added,
          removed,
          solanaLive: currMax.solanaLive,
          portfolioLive: currMax.portfolioLive,
        },
      }),
    );
  }

  // Community Explore board — public /api/explore/feed post IDs (not engagement spam).
  const prevExplore = prev["geoff.explore"];
  const currExplore = curr["geoff.explore"];
  if (prevExplore?.ok && currExplore?.ok && prevExplore.fingerprint && currExplore.fingerprint) {
    if (prevExplore.fingerprint !== currExplore.fingerprint) {
      const prevIds = prevExplore.ids || [];
      const currIds = currExplore.ids || [];
      const diff = listDiff(prevIds, currIds);
      const addedN = diff.added.length;
      const removedN = diff.removed.length;
      const sampleById = new Map((currExplore.sample || []).map((p) => [p.id, p]));
      const addedTitles = diff.added
        .map((id) => sampleById.get(id)?.title)
        .filter(Boolean)
        .slice(0, 4);
      // Heavy both-ways churn = trending reshuffle, not a content dump.
      const reshuffle = addedN >= 10 && removedN >= 10;
      const rank = reshuffle
        ? "whisper"
        : rankForListChange(addedN || removedN);
      const title = reshuffle
        ? "Explore feed reshuffled"
        : addedN
          ? "New posts on Explore"
          : "Explore board changed";
      const bits = [];
      if (addedN) bits.push(`+${addedN} post${addedN === 1 ? "" : "s"}`);
      if (removedN) bits.push(`-${removedN} rotated off the top`);
      if (addedTitles.length) bits.push(addedTitles.map((t) => `“${t}”`).join(", "));
      events.push(
        event({
          kind: "explore",
          rank,
          title,
          summary: bits.length
            ? `${bits.join(" · ")}. Public geoff.ai/explore feed.`
            : "Public Explore feed fingerprint moved.",
          details: {
            from: prevExplore.fingerprint,
            to: currExplore.fingerprint,
            added: diff.added.slice(0, 12),
            removed: diff.removed.slice(0, 12),
            count: currExplore.count,
            authors: currExplore.authorCount,
            mediaCounts: currExplore.mediaCounts,
          },
        }),
      );
    }
  }

  // Metaproofs ledger — the $ paperwork StackNet books against its $0 treasury.
  const mpPrev = prev["stacknet.network"]?.metaproofs || {};
  const mpCurr = curr["stacknet.network"]?.metaproofs || {};
  const pwPrev = usdNumber(mpPrev.totalPaperworkUsd);
  const pwCurr = usdNumber(mpCurr.totalPaperworkUsd);
  const paidPrev = usdNumber(mpPrev.paidPaperworkUsd);
  const paidCurr = usdNumber(mpCurr.paidPaperworkUsd);
  const outCurr = usdNumber(mpCurr.outstandingUsd);
  const moneyMoved =
    (isNumber(pwPrev) && isNumber(pwCurr) && pwPrev !== pwCurr) ||
    (isNumber(paidPrev) && isNumber(paidCurr) && paidPrev !== paidCurr);

  if (moneyMoved) {
    const firstPayment = paidCurr > 0 && (paidPrev ?? 0) === 0;
    events.push(
      event({
        kind: "metaproofs",
        rank: firstPayment ? "spike" : "note",
        title: firstPayment
          ? "FIRST METAPROOF PAPERWORK PAID"
          : "Metaproof paperwork moved",
        summary: [
          isNumber(pwPrev) && isNumber(pwCurr) && pwPrev !== pwCurr
            ? `booked $${fmtUsd(pwPrev)} → $${fmtUsd(pwCurr)}`
            : null,
          isNumber(paidPrev) && isNumber(paidCurr) && paidPrev !== paidCurr
            ? `paid $${fmtUsd(paidPrev)} → $${fmtUsd(paidCurr)}`
            : null,
          isNumber(outCurr) ? `outstanding $${fmtUsd(outCurr)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        details: {
          paperwork: { from: pwPrev ?? null, to: pwCurr ?? null },
          paid: { from: paidPrev ?? null, to: paidCurr ?? null },
          outstanding: outCurr ?? null,
        },
      }),
    );
  } else if (!isNumber(pwCurr)) {
    const prevMeta = prev["stacknet.network"]?.metaproofs?.total;
    const currMeta = curr["stacknet.network"]?.metaproofs?.total;
    if (isNumber(prevMeta) && isNumber(currMeta) && prevMeta !== currMeta) {
      events.push(
        event({
          kind: "metaproofs",
          rank: "whisper",
          title: "Metaproofs counter moved",
          summary: `Network metaproofs.total ${prevMeta} → ${currMeta}.`,
          details: { from: prevMeta, to: currMeta },
        }),
      );
    }
  }

  // Health string changes (healthy/unhealthy) — ignore bare HTTP codes like "502".
  const prevHealthRaw = prev["stacknet.health"]?.statusText;
  const currHealthRaw = curr["stacknet.health"]?.statusText;
  const isAppHealth = (s) => typeof s === "string" && s.length > 0 && !/^\d{3}$/.test(s);
  const prevHealth = isAppHealth(prevHealthRaw) ? prevHealthRaw : null;
  const currHealth = isAppHealth(currHealthRaw) ? currHealthRaw : null;

  const prevReach = prev["stacknet.health"]?.reachable ?? prev["stacknet.health"]?.ok;
  const currReach = curr["stacknet.health"]?.reachable ?? curr["stacknet.health"]?.ok;
  const currHttp =
    curr["stacknet.health"]?.httpError ??
    (!curr["stacknet.health"]?.ok ? curr["stacknet.health"]?.status : null);

  if (prevReach === true && currReach === false) {
    events.push(
      event({
        kind: "health",
        rank: "spike",
        title: "Health endpoint unreachable",
        summary: `Public /health probe failed${currHttp ? ` (HTTP ${currHttp})` : ""}. Transport blip — not the same as Stacknet reporting unhealthy.`,
        details: { from: "reachable", to: "unreachable", httpError: currHttp },
      }),
    );
  } else if (prevReach === false && currReach === true) {
    events.push(
      event({
        kind: "health",
        rank: "note",
        title: "Health endpoint recovered",
        summary: `Public /health is answering again${currHealth ? ` · status ${currHealth}` : ""}.`,
        details: { from: "unreachable", to: "reachable", status: currHealth },
      }),
    );
  } else if (prevHealth && currHealth && prevHealth !== currHealth) {
    const bad = currHealth !== "healthy";
    events.push(
      event({
        kind: "health",
        rank: bad ? "spike" : "note",
        title: bad ? "Network health degraded" : "Network health recovered",
        summary: `Status went ${prevHealth} → ${currHealth}.`,
        details: { from: prevHealth, to: currHealth },
      }),
    );
  }

  const prevModels = prev["stacknet.network"]?.models;
  const currModels = curr["stacknet.network"]?.models;
  const modelDiff = listDiff(prevModels, currModels);
  if (modelDiff.changed && !isScrapeFlap(prevModels, currModels, modelDiff)) {
    const n = modelDiff.added.length + modelDiff.removed.length;
    events.push(
      event({
        kind: "models",
        rank: rankForListChange(n),
        title: "Available AI models changed",
        summary: humanListChange("models", modelDiff),
        details: modelDiff,
      }),
    );
  }

  const prevCaps = prev["stacknet.network"]?.capabilities;
  const currCaps = curr["stacknet.network"]?.capabilities;
  const capDiff = listDiff(prevCaps, currCaps);
  if (capDiff.changed && !isScrapeFlap(prevCaps, currCaps, capDiff)) {
    const n = capDiff.added.length + capDiff.removed.length;
    events.push(
      event({
        kind: "capabilities",
        rank: rankForListChange(n),
        title: "What Geoff can do shifted",
        summary: humanListChange("powers", {
          added: capDiff.added.map(prettyCapability),
          removed: capDiff.removed.map(prettyCapability),
        }),
        details: {
          added: capDiff.added.map(prettyCapability),
          removed: capDiff.removed.map(prettyCapability),
          raw: capDiff,
        },
      }),
    );
  }

  // Engine-tier census — a NEW BASE means a new brain joined the relabeling machine.
  const prevFleet = fleetTaxonomyOf(prev["stacknet.network"]?.models);
  const currFleet = fleetTaxonomyOf(curr["stacknet.network"]?.models);
  if (prevFleet && currFleet) {
    const baseDiff = listDiff(prevFleet.bases, currFleet.bases);
    const lineDiff = listDiff(prevFleet.lines, currFleet.lines);
    if (baseDiff.changed || lineDiff.changed) {
      const newBrain = baseDiff.added.length > 0;
      events.push(
        event({
          kind: "fleet",
          rank: newBrain ? "spike" : "move",
          title: newBrain
            ? "A new engine tier joined the internal fleet"
            : "Internal model fleet reshaped",
          summary: [
            baseDiff.added.length ? `new engine base(s): ${baseDiff.added.join(", ")}` : null,
            baseDiff.removed.length ? `retired base(s): ${baseDiff.removed.join(", ")}` : null,
            lineDiff.added.length ? `new product line(s): ${lineDiff.added.join(", ")}` : null,
            lineDiff.removed.length ? `retired line(s): ${lineDiff.removed.join(", ")}` : null,
            `${currFleet.bases.length} bases × ${currFleet.lines.length} lines`,
          ]
            .filter(Boolean)
            .join(" · "),
          details: { bases: baseDiff, lines: lineDiff, fleet: currFleet },
        }),
      );
    }
  }

  // Zen ghost shelf — opencode's own anonymous free models.
  const prevZen = prev["opencode.zen"];
  const currZen = curr["opencode.zen"];
  if (prevZen?.ok && currZen?.ok) {
    const ghostDiff = listDiff(prevZen.ghostIds || [], currZen.ghostIds || []);
    const freeDiff = listDiff(prevZen.freeIds || [], currZen.freeIds || []);
    const idDiff = listDiff(prevZen.ids || [], currZen.ids || []);
    const flap = isScrapeFlap(prevZen.ids, currZen.ids, idDiff);
    if (!flap && (ghostDiff.changed || freeDiff.changed)) {
      const ghostMoved = ghostDiff.changed;
      events.push(
        event({
          kind: "zen",
          rank: ghostMoved ? "spike" : "note",
          title: ghostMoved
            ? ghostDiff.added.length
              ? "Ghost model appeared on opencode zen"
              : "Ghost model vanished from opencode zen"
            : "Zen free shelf reshuffled",
          summary: [
            ghostDiff.added.length ? `ghost +${ghostDiff.added.join(", ")}` : null,
            ghostDiff.removed.length ? `ghost -${ghostDiff.removed.join(", ")}` : null,
            freeDiff.changed
              ? `free shelf +${freeDiff.added.length}/-${freeDiff.removed.length}`
              : null,
            `${currZen.count} models · ${currZen.freeCount} free`,
          ]
            .filter(Boolean)
            .join(" · "),
          details: {
            ghosts: ghostDiff,
            free: freeDiff,
            count: currZen.count,
            fingerprint: { from: prevZen.fingerprint, to: currZen.fingerprint },
          },
        }),
      );
    }
  }

  const nodesPrev = prev["stacknet.network"]?.availableNodes;
  const nodesCurr = curr["stacknet.network"]?.availableNodes;
  if (isNumber(nodesPrev) && isNumber(nodesCurr) && nodesPrev !== nodesCurr) {
    const delta = Math.abs(nodesCurr - nodesPrev);
    events.push(
      event({
        kind: "network",
        rank: delta >= 3 ? "spike" : delta >= 2 ? "move" : "note",
        title: "Compute machines online changed",
        summary: `Live nodes ${nodesPrev} → ${nodesCurr}.`,
        details: {
          from: nodesPrev,
          to: nodesCurr,
          gpus: curr["stacknet.network"]?.totalGpus ?? null,
          availableVramGb: curr["stacknet.network"]?.availableVramGb ?? null,
        },
      }),
    );
  }

  const gpusPrev = prev["stacknet.network"]?.totalGpus;
  const gpusCurr = curr["stacknet.network"]?.totalGpus;
  if (isNumber(gpusPrev) && isNumber(gpusCurr) && gpusPrev !== gpusCurr) {
    const delta = Math.abs(gpusCurr - gpusPrev);
    events.push(
      event({
        kind: "network",
        rank: delta >= 2 ? "move" : "note",
        title: "GPU horsepower changed",
        summary: `GPUs available ${gpusPrev} → ${gpusCurr}.`,
        details: { from: gpusPrev, to: gpusCurr },
      }),
    );
  }

  if (!prev["geoff.catalog"]?.skipped && !curr["geoff.catalog"]?.skipped) {
    for (const [key, label] of [
      ["models", "Geoff catalog models"],
      ["tools", "Geoff catalog tools"],
      ["mcpTools", "Remote MCP tools"],
    ]) {
      const prevList = prev["geoff.catalog"]?.[key];
      const currList = curr["geoff.catalog"]?.[key];
      const diff = listDiff(prevList, currList);
      if (diff.changed && !isScrapeFlap(prevList, currList, diff)) {
        const n = diff.added.length + diff.removed.length;
        events.push(
          event({
            kind: "catalog",
            rank: rankForListChange(n),
            title: `${label} updated`,
            summary: humanListChange(label.toLowerCase(), diff),
            details: diff,
          }),
        );
      }
    }
  }

  // SOL noise: ignore penny noise — require ≥5% or $5
  const solPrev = prev["stacknet.network"]?.treasury?.solPriceUsd;
  const solCurr = curr["stacknet.network"]?.treasury?.solPriceUsd;
  if (isNumber(solPrev) && isNumber(solCurr) && solPrev > 0) {
    const abs = Math.abs(solCurr - solPrev);
    const pct = abs / solPrev;
    if (abs >= 5 || pct >= 0.05) {
      events.push(
        event({
          kind: "treasury",
          rank: pct >= 0.1 ? "note" : "whisper",
          title: "Treasury SOL mark moved",
          summary: `SOL ${solPrev} → ${solCurr} USD (${(pct * 100).toFixed(1)}%).`,
          details: { from: solPrev, to: solCurr, pct },
        }),
      );
    }
  }

  // Treasury rails beyond SOL mark — settlement / proofs scaffolding signals.
  const tPrev = prev["stacknet.network"]?.treasury || {};
  const tCurr = curr["stacknet.network"]?.treasury || {};
  if (tPrev.treasuryAddress && tCurr.treasuryAddress && tPrev.treasuryAddress !== tCurr.treasuryAddress) {
    events.push(
      event({
        kind: "treasury",
        rank: "spike",
        title: "Treasury wallet address changed",
        summary: `Published treasuryAddress moved ${String(tPrev.treasuryAddress).slice(0, 6)}… → ${String(tCurr.treasuryAddress).slice(0, 6)}…`,
        details: { from: tPrev.treasuryAddress, to: tCurr.treasuryAddress },
      }),
    );
  }
  if (tPrev.cluster && tCurr.cluster && tPrev.cluster !== tCurr.cluster) {
    events.push(
      event({
        kind: "treasury",
        rank: "move",
        title: "Treasury cluster flipped",
        summary: `Public treasury cluster ${tPrev.cluster} → ${tCurr.cluster}.`,
        details: { from: tPrev.cluster, to: tCurr.cluster },
      }),
    );
  }
  if (isNumber(tPrev.pendingObligations) && isNumber(tCurr.pendingObligations) && tPrev.pendingObligations !== tCurr.pendingObligations) {
    events.push(
      event({
        kind: "treasury",
        rank: tCurr.pendingObligations > 0 ? "note" : "whisper",
        title: "Treasury pending obligations moved",
        summary: `pendingObligations ${tPrev.pendingObligations} → ${tCurr.pendingObligations}.`,
        details: { from: tPrev.pendingObligations, to: tCurr.pendingObligations },
      }),
    );
  }
  if (isNumber(tPrev.totalUsd) && isNumber(tCurr.totalUsd) && tPrev.totalUsd !== tCurr.totalUsd) {
    events.push(
      event({
        kind: "treasury",
        rank: tCurr.totalUsd > 0 || tPrev.totalUsd > 0 ? "move" : "whisper",
        title: "Treasury totalUsd moved",
        summary: `totalUsd ${tPrev.totalUsd} → ${tCurr.totalUsd}.`,
        details: { from: tPrev.totalUsd, to: tCurr.totalUsd },
      }),
    );
  }
  if (isNumber(tPrev.staleSeconds) && isNumber(tCurr.staleSeconds)) {
    const woke = tPrev.staleSeconds < 120 && tCurr.staleSeconds >= 300;
    const fresh = tPrev.staleSeconds >= 300 && tCurr.staleSeconds < 120;
    if (woke || fresh) {
      events.push(
        event({
          kind: "treasury",
          rank: woke ? "note" : "whisper",
          title: woke ? "Treasury feed went stale" : "Treasury feed freshened",
          summary: `staleSeconds ${tPrev.staleSeconds} → ${tCurr.staleSeconds}.`,
          details: { from: tPrev.staleSeconds, to: tCurr.staleSeconds },
        }),
      );
    }
  }
  const warnPrev = Array.isArray(tPrev.warnings) ? tPrev.warnings.length : 0;
  const warnCurr = Array.isArray(tCurr.warnings) ? tCurr.warnings.length : 0;
  if (warnPrev !== warnCurr) {
    events.push(
      event({
        kind: "treasury",
        rank: warnCurr > warnPrev ? "note" : "whisper",
        title: "Treasury warnings changed",
        summary: `warnings ${warnPrev} → ${warnCurr}.`,
        details: { from: warnPrev, to: warnCurr, warnings: (tCurr.warnings || []).slice(0, 4) },
      }),
    );
  }

  // Independent chain check — Solana RPC vs StackNet's own treasury self-report.
  const prevChain = prev["solana.treasury"];
  const currChain = curr["solana.treasury"];
  if (prevChain?.ok && currChain?.ok) {
    const chainPrev = prevChain.lamports;
    const chainCurr = currChain.lamports;
    const repCurr = usdNumber(tCurr.totalLamports);
    if (isNumber(chainPrev) && isNumber(chainCurr) && chainPrev !== chainCurr) {
      const funded = chainPrev === 0 && chainCurr > 0;
      events.push(
        event({
          kind: "solana",
          rank: funded ? "spike" : "note",
          title: funded ? "Treasury wallet funded on-chain" : "Treasury balance moved on-chain",
          summary: `Independent Solana RPC: ${(chainPrev / 1e9).toFixed(9)} → ${(chainCurr / 1e9).toFixed(9)} SOL.`,
          details: { from: chainPrev, to: chainCurr, address: currChain.address },
        }),
      );
    } else if (isNumber(chainCurr) && isNumber(repCurr) && chainCurr !== repCurr) {
      events.push(
        event({
          kind: "solana",
          rank: "move",
          title: "Treasury self-report disagrees with chain",
          summary: `StackNet reports ${(repCurr / 1e9).toFixed(9)} SOL; the chain says ${(chainCurr / 1e9).toFixed(9)} SOL.`,
          details: { reportedLamports: repCurr, onChainLamports: chainCurr, address: currChain.address },
        }),
      );
    } else if (
      isNumber(prevChain.sigCount) &&
      isNumber(currChain.sigCount) &&
      currChain.sigCount > prevChain.sigCount
    ) {
      events.push(
        event({
          kind: "solana",
          rank: "whisper",
          heat: 0,
          title: "Treasury wallet activity",
          summary: `Signature count ${prevChain.sigCount} → ${currChain.sigCount}${currChain.latestActivityAt ? ` · latest ${currChain.latestActivityAt}` : ""}.`,
          details: { from: prevChain.sigCount, to: currChain.sigCount },
        }),
      );
    }
  }

  const prevApiIds = prev["stacknet.models"]?.ids;
  const currApiIds = curr["stacknet.models"]?.ids;
  const apiModelDiff = listDiff(prevApiIds, currApiIds);
  if (apiModelDiff.changed && !isScrapeFlap(prevApiIds, currApiIds, apiModelDiff)) {
    const n = apiModelDiff.added.length + apiModelDiff.removed.length;
    events.push(
      event({
        kind: "apiModels",
        rank: rankForListChange(n),
        title: "Public model menu changed",
        summary: humanListChange("API models", apiModelDiff),
        details: apiModelDiff,
      }),
    );
  } else if (prev["stacknet.models"]?.models && curr["stacknet.models"]?.models) {
    const capShifts = diffModelCapabilities(
      prev["stacknet.models"].models,
      curr["stacknet.models"].models,
    );
    if (capShifts.length) {
      events.push(
        event({
          kind: "apiModels",
          rank: capShifts.length >= 3 ? "move" : "note",
          title: "Model capabilities shifted",
          summary: capShifts
            .slice(0, 3)
            .map((s) => `${s.id}: ${s.summary}`)
            .join(" · "),
          details: { shifts: capShifts },
        }),
      );
    }
  }

  const prevWidgetIds = prev["stacknet.widgets"]?.ids;
  const currWidgetIds = curr["stacknet.widgets"]?.ids;
  const widgetDiff = listDiff(prevWidgetIds, currWidgetIds);
  if (widgetDiff.changed && !isScrapeFlap(prevWidgetIds, currWidgetIds, widgetDiff)) {
    const n = widgetDiff.added.length + widgetDiff.removed.length;
    events.push(
      event({
        kind: "widgets",
        rank: rankForListChange(n),
        title: "Answer widgets catalog changed",
        summary: humanListChange("widgets", widgetDiff),
        details: widgetDiff,
      }),
    );
  }

  // Measurable agent / queue activity (not invented identity)
  const agentEvt = agentActivityEvent(previous, current);
  if (agentEvt) events.push(agentEvt);

  // Same-sniff surface cluster → labeled speculation (heat 0 so it doesn't double-count)
  const clusterEvt = agentClusterEvent(events);
  if (clusterEvt) events.push(clusterEvt);

  return events;
}

function agentActivityEvent(previous, current) {
  const prevFlight = previous.summary?.inFlight;
  const currFlight = current.summary?.inFlight;
  const maxFlight = current.summary?.maxInFlight;
  const prevTasks = previous.summary?.taskCount ?? previous.sources?.["stacknet.node"]?.taskCount;
  const currTasks = current.summary?.taskCount ?? current.sources?.["stacknet.node"]?.taskCount;
  const prevLoad = previous.summary?.averageLoad;
  const currLoad = current.summary?.averageLoad;

  // High bar — 0↔1↔2 flaps every 15s were flooding the desk (1000+ "updates").
  const wokeUp =
    isNumber(prevFlight) && prevFlight === 0 && isNumber(currFlight) && currFlight >= 3;
  const wentIdle =
    isNumber(prevFlight) && prevFlight >= 3 && isNumber(currFlight) && currFlight === 0;
  const flightJump =
    isNumber(prevFlight) && isNumber(currFlight) && Math.abs(currFlight - prevFlight) >= 4;
  const taskJump =
    isNumber(prevTasks) && isNumber(currTasks) && Math.abs(currTasks - prevTasks) >= 2;
  const loadJump =
    isNumber(prevLoad) && isNumber(currLoad) && Math.abs(currLoad - prevLoad) >= 0.15;

  if (!wokeUp && !wentIdle && !flightJump && !taskJump && !loadJump) return null;

  const signals = [];
  if (isNumber(prevFlight) && isNumber(currFlight) && currFlight !== prevFlight) {
    signals.push(
      isNumber(maxFlight)
        ? `in-flight ${prevFlight} → ${currFlight} (max ${maxFlight})`
        : `in-flight ${prevFlight} → ${currFlight}`,
    );
  } else if (isNumber(currFlight)) {
    signals.push(
      isNumber(maxFlight) ? `in-flight ${currFlight}/${maxFlight}` : `in-flight ${currFlight}`,
    );
  }
  if (taskJump) signals.push(`node tasks ${prevTasks} → ${currTasks}`);
  if (loadJump) signals.push(`avg load ${prevLoad} → ${currLoad}`);

  const heavy =
    (isNumber(currFlight) && isNumber(maxFlight) && maxFlight > 0 && currFlight / maxFlight >= 0.05) ||
    (isNumber(currFlight) && currFlight >= 8) ||
    (flightJump && Math.abs(currFlight - prevFlight) >= 8);

  let rank = "note";
  let title = "Queue metrics shifted";
  if (wokeUp) {
    title = "Queue woke up";
    rank = heavy ? "move" : "note";
  } else if (wentIdle) {
    title = "Queue went quiet";
    rank = "whisper";
  } else if (heavy) {
    title = "Queue looks busy";
    rank = "move";
  }

  return event({
    kind: "agent",
    rank,
    // Queue/in-flight telemetry is its own dataset — never heats the change feed.
    heat: 0,
    title,
    summary: `Measured from public Stacknet counters: ${signals.join(" · ")}. No private agent transcript — just queue/load telemetry.`,
    details: {
      inferred: true,
      dataset: "queue",
      inFlight: currFlight,
      maxInFlight: maxFlight,
      taskCount: currTasks ?? null,
      averageLoad: currLoad ?? null,
      signals,
    },
  });
}

function agentClusterEvent(events) {
  const surface = events.filter((e) =>
    [
      "deploy",
      "version",
      "models",
      "apiModels",
      "widgets",
      "capabilities",
      "catalog",
      "fleet",
      "zen",
      "metaproofs",
    ].includes(e.kind),
  );
  if (surface.length < 2) return null;

  const hasCrazy = surface.some((e) => e.rank === "crazy");
  const hasSpike = surface.some((e) => e.rank === "spike");
  const rank = hasCrazy ? "crazy" : hasSpike ? "spike" : "move";

  const bullets = surface.map((e) => `${e.kind}: ${e.title}`);
  return event({
    kind: "agentCluster",
    rank,
    heat: 0, // narrative only — underlying events already carry the heat
    title:
      rank === "crazy"
        ? "Cluster drop — something big just landed"
        : rank === "spike"
          ? "Agent desk cluster"
          : "Same-sniff change cluster",
    summary: `This sniff saw ${surface.length} surface changes together. Inferred cluster (public diffs only): ${bullets.join(" · ")}`,
    details: {
      inferred: true,
      disclaimer:
        "Not claiming a named agent identity — clustering measurable public diffs that arrived in one sniff.",
      kinds: surface.map((e) => e.kind),
      titles: bullets,
    },
  });
}

/**
 * Live "agent desk" card from current counters + optional new events.
 * Always measurable; speculation is labeled.
 */
export function inferAgentDesk(latest, newEvents = []) {
  if (!latest) return null;
  const inFlight = latest.summary?.inFlight;
  const maxInFlight = latest.summary?.maxInFlight;
  const taskCount = latest.summary?.taskCount ?? latest.sources?.["stacknet.node"]?.taskCount;
  const load = latest.summary?.averageLoad;
  const signals = [];

  if (isNumber(inFlight)) {
    signals.push({
      key: "in_flight",
      label: "In-flight jobs",
      value: isNumber(maxInFlight) ? `${inFlight} / ${maxInFlight}` : String(inFlight),
      raw: inFlight,
    });
  }
  if (isNumber(taskCount)) {
    signals.push({
      key: "task_count",
      label: "Node task count",
      value: String(taskCount),
      raw: taskCount,
    });
  }
  if (isNumber(load)) {
    signals.push({
      key: "average_load",
      label: "Average load",
      value: String(load),
      raw: load,
    });
  }

  const surface = newEvents.filter((e) =>
    [
      "deploy",
      "version",
      "models",
      "apiModels",
      "widgets",
      "capabilities",
      "catalog",
      "docs",
      "explore",
      "maxSolana",
      "productLanes",
      "pricing",
    ].includes(e.kind),
  );
  const clustered = surface.length >= 2;

  const busy = isNumber(inFlight) && inFlight > 0;
  const disclaimer =
    "Queue counters from public Stacknet /health + /node only. Not private agent transcripts. No invented identity.";

  if (!busy && !clustered) {
    return {
      status: "quiet",
      headline: "Queue quiet",
      sentence: isNumber(inFlight)
        ? `in_flight = ${inFlight} on public health.`
        : "No in_flight counter in this sniff.",
      signals,
      cluster: [],
      disclaimer,
    };
  }

  let status = "watching";
  let headline = "Watching the queue";
  let sentence = "Public counters are live; nothing clustered yet.";

  if (busy) {
    status = "busy";
    headline = "Queue has work";
    sentence = isNumber(maxInFlight)
      ? `${inFlight} in flight (max ${maxInFlight}) — measured on /health.`
      : `${inFlight} in flight — measured on /health (max not published).`;
  }
  if (clustered) {
    status = busy ? "busy_cluster" : "cluster";
    headline = busy ? "Queue busy + same-sniff diffs" : "Same-sniff public diffs";
    sentence = busy
      ? `${sentence} Also ${surface.length} surface diffs in this sniff (clustered, not an agent name).`
      : `${surface.length} surface changes in one sniff — clustered from public diffs only.`;
  }

  return {
    status,
    headline,
    sentence,
    signals,
    cluster: surface.map((e) => ({
      kind: e.kind,
      rank: e.rank,
      title: e.title,
      summary: e.summary,
    })),
    disclaimer,
  };
}

function diffModelCapabilities(before = [], after = []) {
  const prevMap = new Map(before.map((m) => [m.id, m]));
  const shifts = [];
  for (const model of after) {
    const prevModel = prevMap.get(model.id);
    if (!prevModel) continue;
    const caps = listDiff(prevModel.capabilities, model.capabilities);
    const types = listDiff(prevModel.contentTypes, model.contentTypes);
    if (!caps.changed && !types.changed) continue;
    const bits = [];
    if (caps.added.length) bits.push(`+caps ${caps.added.join(", ")}`);
    if (caps.removed.length) bits.push(`-caps ${caps.removed.join(", ")}`);
    if (types.added.length) bits.push(`+types ${types.added.join(", ")}`);
    if (types.removed.length) bits.push(`-types ${types.removed.join(", ")}`);
    shifts.push({ id: model.id, summary: bits.join("; "), caps, types });
  }
  return shifts;
}

export const TRACK_WINDOW_HOURS = 72;
const TRACK_WINDOW_MS = TRACK_WINDOW_HOURS * 60 * 60 * 1000;

export function computeTemperature(events, latestSnapshot) {
  const now = Date.now();
  const recent = events.filter((e) => now - Date.parse(e.at) < TRACK_WINDOW_MS);
  // Ignore whisper/baseline/zero-heat narrative clusters in the heat math
  const meaningful = recent.filter(
    (e) =>
      (e.heat || 0) > 0 &&
      e.kind !== "baseline" &&
      e.kind !== "agentCluster" &&
      e.kind !== "agent", // in-flight / load / tasks = queue tape, not updates
  );

  const decayed = meaningful.reduce((acc, e) => {
    const ageH = (now - Date.parse(e.at)) / 3_600_000;
    const rankBoost = e.rank === "crazy" ? 1.25 : e.rank === "spike" ? 1.05 : 1;
    // Heat fades across the full 72h tape — recent still dominates
    return acc + (e.heat || 1) * rankBoost * Math.max(0.12, 1 - ageH / TRACK_WINDOW_HOURS);
  }, 0);

  let temp = Math.min(100, Math.round(decayed * 2.8));
  // No fake warmth floors — 0 means no ranked heat in the window

  // Only crazy/spike in the last 6h can force warmer bands from real events
  const recentHot = recent.filter(
    (e) =>
      now - Date.parse(e.at) < 6 * 60 * 60 * 1000 &&
      e.kind !== "agentCluster" &&
      e.kind !== "agent" &&
      (e.heat || 0) > 0,
  );
  if (recentHot.some((e) => e.rank === "crazy")) temp = Math.max(temp, 58);
  else if (recentHot.some((e) => e.rank === "spike")) temp = Math.max(temp, 38);

  return {
    value: temp,
    label: temperatureLabel(temp),
    recentEventCount: recent.length,
    trackWindowHours: TRACK_WINDOW_HOURS,
    basis: "ranked public diffs only — not a sensor, no padded floors",
  };
}

function temperatureLabel(value) {
  if (value >= 75) return "blazing";
  if (value >= 50) return "hot";
  if (value >= 30) return "warming";
  if (value >= 10) return "steady";
  if (value > 0) return "cool";
  return "flat";
}

function humanListChange(noun, { added, removed }) {
  const parts = [];
  if (added.length) parts.push(`+${added.length} ${noun}: ${preview(added)}`);
  if (removed.length) parts.push(`-${removed.length} ${noun}: ${preview(removed)}`);
  return parts.join(" · ") || `No net ${noun} change`;
}

function preview(items, limit = 4) {
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")} (+${items.length - limit} more)`;
}

function prettyCapability(cap) {
  const map = {
    "ai-prompt": "AI prompt",
    "chat-completion": "Chat completion",
    "coder-execute": "Coder execute",
    "coder-session": "Coder sessions",
    "coder-tool": "Coder tools",
    "e2b-code": "E2B code",
    "e2b-execute": "E2B execute",
    "hw:gpu": "GPU hardware",
    "image-edit-pipeline": "Image edit pipeline",
    "image-pipeline": "Image pipeline",
    image_editing: "Image editing",
    image_generation: "Image generation",
    "mcp-tool": "MCP tools",
    "media-analyze": "Media analyze",
    "media-generate": "Media generate",
    "media-orchestration": "Media orchestration",
    media_generation: "Media generation",
    "music-pipeline": "Music pipeline",
    "runtime:shell": "Shell runtime",
    "sequential-thinking": "Sequential thinking",
    "sizzle-video-pipeline": "Sizzle video pipeline",
    "skill-auto-execute": "Skill auto-execute",
    style_transfer: "Style transfer",
    "tts-stream": "TTS stream",
    "tts-synthesize": "TTS synthesize",
    video_generation: "Video generation",
    "voice-session": "Voice sessions",
  };
  return map[cap] || cap.replace(/[-_]/g, " ");
}

function short(id) {
  if (!id || id.length < 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function usdNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function fmtUsd(n) {
  if (!isNumber(n)) return String(n);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function fleetTaxonomyOf(models = []) {
  if (!Array.isArray(models)) return null;
  const bases = new Set();
  const lines = new Set();
  for (const id of models) {
    const m = /^stack-([a-z0-9]+)-([a-z0-9:.+-]+)$/.exec(String(id));
    if (m) {
      lines.add(m[1]);
      bases.add(m[2]);
    } else {
      bases.add(String(id));
    }
  }
  return { bases: [...bases].sort(), lines: [...lines].sort() };
}

export { prettyCapability, RANK };
