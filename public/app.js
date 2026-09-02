window.onerror = function(msg, src, line, col, err) {
  const el = document.getElementById("paperworkMeta");
  if (el) el.textContent = "ERROR: " + msg + " @line " + line;
  console.error("GLOBAL:", msg, "line", line, err);
};
import { icon } from "./icons.js";
import { CLIENT_TOKEN_PLAN } from "./token-plan-fallback.js";
import {
  DEFAULT_HEATMAP_DAYS,
  buildHeatmapGrid,
  mergeDailyActivity,
  pruneDailyActivity,
  upsertDailyActivity,
} from "./daily-activity.js";

const STORAGE_KEY = "geoff-thermometer-v7";
const RANK_WEIGHT = { crazy: 5, spike: 4, move: 3, note: 2, whisper: 1 };
const VIBE = { crazy: "Crazy", spike: "Spike", move: "Move", note: "Note", whisper: "Whisper" };
const TRACK_HOURS = 72;
const TRACK_MS = TRACK_HOURS * 60 * 60 * 1000;
const FEED_RECENT_LIMIT = 20;
const MAX_MEMORY_EVENTS = 2000;
const HEATMAP_DAYS = DEFAULT_HEATMAP_DAYS;
const MAX_DAILY_INGEST_IDS = 800;

/** Website deploys = Note. Spike/Crazy are rare. Never trust "Big deal". */
function inferRank(e = {}) {
  const blob = `${e.title || ""} ${e.summary || ""}`;
  if (/full-stack ship/i.test(blob)) return "crazy";
  if (e.kind === "baseline" || e.kind === "treasury" || e.kind === "metaproofs") return "whisper";
  if (e.kind === "docs") return "note";
  if (e.kind === "explore") {
    const n = (e.details?.added?.length || 0) + (e.details?.removed?.length || 0);
    if (/reshuffl/i.test(blob)) return "whisper";
    if (n >= 8) return "spike";
    if (n >= 3) return "move";
    if (n >= 1) return "note";
    return "note";
  }
  if (e.kind === "maxSolana" || e.kind === "productLanes") return "move";
  if (e.kind === "agent") return "note";
  if (e.kind === "agentCluster") {
    if (/crazy|full-stack/i.test(blob)) return "crazy";
    if (/spike/i.test(blob)) return "spike";
    return "move";
  }
  if (e.kind === "deploy") return "note";
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
    if (n >= 8) return "crazy";
    if (n >= 5) return "spike";
    if (n >= 2) return "move";
    if (n >= 1) return "note";
    const m = blob.match(/\+(\d+)/);
    if (m) {
      const c = Number(m[1]);
      if (c >= 8) return "crazy";
      if (c >= 5) return "spike";
      if (c >= 2) return "move";
      return "note";
    }
    return "note";
  }
  if (e.severity === "high" || e.severity === "medium") return "note";
  if (e.severity === "low" || e.severity === "info") return "whisper";
  return "note";
}

function displayVibe(e) {
  // Always derive from rank. Never paint legacy "Big deal" / "Notable" even if server sends them.
  return VIBE[inferRank(e)] || "Note";
}

function deployFingerprint(e) {
  const d = e.details || {};
  const to = d.to || d.build?.to || d.deploy?.to || d.chunks?.to || e.summary || e.title || "";
  const from = d.from || d.build?.from || d.deploy?.from || d.chunks?.from || "";
  return `${e.kind}|${from}|${to}|${(e.title || "").replace(/\s+/g, " ").slice(0, 48)}`;
}

function dedupeDeployBursts(events = []) {
  const sorted = [...events].sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  const used = new Set();
  const seen = new Set();
  const out = [];
  for (const e of sorted) {
    if (!e?.id || used.has(e.id)) continue;
    if (e.kind !== "deploy") {
      if (
        ["health", "version", "models", "apiModels", "widgets", "capabilities", "catalog"].includes(
          e.kind,
        )
      ) {
        const fp = deployFingerprint(e);
        if (seen.has(fp)) {
          used.add(e.id);
          continue;
        }
        seen.add(fp);
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
    const keep = siblings.find((s) => /shipped|build/i.test(s.title || "")) || siblings[0] || e;
    const rank = inferRank({ ...keep, kind: "deploy", title: "Geoff website shipped" });
    const item = {
      ...keep,
      rank,
      vibe: VIBE[rank],
      title: siblings.length > 1 ? "Geoff website shipped" : keep.title,
      summary:
        siblings.length > 1
          ? `Coalesced ${siblings.length} deploy signals: ${siblings.map((s) => s.title).join(" · ")}`
          : keep.summary,
    };
    const fp = deployFingerprint(item);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(item);
  }
  return out;
}

function isFlapEvent(e) {
  if (e.kind === "fleet") {
    const added = (e.details?.bases?.added?.length || 0) +
      (e.details?.lines?.added?.length || 0);
    const removed = (e.details?.bases?.removed?.length || 0) +
      (e.details?.lines?.removed?.length || 0);
    if (removed === 0 && added >= 4) return true;
    if (added === 0 && removed >= 4) return true;
  }
  if (
    !["models", "apiModels", "widgets", "capabilities", "catalog"].includes(e.kind)
  ) {
    // Drop poisoned health events that treated HTTP codes as Stacknet status.
    if (e.kind === "health") {
      const blob = `${e.title || ""} ${e.summary || ""}`;
      if (/healthy\s*→\s*\d{3}|\d{3}\s*→\s*healthy/i.test(blob)) return true;
      if (/Status went .*\d{3}/i.test(blob) && /degraded|recovered/i.test(blob)) return true;
    }
    return false;
  }
  const added = e.details?.added?.length || e.details?.raw?.added?.length || 0;
  const removed = e.details?.removed?.length || e.details?.raw?.removed?.length || 0;
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

function normalizeFeedEvents(events = []) {
  return dedupeDeployBursts(
    events
      .filter((e) => !isFlapEvent(e))
      .map((e) => {
        const rank = inferRank(e);
        return { ...e, rank, vibe: displayVibe({ ...e, rank }) };
      }),
  );
}
const els = {
  pollBtn: document.getElementById("pollBtn"),
  connection: document.getElementById("connection"),
  mercury: document.getElementById("mercury"),
  tempValue: document.getElementById("tempValue"),
  tempLabel: document.getElementById("tempLabel"),
  tempMeta: document.getElementById("tempMeta"),
  tempPlain: document.getElementById("tempPlain"),
  spark: document.getElementById("spark"),
  pumpMeta: document.getElementById("pumpMeta"),
  pumpStats: document.getElementById("pumpStats"),
  pumpChart: document.getElementById("pumpChart"),
  heatMeta: document.getElementById("heatMeta"),
  heatGrid: document.getElementById("heatGrid"),
  heatMonths: document.getElementById("heatMonths"),
  stackVersion: document.getElementById("stackVersion"),
  stackHealth: document.getElementById("stackHealth"),
  stackNodes: document.getElementById("stackNodes"),
  stackLoad: document.getElementById("stackLoad"),
  stacknetChangeNotice: document.getElementById("stacknetChangeNotice"),
  vramText: document.getElementById("vramText"),
  vramBar: document.getElementById("vramBar"),
  geoffBuild: document.getElementById("geoffBuild"),
  geoffDeploy: document.getElementById("geoffDeploy"),
  modelCount: document.getElementById("modelCount"),
  apiModelCount: document.getElementById("apiModelCount"),
  pileValue: document.getElementById("pileValue"),
  pileMeta: document.getElementById("pileMeta"),
  paperworkUsd: document.getElementById("paperworkUsd"),
  paperworkMeta: document.getElementById("paperworkMeta"),
  paperworkStatus: document.getElementById("paperworkStatus"),
  paperSupply: document.getElementById("paperSupply"),
  trixGeoffCount: document.getElementById("trixGeoffCount"),
  trixGeoffMeta: document.getElementById("trixGeoffMeta"),
  trixGeoffReceipt: document.getElementById("trixGeoffReceipt"),
  trixPacksMinted: document.getElementById("trixPacksMinted"),
  trixPacksMeta: document.getElementById("trixPacksMeta"),
trixPackMarket: document.getElementById("trixPackMarket"),
  trixPackTraits: document.getElementById("trixPackTraits"),
  trixMarketCount: document.getElementById("trixMarketCount"),
  trixMarketMeta: document.getElementById("trixMarketMeta"),
  trixMarketStats: document.getElementById("trixMarketStats"),
  pond0xMiners: document.getElementById("pond0xMiners"),
  pond0xMeta: document.getElementById("pond0xMeta"),
  keysoldUsd: document.getElementById("keysoldUsd"),
  keysoldMeta: document.getElementById("keysoldMeta"),
  trafficMini: document.getElementById("trafficMini"),
  settleBanner: document.getElementById("settleBanner"),
  oxAlphaSpec: document.getElementById("oxAlphaSpec"),
  oxAlphaMeta: document.getElementById("oxAlphaMeta"),
  zenErrStatus: document.getElementById("zenErrStatus"),
  zenErrMeta: document.getElementById("zenErrMeta"),
  ghostCount: document.getElementById("ghostCount"),
  ghostMeta: document.getElementById("ghostMeta"),
  fleetCount: document.getElementById("fleetCount"),
  fleetLinesText: document.getElementById("fleetLinesText"),
  x402Downloads: document.getElementById("x402Downloads"),
  x402Meta: document.getElementById("x402Meta"),
  subscriptionCount: document.getElementById("subscriptionCount"),
  subscriptionMeta: document.getElementById("subscriptionMeta"),
  docsCue: document.getElementById("docsCue"),
  docsCueLink: document.getElementById("docsCueLink"),
  lanesCue: document.getElementById("lanesCue"),
  lanesCueLink: document.getElementById("lanesCueLink"),
  probeMeta: document.getElementById("probeMeta"),
  probeLog: document.getElementById("probeLog"),
  maxCue: document.getElementById("maxCue"),
  maxCueLink: document.getElementById("maxCueLink"),
  story: document.getElementById("story"),
  storyHeadline: document.getElementById("storyHeadline"),
  storySentence: document.getElementById("storySentence"),
  agentDesk: document.getElementById("agentDesk"),
  agentHeadline: document.getElementById("agentHeadline"),
  agentSentence: document.getElementById("agentSentence"),
  agentSignals: document.getElementById("agentSignals"),
  agentCluster: document.getElementById("agentCluster"),
  agentDisclaimer: document.getElementById("agentDisclaimer"),
  coverageMeta: document.getElementById("coverageMeta"),
  coverageChips: document.getElementById("coverageChips"),
  coverageNotes: document.getElementById("coverageNotes"),
  hpHeadline: document.getElementById("hpHeadline"),
  hpMeta: document.getElementById("hpMeta"),
  hpSentence: document.getElementById("hpSentence"),
  hpScore: document.getElementById("hpScore"),
  hpCompute: document.getElementById("hpCompute"),
  hpLanes: document.getElementById("hpLanes"),
  hpBrains: document.getElementById("hpBrains"),
  hpTools: document.getElementById("hpTools"),
  hpBlocked: document.getElementById("hpBlocked"),
  priceHeadline: document.getElementById("priceHeadline"),
  priceMeta: document.getElementById("priceMeta"),
  priceSentence: document.getElementById("priceSentence"),
  priceWins: document.getElementById("priceWins"),
  pricePlans: document.getElementById("pricePlans"),
  priceYield: document.getElementById("priceYield"),
  priceSheet: document.getElementById("priceSheet"),
  priceLimits: document.getElementById("priceLimits"),
  priceSource: document.getElementById("priceSource"),
  pieces: document.getElementById("pieces"),
  capGroups: document.getElementById("capGroups"),
  capMeta: document.getElementById("capMeta"),
  feed: document.getElementById("feed"),
  queueFeed: document.getElementById("queueFeed"),
  queueMeta: document.getElementById("queueMeta"),
  queueFeed: document.getElementById("queueFeed"),
  queueMeta: document.getElementById("queueMeta"),
  modelCards: document.getElementById("modelCards"),
  widgets: document.getElementById("widgets"),
  glossary: document.getElementById("glossary"),
  models: document.getElementById("models"),
};

const PIECE_ICONS = {
  app: "app",
  network: "network",
  brains: "brain",
  tools: "tools",
  docs: "book",
  explore: "spark",
  productLanes: "layers",
  publicSurfaces: "activity",
  maxSolana: "bolt",
};
const CAP_ICONS = {
  chat: "chat",
  media: "image",
  audio: "music",
  code: "code",
  infra: "chip",
  other: "spark",
};
const EVENT_ICONS = {
  deploy: "rocket",
  version: "layers",
  models: "brain",
  apiModels: "brain",
  capabilities: "bolt",
  widgets: "blocks",
  network: "server",
  health: "pulse",
  catalog: "layers",
  treasury: "spark",
  baseline: "activity",
  agent: "bolt",
  agentCluster: "spark",
  pricing: "tag",
  docs: "book",
  explore: "spark",
  productLanes: "layers",
  maxSolana: "bolt",
  subscription: "tag",
  pile: "layers",
  x402: "bolt",
  metaproofs: "layers",
  keysale: "tag",
  solana: "pulse",
  trixGeoff: "image",
};

let mode = "local";
let memory = loadMemory();
// Persist upgrade seed (72h events → day cubes) so a refresh keeps the map.
try {
  if (memory.dailyActivity?.length) saveMemory();
} catch {
  /* ignore */
}

function emptyMemory() {
  return {
    latest: null,
    events: [],
    temps: [],
    agentSamples: [],
    dailyActivity: [],
    dailyIngestedIds: [],
    probeSamples: [],
    pollCount: 0,
  };
}

function loadMemory() {
  // Kill poisoned hyped histories from older clients
  for (const key of [
    "geoff-thermometer-v1",
    "geoff-thermometer-v2",
    "geoff-thermometer-v3",
    "geoff-thermometer-v4",
    "geoff-thermometer-v5",
    "geoff-thermometer-v6",
  ]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw) return emptyMemory();
    const mem = {
      ...emptyMemory(),
      ...raw,
      events: normalizeFeedEvents(raw.events || []),
      temps: normalizeTempSeries(raw.temps),
      agentSamples: Array.isArray(raw.agentSamples) ? raw.agentSamples : [],
      dailyActivity: pruneDailyActivity(raw.dailyActivity || [], HEATMAP_DAYS),
      dailyIngestedIds: Array.isArray(raw.dailyIngestedIds)
        ? raw.dailyIngestedIds.slice(0, MAX_DAILY_INGEST_IDS)
        : [],
      probeSamples: Array.isArray(raw.probeSamples) ? raw.probeSamples.slice(0, 3) : [],
    };
    // First visit after upgrade: seed cubes from whatever 72h events we still hold.
    if (!mem.dailyActivity.length && mem.events.length) {
      const seen = new Set(mem.dailyIngestedIds);
      mem.dailyActivity = upsertDailyActivity([], mem.events, {
        heatmapDays: HEATMAP_DAYS,
        seenIds: seen,
      });
      mem.dailyIngestedIds = Array.from(seen).slice(0, MAX_DAILY_INGEST_IDS);
    }
    return mem;
  } catch {
    return emptyMemory();
  }
}

function ingestDailyFromEvents(events = []) {
  if (!events.length) return;
  const seen = new Set(memory.dailyIngestedIds || []);
  memory.dailyActivity = upsertDailyActivity(memory.dailyActivity || [], events, {
    heatmapDays: HEATMAP_DAYS,
    seenIds: seen,
  });
  memory.dailyIngestedIds = Array.from(seen).slice(-MAX_DAILY_INGEST_IDS);
}

function fmtDayLabel(dayKey) {
  if (!dayKey) return "—";
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function renderHeatmap(rows = []) {
  if (!els.heatGrid) return;
  const grid = buildHeatmapGrid(rows, HEATMAP_DAYS);
  const activeDays = (rows || []).filter((r) => r.count > 0).length;
  const totalMoves = (rows || []).reduce((a, r) => a + (r.count || 0), 0);
  const heatSum = (rows || []).reduce((a, r) => a + (r.heat || 0), 0);

  if (els.heatMeta) {
    els.heatMeta.textContent = totalMoves
      ? `${activeDays} active days · ${totalMoves} moves · heat ${heatSum} · last ${HEATMAP_DAYS}d`
      : `No cubes yet · history grows past 72h as sniffs land (kept ${HEATMAP_DAYS} days)`;
  }

  // Month labels aligned to week columns
  if (els.heatMonths) {
    const labels = [];
    let lastMonth = "";
    grid.weeks.forEach((week, wi) => {
      const first = week.find((c) => c);
      if (!first) {
        labels.push(`<span style="grid-column:${wi + 1}"></span>`);
        return;
      }
      const [y, m] = first.day.split("-");
      const month = new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, {
        month: "short",
      });
      if (month !== lastMonth) {
        labels.push(`<span style="grid-column:${wi + 1}">${escapeHtml(month)}</span>`);
        lastMonth = month;
      } else {
        labels.push(`<span style="grid-column:${wi + 1}"></span>`);
      }
    });
    els.heatMonths.style.gridTemplateColumns = `repeat(${grid.weeks.length}, var(--heat-cell))`;
    els.heatMonths.innerHTML = labels.join("");
  }

  els.heatGrid.style.gridTemplateColumns = `repeat(${grid.weeks.length}, var(--heat-cell))`;
  els.heatGrid.innerHTML = grid.weeks
    .map((week) => {
      const cells = week
        .map((cell) => {
          if (!cell) return `<span class="heat-cell pad" aria-hidden="true"></span>`;
          const title = cell.count
            ? `${fmtDayLabel(cell.day)} · ${cell.count} moves · heat ${cell.heat}${
                cell.crazy ? ` · ${cell.crazy} crazy` : ""
              }${cell.spike ? ` · ${cell.spike} spike` : ""}`
            : `${fmtDayLabel(cell.day)} · no ranked moves`;
          return `<button type="button" class="heat-cell lvl${cell.level}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"></button>`;
        })
        .join("");
      return `<div class="heat-week">${cells}</div>`;
    })
    .join("");
}

function normalizeTempSeries(temps) {
  if (!Array.isArray(temps)) return [];
  return temps
    .map((t) =>
      typeof t === "number"
        ? { at: new Date().toISOString(), value: t }
        : { at: t.at || new Date().toISOString(), value: Number(t.value) || 0 },
    )
    .filter((t) => Number.isFinite(t.value));
}

function pruneWindow(list, getAt = (x) => x.at) {
  const cutoff = Date.now() - TRACK_MS;
  return (list || []).filter((item) => {
    const t = Date.parse(getAt(item));
    return Number.isFinite(t) && t >= cutoff;
  });
}

function saveMemory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
}

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    const name = node.getAttribute("data-icon");
    if (!name || node.dataset.hydrated === "1") return;
    node.innerHTML = icon(name);
    node.dataset.hydrated = "1";
  });
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function short(value, head = 8, tail = 6) {
  if (!value && value !== 0) return "—";
  const s = String(value);
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setConnection(state, label) {
  els.connection.className = `pill ${state}`;
  els.connection.textContent = label;
  updateHypothesisBadge();
}

function updateHypothesisBadge() {
  const badge = document.getElementById("hypothesisBadge");
  if (!badge) return;
  // Determine status from latest data
  const s = lastLatest?.summary ?? {};
  const ze = s.zenErrLeakHit;
  const oxSpec = s.oxAlphaSpec || s.goLadder?.find?.(r => r.name === "Ox Alpha Free" || r.name === "x-preview-f-free");
  const syncActive = s.syncStatus === "SYNC";

  let text = "HYPOTHESIS: Ox Alpha = Geoff-spun Z.ai wrapper";
  let status = "ACTIVE";

  if (ze?.leakHit) {
    status = "LEAK DETECTED";
    text += " | LEAK DETECTED";
  } else if (syncActive) {
    status = "SYNC DETECTED";
    text += " | SYNC DETECTED";
  } else if (oxSpec?.knowledge) {
    status = "SPEC CHANGE";
    text += " | SPEC CHANGE";
  }

  badge.textContent = `${text} | ${status}`;
  badge.hidden = false;
}

function setTrust(payload) {
  const el = document.getElementById("trustMode");
  if (!el) return;
  const shared = Boolean(
    payload?.config?.sharedStore ||
      payload?.config?.trustMode === "shared" ||
      payload?.config?.trustMode === "universal",
  );
  const backend = payload?.config?.sharedStoreBackend || "";
  el.className = `pill trust ${shared ? "shared" : "local"}`;
  el.textContent = shared ? "universal live" : "local desk";
  el.title = shared
    ? `One live desk for every browser · ${backend || "shared"} · ${payload?.config?.sharedStoreUrl || ""}`
    : "Local file desk — this machine only";
}

function fmtCompactUsd(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtCompactNumber(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

/* ---- Proof popups · receipts behind every metric ---- */
const SN_BASE = "https://stacknet.magma-rpc.com";
let lastLatest = null;
const SOLANA_DEFAULT = "D2KL4HWbc5URqBti9XLf2DwtiDYJs9wbX6z7tyWLoiH2";

const PROOFS = {
  stackVersion: {
    title: "Stacknet version",
    explain:
      "Self-reported by StackNet's own health and root endpoints. Missing version or queue fields mean the current public response does not publish them; old values are not retained.",
    sources: ["stacknet.health", "stacknet.root"],
    fields: ["stacknetVersion", "mcpContract", "nodeId", "inFlight", "maxInFlight"],
    curls: [`curl -s ${SN_BASE}/health`, `curl -s ${SN_BASE}/`],
  },
  stackNodes: {
    title: "Nodes & GPUs",
    explain:
      "Live capacity counters from StackNet's public network map — their own numbers, re-sniffed by the minute collector. The public /node route may be unavailable.",
    sources: ["stacknet.network", "stacknet.node"],
    fields: ["nodes", "totalNodes", "gpus", "taskCount", "averageLoad"],
    curls: [`curl -s ${SN_BASE}/network/summary`, `curl -s ${SN_BASE}/node`],
  },
  vramText: {
    title: "VRAM free",
    explain:
      "Total vs available VRAM straight off the public network map. The bar shows free share of the whole fleet.",
    sources: ["stacknet.network"],
    fields: ["vramGb", "availableVramGb", "vramAvailablePct"],
    curls: [`curl -s ${SN_BASE}/network/summary`],
  },
  geoffBuild: {
    title: "geoff build",
    explain:
      "Deploy fingerprints scraped from geoff.ai's own page metadata and version endpoint.",
    sources: ["geoff.version", "geoff.deploy"],
    fields: ["geoffBuildId", "geoffDeployId", "chunkHash", "chunkCount"],
    curls: [
      "curl -s https://geoff.ai/api/version",
      'curl -s https://geoff.ai | grep -oE "build[A-Za-z]*[^,]{0,40}" | head',
    ],
  },
  modelCount: {
    title: "Models · api vs net",
    explain:
      "Two different lists on purpose: public /v1/models cards vs internal routing lanes from the network map.",
    sources: ["stacknet.network", "stacknet.models"],
    fields: ["apiModels", "models", "fleetBases", "fleetLines"],
    curls: [`curl -s ${SN_BASE}/v1/models`, `curl -s ${SN_BASE}/network/summary`],
  },
  pileValue: {
    title: "Network PILE",
    explain:
      "StackNet's documented public PILE: unredeemed earnings across Node Keys that are at least 10% utilized.",
    sources: ["stacknet.pile"],
    fields: ["pile"],
    curls: [`curl -s ${SN_BASE}/api/v2/node-keys/pile`],
  },
  paperworkUsd: {
    title: "Paperwork ledger",
    explain:
      "Booked-vs-paid metaproof values from /network/summary, cross-checked against the Solana chain: treasury balance AND lifetime signature count via public RPC. Their books, our math.",
    sources: ["stacknet.network", "solana.treasury"],
    fields: [
      "metaproofsPaperworkUsd",
      "metaproofsPaidUsd",
      "metaproofsOutstandingUsd",
      "metaproofsTotal",
      "treasuryRpcSol",
      "treasuryRpcSigCount",
      "treasuryAddress",
    ],
    curls: [
      `curl -s ${SN_BASE}/network/summary`,
      `curl -s https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["${
        lastLatest?.summary?.treasuryRpcAddress || "2W5gxAio1Bz76P58EaDtGC71MuyH4ZAdXHu3qqmeGy7g"
      }",{"commitment":"confirmed"}]}'`,
      ],
    },
  keySale: {
    title: "Node-key sale",
    explain:
      "Public pricing endpoint for the node-key sale. It is self-reported by StackNet, so the counter is useful for trend watching, but purchases are still unverified on-chain.",
    sources: ["stacknet.keysale", "geoff.docs.pricing"],
    fields: [
      "keySaleActive",
      "keySaleEpoch",
      "keySaleDay",
      "keySaleDaysUntilHalving",
      "keySaleKeysSold",
      "keySalePriceUsd",
    ],
    curls: [
      `curl -s ${SN_BASE}/api/v2/node-keys/pricing`,
      `curl -s https://devconsole-indol.vercel.app/aisp/node-keys`,
    ],
  },
  ghostCount: {
    title: "Ghost shelf",
    explain:
      "Anonymous free-tier models counted live from OpenCode's public zen catalog; watchlist flags which ghosts are present.",
    sources: ["opencode.zen"],
    fields: ["zenGhostIds", "zenMissingGhosts", "zenModelCount", "zenFreeCount"],
    curls: ["curl -s https://opencode.ai/zen/v1/models"],
  },
  fleetCount: {
    title: "Engine tiers",
    explain:
      "Internal fleet taxonomy parsed from /network/summary: product lines crossed with engine bases. The magma/pyro map, straight from them.",
    sources: ["stacknet.network"],
    fields: ["fleetBases", "fleetLines", "models"],
    curls: [`curl -s ${SN_BASE}/network/summary`],
  },
  x402Downloads: {
    title: "x402 PAYG adoption",
    explain:
      "Weekly npm downloads and current release of StackNet's public wallet-funded pay-as-you-go SDK.",
    sources: ["stacknet.x402"],
    fields: ["x402WeeklyDownloads", "x402Version", "x402PaymentMints", "x402PeriodEnd"],
    curls: [
      "curl -s https://api.npmjs.org/downloads/point/last-week/@stacknet/x402payg",
      "curl -s https://registry.npmjs.org/@stacknet/x402payg/latest",
    ],
  },
  pond0xMining: {
    title: "Pond0x miners",
    explain:
      "Live on-chain sampling of the Pond0x mining program: signature rate, unique signer wallets over the page window, and the program treasury balance. Sampled fee payers are hashed to a count only — individual wallet addresses are never kept or shown.",
    sources: ["pond0x.mining"],
    fields: [
      "pond0xRatePerMinute",
      "pond0xActivityCount",
      "pond0xWindowMinutes",
      "pond0xEstActiveMiners",
      "pond0xUniqueRatio",
      "pond0xTreasurySol",
      "pond0xLatestAt",
      "pond0xSampled",
    ],
    curls: [
      `curl -s https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":["T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt",{"limit":1000,"commitment":"confirmed"}]}'`,
      `curl -s https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["cPUtmyb7RZhCaTusCb4qnPJjVTbwpJ6SpXUCvnBDU4a",{"commitment":"confirmed"}]}'`,
    ],
  },
  trixMarket: {
    title: "TRIX collectibles",
    explain:
      "Aggregate-only counts read from TRIX public APIs: boost Card roster, minted artworks, live auctions, treasury, pre-order TCG flag, and the public activity feed. No individual holder, artwork owner, auction bidder, or leaderboard identity is kept or displayed — totals only. The TCG flag is API-reported (false) and no endpoint represents physical packaging.",
    sources: ["trix.market"],
    fields: [
      "trixCardCount",
      "trixCardMaxMultiplier",
      "trixArtworkCount",
      "trixArtworkPrinted",
      "trixAuctionCount",
      "trixTreasurySol",
      "trixTreasuryPoints",
      "trixActivityCount",
      "trixLeaderboardEntries",
      "trixTcgActive",
      "trixMarketFingerprint",
    ],
    curls: [
      "curl -s https://trix.market/api/cards",
      "curl -s https://trix.market/api/artworks",
      "curl -s https://trix.market/api/auctions",
      "curl -s https://trix.market/api/treasury",
      "curl -s https://trix.market/api/mkt/preorder",
      "curl -s https://trix.market/api/activity",
    ],
  },
};

const CARD_PROOF_ORDER = [
  "stackVersion",
  "stackNodes",
  "vramText",
  "geoffBuild",
  "modelCount",
  "pileValue",
  "paperworkUsd",
  "keySale",
"ghostCount",
  "fleetCount",
"x402Downloads",
  "pond0xMining",
  "trixMarket",
];

function openProof(key) {
  const p = PROOFS[key];
  const overlay = document.getElementById("proofOverlay");
  if (!p || !overlay) return;
  const s = lastLatest?.summary ?? {};
  document.getElementById("proofTitle").textContent = p.title;
  document.getElementById("proofExplain").textContent = p.explain;

  const srcBox = document.getElementById("proofSources");
  srcBox.innerHTML = p.sources
    .map((name) => {
      const src = lastLatest?.sources?.[name];
      const status = src
        ? src.ok
          ? `<span class="ps-ok">HTTP ${src.status ?? 200} · ${src.ms ?? "?"}ms</span>`
          : `<span class="ps-bad">FAILED · ${escapeHtml(src.reason || "error")}</span>`
        : '<span class="ps-warn">not in this sniff</span>';
      return `<div class="ps-row"><span>${escapeHtml(name)}</span>${status}</div>`;
    })
    .join("");

  document.getElementById("proofRaw").textContent = p.fields
    .map((f) => `${f}: ${JSON.stringify(s[f] ?? null)}`)
    .join("\n");

  const spark = document.getElementById("proofSpark");
  if (spark) {
    if (key === "paperworkUsd") {
      spark.hidden = false;
      renderPaperworkSpark(spark);
    } else {
      spark.hidden = true;
      spark.innerHTML = "";
    }
  }

  const curlText = p.curls
    .map((c) =>
      c.replace(
        /\$\{lastLatest[\s\S]*?\}/,
        s.treasuryRpcAddress || "2W5gxAio1Bz76P58EaDtGC71MuyH4ZAdXHu3qqmeGy7g",
      ),
    )
    .join("\n\n");
  document.getElementById("proofCurl").textContent = curlText;

  overlay.hidden = false;
}

function closeProof() {
  const overlay = document.getElementById("proofOverlay");
  if (overlay) overlay.hidden = true;
}

/* ---- Paperwork accumulation tape ---- */
let pwHistoryCache = { at: 0, series: [] };

async function fetchPaperworkHistory(force = false) {
  if (!force && Date.now() - pwHistoryCache.at < 5 * 60 * 1000) return pwHistoryCache.series;
  try {
    const res = await fetch("/api/paperwork-history", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    pwHistoryCache = {
      at: Date.now(),
      series: Array.isArray(data?.series) ? data.series : [],
    };
  } catch {}
  return pwHistoryCache.series;
}

function paperworkVelocity(series, windowMs) {
  if (!series.length) return null;
  const nowT = Date.parse(series[0].at);
  if (!Number.isFinite(nowT)) return null;
  let ref = null;
  for (const p of series) {
    if (nowT - Date.parse(p.at) >= windowMs) {
      ref = p;
      break;
    }
  }
  if (!ref && series.length > 1) ref = series[series.length - 1];
  if (!ref) return null;
  return Number(series[0].v) - Number(ref.v);
}

function renderPaperworkSpark(box) {
  const series = [...pwHistoryCache.series]; // newest-first
  if (series.length < 2) {
    box.innerHTML =
      '<p class="spark-note">accumulation tape warming up — needs a few more sniffs</p>';
    return;
  }
  const d24 = paperworkVelocity(pwHistoryCache.series, 24 * 3600e3);
  const d72 = paperworkVelocity(pwHistoryCache.series, 72 * 3600e3);
  const fmtD = (n) =>
    n == null ? "—" : `${n >= 0 ? "▲" : "▼"} ${fmtCompactUsd(Math.abs(n))}`;

  const W = 640;
  const H = 90;
  const pts = [...series].reverse(); // oldest→newest
  const vals = pts.map((p) => Number(p.v));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const coords = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * (W - 8) + 4;
      const y = H - 10 - ((v - min) / span) * (H - 20);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const lastPt = coords.split(" ").pop().split(",");
  box.innerHTML = `
    <div class="spark-stats">
      <span><i>booked</i> ${fmtCompactUsd(vals[vals.length - 1])}</span>
      <span><i>24h</i> ${fmtD(d24)}</span>
      <span><i>72h</i> ${fmtD(d72)}</span>
      <span><i>tape</i> ${pts.length} sniffs</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="paperwork build-up">
      <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${coords}"/>
      <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="3.2" fill="var(--heat-bright)"/>
    </svg>`;
}

function wireProofPopups() {
  const grid = document.querySelector(".metrics");
  grid?.addEventListener("click", (e) => {
    const card = e.target.closest(".metric");
    if (!card) return;
    if (card.dataset.proof && PROOFS[card.dataset.proof]) {
      openProof(card.dataset.proof);
      return;
    }
    const ids = [...card.querySelectorAll("[id]")].map((x) => x.id);
    const key = CARD_PROOF_ORDER.find((k) => ids.includes(k));
    if (key) openProof(key);
  });
  document.getElementById("proofClose")?.addEventListener("click", closeProof);
  document.getElementById("proofOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "proofOverlay") closeProof();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeProof();
  });
  document.getElementById("proofCopy")?.addEventListener("click", async () => {
    const text = document.getElementById("proofCurl")?.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand?.("copy");
      ta.remove();
    }
    const btn = document.getElementById("proofCopy");
    if (btn) {
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1400);
    }
  });
}

wireProofPopups();
document.addEventListener("click", (e) => {
  const dismiss = e.target.closest(".settle-dismiss");
  if (!dismiss || !els.settleBanner) return;
  e.preventDefault();
  els.settleBanner.hidden = true;
});
fetchPaperworkHistory().then(() => {
  if (lastLatest) renderMetrics(lastLatest);
});
setInterval(() => fetchPaperworkHistory(true), 5 * 60 * 1000);

function renderMetrics(latest) {
  lastLatest = latest ?? null;
  const s = latest?.summary ?? {};
  if (els.stacknetChangeNotice) {
    const shellOnline = ["healthy", "ok"].includes(s.stacknetStatus);
    const horsepowerDisconnected = s.gpus === 0 && s.vramGb === 0;
    els.stacknetChangeNotice.hidden = !(shellOnline && horsepowerDisconnected);
  }
  const tokenSource = latest?.sources?.["solana.tokens"];
  const tokenRows = Array.isArray(s.tokenPress) && s.tokenPress.length
    ? s.tokenPress
    : Array.isArray(tokenSource?.mints)
      ? tokenSource.mints
      : [];
  const tokenOwner =
    s.tokenPressOwner || s.tokenPressAuthority || tokenSource?.owner || tokenSource?.authority || "unknown";
  if (els.stackVersion) els.stackVersion.innerHTML = (s.stacknetVersion ? '<span class="live-dot"></span>' : '') + (s.stacknetVersion || "—");
  if (els.stackHealth) els.stackHealth.textContent = s.stacknetStatus || "—";
  if (els.stackNodes) els.stackNodes.textContent =
    s.nodes != null && s.gpus != null ? `${s.nodes} / ${s.gpus}` : "—";
  const loadBits = [];
  if (s.averageLoad != null) loadBits.push(`load ${s.averageLoad}`);
  if (s.inFlight != null) {
    loadBits.push(
      s.maxInFlight != null ? `in-flight ${s.inFlight}/${s.maxInFlight}` : `in-flight ${s.inFlight}`,
    );
  }
  if (s.taskCount != null) loadBits.push(`tasks ${s.taskCount}`);
  if (els.stackLoad) els.stackLoad.textContent = loadBits.length ? loadBits.join(" · ") : "load —";
  if (s.availableVramGb != null && s.vramGb != null) {
    if (els.vramText) els.vramText.textContent = `${s.availableVramGb}/${s.vramGb} GB`;
    els.vramBar.style.width = `${s.vramAvailablePct ?? 0}%`;
  } else {
    els.vramText.textContent = "—";
    els.vramBar.style.width = "0%";
  }
  if (els.geoffBuild) els.geoffBuild.textContent = short(s.geoffBuildId, 10, 6);
  if (s.geoffDeployId) {
    if (els.geoffDeploy) els.geoffDeploy.textContent = s.geoffDeployId;
  } else if (s.chunkHash) {
    els.geoffDeploy.textContent = `asset ${short(s.chunkHash, 4, 4)}`;
  } else {
    els.geoffDeploy.textContent = "—";
  }
  if (els.modelCount) els.modelCount.textContent = s.models != null ? String(s.models) : "—";
  if (els.apiModelCount) els.apiModelCount.textContent =
    s.apiModels != null
      ? `api ${s.apiModels}${s.models != null ? ` · net ${s.models}` : ""}`
      : "api —";
  if (els.apiModelCount) {
    els.apiModelCount.title =
      "api = public /v1/models cards · net = /network/summary routing lanes (not the same list)";
  }
  if (els.pileValue) {
    const pile = Number(s.pile);
    els.pileValue.textContent = Number.isFinite(pile) ? fmtCompactNumber(pile) : "—";
    els.pileValue.title = `Network PILE raw value: ${s.pile ?? "—"}`;
  }
  if (els.pileMeta) els.pileMeta.textContent = "unredeemed key earnings";
  if (els.paperworkUsd) {
    const booked = Number(s.metaproofsPaperworkUsd);
    els.paperworkUsd.textContent =
      s.metaproofsPaperworkUsd != null && Number.isFinite(booked)
        ? fmtCompactUsd(booked)
        : "—";
    els.paperworkUsd.title = `Metaproof paperwork booked (raw: ${s.metaproofsPaperworkUsd ?? "—"})`;
  }
  if (els.paperworkMeta) {
    const bits = [];
    if (s.metaproofsPaidUsd != null)
      bits.push(`paid ${fmtCompactUsd(Number(s.metaproofsPaidUsd))}`);
    if (s.metaproofsTotal != null) bits.push(`${s.metaproofsTotal} proofs`);
    if (s.treasuryRpcOk) {
      bits.push(`chain ${Number(s.treasuryRpcSol ?? 0).toFixed(3)} SOL`);
      if (s.treasuryRpcSigCount != null)
        bits.push(`${s.treasuryRpcSigCount} lifetime tx`);
    }
    if (!bits.length && s.solPriceUsd != null)
      bits.push(`SOL $${Number(s.solPriceUsd).toFixed(2)}`);
    const press = tokenRows.filter((t) => t.symbol && !["USDC", "mSOL"].includes(t.symbol));
    if (press.length) bits.push(`press ${press.map((p) => p.symbol).join("·")}`);
    const d24 = paperworkVelocity(pwHistoryCache.series, 24 * 3600e3);
    if (d24 != null && Math.abs(d24) > 0.5)
      bits.push(`<span class="${d24 >= 0 ? "vel-up" : "vel-down"}">${d24 >= 0 ? "▲" : "▼"} ${fmtCompactUsd(Math.abs(d24))}</span>/24h`);
    if (els.paperworkMeta) els.paperworkMeta.innerHTML = bits.length ? bits.join(" · ") : "—";
    els.paperworkMeta.title = [
      `Booked vs paid metaproof ledger · chain balance via public Solana RPC${
        s.treasuryAddress ? ` · ${s.treasuryAddress}` : ""
      }`,
      press.length
        ? `Tokens held by watched owner ${tokenOwner} — holding token accounts does not grant minting control. INTERNAL TEST SCRIPT, microscopic float, zero liquidity. Do NOT buy: ${press
            .map((p) => `${p.symbol}=${p.supplyUi}`)
            .join(", ")}`
        : null,
      press.length
        ? `Separate mint authorities: ${press
            .map((p) => `${p.symbol}=${p.mintAuthority || "unknown"}`)
            .join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const paper = tokenRows.find((token) => token.symbol === "PAPER") || null;
  if (els.paperSupply) {
    els.paperSupply.textContent = Number.isFinite(Number(paper?.supplyUi))
      ? Number(paper.supplyUi).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "—";
    els.paperSupply.title = paper
      ? `Global on-chain PAPER supply · mint ${paper.mint}`
      : "Waiting for PAPER supply data.";
  }
  const trixGeoff = latest?.sources?.["trix.geoff"];
  if (els.trixGeoffCount) {
    const count = Number(trixGeoff?.count);
    els.trixGeoffCount.textContent = Number.isFinite(count) && count > 0 ? `${count} paid` : "—";
    els.trixGeoffCount.title =
      "Deduplicated paid-generation history observed where TRIX labels generator=geoff.";
  }
  if (els.trixGeoffMeta) {
    const paidSol = Number(trixGeoff?.paidSol);
    const latestFee = Number(trixGeoff?.latest?.feeSol);
    const latestPaidAt = trixGeoff?.latest?.createdAt;
    const checkedAt = trixGeoff?.checkedAt;
    const scannedMints = trixGeoff?.scannedTokenMints?.length || 0;
    const launchTotal = Number(trixGeoff?.launchTotal);
    const backfill = Number.isFinite(launchTotal) && scannedMints < launchTotal
      ? ` · backfill ${scannedMints}/${launchTotal} mints`
      : "";
    els.trixGeoffMeta.textContent = Number.isFinite(paidSol) && paidSol > 0
      ? `${paidSol.toFixed(3)} SOL observed${Number.isFinite(latestFee) ? ` · latest ${latestFee.toFixed(3)} SOL` : ""}${latestPaidAt ? ` · last paid ${fmtTime(latestPaidAt)}` : ""}${checkedAt ? ` · checked ${fmtTime(checkedAt)}` : ""}${backfill}`
      : trixGeoff?.reason || "waiting for paid generations";
    els.trixGeoffMeta.title =
      `TRIX supplies the Geoff provider label, fee amount, network, and transaction signature. The global recent feed can be saturated by other generators, so the collector also rotates through active token histories (${trixGeoff?.activeRefreshCount || 0}/${trixGeoff?.activeTokenCount || 0} this pass). Last paid is activity time; checked is collector time. This does not independently prove geoff.ai operator identity or that the generated image was minted as an NFT.`;
  }
  if (els.trixGeoffReceipt) {
    const signature = trixGeoff?.latest?.txSignature;
    els.trixGeoffReceipt.hidden = !signature;
    if (signature) els.trixGeoffReceipt.href = `https://solscan.io/tx/${encodeURIComponent(signature)}`;
  }
  const trixPacks = trixGeoff?.packs;
  if (els.trixPacksMinted) {
    const minted = Number(trixPacks?.minted);
    const validPackCount =
      trixPacks?.ok && trixPacks.status >= 200 && trixPacks.status < 300 && minted > 0;
    els.trixPacksMinted.textContent = validPackCount
      ? `${minted.toLocaleString()} minted`
      : "—";
    els.trixPacksMinted.title =
      "Pack mint count reported by TRIX /api/mkt/state; not independently verified token supply.";
  }
  if (els.trixPacksMeta) {
    const bits = ["holders not published"];
    if (trixPacks?.stale) bits.unshift("last valid reading");
    if (trixPacks?.round != null) bits.push(`round ${trixPacks.round}`);
    if (trixPacks?.roundStatus) bits.push(trixPacks.roundStatus);
    if (!trixPacks?.ok && trixPacks?.reason) bits.push("market read failed");
    els.trixPacksMeta.textContent = bits.join(" · ");
    els.trixPacksMeta.title = trixPacks?.holderReason ||
      "No public Pack/Card holder count or collection mint is available.";
  }
  if (els.trixPackMarket) {
    const levels = new Map((trixPacks?.levels || []).map((level) => [level.id, level]));
    const hasNumber = (value) => value !== null && value !== undefined && value !== "" &&
      Number.isFinite(Number(value));
    const formatCount = (value) => hasNumber(value)
      ? Number(value).toLocaleString()
      : "—";
    const formatUsd = (value) => hasNumber(value)
      ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : "—";
    const mintRate = hasNumber(trixPacks?.mintsPerHour)
      ? `${Number(trixPacks.mintsPerHour).toLocaleString(undefined, {
          minimumFractionDigits: Number(trixPacks.mintsPerHour) < 1 ? 2 : 1,
          maximumFractionDigits: 2,
        })}/hr`
      : "N/A";
    const observedSol = (value) => hasNumber(value)
      ? `${Number(value).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} SOL`
      : "N/A";
    const priceStat = (id, label) => {
      const level = levels.get(id);
      const hasReportedMints = Number(level?.minted) > 0;
      return {
        label: hasReportedMints ? `${label} API quote` : `${label} sale price`,
        value: hasReportedMints ? formatUsd(level?.priceUsd) : "N/A",
        muted: true,
      };
    };
    const stats = [
      { label: "Packs left", value: formatCount(trixPacks?.available) },
      { label: "Mints/hour", value: mintRate },
      { label: "Base paid max", value: observedSol(trixPacks?.purchaseAudit?.baseMaxPaidSol) },
      { label: "Base all-in max", value: observedSol(trixPacks?.purchaseAudit?.baseMaxAllInSol) },
      { label: "Most ripped", value: trixPacks?.mostRippedSymbol || "N/A" },
      { label: "Reported buyback", value: formatUsd(trixPacks?.mostRippedBuybackUsd) },
      { label: "Meme status", value: trixPacks?.memeStatus || "N/A" },
      priceStat("base", "Base"),
      priceStat("viral", "Viral"),
      priceStat("hype", "Hype"),
    ];
    els.trixPackMarket.innerHTML = stats.map(({ label, value, muted }) =>
      `<span${muted ? ' class="unverified-price"' : ""}><b>${escapeHtml(label)}</b><i>${escapeHtml(value)}</i></span>`,
    ).join("");
    const genesisPrice = Number(trixPacks?.genesisPricePerPackUsd);
    const basePrice = Number(trixPacks?.basePriceUsd);
    const priceCrossCheck = Number.isFinite(genesisPrice) && Number.isFinite(basePrice)
      ? ` State Base $${basePrice.toFixed(2)} vs Genesis $${genesisPrice.toFixed(2)}: ${Math.abs(basePrice - genesisPrice) <= 0.01 ? "match" : "mismatch"}.`
      : "";
    els.trixPackMarket.title =
      `Mints/hour is calculated from recent same-round TRIX API-reported mint totals over a rolling window of up to 60 minutes; it does not prove queueing or throttling. Base paid max is observed Pack consideration. Base all-in max also includes buyer-funded account rent and network fees. TRIX bulk checkout submits one transaction per Pack. Premium Pack levels are excluded from both Base maxima. Most ripped, buyback, and meme status are TRIX Genesis API reports. Prices are current API quotes, not verified realized sales.${priceCrossCheck}`;
  }
  if (els.trixPackTraits) {
    const classes = Array.isArray(trixPacks?.classes) ? trixPacks.classes : [];
    els.trixPackTraits.innerHTML = classes.map((item) => {
      const odds = Number(item.oddsPercent).toLocaleString(undefined, {
        minimumFractionDigits: item.oddsPercent < 1 ? 2 : 0,
        maximumFractionDigits: 2,
      });
      const min = Number(item.payoutMin);
      const max = Number(item.payoutMax);
      const multiple = Number.isFinite(min) && Number.isFinite(max)
        ? min === max ? `${min}x` : `${min}–${max}x`
        : "—";
      return `<span class="trix-trait trait-${escapeHtml(item.key)}"><b>${escapeHtml(item.label)}</b><i><span>odds ${odds}%</span><span>gross ${multiple}</span></i></span>`;
    }).join("");
    els.trixPackTraits.title =
      "Gross reward multiplier applies to Pack USD price before owner, creator, and meme-pool shares. Early claims may pay less than the owner's full share.";
  }
renderTrixMarket(s);
  renderSettlementStatus(s);
  renderKeySale(s);
  if (els.ghostCount) {
    const ghosts = Array.isArray(s.zenGhostIds) ? s.zenGhostIds : [];
    els.ghostCount.textContent = ghosts.length ? String(ghosts.length) : "0";
    els.ghostCount.title = `Zen free-tier anonymous models: ${ghosts.join(", ") || "none"}`;
  }
  if (els.ghostMeta) {
    const bits = [];
    if (s.zenModelCount != null) bits.push(`zen ${s.zenModelCount} models`);
    if (s.zenFreeCount != null) bits.push(`${s.zenFreeCount} free`);
    els.ghostMeta.textContent = bits.length ? bits.join(" · ") : "zen watchlist";
  }
  if (els.fleetCount) {
    const bases = Array.isArray(s.fleetBases) ? s.fleetBases : [];
    const lines = Array.isArray(s.fleetLines) ? s.fleetLines : [];
    els.fleetCount.textContent =
      bases.length && lines.length ? `${bases.length}×${lines.length}` : "—";
    els.fleetCount.title = `Engine bases: ${bases.join(", ") || "?"}\nProduct lines: ${lines.join(", ") || "?"}`;
  }
  if (els.fleetLinesText) {
    const lines = Array.isArray(s.fleetLines) ? s.fleetLines : [];
    els.fleetLinesText.textContent = lines.length
      ? lines.slice(0, 5).join("·")
      : "—";
  }
  if (els.x402Downloads) {
    const downloads = Number(s.x402WeeklyDownloads);
    els.x402Downloads.textContent = Number.isFinite(downloads)
      ? `${fmtCompactNumber(downloads)} / wk`
      : "—";
  }
  if (els.x402Meta) {
    const bits = [];
    if (s.x402Version) bits.push(`v${s.x402Version}`);
    if (Array.isArray(s.x402PaymentMints) && s.x402PaymentMints.length) {
      bits.push(s.x402PaymentMints.join(" / "));
    }
    els.x402Meta.textContent = bits.length ? bits.join(" · ") : "wallet-funded API keys";
    els.x402Meta.title = s.x402PeriodEnd
      ? `npm last-week window ending ${s.x402PeriodEnd}`
      : "StackNet x402 pay-as-you-go SDK";
  }
  if (els.subscriptionCount) {
    els.subscriptionCount.textContent =
      s.subscriptionLiveCount != null
        ? `${s.subscriptionLiveCount}/${s.subscriptionTotal ?? "?"}`
        : "—";
  }
  if (els.subscriptionMeta) {
    const labels = Array.isArray(s.subscriptionLiveLabels) ? s.subscriptionLiveLabels : [];
    const bits = labels.map((l) => l.toLowerCase());
    els.subscriptionMeta.textContent = bits.length
      ? bits.join(" · ")
      : "no billing routes up yet";
    els.subscriptionMeta.title =
      "Public billing/plans/subscription route probe (API is auth-gated)";
  }
  if (els.pond0xMiners) {
    const miners = Number(s.pond0xEstActiveMiners);
    els.pond0xMiners.textContent =
      Number.isFinite(miners) && miners > 0 ? `~${miners.toLocaleString()}` : "—";
    els.pond0xMiners.title = s.pond0xEstActiveMiners != null
      ? `Estimated unique signing wallets active in the last ${s.pond0xWindowMinutes ?? "?"} min (sampled ratio × activity count · on-chain).`
      : "Waiting for a decodable on-chain sample.";
  }
  if (els.pond0xMeta) {
    const bits = [];
    if (s.pond0xRatePerMinute != null) bits.push(`${s.pond0xRatePerMinute}/min txs`);
    if (s.pond0xActivityCount != null && s.pond0xWindowMinutes != null)
      bits.push(`${s.pond0xActivityCount} in ${s.pond0xWindowMinutes}m`);
    if (s.pond0xTreasurySol != null) bits.push(`${Number(s.pond0xTreasurySol).toFixed(0)} SOL treasury`);
    if (s.pond0xLatestAt) bits.push(fmtTime(s.pond0xLatestAt));
    els.pond0xMeta.textContent = bits.length ? bits.join(" · ") : "waiting on chain samples";
    els.pond0xMeta.title = s.pond0xOk
      ? "Community-only aggregation: no wallet identities, no user addresses, no login required."
      : "Collector offline or first sample not yet decoded.";
  }
}

function renderTrixMarket(s) {
  if (!els.trixMarketCount) return;
  const fmt = (value, digits = 0) =>
    Number.isFinite(Number(value)) && Number(value) !== 0
      ? Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
      : "—";
  const marketData = lastLatest?.sources?.["trix.market"];
  const cards = Array.isArray(marketData?.cards?.cards) ? marketData.cards.cards : [];
  const artworks = marketData?.artworks || {};
  if (cards.length) {
    const top = cards
      .filter((card) => card.active)
      .sort((a, b) => (Number(b.multiplier) || 0) - (Number(a.multiplier) || 0))[0];
    let text = `${cards.length} boost cards`;
    if (top?.name && Number.isFinite(Number(top.multiplier))) {
      text += ` · ${top.name} ${Number(top.multiplier).toLocaleString(undefined, { maximumFractionDigits: 2 })}x`;
    }
    els.trixMarketCount.textContent = text;
    els.trixMarketCount.title =
      "Boost Card roster reported by TRIX /api/cards with their stated multiplier and SOL ask. Artwork shown from TRIX's own image URLs.";
  } else if (els.trixMarketMeta) {
    els.trixMarketCount.textContent = finitePositive(artworks.total)
      ? `${fmt(artworks.total)} artworks`
      : "—";
  }
  if (els.trixMarketMeta) {
    const bits = [];
    if (marketData?.cardsCached) bits.push("card catalog cached");
    if (marketData?.checkedAt) bits.push(`checked ${fmtTime(marketData.checkedAt)}`);
    if (!marketData?.ok && marketData?.reason) bits.push("partial read");
    els.trixMarketMeta.textContent = bits.length ? bits.join(" · ") : "waiting on TRIX public endpoints";
  }
  if (els.trixMarketStats) {
    const stats = [];
    if (finitePositive(artworks.total)) {
      stats.push({
        b: "Artworks minted",
        i: `${fmt(artworks.total)} · ${fmt(artworks.printed)} editions`,
      });
      if (finitePositive(artworks.printedSupply)) {
        stats.push({ b: "Printed supply", i: fmt(artworks.printedSupply) });
      }
    }
    const auctions = marketData?.auctions || {};
    if (finitePositive(auctions.active)) {
      const range = (auctions.minStartSol != null && auctions.maxStartSol != null && Number.isFinite(Number(auctions.minStartSol)) && Number.isFinite(Number(auctions.maxStartSol)))
        ? ` · ${Number(auctions.minStartSol).toFixed(3)}–${Number(auctions.maxStartSol).toFixed(3)} SOL`
        : "";
      stats.push({ b: "Live auctions", i: `${fmt(auctions.active)}${range}` });
    }
    const treasury = marketData?.treasury || {};
    if (treasury.balanceSol != null && Number.isFinite(Number(treasury.balanceSol))) {
      stats.push({
        b: "Treasury",
        i: `${fmt(treasury.balanceSol, 2)} SOL${treasury.totalPoints != null ? ` · ${fmt(treasury.totalPoints)} pts` : ""}`,
      });
    }
    const preorder = marketData?.preorder || {};
    if (preorder.pricePerPackUsd != null && Number.isFinite(Number(preorder.pricePerPackUsd))) {
      stats.push({
        b: "Preorder",
        i: `$${Number(preorder.pricePerPackUsd).toFixed(2)}${preorder.cap != null ? ` · cap ${fmt(preorder.cap)}` : ""}`,
      });
    }
    const lb = marketData?.leaderboard || {};
    if (lb.entries != null) {
      stats.push({
        b: "Leaderboard",
        i: `${fmt(lb.entries)} entries${lb.totalPoints != null ? ` · ${fmt(lb.totalPoints)} pts` : ""}`,
      });
    }
    const activity = marketData?.activity || {};
    if (finitePositive(activity.items)) {
      stats.push({ b: "Live sales", i: fmt(activity.items) });
    }
    let html = stats
      .map(({ b, i }) => `<span><b>${escapeHtml(b)}</b><i>${escapeHtml(i)}</i></span>`)
      .join("");
    if (html) html = `<div class="trix-stats-bar">${html}</div>`;
    const boostCards = cards
      .filter((card) => card.imageUrl && card.active !== false)
      .sort((a, b) => (Number(b.multiplier) || 0) - (Number(a.multiplier) || 0) || (Number(a.slot) || 0) - (Number(b.slot) || 0));
    const cardChart = (card, i) => {
      const price = card.priceSol != null && Number.isFinite(Number(card.priceSol))
        ? `${Number(card.priceSol).toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL`
        : "—";
      const mult = Number.isFinite(Number(card.multiplier))
        ? `${Number(card.multiplier).toLocaleString(undefined, { maximumFractionDigits: 2 })}x`
        : "—";
      const src = trixImageUrl(card.imageUrl);
      const discount = card.discountActive && Number.isFinite(Number(card.discountPercent)) && Number(card.discountPercent) > 0
        ? `<span class="trix-discount">${Number(card.discountPercent).toLocaleString()}% off</span>`
        : "";
      const rankClass = i < 3 ? "big" : "small";
      const featuredClass = i === 0 ? " featured" : "";
      return `<figure class="trix-card ${rankClass}${featuredClass}" title="${escapeHtml(card.name || "")} · ${mult} · ${price}">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(card.name || "TRIX boost card")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <figcaption><b>${escapeHtml(card.name || "—")}</b><i>${mult} <span>${price}</span></i>${discount}</figcaption>
      </figure>`;
    };
    if (boostCards.length) {
      html += `<div class="trix-card-grid">${boostCards.map(cardChart).join("")}</div>`;
      stats.push({ b: "Boost cards", i: "" });
    }
    const mints = Array.isArray(marketData?.recentMints) ? marketData.recentMints : [];
    const mintTiles = mints
      .filter((item) => item?.imageUrl)
      .slice(0, 8)
      .map((item) => `<figure class="trix-mint" title="${escapeHtml(item?.name || "Recent TRIX mint")}">
        <img src="${escapeHtml(trixImageUrl(item.imageUrl))}" alt="${escapeHtml(item?.name || "TRIX artwork")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <figcaption>${escapeHtml(item?.name || "—")}</figcaption>
      </figure>`);
    if (mintTiles.length) {
      html += `<div class="trix-mint-strip">${mintTiles.join("")}</div>`;
      stats.push({ b: "Recent mints", i: "" });
    }
    if (!html) {
      html = `<div class="trix-mkt-grid"><span class="unverified-price"><b>Market</b><i>waiting for a valid TRIX read</i></span></div>`;
    }
    els.trixMarketStats.innerHTML = html;
    els.trixMarketStats.title =
      marketData?.note ||
      "Aggregate counts from TRIX public endpoints. No holder, auction, or leaderboard identities are kept or shown.";
  }
}
function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}
function trixImageUrl(url) {
  if (typeof url !== "string" || !url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://trix.market${url.startsWith("/") ? "" : "/"}${url}`;
}

function renderSettlementStatus(s) {
  if (!els.paperworkStatus) return;
  const paid = Number(s.metaproofsPaidUsd);
  const booked = Number(s.metaproofsPaperworkUsd);
  const proofs = Number(s.metaproofsTotal);
  const chainSol = Number(s.treasuryRpcSol ?? 0);
  const sigs = Number(s.treasuryRpcSigCount ?? 0);
  const hasAnyMoney =
    (Number.isFinite(paid) && paid > 0) ||
    (Number.isFinite(chainSol) && chainSol > 0) ||
    (Number.isFinite(proofs) && proofs > 0 && Number.isFinite(booked) && booked > 0);
  const settled = (Number.isFinite(paid) && paid > 0) || (Number.isFinite(sigs) && sigs > 0 && Number.isFinite(chainSol) && chainSol > 0);

  els.paperworkStatus.hidden = false;
  if (settled) {
    els.paperworkStatus.className = "metric-pill fired";
    els.paperworkStatus.textContent = "fired";
    els.paperworkStatus.title = "Settlement observed — real payment(s) or on-chain treasury activity recorded.";
  } else if (hasAnyMoney) {
    els.paperworkStatus.className = "metric-pill paying";
    els.paperworkStatus.textContent = "paying";
    els.paperworkStatus.title = "Money booked on the ledger but no settled payment on the chain yet.";
  } else {
    els.paperworkStatus.className = "metric-pill armed";
    els.paperworkStatus.textContent = "armed";
    els.paperworkStatus.title = "Ledger armed — awaiting the first real settlement / on-chain funding.";
  }
}

function renderKeySale(s) {
  if (!els.keysoldUsd) return;
  const active = s.keySaleActive;
  const price = Number(s.keySalePriceUsd);
  const keys = Number(s.keySaleKeysSold);
  const halving = Number(s.keySaleDaysUntilHalving);
  if (!active || !Number.isFinite(keys)) {
    els.keysoldUsd.textContent = "sale off";
    els.keysoldMeta.textContent = "no active node-key sale";
    els.keysoldUsd.title = "No active key sale detected from StackNet pricing probe.";
    return;
  }
  els.keysoldUsd.textContent = Number.isFinite(price) ? `$${price.toFixed(2)}/key` : "—";
  const bits = [];
  bits.push(`${keys} sold`);
  if (s.keySaleEpoch != null) bits.push(`epoch ${s.keySaleEpoch}`);
  if (Number.isFinite(halving)) bits.push(`halving in ${halving}d`);
  els.keysoldMeta.innerHTML = bits.join(" · ");
  els.keysoldMeta.title =
    "Node-key sale ticker as reported by StackNet (/api/v2/node-keys/pricing). Self-reported; purchases unverified on-chain. Prices rise per key. Each key carries +1B inference tokens per docs.";
  els.keysoldUsd.title = els.keysoldMeta.title;
}

function renderTraffic(traffic) {
  if (!els.trafficMini) return;
  const total = Number(traffic?.totalViews);
  const topPath = traffic?.topPath;
  const topViews = Number(traffic?.topPathViews);

  els.trafficMini.textContent = Number.isFinite(total) ? `views ${fmtCompactNumber(total)}` : "views —";
  if (topPath) {
    els.trafficMini.title = Number.isFinite(topViews)
      ? `Shared page views${traffic?.fallback ? " (local fallback)" : ""} · top ${topPath} (${fmtCompactNumber(topViews)})`
      : `Shared page views${traffic?.fallback ? " (local fallback)" : ""} · top ${topPath}`;
  } else {
    els.trafficMini.title = traffic?.fallback
      ? "Local browser fallback counter while the shared endpoint is unavailable."
      : "Shared HTML page-view counter. Counts root and .html route loads.";
  }
}

async function refreshTraffic() {
  try {
    const res = await fetch("/api/traffic", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderTraffic(await res.json());
  } catch {
    const key = "gt.traffic.views";
    const total = (Number(localStorage.getItem(key)) || 0) + 1;
    localStorage.setItem(key, String(total));
    renderTraffic({ totalViews: total, topPath: "this browser", topPathViews: total, fallback: true });
  }
}

function renderDocsCue(board, events = []) {
  if (!els.docsCue) return;
  if (els.docsCueLink) els.docsCueLink.href = board?.url || "https://docs.geoff.ai/";

  const recent = eventsInTrackWindow(events)
    .filter((e) => e.kind === "docs" || e.kind === "pricing")
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0))[0];

  if (recent) {
    const pages = recent.details?.pages || [];
    const pageBit = pages.length ? ` · ${pages.slice(0, 2).join(", ")}` : "";
    els.docsCue.textContent =
      recent.kind === "pricing"
        ? recent.title || "Token plan rates moved"
        : `${recent.title || "Docs moved"}${pageBit}`;
    els.docsCue.classList.add("hot");
    return;
  }

  els.docsCue.classList.remove("hot");
  if (board?.scraped != null) {
    const total = board.total != null ? `/${board.total}` : "";
    const linked = board.linkedPageCount ? ` · ${board.linkedPageCount} live pages inventoried` : "";
    els.docsCue.textContent = `Armed · ${board.scraped}${total} representative pages${linked}`;
  } else {
    els.docsCue.textContent = "Fingerprinting docs…";
  }
}

function renderLanesCue(board, latest, events = []) {
  if (!els.lanesCue) return;
  const src = latest?.sources?.["geoff.product.lanes"];
  const maxSrc = latest?.sources?.["geoff.max.solana"];
  if (els.lanesCueLink) els.lanesCueLink.href = board?.url || "https://www.geoff.ai/hq";

  const recent = eventsInTrackWindow(events)
    .filter((e) => e.kind === "productLanes" || e.kind === "maxSolana")
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0))[0];

  if (recent) {
    els.lanesCue.textContent = recent.title || "Product lanes moved";
    els.lanesCue.classList.add("hot");
    return;
  }

  els.lanesCue.classList.remove("hot");
  if (src?.liveCount != null) {
    const labels = (src.liveLabels || board?.labels || []).slice(0, 4).join(" · ");
    const solana = maxSrc?.solanaLive ? " · Max×Solana" : "";
    els.lanesCue.textContent = labels
      ? `${src.liveCount}/${src.total} live · ${labels}${solana}`
      : `${src.liveCount}/${src.total} product lanes connect-gated`;
    return;
  }
  els.lanesCue.textContent = "Probing product lanes…";
}

function recordProbeSample(latest) {
  const source = latest?.sources?.["geoff.public.surfaces"];
  if (!Array.isArray(source?.routes) || !source.routes.length) return;
  const at = latest.takenAt || new Date().toISOString();
  if (memory.probeSamples?.some((sample) => sample.at === at)) return;
  const routes = source.routes.map((route) => ({
    id: route.id,
    label: route.label || route.id,
    status: route.status ?? 0,
    ms: route.ms ?? null,
    bytes: route.bytes ?? 0,
    hash: route.hash || null,
    note: route.note || "Geoff",
  }));
  memory.probeSamples = [{ at, routes }, ...(memory.probeSamples || [])].slice(0, 3);
}

function renderProbeLog() {
  if (!els.probeLog) return;
  const order = ["video", "image", "music", "explore", "home"];
  const rows = (memory.probeSamples || []).flatMap((sample) =>
    [...(sample.routes || [])]
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      .map((route) => ({ ...route, at: sample.at })),
  );
  if (!rows.length) {
    els.probeLog.innerHTML = '<tr><td colspan="7">waiting for first surface probe…</td></tr>';
    return;
  }
  const live = rows.slice(0, 5).filter((route) => route.status === 200).length;
  if (els.probeMeta) els.probeMeta.textContent = `${live}/5 live · ${memory.probeSamples.length} cycles`;
  els.probeLog.innerHTML = rows
    .map((route) => {
      const time = new Date(route.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const statusClass = route.status === 200 ? "ok" : "bad";
      return `<tr>
        <td>${escapeHtml(time)}</td>
        <td>${escapeHtml(route.label)}</td>
        <td class="probe-status ${statusClass}">${escapeHtml(route.status)}</td>
        <td>${route.ms == null ? "—" : escapeHtml(route.ms)}</td>
        <td>${Number(route.bytes || 0).toLocaleString()}</td>
        <td><code>${escapeHtml(route.hash || "—")}</code></td>
        <td>${escapeHtml(route.note || "Geoff")}</td>
      </tr>`;
    })
    .join("");
}

function renderMaxCue(latest, events = []) {
  if (!els.maxCue) return;
  const src = latest?.sources?.["geoff.max.solana"];
  if (els.maxCueLink) els.maxCueLink.href = "https://www.geoff.ai/max/solana";

  const recent = eventsInTrackWindow(events)
    .filter((e) => e.kind === "maxSolana")
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0))[0];

  if (recent) {
    els.maxCue.textContent = recent.title || "Max × Solana surface moved";
    els.maxCue.classList.add("hot");
    return;
  }

  els.maxCue.classList.remove("hot");
  if (!src) {
    els.maxCue.textContent = "Probing /max routes…";
    return;
  }
  if (src.solanaLive) {
    els.maxCue.textContent = `Lane live · ${src.liveCount}/${src.total} routes connect-gated (auth)`;
  } else if (src.maxLive) {
    els.maxCue.textContent = "Max hub live · Solana nested lane quiet";
  } else {
    els.maxCue.textContent = "No Max/Solana routes answering";
  }
}

function renderSpark(temps = []) {
  const series = pruneWindow(normalizeTempSeries(temps));
  const pts = series.map((t) => t.value);
  if (pts.length < 2) {
    els.spark.innerHTML = "";
    return;
  }
  const w = 120;
  const h = 36;
  const max = Math.max(30, ...pts);
  const min = Math.min(...pts);
  const span = Math.max(1, max - min);
  const coords = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  els.spark.innerHTML = `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#059669"/>
        <stop offset="100%" stop-color="#4ade80"/>
      </linearGradient>
    </defs>
    <polyline fill="none" stroke="url(#g)" stroke-width="2.2" stroke-linecap="round"
      points="${coords.join(" ")}" />
  `;
}

function recordTracking(latest, temperature) {
  const at = latest?.takenAt || new Date().toISOString();
  const value = temperature?.value ?? 0;
  memory.temps = pruneWindow([
    ...normalizeTempSeries(memory.temps),
    { at, value },
  ]).slice(-500);

  const s = latest?.summary || {};
  memory.agentSamples = pruneWindow([
    ...(memory.agentSamples || []),
    {
      at,
      inFlight: s.inFlight ?? null,
      taskCount: s.taskCount ?? null,
      load: s.averageLoad ?? null,
    },
  ]).slice(-500);

  memory.events = pruneWindow(memory.events || []).slice(0, MAX_MEMORY_EVENTS);
  memory.dailyActivity = pruneDailyActivity(memory.dailyActivity || [], HEATMAP_DAYS);
  saveMemory();
  renderSpark(memory.temps);
}

function renderStory(briefing, temperature) {
  const story = briefing?.story || {};
  const temp = briefing?.temperature || {};
  els.story.className = `story tone-${story.tone || "muted"}`;
  els.storyHeadline.textContent = story.headline || "Waiting for first sniff";
  els.storySentence.textContent =
    story.sentence || "Once live data arrives, this board explains Geoff in plain English.";
  els.tempPlain.textContent = temp.plain
    ? `${temp.plain} ${temp.detail || ""}`
    : "—";

  const value = temperature?.value ?? temp.value ?? 0;
  els.mercury.style.width = `${Math.max(8, value)}%`;
  els.tempValue.textContent = String(value);
  els.tempLabel.textContent = temperature?.label || temp.label || "cool";
}

function eventsInTrackWindow(events = []) {
  return pruneWindow(events);
}

function setFeedMeta({ surface = 0, queue = 0, pollCount = 0 } = {}) {
  const shown = Math.min(surface, FEED_RECENT_LIMIT);
  els.tempMeta.textContent =
    surface > FEED_RECENT_LIMIT
      ? `showing ${shown} newest of ${surface} · ${queue} queue · ${pollCount} refreshes · ${TRACK_HOURS}h`
      : `${surface} surface · ${queue} queue · ${pollCount} refreshes · ${TRACK_HOURS}h`;
}

function hourBuckets(now = Date.now()) {
  const start = now - TRACK_MS;
  const buckets = Array.from({ length: TRACK_HOURS }, (_, i) => ({
    i,
    start: start + i * 3_600_000,
    end: start + (i + 1) * 3_600_000,
    heat: 0,
    count: 0,
    crazy: 0,
    spike: 0,
    agent: 0,
    maxInFlight: 0,
  }));
  return buckets;
}

function renderPumpTape(events = [], agentSamples = []) {
  if (!els.pumpChart) return;
  const now = Date.now();
  const buckets = hourBuckets(now);
  const windowed = eventsInTrackWindow(events);

  for (const e of windowed) {
    // Queue telemetry has its own strip — don't inflate the surface tape heat.
    if (isQueueTelemetry(e) || e.kind === "agentCluster") continue;
    const t = Date.parse(e.at);
    const idx = Math.min(TRACK_HOURS - 1, Math.max(0, Math.floor((t - (now - TRACK_MS)) / 3_600_000)));
    const b = buckets[idx];
    b.count += 1;
    b.heat += e.heat || RANK_WEIGHT[e.rank] || 1;
    if (e.rank === "crazy") b.crazy += 1;
    if (e.rank === "spike") b.spike += 1;
  }

  for (const sample of pruneWindow(agentSamples)) {
    const t = Date.parse(sample.at);
    const idx = Math.min(TRACK_HOURS - 1, Math.max(0, Math.floor((t - (now - TRACK_MS)) / 3_600_000)));
    const flight = Number(sample.inFlight) || 0;
    buckets[idx].maxInFlight = Math.max(buckets[idx].maxInFlight, flight);
  }

  const surface = windowed.filter((e) => !isQueueTelemetry(e) && e.kind !== "agentCluster");
  const crazy = surface.filter((e) => e.rank === "crazy").length;
  const spike = surface.filter((e) => e.rank === "spike").length;
  const queueEdges = windowed.filter((e) => isQueueTelemetry(e)).length;
  const peakFlight = Math.max(0, ...buckets.map((b) => b.maxInFlight));
  const heatSum = buckets.reduce((a, b) => a + b.heat, 0);

  els.pumpMeta.textContent =
    surface.length || peakFlight
      ? `${surface.length} surface moves · peak queue ${peakFlight} · heat ${heatSum}`
      : `Waiting for measurable surface moves across ${TRACK_HOURS}h`;

  els.pumpStats.innerHTML = `
    <span class="pump-stat"><em>Crazy</em><strong>${crazy}</strong></span>
    <span class="pump-stat"><em>Spike</em><strong>${spike}</strong></span>
    <span class="pump-stat"><em>Queue edges</em><strong>${queueEdges}</strong></span>
    <span class="pump-stat"><em>Peak in-flight</em><strong>${peakFlight}</strong></span>
    <span class="pump-stat hot"><em>Tape heat</em><strong>${heatSum}</strong></span>
  `;

  const w = 720;
  const h = 140;
  const pad = { top: 12, bottom: 18, left: 4, right: 4 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const gap = 1.5;
  const barW = innerW / TRACK_HOURS - gap;
  const maxHeat = Math.max(3, ...buckets.map((b) => b.heat));
  const maxFlight = Math.max(1, ...buckets.map((b) => b.maxInFlight));

  const bars = buckets
    .map((b) => {
      const x = pad.left + b.i * (barW + gap);
      const bh = Math.max(b.heat > 0 ? 4 : 0, (b.heat / maxHeat) * (innerH * 0.72));
      const y = pad.top + innerH - bh;
      const hot = b.crazy > 0 || b.spike > 0;
      const fill = hot ? (b.crazy > 0 ? "#fb7185" : "#fbbf24") : "#34d399";
      const opacity = b.heat > 0 ? 0.85 : 0.12;
      return `<rect class="pump-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${bh.toFixed(2)}" rx="1.5" fill="${fill}" opacity="${opacity}">
        <title>${b.count} updates · heat ${b.heat}${b.maxInFlight ? ` · queue ${b.maxInFlight}` : ""}</title>
      </rect>`;
    })
    .join("");

  const agentDots = buckets
    .filter((b) => b.maxInFlight > 0)
    .map((b) => {
      const x = pad.left + b.i * (barW + gap) + barW / 2;
      const y = pad.top + innerH * (1 - b.maxInFlight / maxFlight) * 0.85 + 4;
      const r = Math.min(4.5, 1.8 + b.maxInFlight / maxFlight * 3);
      return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" fill="#67e8f9" opacity="0.9">
        <title>Agent queue peak ${b.maxInFlight}</title>
      </circle>`;
    })
    .join("");

  const baselineY = pad.top + innerH;
  els.pumpChart.setAttribute("viewBox", `0 0 ${w} ${h}`);
  els.pumpChart.innerHTML = `
    <defs>
      <linearGradient id="pumpGlow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4ade80" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <line x1="${pad.left}" y1="${baselineY}" x2="${w - pad.right}" y2="${baselineY}" stroke="rgba(74,222,128,0.2)" stroke-width="1"/>
    ${bars}
    ${agentDots}
  `;
}

function renderPieces(pieces = []) {
  if (!pieces.length) {
    els.pieces.innerHTML = `<p class="empty">Pieces appear after the first successful sniff.</p>`;
    return;
  }
  els.pieces.innerHTML = pieces
    .map(
      (p) => `
      <article class="piece tone-${escapeHtml(p.tone || "muted")}">
        <div class="piece-top">
          <span class="ico-wrap">${icon(PIECE_ICONS[p.id] || "spark")}</span>
          <div>
            <h3>${escapeHtml(p.title)}</h3>
            <p class="plain">${escapeHtml(p.plain)}</p>
          </div>
        </div>
        <p class="status">${escapeHtml(p.status)}</p>
        <p class="meaning">${escapeHtml(p.meaning)}</p>
        <ul>${(p.facts || []).map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
      </article>
    `,
    )
    .join("");
}

function renderCapGroups(groups = []) {
  if (!els.capGroups || els.capGroups.hidden) return;
  const onCount = groups.filter((g) => g.on).length;
  if (els.capMeta) {
    els.capMeta.textContent = `${onCount} active lanes · ids from /network/summary · grouped for humans`;
  }
  if (!groups.length) {
    els.capGroups.innerHTML = `<p class="empty">Waiting for capability map…</p>`;
    return;
  }
  els.capGroups.innerHTML = groups
    .map(
      (g) => `
      <article class="cap-group ${g.on ? "on" : "off"}">
        <div class="cap-group-top">
          <span class="ico-wrap sm">${icon(CAP_ICONS[g.id] || "spark")}</span>
          <h3>${escapeHtml(g.label)}</h3>
        </div>
        <div class="count">${g.count} powers ${g.on ? "on" : "off"}</div>
        <p>${escapeHtml(g.blurb)}</p>
        <div class="chips">
          ${(g.items || [])
            .slice(0, 6)
            .map((i) => `<span class="chip cap">${escapeHtml(i.label)}</span>`)
            .join("")}
          ${g.items?.length > 6 ? `<span class="chip">+${g.items.length - 6}</span>` : ""}
        </div>
      </article>
    `,
    )
    .join("");
}

function renderHorsepower(hp) {
  if (!els.hpScore) return;
  if (!hp) {
    els.hpHeadline.textContent = "On-demand horsepower";
    els.hpMeta.textContent = "Waiting for public Stacknet map…";
    els.hpSentence.textContent = "";
    els.hpScore.innerHTML = "";
    els.hpCompute.innerHTML = "";
    els.hpLanes.innerHTML = "";
    els.hpBrains.innerHTML = "";
    els.hpTools.innerHTML = "";
    els.hpBlocked.innerHTML = "";
    return;
  }

  const s = hp.scoreboard || {};
  const c = hp.compute || {};
  els.hpHeadline.textContent = hp.headline || "On-demand horsepower";
  els.hpMeta.textContent = hp.kicker || "Public Stacknet map";
  els.hpSentence.textContent = hp.sentence || "";

  els.hpScore.innerHTML = [
    ["Lanes on", `${s.onLanes ?? 0}/${s.totalLanes ?? 0}`],
    ["Powers", s.powers ?? "—"],
    ["Brains", s.apiModels ?? "—"],
    ["Widgets", s.widgets ?? "—"],
    ["Nodes", s.nodes ?? "—"],
    ["GPUs", s.gpus ?? "—"],
  ]
    .map(
      ([k, v]) =>
        `<span class="hp-stat"><em>${escapeHtml(k)}</em><strong>${escapeHtml(String(v))}</strong></span>`,
    )
    .join("");

  const nodeLine =
    c.nodes != null
      ? c.totalNodes != null
        ? `${c.nodes}/${c.totalNodes} nodes`
        : `${c.nodes} nodes`
      : "nodes —";
  const vramLine =
    c.vramFree != null && c.vramTotal != null
      ? `${c.vramFree}/${c.vramTotal} GB free`
      : "VRAM —";
  const flightLine = isFiniteNumber(c.inFlight)
    ? isFiniteNumber(c.maxInFlight)
      ? `${c.inFlight}/${c.maxInFlight} in flight`
      : `${c.inFlight} in flight`
    : "in flight —";

  els.hpCompute.innerHTML = `
    <div class="hp-compute-grid">
      <article class="hp-pill ${c.status === "healthy" ? "on" : "warn"}">
        <em>Status</em><strong>${escapeHtml(c.status || "—")}</strong>
        <span>${escapeHtml(c.version || "version —")}</span>
      </article>
      <article class="hp-pill on">
        <em>Machines</em><strong>${escapeHtml(nodeLine)}</strong>
        <span>${c.gpus != null ? `${c.gpus} GPUs` : "GPUs —"}</span>
      </article>
      <article class="hp-pill on">
        <em>VRAM</em><strong>${escapeHtml(vramLine)}</strong>
        <div class="bar tight"><i style="width:${Math.max(0, c.vramPct ?? 0)}%"></i></div>
      </article>
      <article class="hp-pill ${c.inFlight > 0 ? "busy" : "on"}">
        <em>Queue</em><strong>${escapeHtml(flightLine)}</strong>
        <span>load ${c.load ?? "—"}</span>
      </article>
    </div>
  `;

  els.hpLanes.innerHTML = (hp.lanes || [])
    .map((lane) => {
      const verbs = (lane.verbs || []).slice(0, 8);
      return `
      <article class="hp-lane ${lane.on ? "on" : "off"}">
        <header>
          <span class="ico-wrap sm">${icon(CAP_ICONS[lane.id] || "spark")}</span>
          <div>
            <h3>${escapeHtml(lane.label)}</h3>
            <p>${escapeHtml(lane.blurb || "")}</p>
          </div>
          <span class="hp-switch ${lane.on ? "on" : "off"}">${lane.on ? "ON" : "OFF"}</span>
        </header>
        <div class="hp-lane-meta">${lane.count || 0} public powers</div>
        <div class="chips dense">
          ${verbs.map((v) => `<span class="chip cap">${escapeHtml(v)}</span>`).join("")}
          ${(lane.verbs || []).length > 8 ? `<span class="chip">+${lane.verbs.length - 8}</span>` : ""}
        </div>
      </article>`;
    })
    .join("");

  els.hpBrains.innerHTML = (hp.brains || [])
    .map((b) => {
      const types = (b.types || []).slice(0, 5);
      const caps = (b.caps || []).slice(0, 6);
      return `
      <article class="hp-brain">
        <header>
          <h3>${escapeHtml(b.name)}</h3>
          <span class="hp-tag ${b.fromApi ? "api" : "guess"}">${b.fromApi ? "API" : "guessed"}</span>
        </header>
        <p>${escapeHtml(b.blurb || "")}</p>
        <div class="chips dense">
          ${types.map((t) => `<span class="chip type">${escapeHtml(t)}</span>`).join("")}
          ${caps.map((c) => `<span class="chip cap">${escapeHtml(c)}</span>`).join("")}
        </div>
      </article>`;
    })
    .join("") || `<p class="empty">No public /v1/models cards yet.</p>`;

  const tools = hp.tools || {};
  els.hpTools.innerHTML = `
    <div class="hp-tools-top">
      <span class="hp-stat"><em>Widgets live</em><strong>${escapeHtml(String(tools.widgets ?? "—"))}</strong></span>
      <span class="hp-stat wide"><em>MCP contract</em><strong>${escapeHtml(short(tools.mcp, 22, 0))}</strong></span>
    </div>
    <div class="hp-tool-rail">
      ${(tools.items || [])
        .map(
          (w) => `
        <article class="hp-tool">
          <h3>${escapeHtml(w.name)}</h3>
          <span>${escapeHtml(w.audience || "")}</span>
          <p>${escapeHtml(w.glance || "")}</p>
        </article>`,
        )
        .join("")}
    </div>
  `;

  els.hpBlocked.innerHTML = (hp.notShared || []).length
    ? (hp.notShared || [])
        .map(
          (b) => `
      <article class="hp-block">
        <strong>${escapeHtml(b.label)}</strong>
        <span>${escapeHtml(b.reason)}</span>
      </article>`,
        )
        .join("")
    : `<p class="empty soft">Nothing extra marked unavailable — public lanes above are the live map.</p>`;
}

function cellMark(level) {
  return level === "yes"
    ? `<span class="mark yes" aria-label="Yes">✓</span>`
    : `<span class="mark no" aria-label="No">—</span>`;
}

function renderTokenPlan(plan) {
  if (!els.pricePlans) return;
  if (!plan?.plans?.length) {
    if (els.priceHeadline) els.priceHeadline.textContent = "Geoff Token Plan";
    if (els.priceMeta) els.priceMeta.textContent = "Waiting for docs.geoff.ai…";
    if (els.priceSentence) {
      els.priceSentence.textContent = "One pool. Every modality. Public numbers.";
    }
    els.pricePlans.innerHTML = "";
    if (els.priceWins) els.priceWins.innerHTML = "";
    if (els.priceYield) els.priceYield.innerHTML = "";
    if (els.priceSheet) els.priceSheet.innerHTML = "";
    if (els.priceLimits) els.priceLimits.innerHTML = "";
    if (els.priceSource) els.priceSource.innerHTML = "";
    return;
  }

  if (els.priceHeadline) els.priceHeadline.textContent = plan.headline || "Geoff Token Plan";
  if (els.priceMeta) els.priceMeta.textContent = plan.kicker || "Value sheet · docs.geoff.ai";
  if (els.priceSentence) {
    els.priceSentence.textContent =
      plan.subhead || plan.model || "One pool. Every modality. Public numbers.";
  }

  if (els.priceWins) {
    els.priceWins.innerHTML = (plan.wins || [])
      .map(
        (w) => `
      <article class="price-win">
        <strong>${escapeHtml(w.k)}</strong>
        <span>${escapeHtml(w.v)}</span>
      </article>`,
      )
      .join("");
  }

  els.pricePlans.innerHTML = plan.plans
    .map((p) => {
      const hi = p.highlighted ? " highlighted" : "";
      return `
      <article class="price-tier tier-${escapeHtml(p.id)}${hi}">
        <p class="price-badge">${escapeHtml(p.badge || p.name)}</p>
        <h3>${escapeHtml(p.name)}</h3>
        <p class="price-amount">${escapeHtml(p.price)}</p>
        <p class="price-tokens"><span>${escapeHtml(p.tokens)}</span> tokens / mo</p>
        <p class="price-pitch">${escapeHtml(p.pitch || p.why || "")}</p>
      </article>`;
    })
    .join("");

  if (els.priceYield) {
    els.priceYield.hidden = true;
    els.priceYield.innerHTML = "";
  }

  if (els.priceSheet && plan.matrix?.length) {
    const heads = plan.plans
      .map(
        (p) => `
      <th class="${p.highlighted ? "hi" : ""}">
        <span class="sh-name">${escapeHtml(p.name)}</span>
        <span class="sh-price">${escapeHtml(p.price)}</span>
      </th>`,
      )
      .join("");
    const tokenRow = `
      <tr class="sheet-metric">
        <th scope="row">Monthly tokens</th>
        ${plan.plans.map((p) => `<td class="${p.highlighted ? "hi" : ""}"><strong>${escapeHtml(p.tokens)}</strong></td>`).join("")}
      </tr>`;
    const featureRows = plan.matrix
      .map((row) => {
        const cells = (row.levels || [])
          .map((lv, i) => {
            const hi = plan.plans[i]?.highlighted ? "hi" : "";
            return `<td class="${hi}">${cellMark(lv)}</td>`;
          })
          .join("");
        return `<tr><th scope="row">${escapeHtml(row.label)}</th>${cells}</tr>`;
      })
      .join("");
    els.priceSheet.innerHTML = `
      <table class="apple-sheet">
        <thead>
          <tr>
            <th scope="col">Compare</th>
            ${heads}
          </tr>
        </thead>
        <tbody>
          ${tokenRow}
          ${featureRows}
        </tbody>
      </table>`;
  }

  if (els.priceLimits) {
    els.priceLimits.innerHTML = `
      <div class="price-limits-head">API rate limits · per key</div>
      <div class="price-limits-grid">
        ${plan.plans
          .map(
            (p) => `
          <div class="price-limit${p.highlighted ? " hi" : ""}">
            <strong>${escapeHtml(p.name)}</strong>
            <span>${escapeHtml(p.rpm || "—")} RPM</span>
            <span>${escapeHtml(p.inputTpm || "—")} in</span>
            <span>${escapeHtml(p.outputTpm || "—")} out</span>
          </div>`,
          )
          .join("")}
      </div>
      ${plan.unfilteredNote ? `<p class="price-yield-note">${escapeHtml(plan.unfilteredNote)}</p>` : ""}`;
  }

  if (els.priceSource) {
    const overview = plan.sourceUrls?.overview || "https://docs.geoff.ai/token-plan/overview";
    const usage = plan.sourceUrls?.usage || "https://docs.geoff.ai/token-plan/usage";
    const note = plan.sections?.plans?.live && plan.sections?.limits?.live
      ? "Prices, token pools, and limits sniffed live from public docs"
      : plan.reason || "Bundled values pending a complete live docs parse";
    els.priceSource.innerHTML = `${escapeHtml(note)} ·
      <a href="${escapeHtml(overview)}" target="_blank" rel="noopener noreferrer">Overview sheet</a>
      ·
      <a href="${escapeHtml(usage)}" target="_blank" rel="noopener noreferrer">Usage & Limits</a>
      ·
      <a href="https://geoff.ai/settings/billing" target="_blank" rel="noopener noreferrer">Billing</a>`;
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sortFeed(events = []) {
  return [...events].sort((a, b) => {
    const rw = (RANK_WEIGHT[inferRank(b)] || 0) - (RANK_WEIGHT[inferRank(a)] || 0);
    if (rw !== 0) return rw;
    return Date.parse(b.at || 0) - Date.parse(a.at || 0);
  });
}

/** Newest first — What’s changing is a recent tape, not a severity leaderboard. */
function sortFeedRecent(events = []) {
  return [...events].sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
}

function renderCoverage(coverage) {
  if (!els.coverageMeta) return;
  if (!coverage) {
    els.coverageMeta.textContent = "Waiting for first sniff…";
    els.coverageChips.innerHTML = "";
    els.coverageNotes.innerHTML = "";
    return;
  }
  els.coverageMeta.textContent = `${coverage.live}/${coverage.total} live · ${coverage.skipped} not shared · ${coverage.failed} failed`;
  els.coverageChips.innerHTML = (coverage.rows || [])
    .map(
      (r) =>
        `<span class="cov-chip ${escapeHtml(r.state)}" title="${escapeHtml(r.reason || r.source)}">${escapeHtml(r.label)} · ${escapeHtml(r.state)}</span>`,
    )
    .join("");
  els.coverageNotes.innerHTML = (coverage.notes || [])
    .map((n) => `<li>${escapeHtml(n)}</li>`)
    .join("");
}

function renderAgentDesk(desk) {
  if (!els.agentDesk) return;
  if (!desk) {
    els.agentDesk.hidden = true;
    return;
  }
  els.agentDesk.hidden = false;
  els.agentDesk.className = `agent-desk status-${escapeHtml(desk.status || "quiet")}`;
  els.agentHeadline.textContent = desk.headline || "Agent desk";
  els.agentSentence.textContent = desk.sentence || "";
  els.agentDisclaimer.textContent = desk.disclaimer || "";
  els.agentSignals.innerHTML = (desk.signals || [])
    .map(
      (s) =>
        `<span class="agent-signal"><em>${escapeHtml(s.label)}</em><strong>${escapeHtml(s.value)}</strong></span>`,
    )
    .join("");
  els.agentCluster.innerHTML = (desk.cluster || [])
    .map(
      (c) =>
        `<li><span class="badge ${escapeHtml(c.rank || "note")}">${escapeHtml(c.rank || "note")}</span> ${escapeHtml(c.title)} — ${escapeHtml(c.summary)}</li>`,
    )
    .join("");
  hydrateIcons(els.agentDesk);
}

function resolveFeedEvents(payload, memoryEvents = []) {
  const raw =
    mode === "vercel"
      ? memoryEvents
      : payload.events?.length
        ? payload.events
        : memoryEvents;
  const briefMap = new Map((payload.briefing?.events || []).map((e) => [e.id, e]));
  const merged = raw.map((e) => (e?.id && briefMap.has(e.id) ? briefMap.get(e.id) : e));
  return normalizeFeedEvents(merged);
}

function isQueueTelemetry(event = {}) {
  return event.kind === "agent" || event.details?.dataset === "queue";
}

function splitDatasets(events = []) {
  const windowed = eventsInTrackWindow(events);
  const updates = [];
  const queue = [];
  for (const e of windowed) {
    if (isQueueTelemetry(e)) {
      queue.push(e);
      continue;
    }
    // Desk chrome / first lock-in — tracked, but not a "surface change"
    if (e.kind === "agentCluster" || e.kind === "baseline") continue;
    updates.push(e);
  }
  return { updates, queue, total: windowed.length };
}

function renderEventCard(event, { compact = false } = {}) {
  const rank = inferRank(event);
  const vibe = displayVibe(event);
  const float = !compact && (rank === "crazy" || rank === "spike");
  const signals = Array.isArray(event.details?.signals) ? event.details.signals.join(" · ") : "";
  return `
    <article class="event rank-${escapeHtml(rank)}${float ? " float" : ""}${compact ? " queue-item" : ""}">
      <div class="event-ico">${icon(EVENT_ICONS[event.kind] || "activity")}</div>
      <time datetime="${event.at}">${fmtTime(event.at)}</time>
      <div>
        <h3>${escapeHtml(event.title)}</h3>
        <p class="take">${escapeHtml(
          compact && signals ? signals : event.userTake || event.summary,
        )}</p>
        ${compact ? "" : `<p class="tech">${escapeHtml(event.summary)}</p>`}
      </div>
      <span class="badge ${compact ? "queue" : escapeHtml(rank)}">${compact ? "QUEUE" : escapeHtml(vibe)}</span>
    </article>
  `;
}

function renderFeed(events = [], { pollCount = 0 } = {}) {
  const { updates, queue, total } = splitDatasets(events);
  const recent = sortFeedRecent(updates).slice(0, FEED_RECENT_LIMIT);
  setFeedMeta({ surface: updates.length, queue: queue.length, pollCount });
  renderSettleBanner(events);

  if (!recent.length) {
    els.feed.innerHTML = `<p class="empty">Surface quiet in ${TRACK_HOURS}h — no deploy / models / docs / pricing diffs. Live activity is queue/in-flight (${queue.length} edges below). Not a sync miss.</p>`;
  } else {
    els.feed.innerHTML = recent.map((e) => renderEventCard(e)).join("");
  }

  if (els.queueMeta) {
    els.queueMeta.textContent = queue.length
      ? `${queue.length} in-flight/load edges · universal desk · not surface updates`
      : "in-flight / load · not counted as surface updates";
  }
  if (els.queueFeed) {
    if (!queue.length) {
      els.queueFeed.innerHTML = `<p class="empty">No queue edges yet — in-flight / load / tasks stay here when they move.</p>`;
    } else {
      els.queueFeed.innerHTML = sortFeedRecent(queue)
        .slice(0, FEED_RECENT_LIMIT)
        .map((e) => renderEventCard(e, { compact: true }))
        .join("");
    }
  }
}

function renderSettleBanner(events = []) {
  if (!els.settleBanner) return;
  const surfaced = (Array.isArray(events) ? events : [])
    .filter(
      (e) =>
        e &&
        ((e.surfaced && ["metaproofs", "solana", "keysale"].includes(e.kind)) ||
          (e.kind === "keysale" && e.rank === "crazy")),
    )
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  const latest = surfaced[0];
  if (!latest) {
    els.settleBanner.hidden = true;
    els.settleBanner.className = "settle-banner";
    els.settleBanner.innerHTML = "";
    return;
  }
  const rank = latest.rank === "crazy" ? "crazy" : "spike";
  els.settleBanner.hidden = false;
  els.settleBanner.className = `settle-banner ${escapeHtml(rank)}`;
  els.settleBanner.innerHTML = `
    <span class="settle-ico">${icon(EVENT_ICONS[latest.kind] || "activity")}</span>
    <div>
      <strong>${escapeHtml(latest.title)}</strong>
      <p>${escapeHtml(latest.userTake || latest.summary)}</p>
    </div>
    <time datetime="${latest.at}">${fmtTime(latest.at)}</time>
    <a class="settle-dismiss" href="#" role="button" aria-label="dismiss">×</a>
  `;
}

function renderModelCards(models = []) {
  if (!models.length) {
    els.modelCards.innerHTML = `<p class="empty">Waiting for model cards…</p>`;
    return;
  }
  els.modelCards.innerHTML = models
    .map(
      (m) => `
      <article class="model-card">
        <header>
          <div class="title-row">
            <span class="ico-wrap sm">${icon("brain")}</span>
            <h3>${escapeHtml(m.displayName || m.id)}</h3>
          </div>
          <span class="role">${escapeHtml(m.role || "Network model")}${m.roleGuessed ? " · guessed" : ""}</span>
        </header>
        <p class="use">${escapeHtml(m.use || m.description || "")}</p>
        <div class="chips">
          ${(m.skillLabels || m.capabilities || [])
            .slice(0, 8)
            .map((c) => `<span class="chip cap">${escapeHtml(c)}</span>`)
            .join("")}
          ${(m.contentTypes || [])
            .slice(0, 5)
            .map((c) => `<span class="chip type">${escapeHtml(c)}</span>`)
            .join("")}
          ${m.roleGuessed ? `<span class="chip guessed">role guessed</span>` : `<span class="chip type">api text</span>`}
        </div>
      </article>
    `,
    )
    .join("");
}

function renderWidgets(widgets = []) {
  if (!widgets.length) {
    els.widgets.innerHTML = `<p class="empty">Waiting for widgets…</p>`;
    return;
  }
  els.widgets.innerHTML = widgets
    .map(
      (w) => `
      <article class="widget">
        <div class="widget-top">
          <span class="ico-wrap sm">${icon("blocks")}</span>
          <h3>${escapeHtml(w.name || w.id)}</h3>
        </div>
        <div class="meta">${escapeHtml(w.audience || (w.isSystem ? "Built-in" : "Community"))} · ${escapeHtml(w.version || "v?")}</div>
        <p>${escapeHtml(w.glance || w.description || "Reusable answer block")}</p>
      </article>
    `,
    )
    .join("");
}

function renderGlossary(items = []) {
  if (!items.length) {
    els.glossary.innerHTML = "";
    return;
  }
  els.glossary.innerHTML = items
    .map(
      (g) => `
      <article>
        <h3>${escapeHtml(g.term)}</h3>
        <p>${escapeHtml(g.meaning)}</p>
      </article>
    `,
    )
    .join("");
}

function renderNetworkModels(models = [], guide = []) {
  const byId = new Map(guide.map((g) => [g.id, g]));
  if (!models.length) {
    els.models.innerHTML = `<p class="empty">No network model ids yet.</p>`;
    return;
  }
  els.models.innerHTML = models
    .map((id) => {
      const role = byId.get(id)?.role;
      return `<span class="chip" title="${escapeHtml(role || id)}">${escapeHtml(id)}${role ? ` · ${escapeHtml(role)}` : ""}</span>`;
    })
    .join("");
}

function mergeEventsById(a = [], b = []) {
  const map = new Map();
  for (const e of [...(a || []), ...(b || [])]) {
    if (!e?.id) continue;
    map.set(e.id, e);
  }
  return pruneWindow([...map.values()])
    .sort((x, y) => Date.parse(y.at || 0) - Date.parse(x.at || 0))
    .slice(0, MAX_MEMORY_EVENTS);
}

function agentSamplesFromEvents(events = []) {
  const out = [];
  for (const e of events || []) {
    if (!isQueueTelemetry(e)) continue;
    const d = e.details || {};
    let inFlight = d.inFlight ?? d.to ?? d.currFlight ?? null;
    if (inFlight == null) {
      const m = String(e.summary || "").match(/in-flight\s+(\d+)\s*→\s*(\d+)/i);
      if (m) inFlight = Number(m[2]);
      else {
        const m2 = String(e.summary || "").match(/in-flight\s+(\d+)/i);
        if (m2) inFlight = Number(m2[1]);
      }
    }
    if (inFlight == null || !Number.isFinite(Number(inFlight))) continue;
    out.push({
      at: e.at,
      inFlight: Number(inFlight),
      taskCount: d.tasks ?? d.taskCount ?? null,
      load: d.load ?? d.averageLoad ?? null,
    });
  }
  return pruneWindow(out);
}

function applyPayload(payload) {
  if (!payload?.latest && !payload?.briefing && !payload?.events) return;

  mode = payload.config?.mode || mode;

  const incomingEvents = pruneWindow(payload.events || []);
  const incomingDaily = pruneDailyActivity(payload.dailyActivity || [], HEATMAP_DAYS);
  const universal = payload.config?.trustMode === "universal";

  // Universal Redis desk: server wins. Local empty files must NEVER clobber richer browser history.
  if (universal && incomingEvents.length) {
    memory.events = incomingEvents.slice(0, MAX_MEMORY_EVENTS);
    memory.dailyActivity = mergeDailyActivity(memory.dailyActivity || [], incomingDaily, HEATMAP_DAYS);
  } else {
    memory.events = mergeEventsById(memory.events, incomingEvents);
    memory.dailyActivity = mergeDailyActivity(memory.dailyActivity || [], incomingDaily, HEATMAP_DAYS);
  }
  memory.latest = payload.latest || memory.latest;
  recordProbeSample(payload.latest);
  // Rebuild pump-tape queue dots from stored agent edges when browser samples were wiped.
  const derived = agentSamplesFromEvents(memory.events);
  if (derived.length > (memory.agentSamples?.length || 0)) {
    memory.agentSamples = derived;
  }
  memory.pollCount = payload.state?.pollCount || memory.pollCount || 0;
  saveMemory();

  const briefing = payload.briefing;
  const latest = payload.latest || memory.latest;
  const pollCount = payload.state?.pollCount ?? memory.pollCount ?? 0;
  const feedEvents = eventsInTrackWindow(memory.events || []);

  recordTracking(latest, payload.temperature);
  renderMetrics(latest);
  renderStory(briefing, payload.temperature);
  renderCoverage(briefing?.coverage || null);
  renderHorsepower(briefing?.horsepower || null);
  renderTokenPlan(briefing?.tokenPlan || CLIENT_TOKEN_PLAN);
  renderDocsCue(briefing?.docsBoard || null, feedEvents);
  renderLanesCue(briefing?.lanesBoard || null, latest, feedEvents);
  renderProbeLog();
  renderMaxCue(latest, feedEvents);
  renderAgentDesk(payload.agentDesk || briefing?.agentDesk || null);
  renderPumpTape(feedEvents, memory.agentSamples || []);
  renderHeatmap(memory.dailyActivity || []);
  renderPieces(briefing?.pieces || []);
  renderCapGroups(briefing?.capabilityGroups || []);
  renderFeed(feedEvents, { pollCount });
  renderModelCards(briefing?.models || latest?.sources?.["stacknet.models"]?.models || []);
  renderWidgets(briefing?.widgets || latest?.sources?.["stacknet.widgets"]?.widgets || []);
  renderGlossary(briefing?.glossary || []);
  renderNetworkModels(
    latest?.sources?.["stacknet.network"]?.models || [],
    briefing?.networkModelGuide || [],
  );

  setTrust(payload);
  if (payload.state?.lastError || payload.error) setConnection("error", "degraded");
}

async function pollNow() {
  els.pollBtn.disabled = true;
  try {
    const res = mode === "vercel"
      ? await fetch("/api/status", { cache: "no-store" })
      : await fetch("/api/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Poll failed");
    applyPayload(data);
    setConnection("live", "live");
  } catch (error) {
    setConnection("error", "refresh failed");
    console.error(error);
  } finally {
    els.pollBtn.disabled = false;
  }
}

function connectStream() {
  if (mode === "vercel") return null;
  const source = new EventSource("/api/stream");
  source.addEventListener("status", (event) => {
    try {
      const payload = JSON.parse(event.data);
      mode = payload.config?.mode || mode;
      applyPayload(payload);
      setConnection("live", "live");
    } catch (error) {
      console.error(error);
    }
  });
  source.onerror = () => setConnection("error", "reconnecting");
  return source;
}

function startMatrix() {
  const canvas = document.getElementById("matrix");
  if (!canvas) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    canvas.style.opacity = "0.12";
    return;
  }
  const ctx = canvas.getContext("2d");
  let columns = [];
  const glyphs = "01アイウエオカキクケコサシスセソGEOFFSTACKNETMCP<>/=#";
  const step = 16;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colCount = Math.floor(w / step);
    columns = Array.from({ length: colCount }, () => Math.random() * -50);
  }

  function tick() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.fillStyle = "rgba(11, 11, 14, 0.1)";
    ctx.fillRect(0, 0, w, h);
    ctx.font = '12px "IBM Plex Mono", ui-monospace, Menlo, monospace';
    for (let i = 0; i < columns.length; i++) {
      const ch = glyphs[(Math.random() * glyphs.length) | 0];
      const x = i * step;
      const y = columns[i] * step;
      ctx.fillStyle = "rgba(255, 214, 10, 0.78)";
      ctx.fillText(ch, x, y);
      ctx.fillStyle = "rgba(147, 197, 253, 0.28)";
      ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], x, y - step);
      if (y > h && Math.random() > 0.968) columns[i] = 0;
      columns[i] += 0.72 + (i % 5) * 0.04;
    }
    requestAnimationFrame(tick);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(tick);
}

els.pollBtn.addEventListener("click", pollNow);
hydrateIcons();
startMatrix();
// Paint the value sheet immediately — don't wait on a cold sniff.
renderTokenPlan(CLIENT_TOKEN_PLAN);
renderHeatmap(memory.dailyActivity || []);

async function boot() {
  try {
    const health = await fetch("/api/health").then((r) => r.json());
    mode = health.mode || "local";
    if (health.sharedStore) {
      setTrust({
        config: {
          sharedStore: true,
          sharedStoreUrl: health.sharedStoreUrl,
          trustMode: "shared",
        },
      });
    }
  } catch {
    mode = "vercel";
  }

  try {
    if (mode === "vercel") {
      // Production browsers only read the shared desk. They never trigger upstream sniffing.
      try {
        const status = await fetch("/api/status", { cache: "no-store" }).then((r) => r.json());
        if (!status.error) {
          applyPayload(status);
          setConnection("live", "live");
        }
        setInterval(() => {
          if (document.visibilityState === "visible") pollNow();
        }, 60_000);
      } catch {
        setConnection("error", "shared desk unavailable");
      }
    } else {
      const status = await fetch("/api/status").then((r) => r.json());
      mode = status.config?.mode || mode;
      applyPayload(status);
      setConnection("live", "live");
      connectStream();
    }
    refreshTraffic().catch(() => {});
  } catch (error) {
    console.error(error);
    mode = "vercel";
    setConnection("error", "shared desk unavailable");
  }
}

boot();
