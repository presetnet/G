import { inferRank, normalizeEvents, prettyCapability, vibeForRank } from "./translator.js";
import { buildPlanSheet, TOKEN_PLAN_URLS } from "./token-plan.js";
import { brandStrip, GEOFF_BRAND } from "./geoff-brand.js";

const CAPABILITY_GROUPS = [
  {
    id: "chat",
    label: "Chat & reasoning",
    blurb: "Talk, plan, and think through tasks.",
    match: [/chat/, /prompt/, /completion/, /reasoning/, /think/, /sequential/],
  },
  {
    id: "media",
    label: "Images & video",
    blurb: "Generate and edit pictures, clips, and visual styles.",
    match: [/image/, /video/, /sizzle/, /style/, /vision/, /media/],
  },
  {
    id: "audio",
    label: "Music & voice",
    blurb: "Make music, speech, and voice sessions.",
    match: [/music/, /tts/, /voice/, /audio/],
  },
  {
    id: "code",
    label: "Code & agents",
    blurb: "Run code, sandboxes, skills, and AI helpers.",
    match: [/coder/, /e2b/, /shell/, /skill/, /agent/, /mcp/, /runtime/],
  },
  {
    id: "infra",
    label: "Hardware & infra",
    blurb: "GPU power and low-level network capacity.",
    match: [/^hw:/, /gpu/, /embedding/, /embed/],
  },
];

const MODEL_ROLE = {
  magma: { role: "Creative powerhouse", use: "Music, media, agents, and multimodal making." },
  preview: { role: "Everyday multimodal", use: "Chat, code, images, and tool use." },
  pyro: { role: "Companion reasoning brain", use: "Multimodal chat with deep reasoning." },
  "pyro:max": { role: "Max reasoning lane", use: "1M-context pyro-class multimodal chat." },
  "pyro-magma": { role: "Pyro × Magma blend", use: "Network-listed pyro/magma hybrid id." },
  "pyro-preview": { role: "Pyro preview lane", use: "Preview-tier pyro family id." },
  "stack-chat": { role: "Chat specialist", use: "Conversation-focused replies." },
  "stack-chat-magma": { role: "Chat · Magma", use: "Chat runtime on Magma layer." },
  "stack-chat-preview": { role: "Chat · Preview", use: "Chat runtime on Preview layer." },
  "stack-chat-pyro": { role: "Chat · Pyro", use: "Chat runtime on Pyro layer." },
  "stack-chat-pyro:max": { role: "Chat · Pyro Max", use: "Chat runtime on Pyro Max layer." },
  "stack-embed": { role: "Search memory", use: "Turns text into embeddings for retrieval." },
  "stack-embed-magma": { role: "Embed · Magma", use: "Embeddings on Magma layer." },
  "stack-embed-preview": { role: "Embed · Preview", use: "Embeddings on Preview layer." },
  "stack-embed-pyro": { role: "Embed · Pyro", use: "Embeddings on Pyro layer." },
  "stack-embed-pyro:max": { role: "Embed · Pyro Max", use: "Embeddings on Pyro Max layer." },
  "stack-media-magma": { role: "Media · Magma", use: "Image/video/music runtime on Magma." },
  "stack-media-preview": { role: "Media · Preview", use: "Media runtime on Preview." },
  "stack-media-pyro": { role: "Media · Pyro", use: "Media runtime on Pyro." },
  "stack-media-pyro:max": { role: "Media · Pyro Max", use: "Media runtime on Pyro Max." },
  "stack-vision-magma": { role: "Vision · Magma", use: "Vision runtime on Magma." },
  "stack-vision-preview": { role: "Vision · Preview", use: "Vision runtime on Preview." },
  "stack-vision-pyro": { role: "Vision · Pyro", use: "Vision runtime on Pyro." },
  "stack-vision-pyro:max": { role: "Vision · Pyro Max", use: "Vision runtime on Pyro Max." },
  "stack-voice-magma": { role: "Voice · Magma", use: "Voice/TTS runtime on Magma." },
  "stack-voice-preview": { role: "Voice · Preview", use: "Voice/TTS runtime on Preview." },
  "stack-voice-pyro": { role: "Voice · Pyro", use: "Voice/TTS runtime on Pyro." },
  "stack-voice-pyro:max": { role: "Voice · Pyro Max", use: "Voice/TTS runtime on Pyro Max." },
  "mom-preview": { role: "Mixture of Models · preview", use: "MoM preview lane listed on the public network map." },
  duce: { role: "Retired naming", use: "Older docs/catalog name — live Stacknet menu uses pyro." },
};

function modelRole(id = "") {
  if (MODEL_ROLE[id]) return { ...MODEL_ROLE[id], guessed: true };
  if (id.includes("voice"))
    return { role: "Voice-related id", use: "Named like voice — guessed from id only.", guessed: true };
  if (id.includes("vision"))
    return { role: "Vision-related id", use: "Named like vision — guessed from id only.", guessed: true };
  if (id.includes("media"))
    return { role: "Media-related id", use: "Named like media — guessed from id only.", guessed: true };
  if (id.includes("embed"))
    return { role: "Embedding-related id", use: "Named like embed — guessed from id only.", guessed: true };
  if (id.includes("chat"))
    return { role: "Chat-related id", use: "Named like chat — guessed from id only.", guessed: true };
  if (id.includes("pyro"))
    return { role: "Pyro family id", use: "Pyro family — role guessed from id only.", guessed: true };
  if (id.includes("magma"))
    return { role: "Magma family id", use: "Magma family — role guessed from id only.", guessed: true };
  return { role: "Network model", use: "Listed publicly — no role metadata published.", guessed: true };
}

function groupCapabilities(capabilities = []) {
  const remaining = new Set(capabilities);
  const groups = CAPABILITY_GROUPS.map((group) => {
    const items = capabilities.filter((cap) => {
      const hit = group.match.some((re) => re.test(cap));
      if (hit) remaining.delete(cap);
      return hit;
    });
    return {
      id: group.id,
      label: group.label,
      blurb: group.blurb,
      count: items.length,
      items: items.map((c) => ({ id: c, label: prettyCapability(c) })),
      on: items.length > 0,
    };
  });

  if (remaining.size) {
    groups.push({
      id: "other",
      label: "Other powers",
      blurb: "Extra network abilities that don’t fit the big buckets.",
      count: remaining.size,
      items: [...remaining].map((c) => ({ id: c, label: prettyCapability(c) })),
      on: true,
    });
  }

  return groups;
}

function healthStory(summary) {
  const healthy = summary.stacknetStatus === "healthy";
  if (!healthy) {
    return {
      tone: "warn",
      headline: "Network needs attention",
      sentence: "Stacknet isn’t reporting healthy right now — generation may be flaky.",
    };
  }

  const inFlight = summary.inFlight;
  const maxInFlight = summary.maxInFlight;
  const busy = typeof inFlight === "number" && inFlight > 0;

  // Live queue is real activity — don't pretend the board is idle when only surface is quiet.
  if (busy) {
    const q =
      typeof maxInFlight === "number"
        ? `${inFlight}/${maxInFlight} in flight`
        : `${inFlight} in flight`;
    return {
      tone: "good",
      headline: `Queue live · ${q}`,
      sentence:
        "Public /health shows work on the wire. Surface stays quiet until deploy / models / docs / explore / Max×Solana actually change.",
    };
  }

  const docsN = summary.docsSurfaceScraped;
  const exploreN = summary.exploreCount;
  const maxLive = summary.maxSolanaLive;
  const lanesLive = summary.productLanesLive;
  const gamedayBits = [];
  if (typeof docsN === "number" && docsN > 0) gamedayBits.push(`${docsN} docs watched`);
  if (typeof exploreN === "number" && exploreN > 0) gamedayBits.push(`Explore ${exploreN}`);
  if (typeof lanesLive === "number" && lanesLive > 0) gamedayBits.push(`${lanesLive} product lanes`);
  else if (maxLive) gamedayBits.push("Max×Solana live");
  if (summary.mcpToolsDoc) gamedayBits.push(`MCP ${summary.mcpToolsDoc}`);

  const tempHint =
    summary._temperatureLabel === "blazing"
      ? "A real cluster of meaningful change just landed."
      : summary._temperatureLabel === "hot"
        ? "A spike showed up recently — check the feed."
        : summary._temperatureLabel === "warming"
          ? "Some measurable movement, nothing crazy."
          : "No ranked surface diffs in the window — desk is armed, not padded.";

  if (gamedayBits.length) {
    return {
      tone: "good",
      headline: "Gameday desk armed",
      sentence: `${tempHint} Live watches: ${gamedayBits.join(" · ")}.`,
    };
  }

  return {
    tone: "good",
    headline: "Geoff online · surface quiet",
    sentence: `${tempHint} Queue is idle on public counters.`,
  };
}

function pieceApp(summary) {
  const shipped = Boolean(summary.geoffBuildId);
  const deployFact = summary.geoffDeployId
    ? `Vercel deploy id present`
    : summary.chunkHash
      ? `No deploy id — asset fingerprint ${summary.chunkHash} (derived from JS chunk names)`
      : "Deploy id and asset fingerprint both missing";
  return {
    id: "app",
    title: "The app",
    plain: "geoff.ai — the website people use",
    status: shipped ? "Live build detected" : "Build unknown",
    tone: shipped ? "good" : "muted",
    meaning:
      "When buildId changes, geoff.ai shipped. Measured from public /api/version + HTML scrape.",
    facts: [
      deployFact,
      summary.chunkCount != null ? `${summary.chunkCount} frontend bundles fingerprint` : "Bundle count unknown",
    ],
  };
}

function pieceNetwork(summary) {
  const nodes = summary.nodes;
  const gpus = summary.gpus;
  const vramPct = summary.vramAvailablePct;
  let headroom = "VRAM headroom unknown";
  if (vramPct != null) {
    if (vramPct >= 55) headroom = "comfortable GPU memory free";
    else if (vramPct >= 30) headroom = "moderate GPU memory free";
    else headroom = "GPU memory running tight";
  }

  const nodeBit = nodes != null ? `${nodes} machines` : "machine count unknown";
  const gpuBit = gpus != null ? `${gpus} GPUs` : "GPU count unknown";

  return {
    id: "network",
    title: "The network",
    plain: "Stacknet — shared computers that run AI jobs",
    status: summary.stacknetStatus === "healthy" ? "Healthy" : summary.stacknetStatus || "Unknown",
    tone: summary.stacknetStatus === "healthy" ? "good" : "warn",
    meaning: `${nodeBit} online with ${gpuBit}. From public /network/summary — not estimated.`,
    facts: [
      summary.stacknetVersion ? `Software ${summary.stacknetVersion}` : "Version unknown",
      headroom,
      summary.averageLoad != null ? `Average load ${summary.averageLoad}` : "Load unknown",
    ],
  };
}

function pieceBrains(summary, models = []) {
  const featured = models.slice(0, 4).map((m) => {
    if (m.description) return `${m.displayName || m.id}: ${m.description.split(/(?<=\.)\s/)[0]}`;
    const role = modelRole(m.id);
    return `${m.displayName || m.id}: ${role.role} (guessed from id)`;
  });

  return {
    id: "brains",
    title: "The brains",
    plain: "Models — different AI personalities / skills",
    status: `${summary.apiModels ?? models.length ?? "—"} API models · ${summary.models ?? "—"} network ids`,
    tone: (summary.apiModels || summary.models) > 0 ? "good" : "muted",
    meaning:
      "Prefer live /v1/models descriptions. Role labels say guessed when the API doesn’t publish one.",
    facts: featured.length ? featured : ["No public model cards yet"],
  };
}

function pieceTools(summary, capabilityGroups = [], widgets = []) {
  const onGroups = capabilityGroups.filter((g) => g.on).map((g) => g.label);
  return {
    id: "tools",
    title: "The tools",
    plain: "Capabilities + widgets — what Geoff can actually do",
    status: `${summary.capabilities ?? 0} powers · ${summary.widgets ?? widgets.length ?? 0} widgets`,
    tone: (summary.capabilities || 0) > 0 ? "good" : "muted",
    meaning:
      "Capabilities are verbs (make image, run code, speak). Widgets are ready-made UI blocks agents can drop into answers.",
    facts: [
      onGroups.length ? `Active lanes: ${onGroups.join(", ")}` : "No capability lanes detected",
      summary.mcpContract
        ? "Agent plug-in contract (MCP) published on /health"
        : "MCP contract not on /health — see public docs.geoff.ai/mcp (fingerprinted)",
    ],
  };
}

function pieceExplore(summary, explore = null) {
  const count = explore?.count ?? summary.exploreCount;
  const authors = explore?.authorCount ?? summary.exploreAuthors;
  const media = explore?.mediaCounts || summary.exploreMedia || {};
  const mediaBits = Object.entries(media)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .slice(0, 4);
  return {
    id: "explore",
    title: "The community",
    plain: "Explore — public posts people share on geoff.ai",
    status:
      typeof count === "number"
        ? `${count} on the top board${typeof authors === "number" ? ` · ${authors} creators` : ""}`
        : "Explore feed not sniffed yet",
    tone: typeof count === "number" && count > 0 ? "good" : "muted",
    meaning:
      "Tracked from public /api/explore/feed. When new posts enter the top board, What’s changing lights up.",
    facts: [
      mediaBits.length ? `Mix: ${mediaBits.join(", ")}` : "Media mix unknown",
      "Source: geoff.ai/explore (no login)",
    ],
  };
}

function pieceMaxSolana(summary, maxSrc = null) {
  const live = maxSrc?.liveCount ?? summary.maxSolanaRoutes;
  const total = maxSrc?.total ?? null;
  const solana = maxSrc?.solanaLive ?? summary.maxSolanaLive;
  return {
    id: "maxSolana",
    title: "Max × Solana",
    plain: "Auth-gated product lanes under /max and /max/solana/*",
    status:
      typeof live === "number"
        ? `${live}${total != null ? `/${total}` : ""} routes answering · Solana ${solana ? "live" : "quiet"}`
        : "Max routes not probed yet",
    tone: solana || live > 0 ? "good" : "muted",
    meaning:
      "Public 307→/connect proves the lane exists. We don’t read wallets or portfolio contents.",
    facts: [
      summary.maxHubLive ? "Max hub connect-gated" : "Max hub quiet",
      "Watch for route table diffs in What’s changing",
    ],
  };
}

function pieceProductLanes(summary, lanesSrc = null) {
  const live = lanesSrc?.liveCount ?? summary.productLanesLive;
  const total = lanesSrc?.total ?? summary.productLanesTotal;
  const labels = lanesSrc?.liveLabels || summary.productLanesLabels || [];
  return {
    id: "productLanes",
    title: "Product lanes",
    plain: "HQ · Studio · Skills · Code · Claw · Social · Max — docs-allowlisted shells",
    status:
      typeof live === "number"
        ? `${live}${total != null ? `/${total}` : ""} lanes answering`
        : "Product lanes not probed yet",
    tone: live > 0 ? "good" : "muted",
    meaning: "Public 307→/connect on docs-backed paths. Catch-all connect alone is not proof of a product.",
    facts: [
      labels.length ? `Live: ${labels.join(" · ")}` : "Waiting for first lane probe",
      "Separate from Max×Solana nested routes (/max/solana/*)",
    ],
  };
}

function pieceDocs(summary, docsSrc = null) {
  const scraped = docsSrc?.scraped ?? summary.docsSurfaceScraped;
  const total = docsSrc?.total ?? null;
  const mcpHint = summary.mcpToolsDoc
    || (docsSrc?.pages || []).find((p) => p.id === "mcp-tools")?.toolHint;
  const clawHint = summary.clawToolsDoc
    || (docsSrc?.pages || []).find((p) => p.id === "claw")?.toolHint;
  const toolBit = mcpHint
    ? mcpHint.includes("/")
      ? `MCP tools: ${mcpHint.replace("/", " tools / ")} groups`
      : `MCP tools doc hints ${mcpHint} tools`
    : "MCP tools page watched";
  const clawBit = clawHint
    ? `Claw browser tools (docs): ${clawHint}`
    : "Claw / Agent Mode page watched";
  return {
    id: "docs",
    title: "The docs",
    plain: "docs.geoff.ai — intro, MCP, features, token plan, Geoff Code",
    status:
      typeof scraped === "number"
        ? `${scraped}${total != null ? `/${total}` : ""} pages fingerprinted`
        : "Docs surface not sniffed yet",
    tone: scraped > 0 ? "good" : "muted",
    meaning: "Body fingerprints on watched pages — What’s changing lights when copy moves. No fake changelog.",
    facts: [
      toolBit,
      clawBit,
      "Features watched: Codev3 · Skills · Social · StackNet Proxy · Studio · Claw/HQ",
      "Source: public docs.geoff.ai HTML (main body, not shared chrome)",
    ],
  };
}

function buildExploreBoard(latest) {
  const src = latest?.sources?.["geoff.explore"];
  if (!src?.ok) return null;
  return {
    url: src.url || "https://www.geoff.ai/explore",
    count: src.count ?? 0,
    authors: src.authorCount ?? null,
    mediaCounts: src.mediaCounts || null,
    fingerprint: src.fingerprint || null,
  };
}

function explainTemperature(temperature) {
  const value = temperature?.value ?? 0;
  const label = temperature?.label ?? "flat";
  const map = {
    flat: "Flat — no ranked public diffs in the window (not padded).",
    cool: "Cool — tiny ranked movement only.",
    steady: "Steady — a few real ranked diffs.",
    warming: "Warming — measurable moves showed up.",
    hot: "Hot — spike-class public diffs recently.",
    blazing: "Blazing — crazy-class public diffs stacked.",
  };
  return {
    value,
    label,
    plain: map[label] || "Score from ranked public diffs only.",
    detail: temperature?.basis || "Not a thermometer sensor. No fake floors.",
  };
}

const RANK_WEIGHT = { crazy: 5, spike: 4, move: 3, note: 2, whisper: 1, info: 1 };

function sortEvents(events = []) {
  return [...events].sort((a, b) => {
    const ra = RANK_WEIGHT[inferRank(a)] || 0;
    const rb = RANK_WEIGHT[inferRank(b)] || 0;
    if (rb !== ra) return rb - ra;
    return Date.parse(b.at || 0) - Date.parse(a.at || 0);
  });
}

function humanModels(models = []) {
  return models.map((m) => {
    const role = modelRole(m.id);
    const skills = (m.capabilities || []).map(prettyCapability);
    const hasApiDesc = Boolean(m.description);
    return {
      ...m,
      role: hasApiDesc ? "From API description" : role.role,
      use: m.description || role.use,
      skillLabels: skills,
      roleGuessed: !hasApiDesc,
      glance: hasApiDesc
        ? m.description.split(/(?<=\.)\s/)[0]
        : `${role.role} (guessed) — ${(m.contentTypes || []).length ? (m.contentTypes || []).join(", ") : "types unknown"}`,
    };
  });
}

function humanWidgets(widgets = []) {
  return widgets.map((w) => ({
    ...w,
    glance: w.description
      ? w.description.split(/(?<=\.)\s/)[0]
      : "A reusable UI block agents can attach to answers.",
    audience: w.isSystem ? "Built-in" : "Community",
  }));
}

function humanEvents(events = []) {
  return sortEvents(normalizeEvents(events)).map((e) => {
    const rank = inferRank(e);
    return {
      ...e,
      rank,
      vibe: vibeForRank(rank),
      userTake: userTakeForEvent(e),
    };
  });
}

function userTakeForEvent(event) {
  switch (event.kind) {
    case "deploy":
      return "Geoff’s website/app code changed. New UI or behavior may appear.";
    case "version":
      return "The AI network software moved forward — under-the-hood upgrades.";
    case "models":
    case "apiModels":
      return "Available AI models changed. Some skills may appear or disappear.";
    case "capabilities":
      return "What the network can do shifted (new or removed powers).";
    case "widgets":
      return "Ready-made answer widgets changed.";
    case "network":
      return "Compute capacity changed — more/fewer machines or GPUs.";
    case "health":
      return /unreachable|HTTP|probe failed/i.test(event.summary || event.title || "")
        ? "Public /health probe hiccuped (transport). Not the same as Stacknet saying unhealthy."
        : "Network health status changed — check if generation still works.";
    case "catalog":
      return "Geoff’s internal tool/model catalog was updated.";
    case "treasury":
      return "On-chain treasury pricing moved; usually not user-facing.";
    case "metaproofs":
      return "Network metaproofs counter moved — public summary field only.";
    case "keysale":
      return "Node-key sale ticker moved — self-reported by StackNet (public /api/v2/node-keys/pricing), purchases unverified on-chain. Each key carries +1B inference tokens per docs.";
    case "docs":
      return "Public docs pages moved (intro / token-plan / MCP / features / Geoff Code / security).";
    case "explore":
      return "Community Explore board moved — new or rotated public posts on geoff.ai/explore.";
    case "maxSolana":
      return "Max × Solana routes moved — public connect-gate probe on /max and /max/solana/*.";
    case "productLanes":
      return "Product lanes moved — HQ / Studio / Skills / Code / Claw / Social / Max (docs-allowlisted).";
    case "pricing":
      return "Public Token Plan rates on docs.geoff.ai changed — check what seats/tokens cost now.";
    case "baseline":
      return "First reading captured — this is the starting snapshot.";
    case "agent":
      return "Queue telemetry (in-flight / load / tasks) — separate from surface updates.";
    case "agentCluster":
      return "Several public diffs landed in one sniff — clustered, not invented.";
    default:
      return event.summary;
  }
}

/**
 * Compile a glanceable human briefing from a raw snapshot + temperature/events.
 */
export function compileBriefing({ latest, temperature, events = [], agentDesk = null } = {}) {
  if (!latest) {
    return {
      story: {
        tone: "muted",
        headline: "Waiting for first sniff",
        sentence: "Once live data arrives, this board explains what Geoff’s pieces mean.",
      },
      temperature: explainTemperature(temperature),
      pieces: [],
      capabilityGroups: [],
      models: [],
      widgets: [],
      events: [],
      agentDesk: null,
      coverage: null,
      tokenPlan: null,
      brand: brandStrip(),
      exploreBoard: null,
      docsBoard: null,
      lanesBoard: null,
      glossary: glossary(),
    };
  }

  const summary = {
    ...latest.summary,
    _temperatureLabel: temperature?.label,
  };
  const models = humanModels(latest.sources?.["stacknet.models"]?.models || []);
  const widgets = humanWidgets(latest.sources?.["stacknet.widgets"]?.widgets || []);
  const capabilityGroups = groupCapabilities(
    latest.sources?.["stacknet.network"]?.capabilities || [],
  );
  const story = healthStory(summary);
  const coverage = buildCoverage(latest, summary);
  const horsepower = buildHorsepower(summary, models, capabilityGroups, widgets, coverage);
  const tokenPlan = buildTokenPlan(latest);
  const exploreSrc = latest.sources?.["geoff.explore"] || null;
  const exploreBoard = buildExploreBoard(latest);
  const maxSrc = latest.sources?.["geoff.max.solana"] || null;
  const lanesSrc = latest.sources?.["geoff.product.lanes"] || null;
  const docsSrc = latest.sources?.["geoff.docs.surface"] || null;

  return {
    story,
    brand: brandStrip(),
    temperature: explainTemperature(temperature),
    coverage,
    horsepower,
    tokenPlan,
    exploreBoard,
    docsBoard: docsSrc?.ok
      ? {
          scraped: docsSrc.scraped,
          total: docsSrc.total,
          fingerprint: docsSrc.fingerprint,
          url: "https://docs.geoff.ai/",
        }
      : null,
    lanesBoard: lanesSrc?.ok
      ? {
          liveCount: lanesSrc.liveCount,
          total: lanesSrc.total,
          labels: lanesSrc.liveLabels || [],
          url: "https://www.geoff.ai/hq",
        }
      : null,
    pieces: [
      pieceApp(summary),
      pieceNetwork(summary),
      pieceBrains(summary, models),
      pieceTools(summary, capabilityGroups, widgets),
      pieceDocs(summary, docsSrc),
      pieceExplore(summary, exploreSrc),
      pieceProductLanes(summary, lanesSrc),
      pieceMaxSolana(summary, maxSrc),
    ],
    capabilityGroups,
    models,
    widgets,
    events: humanEvents(events),
    agentDesk,
    networkModelGuide: (latest.sources?.["stacknet.network"]?.models || []).map((id) => ({
      id,
      ...modelRole(id),
    })),
    glossary: glossary(),
  };
}

function buildTokenPlan(latest) {
  const src = latest?.sources?.["geoff.docs.pricing"];
  if (!src?.plans?.length) return null;
  const sheet = buildPlanSheet(src);
  return {
    ...sheet,
    kicker: src.scraped
      ? `${sheet.kicker} · sniffed live`
      : `${sheet.kicker} · published tables`,
    scraped: Boolean(src.scraped),
    reason: src.reason || null,
    fingerprint: src.fingerprint || null,
    sourceUrls: src.sourceUrls || TOKEN_PLAN_URLS,
  };
}

/**
 * Tight on-demand map: compute → brains → power lanes → tools.
 * Only public measured signals; not-shared called out.
 */
function buildHorsepower(summary, models = [], lanes = [], widgets = [], coverage = null) {
  const onLanes = lanes.filter((l) => l.on);
  const offLanes = lanes.filter((l) => !l.on);
  const powers = lanes.reduce((n, l) => n + (l.count || 0), 0);

  const compute = {
    status: summary.stacknetStatus || "unknown",
    version: summary.stacknetVersion || null,
    nodes: summary.nodes ?? null,
    totalNodes: summary.totalNodes ?? null,
    gpus: summary.gpus ?? null,
    vramFree: summary.availableVramGb ?? null,
    vramTotal: summary.vramGb ?? null,
    vramPct: summary.vramAvailablePct ?? null,
    load: summary.averageLoad ?? null,
    inFlight: summary.inFlight ?? null,
    maxInFlight: summary.maxInFlight ?? null,
  };

  const brains = models.map((m) => ({
    id: m.id,
    name: m.displayName || m.id,
    types: m.contentTypes || [],
    caps: (m.skillLabels || m.capabilities || []).slice(0, 8),
    blurb: m.glance || m.use || "",
    fromApi: !m.roleGuessed,
  }));

  const notShared = [];
  if (coverage?.catalogSkipped) {
    notShared.push({
      id: "geoff.catalog",
      label: "Geoff private catalogs",
      reason: "Auth-gated /api/catalog — not on the public on-demand map",
    });
  }
  for (const lane of offLanes) {
    notShared.push({
      id: lane.id,
      label: lane.label,
      reason: "No matching powers in the public capability list right now",
    });
  }

  return {
    kicker: "On-demand horsepower · public Stacknet",
    headline: "What you can call right now",
    sentence:
      "Live map of compute, model brains, power lanes, and widgets. Corps hide this. Geoff publishes it.",
    scoreboard: {
      onLanes: onLanes.length,
      totalLanes: lanes.length,
      powers,
      apiModels: summary.apiModels ?? brains.length,
      widgets: summary.widgets ?? widgets.length,
      nodes: summary.nodes ?? null,
      gpus: summary.gpus ?? null,
    },
    compute,
    lanes: lanes.map((l) => ({
      id: l.id,
      label: l.label,
      blurb: l.blurb,
      on: l.on,
      count: l.count,
      verbs: (l.items || []).map((i) => i.label || i.id),
    })),
    brains,
    tools: {
      widgets: summary.widgets ?? widgets.length,
      mcp: summary.mcpContract || null,
      mcpOnHealth: Boolean(summary.mcpOnHealth),
      solPriceUsd: summary.solPriceUsd ?? null,
      treasuryAddress: summary.treasuryAddress || null,
      metaproofsTotal: summary.metaproofsTotal ?? null,
      docsSurfaceScraped: summary.docsSurfaceScraped ?? null,
      items: widgets.slice(0, 12).map((w) => ({
        id: w.id,
        name: w.name || w.id,
        audience: w.audience || (w.isSystem ? "Built-in" : "Community"),
        glance: w.glance || w.description || "",
      })),
    },
    notShared,
  };
}

const COVERAGE_LABELS = {
  "stacknet.health": "Health",
  "stacknet.network": "Network",
  "stacknet.node": "Node",
  "stacknet.root": "Stacknet root",
  "stacknet.models": "Models API",
  "stacknet.widgets": "Widgets",
  "geoff.version": "geoff.ai build",
  "geoff.deploy": "geoff.ai deploy",
  "geoff.docs.surface": "Docs surface",
  "geoff.docs.pricing": "Token plan",
  "geoff.explore": "Explore",
  "geoff.max.solana": "Max × Solana",
  "geoff.product.lanes": "Product lanes",
  "geoff.public.surfaces": "Public surfaces",
  "geoff.catalog": "Catalog (gated)",
};

const COVERAGE_PRIORITY = [
  "stacknet.health",
  "stacknet.network",
  "stacknet.models",
  "geoff.docs.surface",
  "geoff.docs.pricing",
  "geoff.explore",
  "geoff.product.lanes",
  "geoff.public.surfaces",
  "geoff.max.solana",
  "stacknet.widgets",
  "geoff.version",
  "geoff.deploy",
  "stacknet.node",
  "stacknet.root",
];

function buildCoverage(latest, summary) {
  const rows = (summary.coverage || latest.summary?.coverage || []).map((row) => {
    let state = "fail";
    if (row.skipped) state = "skipped";
    else if (row.ok) state = "live";
    return {
      ...row,
      state,
      label: COVERAGE_LABELS[row.source] || row.source,
    };
  });

  const stateRank = { live: 0, skipped: 1, fail: 2 };
  rows.sort((a, b) => {
    const sr = (stateRank[a.state] ?? 9) - (stateRank[b.state] ?? 9);
    if (sr !== 0) return sr;
    const pa = COVERAGE_PRIORITY.indexOf(a.source);
    const pb = COVERAGE_PRIORITY.indexOf(b.source);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });

  const catalogSkipped = Boolean(summary.catalogSkipped);
  const notes = [];
  if (catalogSkipped) {
    notes.push(
      summary.catalogSkipReason ||
        "Geoff /api/catalog/* is auth-gated — not measured without GEOFF_COOKIE / GEOFF_PREVIEW_CODE.",
    );
  }
  const docsScraped = summary.docsSurfaceScraped;
  if (typeof docsScraped === "number" && docsScraped > 0) {
    notes.push(
      `Docs surface: ${docsScraped} public pages fingerprinted (intro · MCP · features · Geoff Code · cookbook).`,
    );
  }
  if (summary.maxSolanaLive || summary.maxHubLive) {
    notes.push("Max × Solana: public connect-gate probe only — no wallet/portfolio contents.");
  }
  notes.push("Temperature + ranks are derived from public diffs — not a physical sensor.");
  notes.push("Model roles marked guessed when /v1/models has no description.");
  notes.push("Queue desk uses /health in_flight + /node task_count only.");

  return {
    live: summary.healthySources ?? rows.filter((r) => r.state === "live").length,
    skipped: summary.skippedSources ?? rows.filter((r) => r.state === "skipped").length,
    failed: summary.failedSources ?? rows.filter((r) => r.state === "fail").length,
    total: summary.totalSources ?? rows.length,
    rows,
    notes,
    catalogSkipped,
  };
}

function glossary() {
  return [
    {
      term: "Geoff (brand)",
      meaning: `${GEOFF_BRAND.tagline} Public meta from geoff.ai. /manifesto is not published yet.`,
    },
    {
      term: "Temperature",
      meaning: "Derived score from ranked public diffs over 72h. Not a sensor. No padded floors.",
    },
    {
      term: "Pump tape",
      meaning: "72h chart of real ranked updates + sampled in_flight. Heat = rank weights, not fake volume.",
    },
    {
      term: "Coverage",
      meaning: "Which public endpoints answered. Skipped = auth-gated / not shared. Failed = request error.",
    },
    {
      term: "On-demand horsepower",
      meaning: "Public map of what Stacknet can do right now: compute, brains, power lanes, widgets — plus what isn’t shared.",
    },
    {
      term: "Power lane",
      meaning: "A human bucket of capability ids from /network/summary. On = at least one matching power is live.",
    },
    {
      term: "Stacknet",
      meaning: "Geoff’s shared compute network: nodes, GPUs, and model runtimes.",
    },
    {
      term: "Model",
      meaning: "An AI brain with a specialty (chat, music, vision, embeddings, etc.).",
    },
    {
      term: "Capability",
      meaning: "A verb the network supports — generate image, run code, speak, and so on.",
    },
    {
      term: "Widget",
      meaning: "A packaged UI card agents can attach to answers (charts, reports, etc.).",
    },
    {
      term: "MCP",
      meaning: "A plug-in contract so outside AI agents can call Stacknet tools safely.",
    },
    {
      term: "Build / deploy",
      meaning: "Proof the geoff.ai website shipped a new version.",
    },
    {
      term: "Docs surface",
      meaning:
        "28 public docs.geoff.ai pages (intro, token plan, MCP, features like Codev3/Skills/StackNet Proxy, Geoff Code, cookbook). Body fingerprints — not shared nav chrome.",
    },
    {
      term: "Explore",
      meaning:
        "Public community board on geoff.ai/explore. We fingerprint the top feed posts — new entries show up in What’s changing.",
    },
    {
      term: "Product lanes",
      meaning:
        "Auth-gated geoff.ai shells allowlisted from docs: /hq, /studio, /skills, /code, /claw, /social, /max. Catch-all /connect on random paths is ignored.",
    },
    {
      term: "Max × Solana",
      meaning:
        "Auth-gated geoff.ai routes under /max and /max/solana/*. We only probe public redirects (307→connect) — not wallets or portfolio contents.",
    },
    {
      term: "Claw",
      meaning:
        "Browser-based agent mode (docs: 12 static tools, SOUL.md / MEMORY.md, skills, VM sandbox). Lane at /claw; docs under Agent Mode.",
    },
    {
      term: "Skills",
      meaning:
        "Reusable agent behaviors as markdown + YAML (SKILL.md) on docs — discovery without bloating every prompt. Watched via the Skills docs page + /skills lane.",
    },
    {
      term: "StackNet Proxy",
      meaning:
        "Geoff’s JWT re-signing / request-forwarding layer between users and Stacknet. Watched on the public docs page.",
    },
    {
      term: "Rank",
      meaning: "Whisper → note → move → spike → crazy. Only spike/crazy float hard.",
    },
    {
      term: "Agent desk",
      meaning: "Inferred busyness from public in-flight / task / load counters + same-sniff clusters. Not private agent chat.",
    },
    {
      term: "Token plan",
      meaning:
        "Public monthly seats on docs.geoff.ai: Basic $19 / Pro $199 / Max $499 / Turbo $999 — shared token pool + rate limits.",
    },
  ];
}
