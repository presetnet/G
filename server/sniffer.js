import { createHash } from "node:crypto";
import { config } from "./config.js";
import { loadMiningSurfaceCache, saveMiningSurfaceCache } from "./store.js";
import {
  TOKEN_PLAN_URLS,
  FALLBACK_TOKEN_PLAN,
  FEATURE_MATRIX,
  parseTokenPlanHtml,
  fingerprintTokenPlan,
} from "./token-plan.js";

const DEFAULT_TIMEOUT_MS = 18_000;
const MINING_SURFACE_CACHE_MS = 4 * 60 * 60 * 1000;
const configuredOutboundConcurrency = Number(process.env.GT_MAX_OUTBOUND_CONCURRENCY || 3);
const MAX_OUTBOUND_CONCURRENCY = Number.isFinite(configuredOutboundConcurrency)
  ? Math.max(1, Math.floor(configuredOutboundConcurrency))
  : 3;
let outboundActive = 0;
const outboundQueue = [];

async function limitedFetch(...args) {
  if (outboundActive >= MAX_OUTBOUND_CONCURRENCY) {
    await new Promise((resolve) => outboundQueue.push(resolve));
  } else {
    outboundActive += 1;
  }
  try {
    return await fetch(...args);
  } finally {
    const next = outboundQueue.shift();
    if (next) next();
    else outboundActive -= 1;
  }
}

async function fetchJson(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await limitedFetch(url, {
      headers: {
        Accept: "application/json, text/html;q=0.8, */*;q=0.5",
        "User-Agent": "GeoffThermometer/1.0 (+local sniffer)",
        ...headers,
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      url: res.url,
      ms: Date.now() - started,
      json,
      text,
      headers: Object.fromEntries(res.headers.entries()),
    };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders() {
  const headers = {};
  if (config.geoffCookie) headers.Cookie = config.geoffCookie;
  if (config.geoffPreviewCode) {
    headers.Authorization = `Bearer ${config.geoffPreviewCode}`;
    headers["x-preview-code"] = config.geoffPreviewCode;
  }
  return headers;
}

function extractDeployId(html) {
  if (!html) return null;
  const dpl = html.match(/dpl_[A-Za-z0-9]+/);
  return dpl?.[0] ?? null;
}

function extractChunkFingerprint(html) {
  if (!html) return null;
  const chunks = [...html.matchAll(/\/_next\/static\/chunks\/([^\"'?\s]+\.js)/g)].map((m) => m[1]);
  const unique = [...new Set(chunks)].sort();
  return {
    count: unique.length,
    sample: unique.slice(0, 8),
    hash: simpleHash(unique.join("|")),
  };
}

function simpleHash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String))].sort();
}

async function sniffGeoffVersion() {
  const res = await fetchJson(`${config.geoffBaseUrl}/api/version`);
  return {
    source: "geoff.version",
    ok: res.ok,
    status: res.status,
    ms: res.ms,
    buildId: res.json?.buildId ?? null,
    raw: res.json,
  };
}

async function sniffGeoffDeploy() {
  const res = await fetchJson(config.geoffBaseUrl, {
    headers: { Accept: "text/html" },
  });
  return {
    source: "geoff.deploy",
    ok: res.ok,
    status: res.status,
    ms: res.ms,
    deployId: extractDeployId(res.text),
    chunks: extractChunkFingerprint(res.text),
  };
}

async function sniffGeoffCatalog() {
  if (!config.geoffCookie && !config.geoffPreviewCode) {
    return {
      source: "geoff.catalog",
      ok: false,
      status: 0,
      skipped: true,
      reason: "Set GEOFF_COOKIE or GEOFF_PREVIEW_CODE to sniff authenticated catalogs",
      models: [],
      tools: [],
      mcpTools: [],
    };
  }

  const headers = authHeaders();
  const [models, tools, mcp] = await Promise.all([
    fetchJson(`${config.geoffBaseUrl}/api/catalog/models`, { headers }),
    fetchJson(`${config.geoffBaseUrl}/api/catalog/tools?scope=all`, { headers }),
    fetchJson(`${config.geoffBaseUrl}/api/catalog/remote-mcp-tools`, { headers }),
  ]);

  const modelIds = normalizeList(
    (models.json?.data ?? models.json?.models ?? models.json ?? [])
      .map?.((m) => m.id || m.name || m)
      .filter(Boolean) ?? [],
  );
  const toolIds = normalizeList(
    (tools.json?.data ?? tools.json?.tools ?? tools.json ?? [])
      .map?.((t) => t.id || t.name || t)
      .filter(Boolean) ?? [],
  );
  const mcpIds = normalizeList(
    (mcp.json?.data ?? mcp.json?.tools ?? mcp.json ?? [])
      .map?.((t) => t.id || t.name || t)
      .filter(Boolean) ?? [],
  );

  return {
    source: "geoff.catalog",
    ok: models.ok || tools.ok || mcp.ok,
    status: models.status,
    skipped: false,
    models: modelIds,
    tools: toolIds,
    mcpTools: mcpIds,
    ms: Math.max(models.ms, tools.ms, mcp.ms),
  };
}

async function sniffStacknetHealth() {
  const res = await fetchJson(`${config.stacknetBaseUrl}/health`);
  // Application health string (e.g. "healthy") — never confuse with HTTP status codes.
  const rawStatus = res.json?.status;
  const statusText =
    res.ok && typeof rawStatus === "string" && !/^\d{3}$/.test(rawStatus)
      ? rawStatus
      : null;
  return {
    source: "stacknet.health",
    ok: res.ok && Boolean(statusText),
    status: res.status,
    ms: res.ms,
    statusText,
    reachable: res.ok,
    httpError: res.ok ? null : res.status || "fetch_failed",
    version: res.json?.version ?? null,
    nodeId: res.json?.node_id ?? null,
    inFlight: res.json?.in_flight ?? null,
    maxInFlight: res.json?.max_in_flight ?? null,
    remoteMcp: res.json?.remote_mcp ?? null,
    error: res.ok
      ? statusText
        ? null
        : "Health JSON missing a string status field"
      : `HTTP ${res.status || 0} from /health`,
  };
}

async function sniffStacknetRoot() {
  const res = await fetchJson(`${config.stacknetBaseUrl}/`);
  return {
    source: "stacknet.root",
    ok: res.ok,
    status: res.status,
    ms: res.ms,
    version: res.json?.v ?? null,
  };
}

async function sniffStacknetNetwork() {
  const res = await fetchJson(`${config.stacknetBaseUrl}/network/summary`);
  const network = res.json?.network ?? {};
  return {
    source: "stacknet.network",
    ok: res.ok,
    status: res.status,
    ms: res.ms,
    totalNodes: network.totalNodes ?? null,
    availableNodes: network.availableNodes ?? null,
    totalGpus: network.totalGpus ?? null,
    totalVramGb: network.totalVramGb ?? null,
    availableVramGb: network.availableVramGb ?? null,
    averageLoad: network.averageLoad ?? null,
    totalModels: network.totalModels ?? null,
    models: normalizeList(network.models),
    capabilities: normalizeList(network.capabilities),
    treasury: res.json?.treasury
      ? {
          solPriceUsd: res.json.treasury.solPriceUsd ?? null,
          cluster: res.json.treasury.cluster ?? null,
          pendingObligations: res.json.treasury.pendingObligations ?? null,
          totalUsd: res.json.treasury.totalUsd ?? null,
          receivableUsd: res.json.treasury.receivableUsd ?? null,
          totalLamports: res.json.treasury.totalLamports ?? null,
          staleSeconds: res.json.treasury.staleSeconds ?? null,
          treasuryAddress: res.json.treasury.treasuryAddress ?? null,
          warnings: Array.isArray(res.json.treasury.warnings)
            ? res.json.treasury.warnings
            : [],
        }
      : null,
    metaproofs: res.json?.metaproofs
      ? {
          total: res.json.metaproofs.total ?? null,
          totalPaperworkUsd: res.json.metaproofs.totalPaperworkUsd ?? null,
          paidPaperworkUsd:
            res.json.metaproofs.totalPaidPaperworkMetaproofUsd ??
            res.json.metaproofs.paidPaperworkUsd ??
            null,
          outstandingUsd: res.json.metaproofs.outstandingUsd ?? null,
        }
      : null,
    timestamp: res.json?.timestamp ?? null,
  };
}

async function sniffStacknetPile() {
  const res = await fetchJson(`${config.stacknetBaseUrl}/api/v2/node-keys/pile`);
  const raw = res.json?.pile ?? null;
  const value = raw == null ? null : Number(raw);
  return {
    source: "stacknet.pile",
    ok: res.ok && Number.isFinite(value),
    status: res.status,
    ms: res.ms,
    pile: Number.isFinite(value) ? value : null,
    raw,
    docsUrl: "https://devconsole-indol.vercel.app/aisp/node-keys",
  };
}

async function sniffStacknetKeySale() {
  const res = await fetchJson(`${config.stacknetBaseUrl}/api/v2/node-keys/pricing`);
  const j = res.json || {};
  const keysSold = Number(j.keysSold);
  return {
    source: "stacknet.keysale",
    ok: res.ok && Number.isFinite(keysSold),
    status: res.status,
    ms: res.ms,
    saleActive: Boolean(j.saleActive),
    epoch: isFiniteNumber(j.currentEpoch) ? j.currentEpoch : null,
    day: isFiniteNumber(j.currentDay) ? j.currentDay : null,
    daysUntilHalving: isFiniteNumber(j.daysUntilHalving) ? j.daysUntilHalving : null,
    keysSold: Number.isFinite(keysSold) ? keysSold : null,
    priceUsd: isFiniteNumber(j.priceUsd) ? j.priceUsd : null,
    priceCents: isFiniteNumber(j.priceCents) ? j.priceCents : null,
    // NOTE: tokenAllocation in this response is NOT the per-key token grant.
    // Docs (/aisp/node-keys) state each Node Key carries +1B inference tokens.
    // The API's 15.6M figure is a sale-ticker unit, not the key grant — deliberately omitted
    // to avoid misreading it as "15.6M tokens per key."
    nextHalvingDate: j.nextHalvingDate ?? null,
    saleStartDate: j.saleStartDate ?? null,
    docsUrl: "https://devconsole-indol.vercel.app/aisp/node-keys",
    fingerprint: simpleHash(
      `${j.saleActive}|${j.currentEpoch ?? 0}|${j.currentDay ?? 0}|${keysSold || 0}|${j.priceUsd ?? 0}`,
    ),
  };
}

async function sniffStacknetX402() {
  const [latest, downloads] = await Promise.all([
    fetchJson("https://registry.npmjs.org/@stacknet/x402payg/latest"),
    fetchJson("https://api.npmjs.org/downloads/point/last-week/@stacknet/x402payg"),
  ]);
  const weeklyDownloads = Number(downloads.json?.downloads);
  const version = latest.json?.version ?? null;
  return {
    source: "stacknet.x402",
    ok: latest.ok && downloads.ok && Boolean(version) && Number.isFinite(weeklyDownloads),
    status: latest.ok && downloads.ok ? 200 : latest.status || downloads.status,
    ms: Math.max(latest.ms, downloads.ms),
    version,
    weeklyDownloads: Number.isFinite(weeklyDownloads) ? weeklyDownloads : null,
    periodStart: downloads.json?.start ?? null,
    periodEnd: downloads.json?.end ?? null,
    package: "@stacknet/x402payg",
    paymentMints: ["SOL", "USDC", "PAPER"],
    docsUrl: "https://docs.geoff.ai/introduction/x402-payg",
    fingerprint: simpleHash(`${version || ""}|${weeklyDownloads || 0}|${downloads.json?.end || ""}`),
  };
}

async function sniffStacknetNode() {
  const res = await fetchJson(`${config.stacknetBaseUrl}/node`);
  return {
    source: "stacknet.node",
    ok: res.ok,
    status: res.status,
    ms: res.ms,
    nodeId: res.json?.node_id ?? null,
    version: res.json?.version ?? null,
    coprocessorCount: res.json?.coprocessor_count ?? null,
    taskCount: res.json?.task_count ?? null,
  };
}

async function sniffStacknetModels() {
  const res = await fetchJson(`${config.stacknetBaseUrl}/v1/models`);
  const rows = Array.isArray(res.json?.data) ? res.json.data : [];
  const models = rows
    .map((m) => ({
      id: m.id,
      displayName: m.display_name || m.displayName || m.id,
      ownedBy: m.owned_by || m.ownedBy || null,
      description: m.description || null,
      capabilities: normalizeList(m.capabilities),
      contentTypes: normalizeList(m.content_types || m.contentTypes),
      created: m.created ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    source: "stacknet.models",
    ok: res.ok,
    status: res.status,
    ms: res.ms,
    count: models.length,
    ids: models.map((m) => m.id),
    models,
  };
}

async function sniffStacknetWidgets() {
  const res = await fetchJson(`${config.stacknetBaseUrl}/widgets`);
  const rows = Array.isArray(res.json?.widgets) ? res.json.widgets : [];
  const widgets = rows
    .map((w) => ({
      id: w.id,
      name: w.name || w.id,
      description: w.description || null,
      version: w.version || null,
      tags: normalizeList(w.tags),
      isSystem: Boolean(w.is_system ?? w.isSystem),
      isPublic: w.is_public ?? w.isPublic ?? true,
      usageCount: w.usage_count ?? w.usageCount ?? null,
      updatedAt: w.updated_at ?? w.updatedAt ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    source: "stacknet.widgets",
    ok: res.ok,
    status: res.status,
    ms: res.ms,
    count: widgets.length,
    ids: widgets.map((w) => w.id),
    widgets,
  };
}

/** Internal fleet taxonomy: stack-<line>-<base> naming axis + standalone bases. */
function fleetTaxonomy(models = []) {
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

const OPENCODE_ZEN_URL = "https://opencode.ai/zen/v1/models";
const ZEN_GHOST_WATCHLIST = [
  "big-pickle",
  "hy3-free",
  "laguna-s-2.1-free",
  "x-preview-f-free",
  "muse-spark-1.2-contributor-free",
];

export async function sniffOpencodeZen() {
  const res = await fetchJson(OPENCODE_ZEN_URL);
  const rows = Array.isArray(res.json?.data) ? res.json.data : [];
  const ids = rows.map((m) => String(m.id || "")).filter(Boolean).sort();
  const contexts = new Map();
  for (const m of rows) {
    const id = String(m.id || "");
    if (!id) continue;
    const raw =
      m.context_length ?? m.top_provider?.context_length ?? m.limit?.context ?? null;
    const n = Number(raw);
    contexts.set(id, Number.isFinite(n) && n > 0 ? n : null);
  }
  const ctxSum = (list) =>
    list.reduce((acc, id) => acc + (contexts.get(id) || 0), 0);
  const freeIds = ids.filter((id) => /(^|[-_])free$|free[-_]/.test(id) || id.endsWith("free"));
  const ghosts = ids.filter((id) => ZEN_GHOST_WATCHLIST.includes(id));
  return {
    source: "opencode.zen",
    ok: res.ok && ids.length > 0,
    status: res.status,
    ms: res.ms,
    count: ids.length,
    ids,
    freeCount: freeIds.length,
    freeIds,
    ghostIds: ghosts,
    missingGhosts: ZEN_GHOST_WATCHLIST.filter((g) => !ids.includes(g)),
    freeContextTotal: ctxSum(freeIds) || null,
    ghostContextTotal: ctxSum(ghosts) || null,
    fingerprint: simpleHash(ids.join("|")),
    reason: res.ok ? (ids.length ? null : "Zen catalog empty") : `HTTP ${res.status || 0} from zen`,
  };
}

const OPENCODE_REGISTRY_URL = "https://models.dev/api.json";
const MINING_SURFACE_URL =
  process.env.MINING_SURFACE_URL || "https://wpond-mining-dashboard.vercel.app/";
const MINING_PAYOUT_WALLET = "AYg4dKoZJudVkD7Eu3ZaJjkzfoaATUqfiv8w8pS53opT";
const MINING_PAYOUT_TOKEN_ACCOUNT = "2Ag1QgyyJj2nS6nD6SLbpAUFaWPhaDrmHwrGwWpMqV9K";
const WPOND_MINT = "3JgFwoYV74f6LwWjQWnr3YDPFnmBdwQfNyubv99jqUoq";
const MINING_CLAIM_MIN = 100_000_000;
const MINING_TX_DECODE_LIMIT = 24;
// The mining dashboard itself excludes these house / relay / token accounts
// from its miner roster. We mirror that so the 60-minute estimate counts only
// wallets that look like individual miners, and we never show a wPOND total.
const MINING_HOUSE_WALLETS = new Set([
  "2Ag1QgyyJj2nS6nD6SLbpAUFaWPhaDrmHwrGwWpMqV9K",
  "HwyJtiPXQ5ZosJQRpUmcmV6E2J9ffKfhqjNcY1R8Gt29",
  "7VocnjpSyCAvhk3zNVu5DqeGAvxbi8MMxEUvLznDFnok",
  "Hjzfr1BzWizuasoYJLa5Z7b1GFG9xWJcMSLpqfvctK82",
  "AYg4dKoZJudVkD7Eu3ZaJjkzfoaATUqfiv8w8pS53opT",
  "1orFCnFfgwPzSgUaoK6Wr3MjgXZ7mtk8NGz9Hh4iWWL",
  "HdM9481g5mXApUUsMSMxwVcRVcTde7nqLjGsgqMMf4P2",
  "5KXZCyUaqHJ1T2wbcMXvLt9jYR87tDJS2Bf71gxYSZNt",
  "9z9H5dA6AejJ1LpXbyENhXog3jfpjVFdDEFbuymHjFSL",
  "Fk6PvoxW9LcjSg9ix7EJAnrAViHmqoKonX15WDau2NYv",
  "G5YGpBWvwFo2Ah1HXmCrmMMMPrnmvsaNs7TwW3win4Qw",
  "CYaXLzjVneHu2tXNN5KtyiithTeiyEZFdniu8nk4wNGi",
  "HvYahPhM2ANz4cWKDmN8NCDP4aFbdrsRdrPNJEk8KQpQ",
]);
const MINING_60M_WINDOW_MS = 60 * 60 * 1_000;
const MINING_60M_TTL_MS = 6 * 60 * 1_000; // the 60m estimate refreshes every full pass

let mining60mCache = { at: 0, value: null };

async function sniffMiningPayouts({ force = false } = {}) {
  if (!force && mining60mCache.at && Date.now() - mining60mCache.at < MINING_60M_TTL_MS) {
    return mining60mCache.value;
  }
  const signatures = await solanaRpc("getSignaturesForAddress", [
    MINING_PAYOUT_TOKEN_ACCOUNT,
    { limit: 100, commitment: "confirmed" },
  ]);
  const successful = (Array.isArray(signatures) ? signatures : []).filter((row) => !row.err);
  const latestActivityDay = successful[0]?.blockTime != null
    ? new Date(successful[0].blockTime * 1000).toISOString().slice(0, 10)
    : null;
  const latestActivity = latestActivityDay
    ? successful.filter(
        (row) =>
          row.blockTime != null &&
          new Date(row.blockTime * 1000).toISOString().startsWith(latestActivityDay),
      )
    : [];
  const minBlockTime = (Date.now() - MINING_60M_WINDOW_MS) / 1000;
  const inWindow = successful.filter(
    (row) => row.blockTime != null && row.blockTime >= minBlockTime,
  );
  const payouts = [];
  const windowRecipients = new Set();
  let payouts60m = 0;
  const decodeRows = (inWindow.length ? inWindow : latestActivity).slice(0, MINING_TX_DECODE_LIMIT);
  for (const row of decodeRows) {
    const tx = await solanaRpc("getTransaction", [
      row.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]);
    if (!tx?.transaction?.message || tx.meta?.err) continue;
    const keys = (tx.transaction.message.accountKeys || []).map((key) =>
      typeof key === "string" ? key : key.pubkey,
    );
    const instructions = [
      ...(tx.transaction.message.instructions || []),
      ...((tx.meta?.innerInstructions || []).flatMap((group) => group.instructions || [])),
    ];
    for (const instruction of instructions) {
      const info = instruction?.parsed?.info;
      if (instruction?.parsed?.type !== "transfer" || info?.authority !== MINING_PAYOUT_WALLET) {
        continue;
      }
      const accountIndex = keys.indexOf(info.destination);
      const balance = (tx.meta?.postTokenBalances || []).find(
        (entry) => entry.accountIndex === accountIndex && entry.mint === WPOND_MINT,
      );
      if (!balance) continue;
      const decimals = Number(balance.uiTokenAmount?.decimals || 0);
      const amount = Number(info.amount) / 10 ** decimals;
      if (!Number.isFinite(amount) || amount < MINING_CLAIM_MIN) continue;
      const recipient = balance.owner || info.destination || null;
      payouts.push({
        signature: row.signature,
        at: row.blockTime != null ? new Date(row.blockTime * 1000).toISOString() : null,
        amount,
        recipient,
        destination: info.destination,
      });
      if (inWindow.length && row.blockTime >= minBlockTime) {
        payouts60m += 1;
        if (recipient && !MINING_HOUSE_WALLETS.has(recipient)) windowRecipients.add(recipient);
      }
    }
  }
  payouts.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  const latestDay = payouts[0]?.at?.slice(0, 10) || null;
  const latestBatch = latestDay ? payouts.filter((row) => row.at?.startsWith(latestDay)) : [];
  const silentSince = successful[0]?.blockTime != null
    ? new Date(successful[0].blockTime * 1000).toISOString()
    : null;
  const result = {
    payouts,
    latestDay,
    latestBatch,
    latestSignature: payouts[0]?.signature || null,
    latestAt: payouts[0]?.at || null,
    latestTotal: latestBatch.reduce((sum, row) => sum + row.amount, 0),
    activityCount: latestActivity.length,
    truncated: latestActivity.length > MINING_TX_DECODE_LIMIT,
    miners60m: windowRecipients.size || 0,
    payouts60m,
    miners60mWindowMs: MINING_60M_WINDOW_MS,
    miners60mAt: new Date().toISOString(),
    silentSince,
  };
  mining60mCache = { at: Date.now(), value: result };
  return result;
}

function bodyHash(input) {
  return createHash("sha256").update(input || "", "utf8").digest("hex").slice(0, 16);
}

function miningPayoutFields(payoutData) {
  return {
    payoutCount: payoutData.latestBatch.length,
    payoutTotal: payoutData.latestTotal,
    payoutDate: payoutData.latestDay,
    payoutLatestAt: payoutData.latestAt,
    payoutLatestSignature: payoutData.latestSignature,
    payoutActivityCount: payoutData.activityCount,
    payoutTruncated: payoutData.truncated,
    payouts: payoutData.latestBatch,
    miners60m: payoutData.miners60m,
    payouts60m: payoutData.payouts60m,
    miners60mWindowMs: payoutData.miners60mWindowMs,
    miners60mAt: payoutData.miners60mAt,
    silentSince: payoutData.silentSince,
  };
}

export async function sniffMiningSurface(force = false) {
  const payoutData = await sniffMiningPayouts();
  if (!force) {
    const cached = await loadMiningSurfaceCache().catch(() => null);
    const cachedAt = cached?.cachedAt ? Date.parse(cached.cachedAt) : NaN;
    if (
      cached?.source?.payoutWallet === MINING_PAYOUT_WALLET &&
      Number.isFinite(cachedAt) &&
      Date.now() - cachedAt < MINING_SURFACE_CACHE_MS
    ) {
      return {
        ...cached.source,
        cached: true,
        ageMs: Date.now() - cachedAt,
        ...miningPayoutFields(payoutData),
      };
    }
  }
  try {
    const [res, archiveRes] = await Promise.all([
      fetchJson(MINING_SURFACE_URL, { timeoutMs: 9_000 }),
      fetchJson(`${MINING_SURFACE_URL}band-claims-archive.json`, { timeoutMs: 18_000 }),
    ]);
    const text = res.text || "";
    const title = (text.match(/<title>([^<]{0,120})<\/title>/i) || [])[1] || null;
    const claimsClass = (text.match(/body class="[^"]*claims-(on|off)/i) || [])[1] || null;
    const facet =
      (text.match(/id="facetState"[^>]*>\s*([^<]{0,60})</i) || [])[1]?.trim() || null;
    const band = (text.match(/class="subtitle"[^>]*>\s*([^<]{0,160})</i) || [])[1]?.trim() || null;
    const source = {
      source: "surface.mining",
      ok: true,
      status: res.status,
      ms: res.ms,
      bytes: text.length,
      title,
      claimsOn: claimsClass ? claimsClass.toLowerCase() === "on" : null,
      facetState: facet,
      band,
      payoutWallet: MINING_PAYOUT_WALLET,
      payoutTokenAccount: MINING_PAYOUT_TOKEN_ACCOUNT,
      payoutMint: WPOND_MINT,
      payoutMinimum: MINING_CLAIM_MIN,
      ...miningPayoutFields(payoutData),
      archiveClaims: archiveRes.json?.summary?.totalClaims ?? null,
      archiveWallets: archiveRes.json?.summary?.uniqueWallets ?? null,
      archiveTotalWpond: archiveRes.json?.summary?.periods?.all?.totalWpond ?? null,
      archiveGeneratedAt: archiveRes.json?.summary?.dateGenerated ?? null,
      archiveMinimum: archiveRes.json?.summary?.claimBands?.normal?.[0] ?? null,
      fingerprint: simpleHash(
        `${res.status}:${text.length}:${title}:${claimsClass}:${facet}:${payoutData.latestSignature || "none"}`,
      ),
      reason: null,
    };
    await saveMiningSurfaceCache({ cachedAt: new Date().toISOString(), source }).catch(() => {});
    return source;
  } catch (error) {
    const source = {
      source: "surface.mining",
      ok: false,
      status: 0,
      ms: null,
      bytes: 0,
      title: null,
      claimsOn: null,
      facetState: null,
      band: null,
      ...miningPayoutFields(payoutData),
      fingerprint: null,
      reason: error?.message || String(error),
    };
    return source;
  }
}
const OPENCODE_RELEASES_URL =
  "https://api.github.com/repos/anomalyco/opencode/releases?per_page=5";
const OPENCODE_GO_URL = "https://opencode.ai/go";
const GO_LINEUP_NAMES = [
  "Kimi K3",
  "Grok 4.5",
  "Qwen3.8 Max",
  "GLM-5.2",
  "DeepSeek V4 Pro",
  "GPT 5.6 Luna",
  "MiniMax M3",
  "Qwen3.7 Plus",
  "DeepSeek V4 Flash",
  "MiMo-V2.5",
  "Hy3",
  "Muse Spark 1.2 Contributor",
  "Ox Alpha Free",
];
const RELEASES_CACHE_TTL_MS = 15 * 60 * 1000;
let releasesCache = { at: 0, value: null };

export async function sniffOpencodeRegistry() {
  const res = await fetchJson(OPENCODE_REGISTRY_URL);
  const providers =
    res.json && typeof res.json === "object" && !Array.isArray(res.json)
      ? res.json
      : {};
  const rows = [];
  for (const [providerId, provider] of Object.entries(providers)) {
    const models =
      provider?.models && typeof provider.models === "object"
        ? provider.models
        : {};
    for (const [modelId, model] of Object.entries(models)) {
      const name = String(model?.name || "").toLowerCase();
      const ghost = ZEN_GHOST_WATCHLIST.some(
        (g) => modelId === g || name.includes(g),
      );
      rows.push({
        key: `${providerId}/${modelId}`,
        provider: providerId,
        id: modelId,
        ghost,
      });
    }
  }
  const tracked = rows.filter(
    (r) => /opencode|zen/i.test(r.provider) || r.ghost,
  );
  const keys = tracked.map((r) => r.key).sort();
  const ghostSpecs = [];
  for (const r of tracked) {
    if (!r.ghost) continue;
    const raw =
      providers[r.provider]?.models?.[r.id] ?? {};
    ghostSpecs.push({
      key: r.key,
      id: r.id,
      displayName: raw.name ?? null,
      description: raw.description ? String(raw.description).slice(0, 160) : null,
      reasoning: Boolean(raw.reasoning),
      toolCall: Boolean(raw.tool_call),
      structuredOutput: Boolean(raw.structured_output),
      openWeights: raw.open_weights === true,
      knowledge: raw.knowledge ?? null,
      releaseDate: raw.release_date ?? null,
      lastUpdated: raw.last_updated ?? null,
      status: raw.status ?? null,
      contextLimit: Number(raw.limit?.context) || null,
      inputLimit: Number(raw.limit?.input) || null,
      outputLimit: Number(raw.limit?.output) || null,
      costInput: raw.cost?.input ?? null,
      costOutput: raw.cost?.output ?? null,
    });
  }
  return {
    source: "opencode.registry",
    ok: res.ok && rows.length > 0,
    status: res.status,
    ms: res.ms,
    registryProviders: Object.keys(providers).length,
    registryModels: rows.length,
    count: tracked.length,
    keys,
    ghostHits: tracked.filter((r) => r.ghost).map((r) => r.key),
    ghostSpecs,
    fingerprint: simpleHash(keys.join("|")),
    reason: res.ok
      ? rows.length
        ? null
        : "models.dev payload empty"
      : `HTTP ${res.status || 0} from models.dev`,
  };
}

function parseGoLadder(flatText, names) {
  const tokens = flatText.split(/\s+/);
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const isQuota = t === "∞" || /^[\d,]+$/.test(t);
    if (!isQuota) continue;
    for (const n of names) {
      if (out.some((row) => row.name === n)) continue;
      const words = n.split(/\s+/);
      if (words.every((w, j) => tokens[i + 1 + j] === w)) {
        out.push({ name: n, quota: t === "∞" ? "unlimited" : Number(t.replaceAll(",", "")) });
        i += words.length;
        break;
      }
    }
  }
  return names.map((n) => out.find((row) => row.name === n) ?? { name: n, quota: null });
}

export async function sniffOpencodeGo() {
  const res = await fetchJson(OPENCODE_GO_URL);
  const html = res.text || "";
  const flat = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const introMatch = html.match(/\$(\d+)\s*(?:for your first month|first month)/i);
  const monthlyMatches = [...html.matchAll(/\$(\d+)\s*\/\s*month/g)].map((m) => Number(m[1]));
  const freeQuotaMatch = html.match(/(\d+)\s*requests\s*\/\s*day/i);
  const equiv5h = html.match(/\$(\d+)\s*per 5 hours/i);
  const equivWeek = html.match(/\$(\d+)\s*per week/i);
  const equivMonth = html.match(/\$(\d+)\s*per month/i);
  const ladder = parseGoLadder(flat, GO_LINEUP_NAMES);
  const lineup = ladder.filter((r) => r.quota != null).map((r) => r.name);
  const bits = [
    introMatch?.[1] ?? "-",
    monthlyMatches[0] != null ? String(monthlyMatches[0]) : "-",
    freeQuotaMatch?.[1] ?? "-",
    equiv5h?.[1] ?? "-",
    equivWeek?.[1] ?? "-",
    equivMonth?.[1] ?? "-",
    String(lineup.length),
    ladder.map((r) => `${r.name}:${r.quota ?? "?"}`).join(","),
    html.includes("available on Go for a limited time") ? "promo" : "nopromo",
  ];
  return {
    source: "opencode.go",
    ok: res.ok && html.length > 200,
    status: res.status,
    ms: res.ms,
    priceIntroUsd: introMatch ? Number(introMatch[1]) : null,
    priceMonthlyUsd: monthlyMatches[0] ?? null,
    freeDailyRequests: freeQuotaMatch ? Number(freeQuotaMatch[1]) : null,
    equiv5hUsd: equiv5h ? Number(equiv5h[1]) : null,
    equivWeekUsd: equivWeek ? Number(equivWeek[1]) : null,
    equivMonthUsd: equivMonth ? Number(equivMonth[1]) : null,
    lineupCount: lineup.length,
    lineupNames: lineup,
    goLadder: ladder,
    oxAlphaPromo: html.includes("available on Go for a limited time"),
    gptLunaListed: html.includes("GPT 5.6 Luna"),
    tierTabs: [
      ...new Set([...flat.matchAll(/(\d+)x(?=\s)/g)].map((m) => Number(m[1]))),
    ].filter((v) => [1, 10, 25, 50, 100, 250].includes(v)),
    fingerprint: simpleHash(bits.join("|")),
    reason: res.ok ? null : `HTTP ${res.status || 0} from opencode.ai/go`,
  };
}

export async function sniffOpencodeReleases() {
  const started = Date.now();
  if (releasesCache.value && Date.now() - releasesCache.at < RELEASES_CACHE_TTL_MS) {
    return { ...releasesCache.value, cached: true, ms: Date.now() - started };
  }
  try {
    const res = await fetchJson(OPENCODE_RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "geoff-thermometer",
      },
    });
    const rows = Array.isArray(res.json) ? res.json : [];
    const latest = rows.find((r) => !r.draft) ?? null;
    const value = {
      source: "opencode.releases",
      ok: res.ok && rows.length > 0,
      status: res.status,
      ms: Date.now() - started,
      latestTag: latest?.tag_name ?? null,
      latestName: latest?.name ?? null,
      latestAt: latest?.published_at ?? null,
      recentTags: rows.map((r) => r.tag_name).filter(Boolean),
      fingerprint: simpleHash(rows.map((r) => String(r.tag_name)).join("|")),
      reason: res.ok
        ? rows.length
          ? null
          : "No releases returned"
        : `HTTP ${res.status || 0} from GitHub`,
    };
    if (value.ok) releasesCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    return {
      source: "opencode.releases",
      ok: false,
      status: 0,
      ms: Date.now() - started,
      latestTag: releasesCache.value?.latestTag ?? null,
      latestName: releasesCache.value?.latestName ?? null,
      latestAt: releasesCache.value?.latestAt ?? null,
      recentTags: [],
      fingerprint: null,
      reason: error?.message || String(error),
    };
  }
}

let zenErrCache = { at: 0, value: null };

export async function sniffZenErrorShape() {
  const started = Date.now();
  if (zenErrCache.value && Date.now() - zenErrCache.at < 60 * 60 * 1000) {
    return { ...zenErrCache.value, cached: true, ms: Date.now() - started };
  }
  try {
    const res = await fetchJson("https://opencode.ai/zen/v1/models/__gt_probe_nonexistent__", {
      timeoutMs: 9_000,
    });
    const body = res.text || "";
    const keys = Object.keys(res.json || {}).sort().join(",");
    const shape = res.json ? `json:${keys}` : `html:${body.length}`;
    const leakHit = /magma|stacknet|metaproof|6008/i.test(body);
    const value = {
      source: "opencode.zenerr",
      ok: true,
      status: res.status,
      ms: Date.now() - started,
      shape,
      leakHit,
      snippet: body.slice(0, 200),
      fingerprint: simpleHash(shape),
      reason: null,
    };
    zenErrCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    return {
      source: "opencode.zenerr",
      ok: false,
      status: 0,
      ms: Date.now() - started,
      shape: null,
      leakHit: false,
      fingerprint: null,
      reason: error?.message || String(error),
    };
  }
}

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const DEFAULT_TREASURY_ADDRESS = "2W5gxAio1Bz76P58EaDtGC71MuyH4ZAdXHu3qqmeGy7g";
const SIG_CACHE_TTL_MS = 10 * 60 * 1000;
let sigCache = { at: 0, value: null };

async function solanaRpc(method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await limitedFetch(SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    if (json?.error) throw new Error(json.error.message || "solana rpc error");
    return json?.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

export async function sniffSolanaTreasury(address = DEFAULT_TREASURY_ADDRESS) {
  const started = Date.now();
  try {
    const balRes = await solanaRpc("getBalance", [address, { commitment: "confirmed" }]);
    const lamports = typeof balRes?.value === "number" ? balRes.value : null;
    let sigs;
    if (sigCache.value && Date.now() - sigCache.at < SIG_CACHE_TTL_MS) {
      sigs = sigCache.value;
    } else {
      const sigRes = await solanaRpc("getSignaturesForAddress", [
        address,
        { limit: 1000, commitment: "confirmed" },
      ]);
      const rows = Array.isArray(sigRes) ? sigRes : [];
      sigs = {
        count: rows.length,
        pageFull: rows.length >= 1000,
        latestSlot: rows[0]?.slot ?? null,
        latestAt:
          rows[0]?.blockTime != null
            ? new Date(rows[0].blockTime * 1000).toISOString()
            : null,
      };
      sigCache = { at: Date.now(), value: sigs };
    }
    return {
      source: "solana.treasury",
      ok: lamports !== null,
      status: lamports !== null ? 200 : 0,
      ms: Date.now() - started,
      address,
      cluster: "mainnet",
      lamports,
      sol: lamports !== null ? lamports / 1e9 : null,
      sigCount: sigs.count,
      sigPageFull: sigs.pageFull,
      latestActivitySlot: sigs.latestSlot,
      latestActivityAt: sigs.latestAt,
      rpcUrl: SOLANA_RPC_URL,
      reason: lamports !== null ? null : "getBalance returned no value",
    };
  } catch (error) {
    return {
      source: "solana.treasury",
      ok: false,
      status: 0,
      ms: Date.now() - started,
      address,
      cluster: "mainnet",
      lamports: null,
      sol: null,
      sigCount: sigCache.value?.count ?? null,
      sigPageFull: false,
      latestActivitySlot: null,
      latestActivityAt: null,
      rpcUrl: SOLANA_RPC_URL,
      reason: error?.message || String(error),
    };
  }
}

export const DEFAULT_TOKEN_OWNER =
  process.env.GEOFF_TOKEN_OWNER ||
  process.env.GEOFF_TOKEN_AUTHORITY ||
  "D2KL4HWbc5URqBti9XLf2DwtiDYJs9wbX6z7tyWLoiH2";

function symbolFromMint(mint) {
  const known = [
    ["PAPERu8xjrqfjBLj8XG6FCiokuk7pG1GzUbRTYwX1nU", "PAPER"],
    ["CCPU6wgqmMiWigL3Tffpg7NgPfKuBRePTmrhxqqizWSa", "CCU"],
    ["CUSDxMH4nG6KeB5Qwf8ZWzEugHJBLnfcTAqk9GQy211u", "CUSD"],
    ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC"],
    ["mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", "mSOL"],
  ];
  const hit = known.find(([addr]) => addr === mint);
  if (hit) return hit[1];
  const vanity = mint.match(/^[A-Z]{3,6}/);
  return vanity ? vanity[0] : `${mint.slice(0, 4)}…`;
}

export async function sniffSolanaTokens(owner = DEFAULT_TOKEN_OWNER) {
  const started = Date.now();
  try {
    const accountsRes = await solanaRpc("getTokenAccountsByOwner", [
      owner,
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { encoding: "jsonParsed" },
    ]);
    const accounts = accountsRes?.value ?? [];
    const mints = [];
    for (const acc of accounts) {
      const info = acc?.account?.data?.parsed?.info;
      if (!info?.mint) continue;
      const supplyRes = await solanaRpc("getTokenSupply", [info.mint]);
      const sv = supplyRes?.value ?? {};
      const supplyRaw = Number(sv.amount ?? 0);
      const decimals = Number(sv.decimals ?? info.tokenAmount?.decimals ?? 0);
      mints.push({
        mint: info.mint,
        symbol: symbolFromMint(info.mint),
        balanceUi: Number(info.tokenAmount?.uiAmountString ?? 0),
        supplyUi: decimals > 0 ? supplyRaw / 10 ** decimals : supplyRaw,
        decimals,
        mintAuthority: null,
      });
    }
    for (const row of mints) {
      try {
        const mi = await solanaRpc("getAccountInfo", [row.mint, { encoding: "jsonParsed" }]);
        row.mintAuthority = mi?.value?.data?.parsed?.info?.mintAuthority ?? null;
      } catch {}
    }
    const order = [...mints].sort((a, b) => a.mint.localeCompare(b.mint));
    return {
      source: "solana.tokens",
      ok: true,
      status: 200,
      ms: Date.now() - started,
      owner,
      mints: order,
      fingerprint: simpleHash(
        order.map((m) => `${m.mint}:${m.supplyUi}`).join("|"),
      ),
      reason: null,
    };
  } catch (error) {
    return {
      source: "solana.tokens",
      ok: false,
      status: 0,
      ms: Date.now() - started,
      owner,
      mints: [],
      fingerprint: null,
      reason: error?.message || String(error),
    };
  }
}

const POND0X_PROGRAM = "T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt";
const POND0X_TREASURY = "cPUtmyb7RZhCaTusCb4qnPJjVTbwpJ6SpXUCvnBDU4a";
const POND0X_SAMPLE_TARGET = 10;
const POND0X_QUIET_MS = 90 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTransactionWithRetry(signature) {
  const attempt = () =>
    solanaRpc("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]).catch(() => null);
  let tx = await attempt();
  if (!tx) {
    await sleep(250);
    tx = await attempt();
  }
  return tx;
}

/** All system-transfer destinations of a parsed transaction, if any. */
function trixTransferDestinations(tx) {
  const destinations = new Set();
  const instructions = [
    ...(tx?.meta?.innerInstructions || []).flatMap((entry) => entry.instructions || []),
    ...(tx?.transaction?.message?.instructions || []),
  ];
  for (const instruction of instructions) {
    if (
      instruction?.program === "system" &&
      instruction?.parsed?.type === "transfer" &&
      instruction.parsed.info?.destination
    ) {
      destinations.add(instruction.parsed.info.destination);
    }
  }
  return destinations;
}

async function samplePond0xMiners(rows, target = POND0X_SAMPLE_TARGET) {
  const feePayers = new Set();
  let decoded = 0;
  const span = Math.max(1, (rows || []).length - 1);
  for (let k = 0; k < target; k += 1) {
    const idx = Math.round((k * span) / Math.max(1, target - 1));
    const row = rows?.[idx];
    if (!row?.signature) continue;
    const tx = await getTransactionWithRetry(row.signature);
    if (tx?.meta?.err || !tx?.transaction?.message?.accountKeys?.length) continue;
    decoded += 1;
    const first = tx.transaction.message.accountKeys[0];
    const payer = typeof first === "string" ? first : first?.pubkey || null;
    if (payer) feePayers.add(payer);
  }
  const unique = feePayers.size;
  const ratio = decoded > 0 ? unique / decoded : null;
  return {
    sampleCount: decoded,
    sampledUnique: unique,
    sampledUniqueRatio: ratio,
    estActiveMiners:
      ratio != null && (rows || []).length > 0
        ? Math.max(1, Math.round(rows.length * ratio))
        : null,
  };
}

/** On-chain Pond0x mining desk: aggregate activity + unique-signer estimate. No user wallets. */
export async function sniffPond0x({ previous = null } = {}) {
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  const base = {
    source: "pond0x.mining",
    ok: false,
    status: 0,
    ms: null,
    checkedAt,
    program: POND0X_PROGRAM,
    treasury: POND0X_TREASURY,
    cluster: "mainnet",
    rpcUrl: SOLANA_RPC_URL,
    reason: null,
  };
  try {
    const sigRes = await solanaRpc("getSignaturesForAddress", [
      POND0X_PROGRAM,
      { limit: 1000, commitment: "confirmed" },
    ]);
    const rows = (Array.isArray(sigRes) ? sigRes : []).filter(
      (row) => !row.err && row.blockTime != null,
    );
    if (!rows.length) {
      return {
        ...base,
        ms: Date.now() - started,
        status: 200,
        reason: "No successful program signatures in window",
      };
    }

    const newestAt = new Date(rows[0].blockTime * 1000).toISOString();
    const oldestAt = new Date(rows[rows.length - 1].blockTime * 1000).toISOString();
    const spanSeconds = Math.max(1, rows[0].blockTime - rows[rows.length - 1].blockTime);
    const activityCount = rows.length;
    const pageFull = Array.isArray(sigRes) && sigRes.length >= 1000;
    const rawRate = (activityCount - 1) * 60 / spanSeconds;
    const ratePerMinute = Number.isFinite(rawRate)
      ? Math.round(rawRate * 10) / 10
      : null;

    const prevChecked = previous?.checkedAt ? Date.parse(previous.checkedAt) : NaN;
    const quiet =
      Number.isFinite(prevChecked) &&
      Date.now() - prevChecked < POND0X_QUIET_MS &&
      previous?.latestSignature === rows[0].signature;

    let sampled = false;
    let cached = quiet;
    let sampleCount = 0;
    let sampledUnique = 0;
    let sampledUniqueRatio = null;
    let estActiveMiners = null;
    if (!quiet) {
      const sample = await samplePond0xMiners(rows);
      sampled = true;
      sampleCount = sample.sampleCount;
      sampledUnique = sample.sampledUnique;
      sampledUniqueRatio = sample.sampledUniqueRatio;
      estActiveMiners = sample.estActiveMiners;
    }

    const balanceAttempt = () =>
      solanaRpc("getBalance", [POND0X_TREASURY, { commitment: "confirmed" }]).catch(() => null);
    let balRes = await balanceAttempt();
    if (!balRes) {
      await sleep(250);
      balRes = await balanceAttempt();
    }
    const treasuryLamports =
      typeof balRes?.value === "number" ? balRes.value : null;

    return {
      ...base,
      ok: true,
      status: 200,
      ms: Date.now() - started,
      latestSignature: rows[0].signature,
      activityCount,
      pageFull,
      windowSeconds: spanSeconds,
      windowMinutes: Math.round((spanSeconds / 60) * 10) / 10,
      ratePerMinute,
      sampled,
      cached,
      sampleCount,
      sampledUnique,
      sampledUniqueRatio,
      estActiveMiners,
      treasurySol: treasuryLamports != null ? treasuryLamports / 1e9 : null,
      newestAt,
      oldestAt,
      latestAt: newestAt,
    };
  } catch (error) {
    return {
      ...base,
      ms: Date.now() - started,
      reason: error?.message || String(error),
    };
  }
}

export function summarizePond0x(source) {
  if (!source || typeof source !== "object") {
    return {
      pond0xOk: false,
      pond0xRatePerMinute: null,
      pond0xActivityCount: null,
      pond0xWindowMinutes: null,
      pond0xEstActiveMiners: null,
      pond0xUniqueRatio: null,
      pond0xTreasurySol: null,
      pond0xLatestAt: null,
      pond0xSampled: false,
      pond0xReason: null,
    };
  }
  return {
    pond0xOk: Boolean(source.ok),
    pond0xRatePerMinute: source.ratePerMinute ?? null,
    pond0xActivityCount: source.activityCount ?? null,
    pond0xWindowMinutes: source.windowMinutes ?? null,
    pond0xEstActiveMiners: source.estActiveMiners ?? null,
    pond0xUniqueRatio: source.sampledUniqueRatio ?? null,
    pond0xTreasurySol: source.treasurySol ?? null,
    pond0xLatestAt: source.latestAt ?? null,
    pond0xSampled: Boolean(source.sampled),
    pond0xReason: source.reason ?? null,
  };
}

/** Node-key payout wallet on the public 9G SOL leaderboard. Sender identities are hashed, never kept in full. */
const GEOF_KEYS_9G_WALLET = "9GjEVnpWiLe2uknUmtaH6DSfgcBvL66DtSKGREXDctZU";
const GEOF_KEYS_9G_DECODE_LIMIT = 10;
const GEOF_KEYS_9G_CACHE_MS = 15 * 60 * 1000;
let geof9gCache = { at: 0, value: null };

const hash9gAddr = (addr) =>
  createHash("sha256").update(String(addr)).digest("hex").slice(0, 16);

export async function sniffNodeKeys9g() {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const base = {
    source: "geoff.keys.9g",
    ok: false,
    status: 0,
    ms: null,
    checkedAt: startedAt,
    wallet: GEOF_KEYS_9G_WALLET,
    cluster: "mainnet",
    reason: null,
  };
  if (geof9gCache.value && Date.now() - geof9gCache.at < GEOF_KEYS_9G_CACHE_MS) {
    return { ...geof9gCache.value, cached: true, ms: Date.now() - started };
  }
  try {
    const sigRes = await solanaRpc("getSignaturesForAddress", [
      GEOF_KEYS_9G_WALLET,
      { limit: 1000, commitment: "confirmed" },
    ]);
    const rows = (Array.isArray(sigRes) ? sigRes : []).filter(
      (row) => !row.err && row.blockTime != null,
    );
    if (!rows.length) {
      const value = {
        ...base,
        ok: true,
        status: 200,
        ms: Date.now() - started,
        windowTx: 0,
        decoded: 0,
        solIn: null,
        senders: null,
        reason: "No successful signatures in window",
      };
      geof9gCache = { at: Date.now(), value };
      return value;
    }

    const inbound = [];
    const decodeCount = Math.min(GEOF_KEYS_9G_DECODE_LIMIT, rows.length);
    for (let k = 0; k < decodeCount; k += 1) {
      const row = rows[k];
      const tx = await getTransactionWithRetry(row.signature);
      if (!tx?.meta?.preBalances || tx.meta.err || !Array.isArray(tx.meta.preBalances) || !Array.isArray(tx.meta.postBalances)) continue;
      const keys = tx.transaction?.message?.accountKeys || [];
      const index = keys.findIndex(
        (key) => (typeof key === "string" ? key : key?.pubkey) === GEOF_KEYS_9G_WALLET,
      );
      if (index < 0) continue;
      const lamports = tx.meta.postBalances[index] - tx.meta.preBalances[index];
      if (lamports <= 0) continue;
      const payer = keys[0] ? (typeof keys[0] === "string" ? keys[0] : keys[0]?.pubkey) : null;
      inbound.push({
        at: row.blockTime * 1000,
        sol: lamports / 1e9,
        senderHash: payer ? hash9gAddr(payer) : null,
      });
    }
    inbound.sort((a, b) => b.at - a.at);
    if (!inbound.length) {
      const value = {
        ...base,
        ok: true,
        status: 200,
        ms: Date.now() - started,
        windowTx: rows.length,
        decoded: 0,
        solIn: null,
        senders: null,
        sol24h: null,
        tx24h: 0,
        reason: "No inbound SOL transfers decoded in recent window",
      };
      geof9gCache = { at: Date.now(), value };
      return value;
    }

    const now = Date.now();
    const dayAgo = now - 24 * 3600 * 1000;
    const recent24h = inbound.filter((r) => r.at >= dayAgo);
    const solIn = inbound.reduce((sum, r) => sum + r.sol, 0);
    const bySender = new Map();
    for (const r of inbound) {
      const key = r.senderHash || "unknown";
      const entry = bySender.get(key) || { first: r.at, last: r.at, tx: 0, sol: 0 };
      entry.first = Math.min(entry.first, r.at);
      entry.last = Math.max(entry.last, r.at);
      entry.tx += 1;
      entry.sol += r.sol;
      bySender.set(key, entry);
    }
    const cohorts = [...bySender.entries()]
      .map(([sender, entry]) => ({
        sender: sender.slice(0, 12),
        first: new Date(entry.first).toISOString(),
        last: new Date(entry.last).toISOString(),
        tx: entry.tx,
        sol: Math.round(entry.sol * 1000) / 1000,
      }))
      .sort((a, b) => b.sol - a.sol)
      .slice(0, 5);

    const senderHashes = [...bySender.keys()].filter((key) => key !== "unknown");

    const value = {
      ...base,
      ok: true,
      status: 200,
      ms: Date.now() - started,
      windowTx: rows.length,
      decoded: inbound.length,
      solIn: Math.round(solIn * 1000) / 1000,
      senders: bySender.size,
      senderHashes,
      avgSolPerTx: Math.round((solIn / inbound.length) * 1000) / 1000,
      sol24h: Math.round(recent24h.reduce((sum, r) => sum + r.sol, 0) * 1000) / 1000,
      tx24h: recent24h.length,
      cohorts,
      newestAt: new Date(inbound[0].at).toISOString(),
      oldestAt: new Date(inbound[inbound.length - 1].at).toISOString(),
      cached: false,
      reason: null,
    };
    geof9gCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    return {
      ...base,
      ms: Date.now() - started,
      reason: error?.message || String(error),
    };
  }
}

export function summarizeKey9g(source) {
  if (!source || typeof source !== "object") {
    return {
      key9gOk: false,
      key9gSolIn: null,
      key9gSenders: null,
      key9gDecoded: null,
      key9gSol24h: null,
      key9gTx24h: null,
      key9gCohorts: [],
      key9gFundingHits: [],
      key9gNewestAt: null,
      key9gReason: null,
    };
  }
  const visited = new Set();
  const hits = [];
  for (const [label, address] of [
    ["stacknet-treasury", DEFAULT_TREASURY_ADDRESS],
    ["pond0x-treasury", POND0X_TREASURY],
  ]) {
    const digest = hash9gAddr(address);
    if (
      Array.isArray(source.senderHashes) &&
      source.senderHashes.includes(digest) &&
      !visited.has(digest)
    ) {
      visited.add(digest);
      hits.push(label);
    }
  }
  return {
    key9gOk: Boolean(source.ok),
    key9gSolIn: source.solIn ?? null,
    key9gSenders: source.senders ?? null,
    key9gDecoded: source.decoded ?? null,
    key9gSol24h: source.sol24h ?? null,
    key9gTx24h: source.tx24h ?? null,
    key9gCohorts: Array.isArray(source.cohorts) ? source.cohorts : [],
    key9gFundingHits: hits,
    key9gNewestAt: source.newestAt ?? null,
    key9gReason: source.reason ?? null,
  };
}

/** Public docs pages we fingerprint so silent surface moves show up in the feed. */
const DOCS_SURFACE_PAGES = [
  // Introduction
  { id: "api-overview", path: "/introduction/overview", label: "API Overview" },
  { id: "quickstart", path: "/introduction/quickstart", label: "Quickstart" },
  { id: "auth", path: "/introduction/authentication", label: "Authentication" },
  { id: "x402", path: "/introduction/x402-payg", label: "x402 PAYG" },
  { id: "models", path: "/introduction/models", label: "Models" },
  // Geoff Code
  { id: "geoff-code", path: "/geoff-code/getting-started", label: "Geoff Code" },
  { id: "geoff-code-use-cases", path: "/geoff-code/use-cases", label: "Geoff Code Use Cases" },
  { id: "geoff-code-mcp", path: "/geoff-code/mcp", label: "Geoff Code MCP" },
  { id: "geoff-code-plugins", path: "/geoff-code/plugins", label: "Geoff Code Plugins" },
  { id: "geoff-code-hooks", path: "/geoff-code/hooks", label: "Geoff Code Hooks" },
  { id: "geoff-code-skills", path: "/geoff-code/skills", label: "Geoff Code Skills" },
  { id: "geoff-code-subagents", path: "/geoff-code/subagents", label: "Geoff Code Subagents" },
  { id: "geoff-code-acp", path: "/geoff-code/acp", label: "Geoff Code ACP" },
  // API Reference: one representative page per published category.
  { id: "api-reference", path: "/api-reference/overview", label: "API Reference" },
  { id: "api-text", path: "/api-reference/text/openai-api", label: "OpenAI-compatible API" },
  { id: "api-speech", path: "/api-reference/speech/t2a-http", label: "Speech API" },
  { id: "api-training", path: "/api-reference/training/image-lora", label: "Training API" },
  { id: "api-video", path: "/api-reference/video/text-to-video", label: "Video API" },
  { id: "api-image", path: "/api-reference/image/text-to-image", label: "Image API" },
  { id: "api-music", path: "/api-reference/music/generate", label: "Music API" },
  { id: "api-code", path: "/api-reference/code/execute", label: "Code API" },
  { id: "api-files", path: "/api-reference/file/upload", label: "File API" },
  // Token Plan
  { id: "token-overview", path: "/token-plan/overview", label: "Token Plan Overview" },
  { id: "usage", path: "/token-plan/usage", label: "Usage & Limits" },
];
const DOCS_LINKED_PAGE_COUNT = 70;

/** Prefer main/article/prose body so shared docs chrome doesn't fake-move every page. */
function extractDocsBodyText(html = "") {
  const chunk =
    (html.match(/<main[\s\S]*?<\/main>/i) || [])[0] ||
    (html.match(/<article[\s\S]*?<\/article>/i) || [])[0] ||
    (html.match(/class="[^"]*prose[^"]*"[\s\S]{0,20000}/i) || [])[0] ||
    html;
  return chunk
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDocsFingerprint(html = "") {
  const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || "";
  const text = extractDocsBodyText(html).slice(0, 50_000);
  const modelHits = [
    ...new Set(
      [...text.matchAll(/\b(magma(?:-2\.1)?|pyro(?::max)?|preview|stack-embed|mom-preview)\b/gi)].map((m) =>
        m[0].toLowerCase(),
      ),
    ),
  ].sort();
  const featureHits = [
    ...new Set(
      [
        "x402",
        "plugins",
        "hooks",
        "skills",
        "subagents",
        "acp",
        "mcp",
        "geoff code",
        "token plan",
        "model training",
        "sandbox",
        "voice clone",
      ].filter((k) => new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(text)),
    ),
  ].sort();
  const transportHits = [
    ...new Set(
      ["sse", "stdio", "streamable http", "websocket", "http", "acp"]
        .filter((k) => new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(text)),
    ),
  ].sort();
  const toolAcross = text.match(/(\d+)\s+tools?\s+across\s+(\d+)\s+groups?/i);
  const toolHint = toolAcross
    ? `${toolAcross[1]}/${toolAcross[2]}`
    : /MCP tools|tool groups|\b\d+\s+tools?\b/i.test(text)
      ? (text.match(/\b(\d+)\s+tools?\b/i) || [])[1] || "tools"
      : null;
  return {
    title: title.replace(/&amp;/g, "&").slice(0, 120),
    chars: text.length,
    modelHits,
    featureHits,
    transportHits,
    toolHint,
    hash: simpleHash(`${title}|${text}`),
  };
}

const EXPLORE_FEED_LIMIT = 48;

function normalizeExplorePost(post) {
  if (!post || typeof post !== "object") return null;
  const id = typeof post.id === "string" ? post.id : null;
  if (!id) return null;
  const author =
    post.author?.username ||
    post.author?.handle ||
    post.author?.name ||
    null;
  const title =
    (typeof post.content === "string" && post.content.trim()) ||
    (typeof post.title === "string" && post.title.trim()) ||
    "Untitled";
  const mediaType = typeof post.media_type === "string" ? post.media_type : "unknown";
  return {
    id,
    title: title.slice(0, 120),
    author: author ? String(author).slice(0, 64) : null,
    mediaType,
    createdAt: typeof post.created_at === "number" ? post.created_at : null,
    likes: typeof post.likes_count === "number" ? post.likes_count : null,
    views: typeof post.views_count === "number" ? post.views_count : null,
    nsfw: Boolean(post.nsfw),
  };
}

async function sniffGeoffExplore() {
  const started = Date.now();
  // Prefer www — apex can redirect; feed is often slow under parallel sniffs.
  const urls = [
    "https://www.geoff.ai/api/explore/feed?limit=" + EXPLORE_FEED_LIMIT,
    `${config.geoffBaseUrl}/api/explore/feed?limit=${EXPLORE_FEED_LIMIT}`,
  ];
  let lastError = null;

  for (const url of [...new Set(urls)]) {
    try {
      const res = await fetchJson(url, {
        headers: { Accept: "application/json" },
        timeoutMs: 28_000,
      });
      const posts = Array.isArray(res.json?.posts)
        ? res.json.posts.map(normalizeExplorePost).filter(Boolean)
        : [];
      const ids = posts.map((p) => p.id);
      const mediaCounts = {};
      for (const p of posts) {
        mediaCounts[p.mediaType] = (mediaCounts[p.mediaType] || 0) + 1;
      }
      const authors = [...new Set(posts.map((p) => p.author).filter(Boolean))].sort();
      const fingerprint = simpleHash(ids.slice().sort().join("|"));

      return {
        source: "geoff.explore",
        ok: res.ok && posts.length > 0,
        status: res.status,
        ms: Date.now() - started,
        url: "https://www.geoff.ai/explore",
        feedUrl: url,
        count: posts.length,
        hasMore: Boolean(res.json?.hasMore),
        page: res.json?.page ?? null,
        fingerprint,
        ids,
        mediaCounts,
        authors,
        authorCount: authors.length,
        sample: posts.slice(0, 6),
        reason: res.ok
          ? posts.length
            ? null
            : "Explore feed returned zero posts"
          : `Explore feed HTTP ${res.status}`,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    source: "geoff.explore",
    ok: false,
    status: 0,
    ms: Date.now() - started,
    url: "https://www.geoff.ai/explore",
    count: 0,
    fingerprint: null,
    ids: [],
    mediaCounts: {},
    authors: [],
    authorCount: 0,
    sample: [],
    reason: lastError?.message || String(lastError) || "Explore feed failed",
  };
}

/**
 * Max × Solana surface — public route existence (auth-gated, but redirects prove the lanes).
 * Caught in client as: /max || (/max/solana/* && !/max/solana/portfolio)
 */
const MAX_SOLANA_ROUTES = [
  { id: "max", path: "/max", label: "Max hub" },
  { id: "max-solana", path: "/max/solana", label: "Max × Solana" },
  { id: "max-solana-watch", path: "/max/solana/watch", label: "Max × Solana watch" },
  { id: "max-solana-portfolio", path: "/max/solana/portfolio", label: "Max × Solana portfolio" },
];

async function probeRoute(path) {
  const started = Date.now();
  // Prefer www — apex often 307s to www before the real /connect gate.
  let url = `https://www.geoff.ai${path}`;
  let lastStatus = 0;
  let lastLoc = null;
  let redirectUrl = null;
  let toConnect = false;

  try {
    for (let hop = 0; hop < 5; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      let res;
      try {
        res = await limitedFetch(url, {
          method: "GET",
          redirect: "manual",
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "GeoffThermometer/1.0 (+max-solana route probe)",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      lastStatus = res.status;
      lastLoc = res.headers.get("location") || null;

      if (lastStatus >= 300 && lastStatus < 400 && lastLoc) {
        const next = new URL(lastLoc, url);
        redirectUrl = next.searchParams.get("redirectUrl") || redirectUrl;
        if (next.pathname === "/connect" || redirectUrl) {
          toConnect = true;
          break;
        }
        url = next.toString();
        continue;
      }

      // Final non-redirect response
      break;
    }

    return {
      id: path,
      path,
      status: lastStatus,
      ms: Date.now() - started,
      location: lastLoc,
      redirectUrl,
      toConnect,
      // Lane is "live" if it auth-gates to connect or serves 200 (public open)
      live: toConnect || lastStatus === 200,
    };
  } catch (error) {
    return {
      id: path,
      path,
      status: 0,
      ms: Date.now() - started,
      location: null,
      redirectUrl: null,
      toConnect: false,
      live: false,
      error: error.message || String(error),
    };
  }
}

async function sniffGeoffMaxSolana() {
  const started = Date.now();
  const settled = await Promise.allSettled(
    MAX_SOLANA_ROUTES.map(async (route) => {
      const probe = await probeRoute(route.path);
      return { ...route, ...probe, id: route.id };
    }),
  );

  const routes = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  const live = routes.filter((r) => r.live);
  const fingerprint = simpleHash(
    routes
      .map((r) => `${r.id}:${r.status}:${r.toConnect ? "connect" : r.live ? "open" : "down"}`)
      .sort()
      .join("|"),
  );

  return {
    source: "geoff.max.solana",
    ok: live.length > 0,
    status: live.length ? 200 : 0,
    ms: Date.now() - started,
    fingerprint,
    liveCount: live.length,
    total: MAX_SOLANA_ROUTES.length,
    solanaLive: Boolean(routes.find((r) => r.id === "max-solana" && r.live)),
    portfolioLive: Boolean(routes.find((r) => r.id === "max-solana-portfolio" && r.live)),
    maxLive: Boolean(routes.find((r) => r.id === "max" && r.live)),
    routes,
    note: "Public redirect probe only — Max×Solana is auth-gated; 307→/connect means the lane exists.",
    reason: live.length
      ? null
      : "No Max/Solana routes answered with connect-gate or 200",
  };
}

/** Historically watched auth-gated geoff.ai shells; catch-all /connect is not product proof. */
const PRODUCT_LANES = [
  { id: "hq", path: "/hq", label: "HQ" },
  { id: "studio", path: "/studio", label: "Studio" },
  { id: "skills", path: "/skills", label: "Skills" },
  { id: "code", path: "/code", label: "Geoff Code" },
  { id: "claw", path: "/claw", label: "Claw" },
  { id: "social", path: "/social", label: "Social" },
  { id: "max", path: "/max", label: "Max" },
];

async function sniffGeoffProductLanes() {
  const started = Date.now();
  const settled = await Promise.allSettled(
    PRODUCT_LANES.map(async (route) => {
      const probe = await probeRoute(route.path);
      return { ...route, ...probe, id: route.id };
    }),
  );

  const routes = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  const live = routes.filter((r) => r.live);
  const fingerprint = simpleHash(
    routes
      .map((r) => `${r.id}:${r.status}:${r.toConnect ? "connect" : r.live ? "open" : "down"}`)
      .sort()
      .join("|"),
  );
  const liveLabels = live.map((r) => r.label || r.id);

  return {
    source: "geoff.product.lanes",
    ok: live.length > 0,
    status: live.length ? 200 : 0,
    ms: Date.now() - started,
    fingerprint,
    liveCount: live.length,
    total: PRODUCT_LANES.length,
    liveLabels,
    hqLive: Boolean(routes.find((r) => r.id === "hq" && r.live)),
    studioLive: Boolean(routes.find((r) => r.id === "studio" && r.live)),
    skillsLive: Boolean(routes.find((r) => r.id === "skills" && r.live)),
    codeLive: Boolean(routes.find((r) => r.id === "code" && r.live)),
    clawLive: Boolean(routes.find((r) => r.id === "claw" && r.live)),
    socialLive: Boolean(routes.find((r) => r.id === "social" && r.live)),
    maxLive: Boolean(routes.find((r) => r.id === "max" && r.live)),
    routes,
    note: "Docs-allowlisted connect-gate probe — HQ / Studio / Skills / Code / Claw / Social / Max. Catch-all /connect alone is not proof.",
    reason: live.length
      ? null
      : "No product lanes answered with connect-gate or 200",
  };
}

const PUBLIC_SURFACE_ROUTES = [
  { id: "home", path: "/", label: "home" },
  { id: "explore", path: "/explore", label: "explore" },
  { id: "music", path: "/music", label: "music" },
  { id: "image", path: "/image", label: "image" },
  { id: "video", path: "/video", label: "video" },
];

async function sniffGeoffPublicSurfaces() {
  const started = Date.now();
  const settled = await Promise.allSettled(
    PUBLIC_SURFACE_ROUTES.map(async (route) => {
      const res = await fetchJson(`${config.geoffBaseUrl}${route.path}`, {
        headers: { Accept: "text/html" },
      });
      return {
        ...route,
        url: res.url || `${config.geoffBaseUrl}${route.path}`,
        ok: res.ok,
        status: res.status,
        ms: res.ms,
        bytes: Buffer.byteLength(res.text || "", "utf8"),
        hash: bodyHash(res.text),
        note: "Geoff",
      };
    }),
  );
  const routes = settled.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : {
          ...PUBLIC_SURFACE_ROUTES[index],
          url: `${config.geoffBaseUrl}${PUBLIC_SURFACE_ROUTES[index].path}`,
          ok: false,
          status: 0,
          ms: null,
          bytes: 0,
          hash: null,
          note: "Geoff",
          error: result.reason?.message || String(result.reason),
        },
  );
  const live = routes.filter((route) => route.ok);
  const fingerprint = bodyHash(
    routes
      .map((route) => `${route.id}:${route.status}:${route.id === "home" ? "dynamic" : route.hash || "none"}`)
      .join("|"),
  );
  return {
    source: "geoff.public.surfaces",
    ok: live.length === routes.length,
    status: live.length === routes.length ? 200 : live.length ? 207 : 0,
    ms: Date.now() - started,
    liveCount: live.length,
    total: routes.length,
    fingerprint,
    routes,
    note: "Public HTML response probe. Stable hashes mean stable response bodies, not ownership or partnership.",
    reason: live.length === routes.length ? null : `${live.length}/${routes.length} public Geoff surfaces answered`,
  };
}

/** Auth-gated billing / subscription shells on geoff.ai — public route probe only. */
const SUBSCRIPTION_ROUTES = [
  { id: "account", path: "/account", label: "Account" },
  { id: "billing", path: "/billing", label: "Billing" },
  { id: "plan", path: "/plan", label: "Plan" },
  { id: "plans", path: "/plans", label: "Plans" },
  { id: "subscription", path: "/subscription", label: "Subscription" },
];

async function sniffGeoffSubscription() {
  const started = Date.now();
  const settled = await Promise.allSettled(
    SUBSCRIPTION_ROUTES.map(async (route) => {
      const probe = await probeRoute(route.path);
      return { ...route, ...probe, id: route.id };
    }),
  );

  const routes = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  const live = routes.filter((r) => r.live);
  const fingerprint = simpleHash(
    routes
      .map((r) => `${r.id}:${r.status}:${r.toConnect ? "connect" : r.live ? "open" : "down"}`)
      .sort()
      .join("|"),
  );
  const liveLabels = live.map((r) => r.label || r.id);

  return {
    source: "geoff.subscription",
    ok: live.length > 0,
    status: live.length ? 200 : 0,
    ms: Date.now() - started,
    fingerprint,
    liveCount: live.length,
    total: SUBSCRIPTION_ROUTES.length,
    liveLabels,
    accountLive: Boolean(routes.find((r) => r.id === "account" && r.live)),
    billingLive: Boolean(routes.find((r) => r.id === "billing" && r.live)),
    plansLive: Boolean(routes.find((r) => r.id === "plans" && r.live)),
    subscriptionLive: Boolean(routes.find((r) => r.id === "subscription" && r.live)),
    routes,
    note: "Public route probe — billing/plans/subscription shells exist as app routes; API (/api/v2 + /stacks/*) is auth-gated.",
    reason: live.length
      ? null
      : "No billing/subscription routes answered with connect-gate or 200",
  };
}

async function sniffGeoffDocsSurface() {
  const started = Date.now();
  const settled = await Promise.allSettled(
    DOCS_SURFACE_PAGES.map((page) =>
      fetchJson(`https://docs.geoff.ai${page.path}`, {
        headers: { Accept: "text/html,application/xhtml+xml" },
      }).then((res) => ({ page, res })),
    ),
  );

  const pages = [];
  for (const row of settled) {
    if (row.status !== "fulfilled") continue;
    const { page, res } = row.value;
    if (!res.ok || !res.text) {
      pages.push({
        id: page.id,
        path: page.path,
        label: page.label,
        ok: false,
        status: res.status,
      });
      continue;
    }
    const fp = extractDocsFingerprint(res.text);
    pages.push({
      id: page.id,
      path: page.path,
      label: page.label,
      ok: true,
      status: res.status,
      ...fp,
    });
  }

  const okPages = pages.filter((p) => p.ok);
  const publishedModelLayers = (pages.find((p) => p.id === "models")?.modelHits || [])
    .filter((id) => ["magma", "magma-2.1", "pyro"].includes(id));
  const fingerprint = simpleHash(
    okPages.map((p) => `${p.id}:${p.hash}`).sort().join("|"),
  );

  return {
    source: "geoff.docs.surface",
    ok: okPages.length > 0,
    status: okPages.length ? 200 : 0,
    ms: Date.now() - started,
    scraped: okPages.length,
    total: DOCS_SURFACE_PAGES.length,
    linkedPageCount: DOCS_LINKED_PAGE_COUNT,
    representativeWatch: true,
    publishedModelLayers,
    checkedAt: new Date().toISOString(),
    fingerprint,
    pages,
    reason:
      okPages.length === DOCS_SURFACE_PAGES.length
        ? null
        : `Scraped ${okPages.length}/${DOCS_SURFACE_PAGES.length} docs pages`,
  };
}

async function sniffGeoffTokenPlan() {
  const started = Date.now();
  try {
    const [overview, usage] = await Promise.all([
      fetchJson(TOKEN_PLAN_URLS.overview),
      fetchJson(TOKEN_PLAN_URLS.usage),
    ]);
    const html = `${overview.text || ""}\n${usage.text || ""}`;
    const parsed = parseTokenPlanHtml(html);
    const plansLive = Boolean(overview.ok && parsed.observed.plans);
    const limitsLive = Boolean(usage.ok && parsed.observed.limits);
    const scrapedOk = plansLive && limitsLive;
    const plan = {
      ...parsed,
      observed: { plans: plansLive, limits: limitsLive },
    };
    const fingerprint = simpleHash(fingerprintTokenPlan(plan));

    return {
      source: "geoff.docs.pricing",
      ok: scrapedOk,
      status: scrapedOk ? 200 : !overview.ok ? overview.status : usage.status || 0,
      ms: Date.now() - started,
      scraped: scrapedOk,
      fingerprint,
      model: plan.model,
      unfilteredNote: plan.unfilteredNote,
      plans: plan.plans,
      estimates: plan.estimates,
      matrix: plan.matrix || FEATURE_MATRIX,
      wins: plan.wins || FALLBACK_TOKEN_PLAN.wins,
      observed: plan.observed,
      sections: {
        plans: { live: plansLive, status: overview.status, sourceUrl: TOKEN_PLAN_URLS.overview },
        limits: { live: limitsLive, status: usage.status, sourceUrl: TOKEN_PLAN_URLS.usage },
        features: { live: overview.ok, status: overview.status, sourceUrl: TOKEN_PLAN_URLS.overview },
        yields: { live: false, status: null, sourceUrl: null },
      },
      sourceUrls: TOKEN_PLAN_URLS,
      reason: scrapedOk
        ? null
        : "Live Token Plan parse incomplete — showing bundled values for incomplete sections",
    };
  } catch (error) {
    return {
      source: "geoff.docs.pricing",
      ok: false,
      skipped: false,
      status: 0,
      ms: Date.now() - started,
      scraped: false,
      fingerprint: simpleHash(fingerprintTokenPlan(FALLBACK_TOKEN_PLAN)),
      model: FALLBACK_TOKEN_PLAN.model,
      unfilteredNote: FALLBACK_TOKEN_PLAN.unfilteredNote,
      plans: FALLBACK_TOKEN_PLAN.plans.map((p) => ({ ...p })),
      estimates: null,
      matrix: FEATURE_MATRIX,
      wins: FALLBACK_TOKEN_PLAN.wins,
      observed: { plans: false, limits: false },
      sections: {
        plans: { live: false, status: 0, sourceUrl: TOKEN_PLAN_URLS.overview },
        limits: { live: false, status: 0, sourceUrl: TOKEN_PLAN_URLS.usage },
        features: { live: false, status: 0, sourceUrl: TOKEN_PLAN_URLS.overview },
        yields: { live: false, status: null, sourceUrl: null },
      },
      sourceUrls: TOKEN_PLAN_URLS,
      reason: `Docs sniff failed (${error.message}); using bundled public Token Plan values`,
    };
  }
}

const TRIX_BASE_URL = "https://trix.market";
const MAX_TRIX_HISTORY_RECORDS = 2_000;
const MAX_TRIX_HISTORY_IDS = 10_000;
const TRIX_LAUNCH_CATALOG_TTL_MS = 6 * 60 * 60 * 1_000;
const TRIX_CARD_CATALOG_TTL_MS = 6 * 60 * 60 * 1_000;
const TRIX_ARTWORK_WINDOW = 100; // /api/artworks hard cap; pagination params are ignored. NOTE: limit>~120 returns HTTP 500 ("Failed query"), so keep this <=100.
const TRIX_LEADERBOARD_WINDOW = 100; // /api/leaderboard returns one ranked page from the API
const TRIX_CARD_CLASSES = [
  { key: "common", label: "Common", oddsBps: 4_561 },
  { key: "uncommon", label: "Uncommon", oddsBps: 900 },
  { key: "rare", label: "Rare", oddsBps: 200 },
  { key: "epic", label: "Epic", oddsBps: 35 },
  { key: "mythic", label: "Mythic", oddsBps: 4 },
  { key: "trix", label: "Void", oddsBps: 4_300 },
];

export function normalizeTrixGeoffRecord(record, post = null) {
  const feeLamports = Number(record?.feeLamports);
  return {
    id: record?.id,
    createdAt: record?.createdAt || post?.createdAt || null,
    postId: record?.postId || post?.id || null,
    authorWallet: record?.authorWallet || post?.payerWallet || null,
    tokenMint: record?.tokenMint || post?.memeTokenMint || null,
    tokenSymbol: record?.coinSymbol || post?.memeCoinSymbol || null,
    imageUrl: record?.imageUrl || post?.imageUrl || null,
    txSignature: record?.txSignature || null,
    paidNetwork: record?.paidNetwork || null,
    feeLamports: Number.isFinite(feeLamports) ? feeLamports : null,
    feeSol: Number.isFinite(feeLamports) ? feeLamports / 1e9 : null,
  };
}

export function parseTrixGeoffRecords(posts = [], records = []) {
  const postById = new Map(posts.map((post) => [post.id, post]));
  const seen = new Set();
  return records
    .filter((record) => record?.generator === "geoff" && record.id && !seen.has(record.id))
    .map((record) => {
      seen.add(record.id);
      return normalizeTrixGeoffRecord(record, postById.get(record.postId) || null);
    })
    .filter(
      (record) =>
        record.txSignature && record.feeLamports > 0 && record.paidNetwork === "mainnet",
    )
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

export function parseTrixPackMarket(
  state = null,
  { status = 0, ms = null, genesis = null, genesisStatus = 0 } = {},
) {
  if (
    !state ||
    typeof state !== "object" ||
    status < 200 ||
    status >= 300 ||
    !Array.isArray(state.levels) ||
    state.levels.length === 0
  ) {
    return {
      ok: false,
      status,
      ms,
      minted: null,
      holders: null,
      classes: [],
      checkedAt: new Date().toISOString(),
      reason: state?.message || "TRIX Pack market state unavailable.",
    };
  }
  const levels = Array.isArray(state.levels) ? state.levels : [];
  const base = levels.find((level) => level?.id === "base") || levels[0] || null;
  const genesisOk = Boolean(
    genesis && typeof genesis === "object" && genesisStatus >= 200 && genesisStatus < 300,
  );
  const minted = levels.reduce((sum, level) => sum + (Number(level?.minted) || 0), 0);
  const classes = TRIX_CARD_CLASSES.map((entry) => {
    const band = Array.isArray(base?.bands?.[entry.key]) ? base.bands[entry.key] : [];
    return {
      ...entry,
      oddsPercent: entry.oddsBps / 100,
      payoutMin: Number.isFinite(Number(band[0])) ? Number(band[0]) : null,
      payoutMax: Number.isFinite(Number(band[1])) ? Number(band[1]) : null,
    };
  });
  const fingerprint = bodyHash(JSON.stringify({
    round: state.round,
    roundStatus: state.roundStatus,
    tcg: state.tcg,
    roundPacks: state.roundPacks,
    genesis: genesisOk ? {
      round: genesis.round,
      status: genesis.status,
      cap: genesis.cap,
      isGenesis: genesis.isGenesis,
      pricePerPackUsd: genesis.pricePerPackUsd,
      mostRipped: genesis.mostRipped,
      memeStatus: genesis.memeStatus,
    } : null,
    levels: levels.map((level) => ({
      id: level.id,
      minted: level.minted,
      available: level.available,
      priceSol: level.priceSol,
      priceUsd: level.priceUsd,
      bands: level.bands,
    })),
  }));
  return {
    ok: true,
    status: status || 200,
    ms,
    round: Number(state.round) || null,
    roundStatus: state.roundStatus || null,
    tcg: Boolean(state.tcg),
    minted,
    roundPacks: Number(state.roundPacks) || 0,
    stakedPacks: Number(state.agedPool?.stakedPacks) || 0,
    genesisOk,
    genesisStatus,
    genesisCap: genesisOk && Number.isFinite(Number(genesis.cap)) ? Number(genesis.cap) : null,
    genesisRound: genesisOk ? Number(genesis.round) || null : null,
    genesisMarketStatus: genesisOk ? genesis.status || null : null,
    isGenesis: genesisOk ? Boolean(genesis.isGenesis) : null,
    genesisPricePerPackUsd: genesisOk && Number.isFinite(Number(genesis.pricePerPackUsd))
      ? Number(genesis.pricePerPackUsd)
      : null,
    mostRippedSymbol: genesisOk && typeof genesis.mostRipped?.symbol === "string"
      ? genesis.mostRipped.symbol
      : null,
    mostRippedBuybackUsd: genesisOk && Number.isFinite(Number(genesis.mostRipped?.buybackUsd))
      ? Number(genesis.mostRipped.buybackUsd)
      : null,
    memeStatus: genesisOk && typeof genesis.memeStatus === "string" ? genesis.memeStatus : null,
    holders: null,
    holderReason: "TRIX does not publish a global Pack/Card holder count or collection mint.",
    available: Number(base?.available) || 0,
    basePriceSol: Number(base?.priceSol) || null,
    basePriceUsd: Number(base?.priceUsd) || null,
    classes,
    levels: levels.map((level) => ({
      id: level.id,
      name: level.name,
      minted: Number(level.minted) || 0,
      available: Number(level.available) || 0,
      priceSol: Number(level.priceSol) || null,
      priceUsd: Number(level.priceUsd) || null,
    })),
    fingerprint,
    checkedAt: new Date().toISOString(),
    sourceUrl: `${TRIX_BASE_URL}/api/mkt/state`,
    genesisSourceUrl: `${TRIX_BASE_URL}/api/mkt/g`,
    oddsSourceUrl: `${TRIX_BASE_URL}/assets/c-BkGleqvg.js`,
    note: "Minted and market values are TRIX API-reported. Class odds come from the current TRIX frontend bundle. Market-state bands are gross reward multiples of Pack USD price before reward shares, not actual revealed-card counts or direct owner payouts.",
    reason: null,
  };
}

const TRIX_PACK_PROGRAM = "HTrrq6C6j9NYySUrpSLn9nDjFbKNBD6pS3xBuLppfW4F";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** TRIX routes every paid generation to these two system-transfer legs. */
const TRIX_PROVIDER_PAY_RECIPIENTS = new Set([
  "QR7US76WP3D4Hk65DuvF8ZPWb9E65MBgBk25j7f9TtY",
  "H1HU4Bfg6hsMz8SP2JB27urLM1TeB7UhKREsukRtvoid",
]);
/** TRIX's own on-chain treasury / rewards wallet. It is also the 2nd geoff rail. */
const TRIX_TREASURY_ADDRESS = "H1HU4Bfg6hsMz8SP2JB27urLM1TeB7UhKREsukRtvoid";
/** The 1st geoff rail is a distinct wallet (finance/generation split, not the treasury). */
const TRIX_GEOFF_LEG1 = "QR7US76WP3D4Hk65DuvF8ZPWb9E65MBgBk25j7f9TtY";
const GEOF_INFER_VERIFY_LIMIT = 3;

/**
 * Fold blank-labeled paid TRIX generations into the geoff set when their
 * on-chain payment split lands on the known TRIX provider rails. The label
 * stopped being emitted, but the money continues to the same two legs, so
 * these are counted as provider=geoff (inferred), never claimed as verified.
 */
async function inferGeoffPayments(unlabeledRecords, previous = null) {
  const inferredSigs = new Set(previous?.inferredSigs || []);
  const candidates = (unlabeledRecords || [])
    .filter((record) => record?.txSignature)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .slice(0, GEOF_INFER_VERIFY_LIMIT);
  const inferred = [];
  for (const record of candidates) {
    if (!inferredSigs.has(record.txSignature)) {
      const tx = await getTransactionWithRetry(record.txSignature);
      if (tx?.meta && !tx.meta.err) {
        const destinations = trixTransferDestinations(tx);
        const matches =
          TRIX_PROVIDER_PAY_RECIPIENTS.size === destinations.size &&
          [...TRIX_PROVIDER_PAY_RECIPIENTS].every((address) => destinations.has(address));
        if (matches) inferredSigs.add(record.txSignature);
      }
    }
    if (inferredSigs.has(record.txSignature)) inferred.push(record);
  }
  return {
    records: inferred,
    count: inferred.length,
    ok: candidates.length > 0 ? inferred.length > 0 : null,
    inferredSigs: [...inferredSigs],
    checkedAt: new Date().toISOString(),
  };
}

function decodeBase58(value) {
  let decoded = 0n;
  for (const char of value || "") {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    decoded = decoded * 58n + BigInt(digit);
  }
  let hex = decoded.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const leadingZeroes = [...(value || "")].findIndex((char) => char !== "1");
  const prefix = "00".repeat(leadingZeroes < 0 ? value.length : leadingZeroes);
  return Buffer.from(`${prefix}${hex}`, "hex");
}

export function parseTrixPackPurchase(transaction, levels = []) {
  if (!transaction?.meta || transaction.meta.err) return null;
  if (!(transaction.meta.logMessages || []).some((line) => line.includes("Instruction: BuyPack"))) {
    return null;
  }
  const keys = transaction.transaction?.message?.accountKeys || [];
  const buyerIndex = keys.findIndex((key) => key?.signer);
  const buyer = keys[buyerIndex]?.pubkey;
  if (!buyer) return null;
  const instructions = [
    ...(transaction.transaction.message.instructions || []),
    ...(transaction.meta.innerInstructions || []).flatMap((entry) => entry.instructions || []),
  ];
  const buyInstruction = instructions.find((instruction) =>
    instruction.programId === TRIX_PACK_PROGRAM
  );
  const instructionData = decodeBase58(buyInstruction?.data);
  // Anchor prefixes instructions with an 8-byte discriminator; BuyPack stores its level next.
  const level = levels[instructionData?.[8]] || null;
  const paidLamports = instructions
    .filter((instruction) =>
      instruction.program === "system" &&
      instruction.parsed?.type === "transfer" &&
      instruction.parsed.info?.source === buyer
    )
    .reduce((sum, instruction) => sum + (Number(instruction.parsed.info.lamports) || 0), 0);
  const allInLamports = buyerIndex >= 0
    ? transaction.meta.preBalances[buyerIndex] - transaction.meta.postBalances[buyerIndex]
    : null;
  return {
    signature: transaction.transaction.signatures?.[0] || null,
    observedAt: transaction.blockTime ? new Date(transaction.blockTime * 1000).toISOString() : null,
    buyer,
    level: level?.id || null,
    paidLamports,
    paidSol: paidLamports / 1e9,
    allInLamports,
    allInSol: Number.isFinite(allInLamports) ? allInLamports / 1e9 : null,
    networkFeeLamports: Number(transaction.meta.fee) || 0,
  };
}

async function sniffTrixPackPurchases(levels = [], previous = null) {
  try {
    const signatures = await solanaRpc("getSignaturesForAddress", [
      TRIX_PACK_PROGRAM,
      { limit: 25, commitment: "confirmed" },
    ]);
    const scanned = new Set(previous?.scannedSignatures || []);
    const selected = (signatures || []).filter((entry) => !scanned.has(entry.signature)).slice(0, 5);
    const settled = await Promise.allSettled(selected.map((entry) =>
      solanaRpc("getTransaction", [
        entry.signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ])
    ));
    const resolvedSignatures = selected.filter((_, index) =>
      settled[index]?.status === "fulfilled" && settled[index].value
    );
    if (selected.length && !resolvedSignatures.length) {
      throw new Error("Recent TRIX Pack transactions could not be resolved.");
    }
    const observed = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => parseTrixPackPurchase(result.value, levels))
      .filter(Boolean);
    const bySignature = new Map();
    for (const record of [...(previous?.records || []), ...observed]) {
      if (record.signature) bySignature.set(record.signature, record);
    }
    const records = [...bySignature.values()]
      .sort((a, b) => Date.parse(b.observedAt || 0) - Date.parse(a.observedAt || 0))
      .slice(0, 100);
    const baseRecords = records.filter((record) => record.level === "base");
    const baseAllIn = baseRecords.map((record) => record.allInSol).filter(Number.isFinite);
    return {
      ok: true,
      records,
      observedTransactions: records.length,
      observedBaseTransactions: baseRecords.length,
      baseMaxPaidSol: baseRecords.length ? Math.max(...baseRecords.map((record) => record.paidSol)) : null,
      baseMaxAllInSol: baseAllIn.length ? Math.max(...baseAllIn) : null,
      scannedSignatures: [...new Set([
        ...resolvedSignatures.map((entry) => entry.signature),
        ...(previous?.scannedSignatures || []),
      ])].slice(0, 250),
      checkedAt: new Date().toISOString(),
      fingerprint: bodyHash(records.map((record) =>
        `${record.signature}:${record.level}:${record.paidLamports}:${record.allInLamports}`
      ).join("|")),
      reason: null,
    };
  } catch (error) {
    return previous
      ? { ...previous, ok: false, stale: true, reason: error?.message || String(error) }
      : { ok: false, records: [], reason: error?.message || String(error) };
  }
}

export async function sniffTrixGeoff({ previous = null, maxMints = 5 } = {}) {
  const started = Date.now();
  const [recentRes, packRes, genesisRes] = await Promise.all([
    fetchJson(`${TRIX_BASE_URL}/api/meme-image/recent?limit=48`),
    fetchJson(`${TRIX_BASE_URL}/api/mkt/state`),
    fetchJson(`${TRIX_BASE_URL}/api/mkt/g`),
  ]);
  const recentRecords = Array.isArray(recentRes.json) ? recentRes.json : [];
  const packs = parseTrixPackMarket(packRes.json, {
    status: packRes.status,
    ms: packRes.ms,
    genesis: genesisRes.json,
    genesisStatus: genesisRes.status,
  });
  if (packs.ok) {
    packs.purchaseAudit = await sniffTrixPackPurchases(
      packs.levels,
      previous?.packs?.purchaseAudit || null,
    );
    packs.fingerprint = bodyHash(`${packs.fingerprint}:${packs.purchaseAudit.fingerprint || "none"}`);
  }
  const catalogAge = Date.now() - Date.parse(previous?.launchCatalogCheckedAt || 0);
  const refreshCatalog =
    !Array.isArray(previous?.tokenMints) ||
    previous.tokenMints.length < 100 ||
    !Number.isFinite(catalogAge) ||
    catalogAge >= TRIX_LAUNCH_CATALOG_TTL_MS;
  let tokenMints = Array.isArray(previous?.tokenMints) ? previous.tokenMints : [];
  let launchCatalogCheckedAt = previous?.launchCatalogCheckedAt || null;
  let launchTotal = previous?.launchTotal || tokenMints.length;
  if (refreshCatalog) {
    const catalog = await Promise.allSettled([
      fetchJson(`${TRIX_BASE_URL}/api/launches?limit=500&offset=0&sort=marketCap`),
      fetchJson(`${TRIX_BASE_URL}/api/launches?limit=500&offset=500&sort=marketCap`),
    ]);
    const items = catalog.flatMap((result) =>
      result.status === "fulfilled" && Array.isArray(result.value.json?.items)
        ? result.value.json.items
        : [],
    );
    const discoveredMints = items.map((item) => item?.mintAddress).filter(Boolean);
    if (discoveredMints.length) {
      tokenMints = [...new Set([...tokenMints, ...discoveredMints])];
      launchTotal = Math.max(
        tokenMints.length,
        ...catalog.map((result) =>
          result.status === "fulfilled" ? Number(result.value.json?.total) || 0 : 0,
        ),
      );
      launchCatalogCheckedAt = new Date().toISOString();
    }
  }
  const previouslyScanned = new Set(previous?.scannedTokenMints || []);
  const unscanned = tokenMints.filter((mint) => !previouslyScanned.has(mint));
  const requestBudget = Math.max(1, Math.floor(maxMints));
  const activeTokenMints = [...new Set(recentRecords.map((record) => record?.tokenMint).filter(Boolean))];
  const liveReserve = activeTokenMints.length ? Math.min(2, requestBudget) : 0;
  const backfillBudget = unscanned.length ? Math.max(0, requestBudget - liveReserve) : 0;
  const backfillMints = unscanned.slice(0, backfillBudget);
  const activeCandidates = activeTokenMints.filter((mint) => !backfillMints.includes(mint));
  const activeBudget = requestBudget - backfillMints.length;
  const activeStart = activeCandidates.length
    ? (Math.floor(Date.now() / 60_000) * activeBudget) % activeCandidates.length
    : 0;
  const activeRefreshMints = Array.from(
    { length: Math.min(activeBudget, activeCandidates.length) },
    (_, index) => activeCandidates[(activeStart + index) % activeCandidates.length],
  );
  const selectedMints = [...backfillMints, ...activeRefreshMints];
  const settled = await Promise.allSettled(
    selectedMints.map((mint) => fetchJson(`${TRIX_BASE_URL}/api/meme-image/token/${mint}`)),
  );
  const records = [
    ...recentRecords,
    ...settled.flatMap((result) =>
      result.status === "fulfilled" && Array.isArray(result.value.json) ? result.value.json : [],
    ),
  ];
  const resolvedRequests = selectedMints.filter((_, index) => {
    const result = settled[index];
    return result?.status === "fulfilled" && result.value.ok;
  });
  const resolvedTokenMints = backfillMints.filter((mint) => resolvedRequests.includes(mint));
  const labeledGeoff = parseTrixGeoffRecords([], records);
  const unlabeledPaid = records.filter(
    (record) =>
      !record?.generator &&
      record?.txSignature &&
      Number(record.feeLamports || 0) > 0 &&
      record.paidNetwork === "mainnet",
  );
  const infer = await inferGeoffPayments(unlabeledPaid, previous?.infer || null);
  const inferredRecords = infer.records.map((record) => ({
    ...normalizeTrixGeoffRecord(record),
    inferred: true,
  }));
  const seenIds = new Set();
  const geoffRecords = [...labeledGeoff, ...inferredRecords]
    .filter((record) => record.id && !seenIds.has(record.id) ? (seenIds.add(record.id), true) : false)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const latest = geoffRecords.find((record) => record.imageUrl) || geoffRecords[0] || null;
  const paidLamports = geoffRecords.reduce((sum, record) => sum + (record.feeLamports || 0), 0);
  const ok = recentRes.ok && (
    selectedMints.length === 0 ||
    resolvedRequests.length > 0
  );
  const scannedTokenMints = [
    ...new Set([...(previous?.scannedTokenMints || []), ...resolvedTokenMints]),
  ];
  return {
    source: "trix.geoff",
    ok,
    status: ok ? 200 : recentRes.status || 0,
    ms: Date.now() - started,
    count: geoffRecords.length,
    paidLamports,
    paidSol: paidLamports / 1e9,
    unlabeledCount: unlabeledPaid.length,
    inferredCount: infer.count,
    inferenceOk: infer.ok,
    inferredSigs: infer.inferredSigs,
    infer: { inferredSigs: infer.inferredSigs, verifiedAt: infer.checkedAt },
    providerLabelInferred: infer.count > 0,
    tokenMints,
    resolvedTokenMints,
    scannedTokenMints,
    recentCount: recentRecords.length,
    activeTokenCount: activeTokenMints.length,
    activeRefreshCount: activeRefreshMints.length,
    activeRefreshMints,
    launchTotal,
    launchCatalogCheckedAt,
    backfillComplete: tokenMints.length > 0 && scannedTokenMints.length >= tokenMints.length,
    packs,
    records: geoffRecords,
    latest,
    fingerprint: bodyHash(
      geoffRecords.map((record) => `${record.id}:${record.txSignature}:${record.feeLamports}`).join("|"),
    ),
    url: `${TRIX_BASE_URL}/`,
    note: "TRIX public records label the provider as Geoff and report mainnet payment signatures. Active token histories are rotated because the global recent feed can crowd Geoff records out before filtering. This does not independently establish geoff.ai operator identity or an NFT mint.",
    reason: ok ? null : "TRIX recent generations or historical token records could not be resolved.",
  };
}

export function mergeTrixGeoffHistory(previous = null, observed = null) {
  if (!observed) return previous;
  const previousRecordIds = new Set(
    previous?.recordIds?.length
      ? previous.recordIds
      : (previous?.records || []).map((record) => record?.id).filter(Boolean),
  );
  const newRecords = (observed.records || []).filter(
    (record) => record?.id && !previousRecordIds.has(record.id),
  );
  const recordIds = [
    ...new Set([...previousRecordIds, ...newRecords.map((record) => record.id)]),
  ].slice(-MAX_TRIX_HISTORY_IDS);
  const byId = new Map();
  for (const record of [...(previous?.records || []), ...(observed.records || [])]) {
    const key = record?.id || record?.txSignature;
    if (key) byId.set(key, record);
  }
  const records = [...byId.values()]
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .slice(0, MAX_TRIX_HISTORY_RECORDS);
  const previousCount = Number.isFinite(Number(previous?.count))
    ? Math.max(Number(previous.count), previousRecordIds.size)
    : previousRecordIds.size;
  const count = previousCount + newRecords.length;
  const previousPaidLamports = Number.isFinite(Number(previous?.paidLamports))
    ? Number(previous.paidLamports)
    : (previous?.records || []).reduce(
        (sum, record) => sum + (Number(record.feeLamports) || 0),
        0,
      );
  const paidLamports = previousPaidLamports + newRecords.reduce(
    (sum, record) => sum + (Number(record.feeLamports) || 0),
    0,
  );
  const latest = records.find((record) => record.imageUrl) || records[0] || null;
  const tokenMints = [...new Set([...(previous?.tokenMints || []), ...(observed.tokenMints || [])])];
  const scannedTokenMints = [
    ...new Set([...(previous?.scannedTokenMints || []), ...(observed.scannedTokenMints || [])]),
  ];
  const previousPacksValid =
    previous?.packs?.ok &&
    previous.packs.status >= 200 &&
    previous.packs.status < 300 &&
    Number(previous.packs.minted) > 0;
  let packs = observed.packs?.ok
    ? !observed.packs.genesisOk && previousPacksValid && previous.packs.genesisCap != null
      ? {
          ...observed.packs,
          genesisCap: previous.packs.genesisCap,
          genesisRound: previous.packs.genesisRound,
          genesisMarketStatus: previous.packs.genesisMarketStatus,
          isGenesis: previous.packs.isGenesis,
          genesisPricePerPackUsd: previous.packs.genesisPricePerPackUsd,
          mostRippedSymbol: previous.packs.mostRippedSymbol,
          mostRippedBuybackUsd: previous.packs.mostRippedBuybackUsd,
          memeStatus: previous.packs.memeStatus,
          genesisStale: true,
        }
      : observed.packs
    : previousPacksValid
      ? {
          ...previous.packs,
          stale: true,
          lastAttemptAt: observed.packs?.checkedAt || new Date().toISOString(),
          lastError: observed.packs?.reason || "Current TRIX Pack read failed.",
        }
      : observed.packs;
  if (observed.packs?.ok) {
    const currentAt = Date.parse(packs.checkedAt || 0);
    const currentMinted = Number(packs.minted);
    const currentAvailable = Number(packs.available);
    const sameRound = previous?.packs?.round === packs.round;
    const priorSamples = sameRound && Array.isArray(previous.packs.packSamples)
      ? previous.packs.packSamples
      : sameRound && Number.isFinite(Number(previous.packs.minted))
        ? [{
            at: previous.packs.checkedAt,
            minted: Number(previous.packs.minted),
            available: Number(previous.packs.available),
          }]
        : [];
    const packSamples = [...priorSamples, {
      at: packs.checkedAt,
      minted: currentMinted,
      available: currentAvailable,
    }]
      .filter((sample) => Number.isFinite(Date.parse(sample.at)) && Number.isFinite(sample.minted))
      .filter((sample, index, samples) =>
        samples.findIndex((entry) => entry.at === sample.at) === index
      )
      .filter((sample) => Date.parse(sample.at) >= currentAt - 60 * 60_000)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const firstSample = packSamples[0];
    const windowMinutes = firstSample ? (currentAt - Date.parse(firstSample.at)) / 60_000 : 0;
    const mintedInWindow = firstSample ? currentMinted - firstSample.minted : 0;
    const availableInWindow = firstSample ? currentAvailable - firstSample.available : 0;
    packs = {
      ...packs,
      packSamples,
      mintSamples: packSamples,
      mintsPerHour: windowMinutes >= 0.25 && mintedInWindow >= 0
        ? mintedInWindow * 60 / windowMinutes
        : null,
      mintRateWindowMinutes: windowMinutes >= 0.25 ? windowMinutes : null,
      mintRateMinted: windowMinutes >= 0.25 && mintedInWindow >= 0 ? mintedInWindow : null,
      mintRateCheckedAt: packs.checkedAt,
      packAvailableDelta: Number.isFinite(firstSample?.available) && Number.isFinite(currentAvailable)
        ? currentAvailable - firstSample.available
        : null,
      packMintedDelta: Number.isFinite(firstSample?.minted) && Number.isFinite(currentMinted)
        ? currentMinted - firstSample.minted
        : null,
      packRateWindowMinutes: windowMinutes >= 0.25 ? windowMinutes : null,
    };
  }
  return {
    ...(previous || {}),
    ...observed,
    ok: observed.ok || Boolean(previous?.ok && records.length),
    count,
    paidLamports,
    paidSol: paidLamports / 1e9,
    tokenMints,
    scannedTokenMints,
    packs,
    recordIds,
    records,
    latest,
    observedCount: observed.records?.length || 0,
    checkedAt: new Date().toISOString(),
    historyStartedAt: [previous?.historyStartedAt, records.at(-1)?.createdAt]
      .filter(Boolean)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null,
    fingerprint: bodyHash(
      `${count}:${paidLamports}:${records[0]?.id || "none"}`,
    ),
    reason: observed.ok || records.length ? null : observed.reason,
  };
}

let trixCardCatalogCache = {
  at: 0,
  cards: [],
};

export async function sniffTrixMarket({ previous = null } = {}) {
  const started = Date.now();
  const endpoints = {
    artworks: `${TRIX_BASE_URL}/api/artworks?limit=${TRIX_ARTWORK_WINDOW}`,
    auctions: `${TRIX_BASE_URL}/api/auctions`,
    treasury: `${TRIX_BASE_URL}/api/treasury`,
    preorder: `${TRIX_BASE_URL}/api/mkt/preorder`,
    activity: `${TRIX_BASE_URL}/api/activity`,
    leaderboard: `${TRIX_BASE_URL}/api/leaderboard`,
    recentMints: `${TRIX_BASE_URL}/api/artworks/recent-activity?limit=12`,
  };
  let cards = trixCardCatalogCache.cards;
  const cardsAge = Date.now() - trixCardCatalogCache.at;
  const cardsStale = !Array.isArray(cards) || cards.length === 0 || cardsAge >= TRIX_CARD_CATALOG_TTL_MS;
  if (cardsStale) endpoints.cards = `${TRIX_BASE_URL}/api/cards`;
  const endpointKeys = Object.keys(endpoints);
  const settled = await Promise.allSettled(endpointKeys.map((key) => fetchJson(endpoints[key])));
  const results = {};
  let failures = [];
  settled.forEach((result, index) => {
    const key = endpointKeys[index];
    if (result.status === "fulfilled" && result.value?.ok) {
      results[key] = result.value.json;
    } else {
      const meta = result.status === "fulfilled" ? result.value : result.reason;
      failures.push(
        `${key}:${meta?.status ?? 0}:${meta?.reason || meta?.error || meta?.message || "error"}`,
      );
    }
  });
  // Artwork buy-link enrichment depends on /api/artworks. That endpoint can flake
  // (it returns HTTP 500 for limit values the API now rejects, e.g. > ~120), so
  // re-fetch with a fallback ladder of smaller limits to keep the meme grid's buy
  // links alive even when the configured window fails.
  if (!Array.isArray(results.artworks) || results.artworks.length === 0) {
    for (const retryLimit of [100, 80, 60, 40]) {
      const retry = await fetchJson(`${TRIX_BASE_URL}/api/artworks?limit=${retryLimit}`).catch(() => null);
      if (retry?.ok && Array.isArray(retry.json) && retry.json.length) {
        if (!results.artworks) failures = failures.filter((f) => !f.startsWith("artworks:"));
        results.artworks = retry.json;
        break;
      }
    }
  }
  let cardsSummary = { count: null, cards: [], maxMultiplier: null };
  if (results.cards && Array.isArray(results.cards)) {
    cardsSummary.cards = results.cards
      .map((card) => ({
        id: card?.id ?? null,
        name: card?.name ?? null,
        slot: Number.isFinite(Number(card?.slot)) ? Number(card.slot) : null,
        multiplier: Number.isFinite(Number(card?.multiplier)) ? Number(card.multiplier) : null,
        priceSol: Number.isFinite(Number(card?.priceSol)) ? Number(card.priceSol) : null,
        imageUrl: typeof card?.imageUrl === "string" && card.imageUrl.startsWith("/")
          ? `${TRIX_BASE_URL}${card.imageUrl}`
          : (typeof card?.imageUrl === "string" ? card.imageUrl : null),
        active: Boolean(card?.active),
        discountActive: Boolean(card?.discountActive),
        discountPercent: Number.isFinite(Number(card?.discountPercent))
          ? Number(card.discountPercent)
          : null,
      }))
      .filter((card) => card.id);
    cardsSummary.count = cardsSummary.cards.length;
    cardsSummary.maxMultiplier = cardsSummary.cards.reduce(
      (max, card) => Math.max(max, Number(card.multiplier) || 0),
      0,
    ) || null;
    trixCardCatalogCache = { at: Date.now(), cards: cardsSummary.cards };
  } else {
    cardsSummary.cards = cards;
    cardsSummary.count = cards.length || null;
    cardsSummary.maxMultiplier = cards.reduce(
      (max, card) => Math.max(max, Number(card.multiplier) || 0),
      0,
    ) || null;
  }
  const artworks = Array.isArray(results.artworks) ? results.artworks : [];
  let artworkTotal = null;
  let artworkPrinted = null;
  let artworkPrintedSupplySum = null;
  if (results.artworks) {
    artworkTotal = artworks.length;
    artworkPrinted = artworks.filter((item) => Number(item?.printedSupply) > 0).length;
    artworkPrintedSupplySum = artworks.reduce(
      (sum, item) => sum + (Number.isFinite(Number(item?.printedSupply)) ? Number(item.printedSupply) : 0),
      0,
    );
  }
  const auctions = Array.isArray(results.auctions) ? results.auctions : [];
  const isLive = (auction) =>
    (auction?.status !== "closed" &&
      auction?.status !== "sold" &&
      auction?.status !== "cancelled") &&
    Number.isFinite(Number(auction?.startingPriceLamports)) &&
    Number(auction.startingPriceLamports) >= 0;
  const activeAuctions = auctions.filter(isLive);
  const activeStartLamports = activeAuctions
    .map((auction) => Number(auction?.startingPriceLamports))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const auctionBids = activeAuctions.filter(
    (auction) => Number.isFinite(Number(auction?.currentBidLamports)) && Number(auction.currentBidLamports) > 0,
  );
  const topBidLamports = auctionBids.length
    ? Math.max(...auctionBids.map((auction) => Number(auction.currentBidLamports)))
    : null;
  const treasury = {
    balanceSol: Number.isFinite(Number(results.treasury?.balance))
      ? Number(results.treasury.balance)
      : null,
    totalPoints: Number.isFinite(Number(results.treasury?.totalPoints))
      ? Number(results.treasury.totalPoints)
      : null,
  };
  const preorder = {
    tcg: Boolean(results.preorder?.tcg),
    round: results.preorder?.round ?? null,
    status: results.preorder?.status ?? null,
    opened: Boolean(results.preorder?.opened),
    owned: Number.isFinite(Number(results.preorder?.owned)) ? Number(results.preorder.owned) : null,
    cap: Number.isFinite(Number(results.preorder?.cap)) ? Number(results.preorder.cap) : null,
    pricePerPackUsd: Number.isFinite(Number(results.preorder?.pricePerPackUsd))
      ? Number(results.preorder.pricePerPackUsd)
      : null,
    mostRippedSymbol: results.preorder?.mostRipped?.symbol ?? null,
    mostRippedBuybackUsd: Number.isFinite(Number(results.preorder?.mostRipped?.buybackUsd))
      ? Number(results.preorder.mostRipped.buybackUsd)
      : null,
  };
  const activityItems = Array.isArray(results.activity?.items) ? results.activity.items : [];
  const launches = [];
  const launchPages = await Promise.allSettled([
    fetchJson(`${TRIX_BASE_URL}/api/launches?limit=500&offset=0&sort=marketCap`),
    fetchJson(`${TRIX_BASE_URL}/api/launches?limit=500&offset=500&sort=marketCap`),
  ]);
  for (const page of launchPages) {
    if (page.status === "fulfilled" && Array.isArray(page.value.json?.items)) {
      launches.push(...page.value.json.items);
    }
  }
  const launchByMint = new Map();
  for (const launch of launches) {
    if (launch?.mintAddress) launchByMint.set(launch.mintAddress, launch);
  }
  const leaderboard = Array.isArray(results.leaderboard?.leaderboard)
    ? results.leaderboard.leaderboard
    : [];
  const leaderboardPoints = leaderboard.reduce(
    (sum, entry) => sum + (Number.isFinite(Number(entry?.points)) ? Number(entry.points) : 0),
    0,
  );
  const recentMints = Array.isArray(results.recentMints) ? results.recentMints : [];
  const artworksById = new Map();
  if (Array.isArray(results.artworks)) {
    for (const art of results.artworks) {
      if (art?.id) artworksById.set(art.id, art);
    }
  }
  // Build an even grid of up to 12 memes. Buyable memes (a linked tradable coin is
  // present) come first so every Buy link + live price stays reachable; minted
  // artworks WITHOUT a linked coin are included afterwards so their easy View links
  // are never cut off either. The recent-activity feed caps at 12, so fold in the
  // newest catalog artworks to keep the grid full and clean.
  const enrichedRecent = recentMints
    .map((item) => ({ ...item, ...(artworksById.get(item?.id) || {}) }))
    .filter((item) => item?.id && typeof item?.imageUrl === "string");
  const buyableRecent = [];
  const mintedRecent = [];
  for (const item of enrichedRecent) {
    if (item?.linkedCoinMint) buyableRecent.push(item);
    else mintedRecent.push(item);
  }
  const byCreated = (a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0);
  const catalogBuyables = [...artworksById.values()]
    .filter((art) => typeof art?.imageUrl === "string" && art?.id && art?.linkedCoinMint)
    .sort(byCreated);
  const catalogMinted = [...artworksById.values()]
    .filter((art) => typeof art?.imageUrl === "string" && art?.id && !art?.linkedCoinMint)
    .sort(byCreated);
  const candidates = [];
  const seenArt = new Set();
  const addCandidate = (item) => {
    if (candidates.length >= 12 || !item?.id || seenArt.has(item.id)) return;
    seenArt.add(item.id);
    candidates.push(item);
  };
  const pushIfNew = (list) => {
    for (const item of list) {
      addCandidate(item);
      if (candidates.length >= 12) break;
    }
  };
  // buyables first so Buy links + prices always visible
  pushIfNew(buyableRecent);
  pushIfNew(catalogBuyables);
  // then minted-only artworks so their View links survive
  pushIfNew(mintedRecent);
  pushIfNew(catalogMinted);
  const recentMintsSummary = candidates
    .slice(0, 12)
    .map((item) => {
      const full = artworksById.get(item.id) || item;
      const linkedMint = full?.linkedCoinMint ?? null;
      const launch = linkedMint ? launchByMint.get(linkedMint) : null;
      const marketCap = Number.isFinite(Number(launch?.marketCap)) ? Number(launch.marketCap) : null;
      const supply = Number.isFinite(Number(launch?.totalSupply)) ? Number(launch.totalSupply) : null;
      const price = marketCap != null && supply && supply > 0 ? marketCap / supply : null;
      const marketCapUpdatedAt = launch?.marketCapUpdatedAt ?? null;
      return {
        id: item.id,
        name: item?.name ?? full?.name ?? null,
        artworkType: item?.artworkType ?? full?.artworkType ?? null,
        imageUrl: typeof item.imageUrl === "string" && item.imageUrl.startsWith("/")
          ? `${TRIX_BASE_URL}${item.imageUrl}`
          : item.imageUrl,
        userId: full?.userId ?? null,
        mintAddress: full?.mintAddress ?? null,
        status: full?.status ?? null,
        website: full?.website ?? null,
        linkedCoinMint: linkedMint,
        linkedCoinSymbol: full?.linkedCoinSymbol ?? launch?.symbol ?? null,
        linkedCoinName: full?.linkedCoinName ?? launch?.name ?? null,
        buyPriceSol: price,
        buyPriceMarketCap: marketCap,
        buyPriceAt: marketCapUpdatedAt,
      };
    });
  const aggregations = {
    cards: cardsSummary,
    artworks: {
      total: artworkTotal,
      printed: artworkPrinted,
      printedSupply: artworkPrintedSupplySum,
      window: TRIX_ARTWORK_WINDOW,
      capped: artworkTotal >= TRIX_ARTWORK_WINDOW,
    },
    auctions: {
      active: activeStartLamports.length || null,
      minStartSol: activeStartLamports.length
        ? Math.min(...activeStartLamports) / 1e9
        : null,
      maxStartSol: activeStartLamports.length
        ? Math.max(...activeStartLamports) / 1e9
        : null,
      withBid: auctionBids.length || null,
      topBidSol: topBidLamports != null ? topBidLamports / 1e9 : null,
    },
    treasury,
    preorder,
    activity: {
      items: activityItems.length,
      hasMore: Boolean(results.activity?.hasMore),
    },
    leaderboard: {
      entries: leaderboard.length || null,
      totalPoints: leaderboardPoints || null,
      window: leaderboard.length >= TRIX_LEADERBOARD_WINDOW ? TRIX_LEADERBOARD_WINDOW : null,
      capped: leaderboard.length >= TRIX_LEADERBOARD_WINDOW,
      rows: leaderboard.slice(0, TRIX_LEADERBOARD_WINDOW).map((entry) => ({
        rank: Number(entry?.rank) || null,
        username: typeof entry?.username === "string" ? entry.username : null,
        wallet: typeof entry?.walletAddress === "string" ? entry.walletAddress : null,
        points: Number.isFinite(Number(entry?.points)) ? Number(entry.points) : null,
        verified: Boolean(entry?.isVerified),
      })),
    },
    recentMints: recentMintsSummary,
  };
  const ok = Boolean(results.cards || results.artworks || results.auctions || results.treasury);
  return {
    source: "trix.market",
    ok,
    status: ok ? 200 : 0,
    ms: Date.now() - started,
    checkedAt: new Date().toISOString(),
    cardsCached: !results.cards && cardsStale ? false : !results.cards,
    cardsCatalogAgeMs: Number.isFinite(trixCardCatalogCache.at)
      ? Date.now() - trixCardCatalogCache.at
      : null,
    ...aggregations,
    fingerprint: bodyHash(
      JSON.stringify(aggregations),
    ),
    url: `${TRIX_BASE_URL}/`,
    note: "Counts and market data from TRIX public APIs (/api/cards, /api/artworks, /api/auctions, /api/treasury, /api/mkt/preorder, /api/activity, /api/leaderboard, /api/launches). The recent-mint artwork feed shows public artwork titles, images, creator userId, on-chain mint address, and each work's linked coin (via /api/launches) with a live buy-price estimate (marketCap ÷ totalSupply) and a Buy link to the TRIX coin page. The leaderboard rows carry TRIX's own public username, wallet, and points. No holder, auction bidder, or artwork-owner identity beyond TRIX's own published fields is kept or displayed. Boost Card artwork is shown from TRIX's own image URLs; the card catalog is cached for six hours. Limits the API itself enforces: /api/artworks caps at 200 items (pagination params are ignored), /api/leaderboard returns one page of 100, and auction rows are listings: only a share carry a live bid and most have no end time yet. Buy price is an estimate from live marketCap ÷ totalSupply; it is not an official order-book bid or ask. The /api/artworks feed window is limited to 100 items: the API returns HTTP 500 for larger limit values.",
    reason: failures.length ? `Partial: ${failures.join("; ")}.` : null,
  };
}

/**
 * "Follow the money" for TRIX: the treasury + fee accounts, the per-trade buy/sell
 * split, the creator/platform fee ledger, and the live on-chain balances of the
 * treasury and the distinct geoff leg. All values are resilient (null on failure)
 * so a partial read never breaks the dashboard.
 */
export async function sniffTrixMoney({ previous = null } = {}) {
  const started = Date.now();
  const now = new Date().toISOString();
  const endpoints = {
    launchpad: `${TRIX_BASE_URL}/api/launchpad-settings/public`,
    treasury: `${TRIX_BASE_URL}/api/treasury`,
    trades: `${TRIX_BASE_URL}/api/feed/trades?limit=50`,
    market: `${TRIX_BASE_URL}/api/meme-market`,
  };
  const fetched = await Promise.all(
    Object.entries(endpoints).map(async ([key, url]) => {
      try {
        const res = await fetchJson(url);
        if (!res?.ok) return [key, null, `${key}:${res?.status ?? 0}:${res?.reason || "error"}`];
        if (res.json?.message && typeof res.json.message === "string") return [key, null, `${key}:${res.status}:${res.json.message}`];
        return [key, res.json, null];
      } catch (e) {
        return [key, null, `${key}:${e?.message || "error"}`];
      }
    }),
  );
  const results = {};
  const failures = [];
  for (const [key, json, failure] of fetched) {
    if (json != null) results[key] = json;
    else if (failure) failures.push(failure);
  }

  const feeSplit = (() => {
    const p = results.launchpad || {};
    const platformBps = Number.isFinite(Number(p?.platformFeeBps)) ? Number(p.platformFeeBps) : null;
    const creatorBps = Number.isFinite(Number(p?.creatorFeeBps)) ? Number(p.creatorFeeBps) : null;
    return {
      platformFeeBps: platformBps,
      creatorFeeBps: creatorBps,
      platformFeePct: platformBps != null ? platformBps / 100 : null,
      creatorFeePct: creatorBps != null ? creatorBps / 100 : null,
      platformLaunchFeeSol: Number.isFinite(Number(p?.platformLaunchFeeSol)) ? Number(p.platformLaunchFeeSol) : null,
    };
  })();

  const treasuryApi = results.treasury || {};
  const [balanceTreasury, balanceGeoLeg1] = await Promise.all([
    solanaRpc("getBalance", [TRIX_TREASURY_ADDRESS, { commitment: "confirmed" }])
      .then((res) => (typeof res?.value === "number" ? res.value / 1e9 : null))
      .catch(() => null),
    solanaRpc("getBalance", [TRIX_GEOFF_LEG1, { commitment: "confirmed" }])
      .then((res) => (typeof res?.value === "number" ? res.value / 1e9 : null))
      .catch(() => null),
  ]);

  const trades = Array.isArray(results.trades?.items) ? results.trades.items : [];
  let buySol = 0;
  let sellSol = 0;
  let buyCount = 0;
  let sellCount = 0;
  const wallets = new Set();
  const byCoin = new Map();
  for (const t of trades) {
    const side = t?.side;
    const sol = Number.isFinite(Number(t?.solAmount)) ? Number(t.solAmount) : 0;
    const mint = t?.mint;
    if (side === "buy") { buySol += sol; buyCount += 1; }
    if (side === "sell") { sellSol += sol; sellCount += 1; }
    if (t?.walletAddress) wallets.add(t.walletAddress);
    if (mint) {
      const coin = byCoin.get(mint) || { mint, symbol: t?.symbol, buySol: 0, sellSol: 0, count: 0 };
      coin.buySol += side === "buy" ? sol : 0;
      coin.sellSol += side === "sell" ? sol : 0;
      coin.count += 1;
      byCoin.set(mint, coin);
    }
  }
  const topCoins = [...byCoin.values()]
    .sort((a, b) => (b.buySol + b.sellSol) - (a.buySol + a.sellSol))
    .slice(0, 8)
    .map((c) => ({ ...c, buySol: roundSol(c.buySol), sellSol: roundSol(c.sellSol) }));

  const market = Array.isArray(results.market) ? results.market : [];
  let marketVolume24h = 0;
  let marketLiquidity = 0;
  let marketCoins = 0;
  let marketSnapshot = null;
  if (market.length) {
    marketCoins = market.length;
    marketVolume24h = market.reduce((s, c) => s + (Number.isFinite(Number(c?.volume24h)) ? Number(c.volume24h) : 0), 0);
    marketLiquidity = market.reduce((s, c) => s + (Number.isFinite(Number(c?.liquidity)) ? Number(c.liquidity) : 0), 0);
    marketSnapshot = market[0]?.snapshotTimestamp ?? null;
  }

  const aggregations = {
    feeSplit,
    treasury: {
      address: TRIX_TREASURY_ADDRESS,
      balanceSol: Number.isFinite(Number(treasuryApi?.balance)) ? Number(treasuryApi.balance) : null,
      totalPoints: Number.isFinite(Number(treasuryApi?.totalPoints)) ? Number(treasuryApi.totalPoints) : null,
      balanceSolOnChain: balanceTreasury,
      balanceSolOnChainAt: now,
    },
    geoffLeg1: {
      address: TRIX_GEOFF_LEG1,
      balanceSol: balanceGeoLeg1,
      balanceSolOnChainAt: now,
      isTreasury: false,
    },
    // 'Non-geoff' money = the creator + platform fee shares from coin trading that do
    // NOT land on the geoff generation rail. The treasury is itself one geoff leg, so
    // the distinct non-geoff pools are the creator fee (per-launch) and the platform
    // fee kept outside those two system-transfer legs.
    fees: {
      recentBuysSol: roundSol(buySol),
      recentSellsSol: roundSol(sellSol),
      recentNetSol: roundSol(buySol - sellSol),
      buyCount,
      sellCount,
      uniqueWallets: wallets.size,
      topCoins,
    },
    market24h: {
      coins: marketCoins,
      volume24h: roundSol(marketVolume24h),
      liquidity: roundSol(marketLiquidity),
      snapshotAt: marketSnapshot,
    },
    checkedAt: now,
  };

  const ok = Boolean(results.launchpad || results.treasury || trades.length);
  return {
    source: "trix.money",
    ok,
    status: ok ? 200 : 0,
    ms: Date.now() - started,
    ...aggregations,
    url: `${TRIX_BASE_URL}/`,
    note: "Money-flow read from TRIX public APIs (/api/treasury, /api/launchpad-settings/public, /api/feed/trades, /api/meme-market) plus live on-chain SOL balances (getBalance) for the treasury and the distinct geoff leg. The TRIX treasury wallet H1HU4….Rtvoid is itself one of the two geoff provider rails; the other rail QR7US….TtY is a separate wallet. 'Non-geoff' money here means the creator-fee and platform-fee shares a coin trade splits off before any of it reaches the geoff rails. Buy/sell SOL totals are summed from the public trade feed window (limit 50 newest events). 24h volume/liquidity are TRIX's own /api/meme-market snapshot (stale; not live on-curve). All estimates are not an official order-book bid or ask.",
    reason: failures.length ? `Partial: ${failures.join("; ")}.` : null,
    fingerprint: bodyHash(JSON.stringify(aggregations)),
  };
}

function roundSol(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value) * 1e6) / 1e6 : null;
}

export async function runSniff({ forceMiningSurface = false, previous = null } = {}) {
  const startedAt = new Date().toISOString();
  const settled = await Promise.allSettled([
    sniffGeoffVersion(),
    sniffGeoffDeploy(),
    sniffGeoffCatalog(),
    sniffGeoffTokenPlan(),
    sniffGeoffDocsSurface(),
    sniffGeoffExplore(),
    sniffGeoffMaxSolana(),
    sniffGeoffProductLanes(),
    sniffGeoffPublicSurfaces(),
    sniffGeoffSubscription(),
    sniffTrixGeoff({ previous: previous?.sources?.["trix.geoff"] || null }),
    sniffTrixMarket(),
    sniffTrixMoney(),
    sniffStacknetHealth(),
    sniffStacknetRoot(),
    sniffStacknetNetwork(),
    sniffStacknetPile(),
    sniffStacknetKeySale(),
    sniffStacknetX402(),
    sniffStacknetNode(),
    sniffStacknetModels(),
    sniffStacknetWidgets(),
    sniffOpencodeZen(),
    sniffOpencodeRegistry(),
    sniffOpencodeReleases(),
    sniffOpencodeGo(),
    sniffMiningSurface(forceMiningSurface),
    sniffNodeKeys9g(),
    sniffZenErrorShape(),
  ]);

  const sources = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      source: `source-${index}`,
      ok: false,
      status: 0,
      error: result.reason?.message || String(result.reason),
    };
  });

  const treasuryAddress =
    sources.find((s) => s.source === "stacknet.network")?.treasury?.treasuryAddress ||
    DEFAULT_TREASURY_ADDRESS;
  try {
    sources.push(await sniffSolanaTreasury(treasuryAddress));
  } catch (error) {
    sources.push({
      source: "solana.treasury",
      ok: false,
      status: 0,
      address: treasuryAddress,
      reason: error?.message || String(error),
    });
  }

  try {
    sources.push(await sniffSolanaTokens());
  } catch (error) {
    sources.push({
      source: "solana.tokens",
      ok: false,
      status: 0,
      owner: DEFAULT_TOKEN_OWNER,
      mints: [],
      reason: error?.message || String(error),
    });
  }

  const bySource = Object.fromEntries(sources.map((s) => [s.source, s]));

  return {
    id: `snap_${Date.now().toString(36)}`,
    takenAt: startedAt,
    sources: bySource,
    summary: {
      geoffBuildId: bySource["geoff.version"]?.buildId ?? null,
      geoffDeployId: bySource["geoff.deploy"]?.deployId ?? null,
      chunkHash: bySource["geoff.deploy"]?.chunks?.hash ?? null,
      chunkCount: bySource["geoff.deploy"]?.chunks?.count ?? null,
      ...summarizeStacknet(bySource, startedAt),
      widgets: bySource["stacknet.widgets"]?.count ?? null,
      pile: bySource["stacknet.pile"]?.pile ?? null,
      keySaleActive: bySource["stacknet.keysale"]?.saleActive ?? null,
      keySaleEpoch: bySource["stacknet.keysale"]?.epoch ?? null,
      keySaleDay: bySource["stacknet.keysale"]?.day ?? null,
      keySaleDaysUntilHalving: bySource["stacknet.keysale"]?.daysUntilHalving ?? null,
      keySaleKeysSold: bySource["stacknet.keysale"]?.keysSold ?? null,
      keySalePriceUsd: bySource["stacknet.keysale"]?.priceUsd ?? null,
      keySaleFingerprint: bySource["stacknet.keysale"]?.fingerprint ?? null,
      x402Version: bySource["stacknet.x402"]?.version ?? null,
      x402WeeklyDownloads: bySource["stacknet.x402"]?.weeklyDownloads ?? null,
      x402PeriodStart: bySource["stacknet.x402"]?.periodStart ?? null,
      x402PeriodEnd: bySource["stacknet.x402"]?.periodEnd ?? null,
      x402PaymentMints: bySource["stacknet.x402"]?.paymentMints ?? [],
      x402Fingerprint: bySource["stacknet.x402"]?.fingerprint ?? null,
      treasuryRpcOk: Boolean(bySource["solana.treasury"]?.ok),
      treasuryRpcAddress: bySource["solana.treasury"]?.address ?? null,
      treasuryRpcLamports: bySource["solana.treasury"]?.lamports ?? null,
      treasuryRpcSol: bySource["solana.treasury"]?.sol ?? null,
      treasuryRpcSigCount: bySource["solana.treasury"]?.sigCount ?? null,
      treasuryLatestActivityAt: bySource["solana.treasury"]?.latestActivityAt ?? null,
      tokenPress: bySource["solana.tokens"]?.mints ?? [],
      tokenPressOwner: bySource["solana.tokens"]?.owner ?? null,
      tokenPressStale: Boolean(bySource["solana.tokens"]?.stale),
      tokenPressFingerprint: bySource["solana.tokens"]?.fingerprint ?? null,
      zenModelCount: bySource["opencode.zen"]?.count ?? null,
      zenFreeCount: bySource["opencode.zen"]?.freeCount ?? null,
      zenGhostIds: bySource["opencode.zen"]?.ghostIds ?? [],
      zenFreeIds: bySource["opencode.zen"]?.freeIds ?? [],
      zenFreeContextTotal: bySource["opencode.zen"]?.freeContextTotal ?? null,
      zenGhostContextTotal: bySource["opencode.zen"]?.ghostContextTotal ?? null,
      zenMissingGhosts: bySource["opencode.zen"]?.missingGhosts ?? [],
      zenFingerprint: bySource["opencode.zen"]?.fingerprint ?? null,
      ocRegistryProviders: bySource["opencode.registry"]?.registryProviders ?? null,
      ocRegistryModels: bySource["opencode.registry"]?.count ?? null,
      ocGhostHits: bySource["opencode.registry"]?.ghostHits ?? [],
      ocGhostSpecs: bySource["opencode.registry"]?.ghostSpecs ?? [],
      ocRegistryFingerprint: bySource["opencode.registry"]?.fingerprint ?? null,
      ocReleaseTag: bySource["opencode.releases"]?.latestTag ?? null,
      ocReleaseName: bySource["opencode.releases"]?.latestName ?? null,
      ocReleaseAt: bySource["opencode.releases"]?.latestAt ?? null,
      ocReleaseRecentTags: bySource["opencode.releases"]?.recentTags ?? [],
      goPriceIntroUsd: bySource["opencode.go"]?.priceIntroUsd ?? null,
      goPriceMonthlyUsd: bySource["opencode.go"]?.priceMonthlyUsd ?? null,
      goLineupCount: bySource["opencode.go"]?.lineupCount ?? null,
      goOxAlphaPromo: Boolean(bySource["opencode.go"]?.oxAlphaPromo),
      goGptLunaListed: Boolean(bySource["opencode.go"]?.gptLunaListed),
      goFingerprint: bySource["opencode.go"]?.fingerprint ?? null,
      goLadder: bySource["opencode.go"]?.goLadder ?? [],
      goTierTabs: bySource["opencode.go"]?.tierTabs ?? [],
      goFreeDailyRequests: bySource["opencode.go"]?.freeDailyRequests ?? null,
      goEquiv5hUsd: bySource["opencode.go"]?.equiv5hUsd ?? null,
      goEquivWeekUsd: bySource["opencode.go"]?.equivWeekUsd ?? null,
      goEquivMonthUsd: bySource["opencode.go"]?.equivMonthUsd ?? null,
      miningSurfaceOk: Boolean(bySource["surface.mining"]?.ok),
      miningSurfaceStatus: bySource["surface.mining"]?.status ?? null,
      miningSurfaceTitle: bySource["surface.mining"]?.title ?? null,
      miningClaimsOn: bySource["surface.mining"]?.claimsOn ?? null,
      miningMiners60m: bySource["surface.mining"]?.miners60m ?? null,
      miningPayouts60m: bySource["surface.mining"]?.payouts60m ?? null,
      miningMiners60mAt: bySource["surface.mining"]?.miners60mAt ?? null,
      miningSilentSince: bySource["surface.mining"]?.silentSince ?? null,
      miningFacetState: bySource["surface.mining"]?.facetState ?? null,
      miningBand: bySource["surface.mining"]?.band ?? null,
      miningPayoutWallet: bySource["surface.mining"]?.payoutWallet ?? null,
      miningPayoutTokenAccount: bySource["surface.mining"]?.payoutTokenAccount ?? null,
      miningPayoutMint: bySource["surface.mining"]?.payoutMint ?? null,
      miningPayoutMinimum: bySource["surface.mining"]?.payoutMinimum ?? null,
      miningPayoutCount: bySource["surface.mining"]?.payoutCount ?? null,
      miningPayoutTotal: bySource["surface.mining"]?.payoutTotal ?? null,
      miningPayoutDate: bySource["surface.mining"]?.payoutDate ?? null,
      miningPayoutLatestAt: bySource["surface.mining"]?.payoutLatestAt ?? null,
      miningPayoutLatestSignature: bySource["surface.mining"]?.payoutLatestSignature ?? null,
      miningPayoutActivityCount: bySource["surface.mining"]?.payoutActivityCount ?? null,
      miningPayoutTruncated: Boolean(bySource["surface.mining"]?.payoutTruncated),
      miningPayouts: bySource["surface.mining"]?.payouts ?? [],
      miningArchiveClaims: bySource["surface.mining"]?.archiveClaims ?? null,
      miningArchiveWallets: bySource["surface.mining"]?.archiveWallets ?? null,
      miningArchiveTotalWpond: bySource["surface.mining"]?.archiveTotalWpond ?? null,
miningArchiveGeneratedAt: bySource["surface.mining"]?.archiveGeneratedAt ?? null,
      miningArchiveMinimum: bySource["surface.mining"]?.archiveMinimum ?? null,
      ...summarizeKey9g(bySource["geoff.keys.9g"]),
      zenErrShape: bySource["opencode.zenerr"]?.shape ?? null,
      zenErrLeakHit: Boolean(bySource["opencode.zenerr"]?.leakHit),
      catalogModels: bySource["geoff.catalog"]?.models?.length ?? null,
      catalogSkipped: Boolean(bySource["geoff.catalog"]?.skipped),
      catalogSkipReason: bySource["geoff.catalog"]?.reason ?? null,
      tokenPlanCount: bySource["geoff.docs.pricing"]?.plans?.length ?? null,
      tokenPlanScraped: Boolean(bySource["geoff.docs.pricing"]?.scraped),
      tokenPlanFingerprint: bySource["geoff.docs.pricing"]?.fingerprint ?? null,
      docsSurfaceScraped: bySource["geoff.docs.surface"]?.scraped ?? null,
      docsSurfaceFingerprint: bySource["geoff.docs.surface"]?.fingerprint ?? null,
      docsLinkedPageCount: bySource["geoff.docs.surface"]?.linkedPageCount ?? null,
      docsPublishedModelLayers: bySource["geoff.docs.surface"]?.publishedModelLayers ?? [],
      exploreCount: bySource["geoff.explore"]?.count ?? null,
      exploreAuthors: bySource["geoff.explore"]?.authorCount ?? null,
      exploreFingerprint: bySource["geoff.explore"]?.fingerprint ?? null,
      exploreMedia: bySource["geoff.explore"]?.mediaCounts ?? null,
      maxSolanaLive: Boolean(bySource["geoff.max.solana"]?.solanaLive),
      maxHubLive: Boolean(bySource["geoff.max.solana"]?.maxLive),
      maxSolanaFingerprint: bySource["geoff.max.solana"]?.fingerprint ?? null,
      maxSolanaRoutes: bySource["geoff.max.solana"]?.liveCount ?? null,
      productLanesLive: bySource["geoff.product.lanes"]?.liveCount ?? null,
      productLanesTotal: bySource["geoff.product.lanes"]?.total ?? null,
      productLanesLabels: bySource["geoff.product.lanes"]?.liveLabels ?? null,
      productLanesFingerprint: bySource["geoff.product.lanes"]?.fingerprint ?? null,
      publicSurfacesLive: bySource["geoff.public.surfaces"]?.liveCount ?? null,
      publicSurfacesTotal: bySource["geoff.public.surfaces"]?.total ?? null,
      publicSurfacesFingerprint: bySource["geoff.public.surfaces"]?.fingerprint ?? null,
trixGeoffCount: bySource["trix.geoff"]?.count ?? null,
      trixGeoffPaidSol: bySource["trix.geoff"]?.paidSol ?? null,
      trixGeoffFingerprint: bySource["trix.geoff"]?.fingerprint ?? null,
      trixCardCount: bySource["trix.market"]?.cards?.count ?? null,
      trixCardMaxMultiplier: bySource["trix.market"]?.cards?.maxMultiplier ?? null,
      trixArtworkCount: bySource["trix.market"]?.artworks?.total ?? null,
      trixArtworkPrinted: bySource["trix.market"]?.artworks?.printed ?? null,
      trixArtworkSupply: bySource["trix.market"]?.artworks?.printedSupply ?? null,
      trixArtworkCapped: Boolean(bySource["trix.market"]?.artworks?.capped),
      trixAuctionCount: bySource["trix.market"]?.auctions?.active ?? null,
      trixAuctionBidCount: bySource["trix.market"]?.auctions?.withBid ?? null,
      trixPreorderOpened: Boolean(bySource["trix.market"]?.preorder?.opened),
      trixTreasurySol: bySource["trix.market"]?.treasury?.balanceSol ?? null,
      trixTreasuryPoints: bySource["trix.market"]?.treasury?.totalPoints ?? null,
      trixActivityCount: bySource["trix.market"]?.activity?.items ?? null,
      trixLeaderboardEntries: bySource["trix.market"]?.leaderboard?.entries ?? null,
      trixTcgActive: Boolean(bySource["trix.market"]?.preorder?.tcg),
      trixRecentMints: bySource["trix.market"]?.recentMints ?? [],
      trixLeaderboard: bySource["trix.market"]?.leaderboard?.rows ?? [],
      trixLeaderboardCap: bySource["trix.market"]?.leaderboard?.capped ?? false,
      trixMarketFingerprint: bySource["trix.market"]?.fingerprint ?? null,
      trixMoneyOk: Boolean(bySource["trix.money"]?.ok),
      trixMoneyTreasurySol: bySource["trix.money"]?.treasury?.balanceSol ?? null,
      trixMoneyTreasuryOnChain: bySource["trix.money"]?.treasury?.balanceSolOnChain ?? null,
      trixMoneyGeoLeg1Sol: bySource["trix.money"]?.geoffLeg1?.balanceSol ?? null,
      trixMoneyTreasuryPoints: bySource["trix.money"]?.treasury?.totalPoints ?? null,
      trixMoneyPlatformFeeBps: bySource["trix.money"]?.feeSplit?.platformFeeBps ?? null,
      trixMoneyCreatorFeeBps: bySource["trix.money"]?.feeSplit?.creatorFeeBps ?? null,
      trixMoneyLaunchFeeSol: bySource["trix.money"]?.feeSplit?.platformLaunchFeeSol ?? null,
      trixMoneyRecentBuysSol: bySource["trix.money"]?.fees?.recentBuysSol ?? null,
      trixMoneyRecentSellsSol: bySource["trix.money"]?.fees?.recentSellsSol ?? null,
      trixMoneyRecentNetSol: bySource["trix.money"]?.fees?.recentNetSol ?? null,
      trixMoneyTopCoins: bySource["trix.money"]?.fees?.topCoins ?? [],
      trixMoneyMarketVolume24h: bySource["trix.money"]?.market24h?.volume24h ?? null,
      trixMoneyMarketLiquidity: bySource["trix.money"]?.market24h?.liquidity ?? null,
      trixMoneyFingerprint: bySource["trix.money"]?.fingerprint ?? null,
      subscriptionLiveCount: bySource["geoff.subscription"]?.liveCount ?? null,
      subscriptionTotal: bySource["geoff.subscription"]?.total ?? null,
      subscriptionFingerprint: bySource["geoff.subscription"]?.fingerprint ?? null,
      subscriptionLiveLabels: bySource["geoff.subscription"]?.liveLabels ?? null,
      subscriptionAccount: Boolean(bySource["geoff.subscription"]?.accountLive),
      subscriptionBilling: Boolean(bySource["geoff.subscription"]?.billingLive),
      subscriptionPlans: Boolean(bySource["geoff.subscription"]?.plansLive),
      subscriptionRoute: Boolean(bySource["geoff.subscription"]?.subscriptionLive),
      healthySources: sources.filter((s) => s.ok).length,
      skippedSources: sources.filter((s) => s.skipped).length,
      failedSources: sources.filter((s) => !s.ok && !s.skipped).length,
      totalSources: sources.length,
      coverage: sources.map((s) => ({
        source: s.source,
        ok: Boolean(s.ok),
        skipped: Boolean(s.skipped),
        reason: s.reason || s.error || null,
        ms: s.ms ?? null,
      })),
    },
  };
}

export async function sniffStacknetMinute() {
  const takenAt = new Date().toISOString();
  const started = Date.now();
  const settled = await Promise.allSettled([
    sniffStacknetHealth(),
    sniffStacknetRoot(),
    sniffStacknetNetwork(),
    sniffStacknetNode(),
    sniffStacknetModels(),
  ]);
  const fallbackSources = [
    "stacknet.health",
    "stacknet.root",
    "stacknet.network",
    "stacknet.node",
    "stacknet.models",
  ];
  const sources = settled.map((result, index) => ({
    ...(result.status === "fulfilled"
      ? result.value
      : {
          source: fallbackSources[index],
          ok: false,
          status: 0,
          error: result.reason?.message || String(result.reason),
        }),
    checkedAt: takenAt,
  }));
  const bySource = Object.fromEntries(sources.map((source) => [source.source, source]));
  return {
    takenAt,
    durationMs: Date.now() - started,
    sources: bySource,
    summary: summarizeStacknet(bySource, takenAt),
  };
}

function summarizeStacknet(bySource, checkedAt = null) {
  const health = bySource["stacknet.health"] ?? {};
  const network = bySource["stacknet.network"] ?? {};
  const fleet = fleetTaxonomy(network.models || []);
  const vramPct =
    isFiniteNumber(network.totalVramGb) &&
    network.totalVramGb > 0 &&
    isFiniteNumber(network.availableVramGb)
      ? Math.round((network.availableVramGb / network.totalVramGb) * 100)
      : null;
  return {
    stacknetCheckedAt: checkedAt,
    stacknetVersion: health.version ?? bySource["stacknet.root"]?.version ?? null,
    stacknetStatus: health.statusText
      ?? (health.reachable === false
        ? `unreachable (${health.httpError || "error"})`
        : null),
    mcpContract: health.remoteMcp?.contract_id ?? null,
    mcpOnHealth: Boolean(health.remoteMcp?.contract_id),
    inFlight: health.inFlight ?? null,
    maxInFlight: health.maxInFlight ?? null,
    taskCount: bySource["stacknet.node"]?.taskCount ?? null,
    nodeId: bySource["stacknet.node"]?.nodeId ?? health.nodeId ?? null,
    nodes: network.availableNodes ?? null,
    totalNodes: network.totalNodes ?? null,
    gpus: network.totalGpus ?? null,
    vramGb: network.totalVramGb ?? null,
    availableVramGb: network.availableVramGb ?? null,
    vramAvailablePct: vramPct,
    averageLoad: network.averageLoad ?? null,
    models: network.totalModels ?? null,
    apiModels: bySource["stacknet.models"]?.count ?? null,
    capabilities: network.capabilities?.length ?? null,
    solPriceUsd: network.treasury?.solPriceUsd ?? null,
    treasuryAddress: network.treasury?.treasuryAddress ?? null,
    treasuryCluster: network.treasury?.cluster ?? null,
    treasuryStaleSeconds: network.treasury?.staleSeconds ?? null,
    treasuryTotalUsd: network.treasury?.totalUsd ?? null,
    treasuryReceivableUsd: network.treasury?.receivableUsd ?? null,
    treasuryPending: network.treasury?.pendingObligations ?? null,
    treasuryWarnings: network.treasury?.warnings?.length ?? 0,
    metaproofsTotal: network.metaproofs?.total ?? null,
    metaproofsPaperworkUsd: network.metaproofs?.totalPaperworkUsd ?? null,
    metaproofsPaidUsd: network.metaproofs?.paidPaperworkUsd ?? null,
    metaproofsOutstandingUsd: network.metaproofs?.outstandingUsd ?? null,
    fleetBases: fleet.bases,
    fleetLines: fleet.lines,
  };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
