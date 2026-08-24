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
  vramText: document.getElementById("vramText"),
  vramBar: document.getElementById("vramBar"),
  geoffBuild: document.getElementById("geoffBuild"),
  geoffDeploy: document.getElementById("geoffDeploy"),
  modelCount: document.getElementById("modelCount"),
  apiModelCount: document.getElementById("apiModelCount"),
  widgetCount: document.getElementById("widgetCount"),
  mcpContract: document.getElementById("mcpContract"),
  paperworkUsd: document.getElementById("paperworkUsd"),
  paperworkMeta: document.getElementById("paperworkMeta"),
  miningClaims: document.getElementById("miningClaims"),
  miningBand: document.getElementById("miningBand"),
  oxAlphaSpec: document.getElementById("oxAlphaSpec"),
  oxAlphaMeta: document.getElementById("oxAlphaMeta"),
  syncStatus: document.getElementById("syncStatus"),
  syncMeta: document.getElementById("syncMeta"),
  zenErrStatus: document.getElementById("zenErrStatus"),
  zenErrMeta: document.getElementById("zenErrMeta"),
  ghostCount: document.getElementById("ghostCount"),
  ghostMeta: document.getElementById("ghostMeta"),
  fleetCount: document.getElementById("fleetCount"),
  fleetLinesText: document.getElementById("fleetLinesText"),
  exploreCount: document.getElementById("exploreCount"),
  exploreMeta: document.getElementById("exploreMeta"),
  exploreCue: document.getElementById("exploreCue"),
  exploreCueLink: document.getElementById("exploreCueLink"),
  docsCue: document.getElementById("docsCue"),
  docsCueLink: document.getElementById("docsCueLink"),
  lanesCue: document.getElementById("lanesCue"),
  lanesCueLink: document.getElementById("lanesCueLink"),
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
  metaproofs: "layers",
};

let mode = "local";
let memory = loadMemory();
let pollTimer = null;
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

/* ---- Proof popups · receipts behind every metric ---- */
const SN_BASE = "https://stacknet.magma-rpc.com";
let lastLatest = null;
const SOLANA_DEFAULT = "D2KL4HWbc5URqBti9XLf2DwtiDYJs9wbX6z7tyWLoiH2";

const PROOFS = {
  stackVersion: {
    title: "Stacknet version",
    explain:
      "Self-reported by StackNet's own health and root endpoints. We display exactly what they publish — nothing inferred.",
    sources: ["stacknet.health", "stacknet.root"],
    fields: ["stacknetVersion", "mcpContract", "nodeId", "inFlight", "maxInFlight"],
    curls: [`curl -s ${SN_BASE}/health`, `curl -s ${SN_BASE}/`],
  },
  stackNodes: {
    title: "Nodes & GPUs",
    explain:
      "Live capacity counters from StackNet's public network map — their own numbers, re-sniffed every poll cycle.",
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
  widgetCount: {
    title: "Widgets / MCP",
    explain:
      "Public widget count plus whether the MCP contract was present on /health this sniff.",
    sources: ["stacknet.widgets", "stacknet.health"],
    fields: ["widgets", "mcpOnHealth", "mcpContract"],
    curls: [`curl -s ${SN_BASE}/widgets`, `curl -s ${SN_BASE}/health`],
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
  exploreCount: {
    title: "Explore board",
    explain: "Top-board counts from Geoff's public explore feed.",
    sources: ["geoff.explore"],
    fields: ["exploreCount", "exploreAuthors"],
    curls: ["curl -s https://www.geoff.ai/api/explore/feed"],
  },
  miningClaims: {
    title: "wPOND claims",
    explain:
      "Live parse of the wPOND Mining Rewards desk: claim-facet ON/OFF state and the miner band text. When the facet flips open, this fires an event on the tape.",
    sources: ["surface.mining"],
    fields: ["miningClaimsOn", "miningFacetState", "miningBand", "miningSurfaceTitle"],
    curls: ["curl -s https://wpond-mining-dashboard.vercel.app/ | grep -E 'claims-|facetState|subtitle'"],
  },
};

const CARD_PROOF_ORDER = [
  "stackVersion",
  "stackNodes",
  "vramText",
  "geoffBuild",
  "modelCount",
  "widgetCount",
  "paperworkUsd",
  "ghostCount",
  "fleetCount",
  "miningClaims",
  "exploreCount",
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
fetchPaperworkHistory().then(() => {
  if (lastLatest) renderMetrics(lastLatest);
});
setInterval(() => fetchPaperworkHistory(true), 5 * 60 * 1000);

function renderMetrics(latest) {
  lastLatest = latest ?? null;
  const s = latest?.summary ?? {};
  els.stackVersion.textContent = s.stacknetVersion || "—";
  els.stackHealth.textContent = s.stacknetStatus || "—";
  els.stackNodes.textContent =
    s.nodes != null && s.gpus != null ? `${s.nodes} / ${s.gpus}` : "—";
  const loadBits = [];
  if (s.averageLoad != null) loadBits.push(`load ${s.averageLoad}`);
  if (s.inFlight != null) {
    loadBits.push(
      s.maxInFlight != null ? `in-flight ${s.inFlight}/${s.maxInFlight}` : `in-flight ${s.inFlight}`,
    );
  }
  if (s.taskCount != null) loadBits.push(`tasks ${s.taskCount}`);
  els.stackLoad.textContent = loadBits.length ? loadBits.join(" · ") : "load —";
  if (s.availableVramGb != null && s.vramGb != null) {
    els.vramText.textContent = `${s.availableVramGb}/${s.vramGb} GB`;
    els.vramBar.style.width = `${s.vramAvailablePct ?? 0}%`;
  } else {
    els.vramText.textContent = "—";
    els.vramBar.style.width = "0%";
  }
  els.geoffBuild.textContent = short(s.geoffBuildId, 10, 6);
  if (s.geoffDeployId) {
    els.geoffDeploy.textContent = s.geoffDeployId;
  } else if (s.chunkHash) {
    els.geoffDeploy.textContent = `asset ${short(s.chunkHash, 4, 4)}`;
  } else {
    els.geoffDeploy.textContent = "—";
  }
  els.modelCount.textContent = s.models != null ? String(s.models) : "—";
  els.apiModelCount.textContent =
    s.apiModels != null
      ? `api ${s.apiModels}${s.models != null ? ` · net ${s.models}` : ""}`
      : "api —";
  if (els.apiModelCount) {
    els.apiModelCount.title =
      "api = public /v1/models cards · net = /network/summary routing lanes (not the same list)";
  }
  els.widgetCount.textContent = s.widgets != null ? String(s.widgets) : "—";
  if (s.mcpContract) {
    els.mcpContract.textContent = short(s.mcpContract, 22, 0);
    els.mcpContract.title = `MCP contract from Stacknet /health · ${s.mcpContract}`;
  } else {
    els.mcpContract.textContent = "not on /health";
    els.mcpContract.title =
      "remote_mcp missing on /health this sniff — docs.geoff.ai/mcp is still fingerprinted";
  }
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
    const press = Array.isArray(s.tokenPress)
      ? s.tokenPress.filter((t) => t.symbol && !["USDC", "mSOL"].includes(t.symbol))
      : [];
    if (press.length) bits.push(`press ${press.map((p) => p.symbol).join("·")}`);
    const d24 = paperworkVelocity(pwHistoryCache.series, 24 * 3600e3);
    if (d24 != null && Math.abs(d24) > 0.5)
      bits.push(`${d24 >= 0 ? "▲" : "▼"}${fmtCompactUsd(Math.abs(d24))}/24h`);
    els.paperworkMeta.textContent = bits.length ? bits.join(" · ") : "—";
    els.paperworkMeta.title = [
      `Booked vs paid metaproof ledger · chain balance via public Solana RPC${
        s.treasuryAddress ? ` · ${s.treasuryAddress}` : ""
      }`,
      press.length
        ? `Mint-authority tokens — INTERNAL TEST SCRIPT, microscopic float, zero liquidity. Do NOT buy any of these: ${press
            .map((p) => `${p.symbol}=${p.supplyUi}`)
            .join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
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
  if (els.miningClaims) {
    if (s.miningClaimsOn == null) {
      els.miningClaims.textContent = "—";
      els.miningClaims.style.color = "";
    } else {
      els.miningClaims.textContent = s.miningClaimsOn ? "OPEN" : "CLOSED";
      els.miningClaims.style.color = s.miningClaimsOn
        ? "var(--heat-bright)"
        : "var(--muted)";
    }
    const facet = s.miningFacetState ? ` · ${s.miningFacetState}` : "";
    els.miningClaims.title = `wPOND Mining Rewards desk · facet ${facet}\nClick for proof.`;
  }
  if (els.miningBand) {
    els.miningBand.textContent = s.miningBand || "watching the miner desk";
  }
  if (els.miningBand) {
    els.miningBand.textContent = s.miningBand || "watching the miner desk";
  if (els.exploreCount) {
    els.exploreCount.textContent = s.exploreCount != null ? String(s.exploreCount) : "—";
  }
  if (els.exploreMeta) {
    const bits = [];
    if (s.exploreAuthors != null) bits.push(`${s.exploreAuthors} creators`);
    const media = s.exploreMedia || {};
    for (const key of ["image", "video", "audio"]) {
      if (media[key]) bits.push(`${media[key]} ${key}`);
    }
    els.exploreMeta.textContent = bits.length ? bits.join(" · ") : "geoff.ai/explore";
    els.exploreMeta.title = "Top board from public /api/explore/feed";
  }
}
}

function renderExploreCue(board, events = []) {
  if (!els.exploreCue) return;
  const href = board?.url || "https://www.geoff.ai/explore";
  if (els.exploreCueLink) els.exploreCueLink.href = href;

  const recent = eventsInTrackWindow(events)
    .filter((e) => e.kind === "explore")
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  const hit = recent[0];

  if (hit) {
    const added = hit.details?.added?.length || 0;
    const titles = (hit.summary || "")
      .match(/“([^”]+)”/g)
      ?.map((t) => t.slice(1, -1))
      .slice(0, 2);
    const titleBit = titles?.length ? ` · ${titles.join(", ")}` : "";
    els.exploreCue.textContent =
      added > 0
        ? `New stuff added · +${added}${titleBit}`
        : hit.title || "Explore board moved";
    els.exploreCue.classList.add("hot");
    return;
  }

  els.exploreCue.classList.remove("hot");
  if (board?.count != null) {
    const media = board.mediaCounts || memory?.latest?.summary?.exploreMedia || {};
    const mix = ["video", "image", "audio"]
      .filter((k) => media[k])
      .map((k) => `${media[k]} ${k}`)
      .slice(0, 3)
      .join(" · ");
    els.exploreCue.textContent = mix
      ? `Top ${board.count} · ${mix}`
      : `No new posts in ${TRACK_HOURS}h · ${board.count} on the top board`;
  } else {
    els.exploreCue.textContent = "Watching for new posts…";
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
    const mcp = latestMcpToolsHint();
    els.docsCue.textContent = mcp
      ? `Armed · ${board.scraped}${total} · MCP ${mcp}`
      : `Armed · ${board.scraped}${total} pages watched`;
  } else {
    els.docsCue.textContent = "Fingerprinting docs…";
  }
}

function latestMcpToolsHint() {
  try {
    const pages = memory?.latest?.sources?.["geoff.docs.surface"]?.pages || [];
    return pages.find((p) => p.id === "mcp-tools")?.toolHint || null;
  } catch {
    return null;
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
        <div class="price-yield-mini">
          <span><em>Images</em>${escapeHtml(p.images || "—")}</span>
          <span><em>Videos (5s)</em>${escapeHtml(p.videos5s || "—")}</span>
          <span><em>Songs</em>${escapeHtml(p.songs || "—")}</span>
        </div>
      </article>`;
    })
    .join("");

  if (els.priceYield) {
    const est = plan.estimates || {};
    els.priceYield.innerHTML = `
      <div class="price-yield-head">
        <strong>Burn the whole pool on one lane</strong>
        <span>${escapeHtml(est.note || "Docs estimates · Videos (5s) = 5-second clips")}</span>
      </div>
      <div class="price-yield-grid">
        <article>
          <em>Images</em>
          <strong>~150K tokens each</strong>
          <p>${plan.plans.map((p) => `<span>${escapeHtml(p.name)} ${escapeHtml(p.images || "—")}</span>`).join("")}</p>
        </article>
        <article>
          <em>Videos (5 sec)</em>
          <strong>~5M tokens per 5-sec clip</strong>
          <p>${plan.plans.map((p) => `<span>${escapeHtml(p.name)} ${escapeHtml(p.videos5s || "—")}</span>`).join("")}</p>
        </article>
        <article>
          <em>Songs</em>
          <strong>~3M tokens per song</strong>
          <p>${plan.plans.map((p) => `<span>${escapeHtml(p.name)} ${escapeHtml(p.songs || "—")}</span>`).join("")}</p>
        </article>
      </div>
      ${est.nsfwNote ? `<p class="price-yield-note">${escapeHtml(est.nsfwNote)}</p>` : ""}`;
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
      </div>`;
  }

  if (els.priceSource) {
    const pricing = plan.sourceUrls?.pricing || "https://docs.geoff.ai/token-plan/pricing";
    const overview = plan.sourceUrls?.overview || "https://docs.geoff.ai/token-plan/overview";
    const note = plan.scraped
      ? "Sniffed live from public docs"
      : plan.reason || "Cached public docs tables";
    els.priceSource.innerHTML = `${escapeHtml(note)} ·
      <a href="${escapeHtml(overview)}" target="_blank" rel="noopener noreferrer">Overview sheet</a>
      ·
      <a href="${escapeHtml(pricing)}" target="_blank" rel="noopener noreferrer">Pricing</a>
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
  renderExploreCue(briefing?.exploreBoard || null, feedEvents);
  renderLanesCue(briefing?.lanesBoard || null, latest, feedEvents);
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
    const res = await fetch("/api/poll", {
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

function startClientPolling(intervalMs = 15_000) {
  if (pollTimer) clearInterval(pollTimer);
  const ms = Math.max(8_000, Number(intervalMs) || 15_000);
  pollTimer = setInterval(() => {
    pollNow().catch(() => {});
  }, ms);
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
      // Universal desk first — same JSON for every browser — then keep polling.
      try {
        const status = await fetch("/api/status", { cache: "no-store" }).then((r) => r.json());
        if (!status.error) {
          applyPayload(status);
          setConnection("live", "live");
          startClientPolling(status.config?.pollIntervalMs);
        }
      } catch {
        /* fall through to poll */
      }
      await pollNow();
      startClientPolling(15_000);
    } else {
      const status = await fetch("/api/status").then((r) => r.json());
      mode = status.config?.mode || mode;
      applyPayload(status);
      setConnection("live", "live");
      connectStream();
    }
  } catch (error) {
    console.error(error);
    mode = "vercel";
    await pollNow();
    startClientPolling();
  }
}

boot();
