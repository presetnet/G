import { config } from "./config.js";
import {
  TOKEN_PLAN_URLS,
  FALLBACK_TOKEN_PLAN,
  FEATURE_MATRIX,
  parseTokenPlanHtml,
  fingerprintTokenPlan,
} from "./token-plan.js";

const DEFAULT_TIMEOUT_MS = 18_000;

async function fetchJson(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
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
const OPENCODE_RELEASES_URL =
  "https://api.github.com/repos/sst/opencode/releases?per_page=5";
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

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const DEFAULT_TREASURY_ADDRESS = "2W5gxAio1Bz76P58EaDtGC71MuyH4ZAdXHu3qqmeGy7g";
const SIG_CACHE_TTL_MS = 10 * 60 * 1000;
let sigCache = { at: 0, value: null };

async function solanaRpc(method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(SOLANA_RPC_URL, {
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
        res = await fetch(url, {
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

export async function runSniff() {
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
    sniffStacknetHealth(),
    sniffStacknetRoot(),
    sniffStacknetNetwork(),
    sniffStacknetNode(),
    sniffStacknetModels(),
    sniffStacknetWidgets(),
    sniffOpencodeZen(),
    sniffOpencodeRegistry(),
    sniffOpencodeReleases(),
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
      fleetBases: fleet.bases,
      fleetLines: fleet.lines,
      treasuryRpcOk: Boolean(bySource["solana.treasury"]?.ok),
      treasuryRpcAddress: bySource["solana.treasury"]?.address ?? null,
      treasuryRpcLamports: bySource["solana.treasury"]?.lamports ?? null,
      treasuryRpcSol: bySource["solana.treasury"]?.sol ?? null,
      treasuryRpcSigCount: bySource["solana.treasury"]?.sigCount ?? null,
      treasuryLatestActivityAt: bySource["solana.treasury"]?.latestActivityAt ?? null,
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