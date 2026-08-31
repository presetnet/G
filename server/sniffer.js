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
    docsUrl: "https://devconsole-indol.vercel.app/stacks/packages/x402payg",
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
const MINING_TX_DECODE_LIMIT = 12;

async function sniffMiningPayouts() {
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
  const payouts = [];
  for (const row of latestActivity.slice(0, MINING_TX_DECODE_LIMIT)) {
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
      payouts.push({
        signature: row.signature,
        at: row.blockTime != null ? new Date(row.blockTime * 1000).toISOString() : null,
        amount,
        recipient: balance.owner || null,
        destination: info.destination,
      });
    }
  }
  payouts.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  const latestDay = payouts[0]?.at?.slice(0, 10) || null;
  const latestBatch = latestDay ? payouts.filter((row) => row.at?.startsWith(latestDay)) : [];
  return {
    payouts,
    latestDay,
    latestBatch,
    latestSignature: payouts[0]?.signature || null,
    latestAt: payouts[0]?.at || null,
    latestTotal: latestBatch.reduce((sum, row) => sum + row.amount, 0),
    activityCount: latestActivity.length,
    truncated: latestActivity.length > MINING_TX_DECODE_LIMIT,
  };
}

function bodyHash(input) {
  return createHash("sha256").update(input || "", "utf8").digest("hex").slice(0, 16);
}

export async function sniffMiningSurface(force = false) {
  if (!force) {
    const cached = await loadMiningSurfaceCache().catch(() => null);
    const cachedAt = cached?.cachedAt ? Date.parse(cached.cachedAt) : NaN;
    if (
      cached?.source?.payoutWallet === MINING_PAYOUT_WALLET &&
      Number.isFinite(cachedAt) &&
      Date.now() - cachedAt < MINING_SURFACE_CACHE_MS
    ) {
      return { ...cached.source, cached: true, ageMs: Date.now() - cachedAt };
    }
  }
  try {
    const [res, archiveRes, payoutData] = await Promise.all([
      fetchJson(MINING_SURFACE_URL, { timeoutMs: 9_000 }),
      fetchJson(`${MINING_SURFACE_URL}band-claims-archive.json`, { timeoutMs: 18_000 }),
      sniffMiningPayouts(),
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
      payoutCount: payoutData.latestBatch.length,
      payoutTotal: payoutData.latestTotal,
      payoutDate: payoutData.latestDay,
      payoutLatestAt: payoutData.latestAt,
      payoutLatestSignature: payoutData.latestSignature,
      payoutActivityCount: payoutData.activityCount,
      payoutTruncated: payoutData.truncated,
      payouts: payoutData.latestBatch,
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

/** Public docs pages we fingerprint so silent surface moves show up in the feed. */
const DOCS_SURFACE_PAGES = [
  // Intro
  { id: "api-overview", path: "/introduction/overview", label: "API Overview" },
  { id: "quickstart", path: "/introduction/quickstart", label: "Quickstart" },
  { id: "auth", path: "/introduction/authentication", label: "Authentication" },
  { id: "models", path: "/introduction/models", label: "Models" },
  // Token plan
  { id: "token-overview", path: "/token-plan/overview", label: "Token Plan Overview" },
  { id: "pricing-docs", path: "/token-plan/pricing", label: "Pricing docs" },
  { id: "usage", path: "/token-plan/usage", label: "Usage & Limits" },
  // MCP
  { id: "mcp-overview", path: "/mcp/overview", label: "MCP Overview" },
  { id: "mcp-tools", path: "/mcp/tools", label: "MCP Tools" },
  { id: "mcp-examples", path: "/mcp/examples", label: "MCP Examples" },
  { id: "mcp-transports", path: "/mcp/transports", label: "MCP Transports" },
  // Features (expanded nav)
  { id: "hq", path: "/features/hq", label: "HQ" },
  { id: "claw", path: "/features/agent-mode", label: "Agent Mode (Claw)" },
  { id: "codev3", path: "/features/codev3", label: "Codev3" },
  { id: "content-types", path: "/features/content-types", label: "Content Types" },
  { id: "elements", path: "/features/elements", label: "Elements" },
  { id: "skills", path: "/features/skills", label: "Skills" },
  { id: "social", path: "/features/social", label: "Social" },
  { id: "stacknet-proxy", path: "/features/stacknet-proxy", label: "StackNet Proxy" },
  { id: "studio-mode", path: "/features/studio-mode", label: "Studio Mode" },
  { id: "tool-catalog", path: "/features/tool-catalog", label: "Tool Catalog" },
  // Product + ops docs
  { id: "geoff-code", path: "/geoff-code/getting-started", label: "Geoff Code" },
  { id: "api-reference", path: "/api-reference/overview", label: "API Reference" },
  { id: "cookbook", path: "/cookbook/overview", label: "Cookbook" },
  { id: "docs-overview", path: "/docs/overview", label: "Docs Overview" },
  { id: "agents-docs", path: "/docs/agents", label: "Agent integration" },
  { id: "security", path: "/docs/security", label: "Security" },
  { id: "billing-docs", path: "/docs/billing", label: "Billing docs" },
];

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
  const text = extractDocsBodyText(html).slice(0, 6000);
  const modelHits = [
    ...new Set(
      [...text.matchAll(/\b(magma|duce|pyro(?::max)?|preview|stack-embed|mom-preview)\b/gi)].map((m) =>
        m[0].toLowerCase(),
      ),
    ),
  ].sort();
  const featureHits = [
    ...new Set(
      [
        "codev3",
        "stacknet proxy",
        "studio mode",
        "skills",
        "social",
        "agent mode",
        "claw",
        "hq",
        "mcp",
        "geoff code",
        "token plan",
      ].filter((k) => new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(text)),
    ),
  ].sort();
  const transportHits = [
    ...new Set(
      ["sse", "stdio", "streamable http", "websocket", "http"]
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

/** Auth-gated product shells on geoff.ai — allowlisted from docs (catch-all /connect is NOT proof). */
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
    const [overview, pricing] = await Promise.all([
      fetchJson(TOKEN_PLAN_URLS.overview),
      fetchJson(TOKEN_PLAN_URLS.pricing),
    ]);
    const html = `${overview.text || ""}\n${pricing.text || ""}`;
    const parsed = parseTokenPlanHtml(html);
    const scrapedOk =
      (overview.ok || pricing.ok) &&
      parsed.plans.length >= 3 &&
      parsed.plans.every((p) => p.price && p.tokens);
    const plan = scrapedOk
      ? parsed
      : {
          ...FALLBACK_TOKEN_PLAN,
          plans: FALLBACK_TOKEN_PLAN.plans.map((p) => ({ ...p })),
          matrix: FEATURE_MATRIX,
          wins: FALLBACK_TOKEN_PLAN.wins,
        };
    const fingerprint = simpleHash(fingerprintTokenPlan(plan));

    return {
      source: "geoff.docs.pricing",
      ok: Boolean(overview.ok || pricing.ok || scrapedOk),
      status: overview.status || pricing.status || 0,
      ms: Date.now() - started,
      scraped: scrapedOk,
      fingerprint,
      model: plan.model,
      plans: plan.plans,
      estimates: plan.estimates,
      matrix: plan.matrix || FEATURE_MATRIX,
      wins: plan.wins || FALLBACK_TOKEN_PLAN.wins,
      sourceUrls: TOKEN_PLAN_URLS,
      reason: scrapedOk
        ? null
        : "Docs HTML parse incomplete — showing last known public Token Plan tables",
    };
  } catch (error) {
    return {
      source: "geoff.docs.pricing",
      ok: true,
      skipped: false,
      status: 0,
      ms: Date.now() - started,
      scraped: false,
      fingerprint: simpleHash(fingerprintTokenPlan(FALLBACK_TOKEN_PLAN)),
      model: FALLBACK_TOKEN_PLAN.model,
      plans: FALLBACK_TOKEN_PLAN.plans.map((p) => ({ ...p })),
      estimates: FALLBACK_TOKEN_PLAN.estimates,
      matrix: FEATURE_MATRIX,
      wins: FALLBACK_TOKEN_PLAN.wins,
      sourceUrls: TOKEN_PLAN_URLS,
      reason: `Docs sniff failed (${error.message}); using cached public Token Plan tables`,
    };
  }
}

const TRIX_BASE_URL = "https://trix.market";
const MAX_TRIX_HISTORY_RECORDS = 2_000;
const MAX_TRIX_HISTORY_IDS = 10_000;
const TRIX_LAUNCH_CATALOG_TTL_MS = 6 * 60 * 60 * 1_000;
const TRIX_CARD_CLASSES = [
  { key: "mythic", label: "Mythic", oddsBps: 4 },
  { key: "epic", label: "Epic", oddsBps: 35 },
  { key: "rare", label: "Rare", oddsBps: 200 },
  { key: "uncommon", label: "Uncommon", oddsBps: 900 },
  { key: "common", label: "Common", oddsBps: 4_561 },
  { key: "trix", label: "Void", oddsBps: 4_300 },
];

export function parseTrixGeoffRecords(posts = [], records = []) {
  const postById = new Map(posts.map((post) => [post.id, post]));
  const seen = new Set();
  return records
    .filter((record) => record?.generator === "geoff" && record.id && !seen.has(record.id))
    .map((record) => {
      seen.add(record.id);
      const post = postById.get(record.postId) || null;
      const feeLamports = Number(record.feeLamports);
      return {
        id: record.id,
        createdAt: record.createdAt || post?.createdAt || null,
        postId: record.postId || post?.id || null,
        authorWallet: record.authorWallet || post?.payerWallet || null,
        tokenMint: record.tokenMint || post?.memeTokenMint || null,
        tokenSymbol: record.coinSymbol || post?.memeCoinSymbol || null,
        imageUrl: record.imageUrl || post?.imageUrl || null,
        txSignature: record.txSignature || null,
        paidNetwork: record.paidNetwork || null,
        feeLamports: Number.isFinite(feeLamports) ? feeLamports : null,
        feeSol: Number.isFinite(feeLamports) ? feeLamports / 1e9 : null,
      };
    })
    .filter(
      (record) =>
        record.txSignature && record.feeLamports > 0 && record.paidNetwork === "mainnet",
    )
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

export function parseTrixPackMarket(state = null, { status = 0, ms = null } = {}) {
  if (!state || typeof state !== "object") {
    return {
      ok: false,
      status,
      ms,
      minted: null,
      holders: null,
      classes: [],
      reason: "TRIX Pack market state unavailable.",
    };
  }
  const levels = Array.isArray(state.levels) ? state.levels : [];
  const base = levels.find((level) => level?.id === "base") || levels[0] || null;
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
    levels: levels.map((level) => ({
      id: level.id,
      minted: level.minted,
      available: level.available,
      priceSol: level.priceSol,
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
    oddsSourceUrl: `${TRIX_BASE_URL}/assets/c-BkGleqvg.js`,
    note: "Minted and market values are TRIX API-reported. Class odds come from the current TRIX frontend bundle; payout bands come from market state. They are schedules, not actual revealed-card counts.",
    reason: null,
  };
}

export async function sniffTrixGeoff({ previous = null, maxMints = 5 } = {}) {
  const started = Date.now();
  const [recentRes, packRes] = await Promise.all([
    fetchJson(`${TRIX_BASE_URL}/api/meme-image/recent?limit=48`),
    fetchJson(`${TRIX_BASE_URL}/api/mkt/state`),
  ]);
  const recentRecords = Array.isArray(recentRes.json) ? recentRes.json : [];
  const packs = parseTrixPackMarket(packRes.json, { status: packRes.status, ms: packRes.ms });
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
  const selectedMints = unscanned.slice(0, Math.max(1, maxMints));
  const settled = await Promise.allSettled(
    selectedMints.map((mint) => fetchJson(`${TRIX_BASE_URL}/api/meme-image/token/${mint}`)),
  );
  const records = [
    ...recentRecords,
    ...settled.flatMap((result) =>
      result.status === "fulfilled" && Array.isArray(result.value.json) ? result.value.json : [],
    ),
  ];
  const resolvedTokenMints = selectedMints.filter((_, index) => {
    const result = settled[index];
    return result?.status === "fulfilled" && result.value.status < 500;
  });
  const geoffRecords = parseTrixGeoffRecords([], records);
  const latest = geoffRecords.find((record) => record.imageUrl) || geoffRecords[0] || null;
  const paidLamports = geoffRecords.reduce((sum, record) => sum + (record.feeLamports || 0), 0);
  const ok = recentRes.ok && (
    selectedMints.length === 0 ||
    resolvedTokenMints.length > 0
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
    tokenMints,
    resolvedTokenMints,
    scannedTokenMints,
    recentCount: recentRecords.length,
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
    note: "TRIX public records label the provider as Geoff and report mainnet payment signatures. This does not independently establish geoff.ai operator identity or an NFT mint.",
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
  return {
    ...(previous || {}),
    ...observed,
    ok: observed.ok || Boolean(previous?.ok && records.length),
    count,
    paidLamports,
    paidSol: paidLamports / 1e9,
    tokenMints,
    scannedTokenMints,
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
  const network = bySource["stacknet.network"] ?? {};
  const fleet = fleetTaxonomy(network.models || []);
  const vramPct =
    isFiniteNumber(network.totalVramGb) &&
    network.totalVramGb > 0 &&
    isFiniteNumber(network.availableVramGb)
      ? Math.round((network.availableVramGb / network.totalVramGb) * 100)
      : null;

  return {
    id: `snap_${Date.now().toString(36)}`,
    takenAt: startedAt,
    sources: bySource,
    summary: {
      geoffBuildId: bySource["geoff.version"]?.buildId ?? null,
      geoffDeployId: bySource["geoff.deploy"]?.deployId ?? null,
      chunkHash: bySource["geoff.deploy"]?.chunks?.hash ?? null,
      chunkCount: bySource["geoff.deploy"]?.chunks?.count ?? null,
      stacknetVersion: bySource["stacknet.health"]?.version ?? bySource["stacknet.root"]?.version ?? null,
      stacknetStatus: bySource["stacknet.health"]?.statusText
        ?? (bySource["stacknet.health"]?.reachable === false
          ? `unreachable (${bySource["stacknet.health"]?.httpError || "error"})`
          : null),
      mcpContract: bySource["stacknet.health"]?.remoteMcp?.contract_id ?? null,
      mcpOnHealth: Boolean(bySource["stacknet.health"]?.remoteMcp?.contract_id),
      inFlight: bySource["stacknet.health"]?.inFlight ?? null,
      maxInFlight: bySource["stacknet.health"]?.maxInFlight ?? null,
      taskCount: bySource["stacknet.node"]?.taskCount ?? null,
      nodeId: bySource["stacknet.node"]?.nodeId ?? bySource["stacknet.health"]?.nodeId ?? null,
      nodes: network.availableNodes ?? null,
      totalNodes: network.totalNodes ?? null,
      gpus: network.totalGpus ?? null,
      vramGb: network.totalVramGb ?? null,
      availableVramGb: network.availableVramGb ?? null,
      vramAvailablePct: vramPct,
      averageLoad: network.averageLoad ?? null,
      models: network.totalModels ?? null,
      apiModels: bySource["stacknet.models"]?.count ?? null,
      widgets: bySource["stacknet.widgets"]?.count ?? null,
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
      fleetBases: fleet.bases,
      fleetLines: fleet.lines,
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
      mcpToolsDoc:
        bySource["geoff.docs.surface"]?.pages?.find((p) => p.id === "mcp-tools")?.toolHint ?? null,
      clawToolsDoc:
        bySource["geoff.docs.surface"]?.pages?.find((p) => p.id === "claw")?.toolHint ?? null,
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

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
