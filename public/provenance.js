const AGE_NOTICE_MS = 20 * 60_000;

// IDs are value elements, not card positions or proof-popup aliases.
const METRICS = [
  ["stackVersion", "Reported", "StackNet's software version and health claim; not an independent uptime test.", ["stacknet.health", "stacknet.root"]],
  ["stackNodes", "Reported", "Available nodes / total GPUs; load from network summary, queue from health, tasks from node.", ["stacknet.network", "stacknet.health", "stacknet.node"]],
  ["vramText", "Reported", "Available / total GPU memory in GB. Bar = available share, not measured performance.", ["stacknet.network"]],
  ["paperworkUsd", "Mixed", "Booked and paid USD are StackNet ledger claims, not verified revenue. Treasury SOL and a capped signature page are on-chain context, not proof of payment; token labels come from watched holdings. 24h change uses dashboard history.", ["stacknet.network", "solana.treasury", "solana.tokens"]],
  ["paperSupply", "On-chain", "Global PAPER mint supply via Solana RPC, not the watched wallet's balance, liquidity or value.", ["solana.tokens"]],
  ["trixGeoffCount", "Mixed", "Accumulated paid-generation records labeled Geoff by TRIX, plus inferred recipient matches from chain data. Not proof of operator identity or NFT minting; history is incomplete.", ["trix.geoff"]],
  ["keysoldUsd", "Reported", "USD price per node key and sale counters from StackNet pricing; not verified purchases or total revenue.", ["stacknet.keysale"]],
  ["pileValue", "Reported", "Unredeemed earnings for node keys at least 10% utilized, per StackNet. No public time or per-key breakdown; not live earnings.", ["stacknet.pile"]],
  ["trixPacksMinted", "Mixed", "Pack counts and quotes are API-reported, rates are calculated from saved samples, paid costs use observed receipts. Odds are a bundled published schedule, not observed reveals; holders are unknown.", ["trix.geoff.packs", "trix.geoff.packs.purchaseAudit"]],
  ["trixMarketCount", "Reported", "Collectible counts from TRIX APIs, within endpoint windows. Listings are not sales; artwork counts are not a full-chain census.", ["trix.market"]],
  ["keys9gValue", "On-chain", "Positive SOL balance changes in a small decoded window for the 9G wallet. Not lifetime sales or proof every inflow bought a key.", ["geoff.keys.9g"]],
  ["x402Downloads", "Reported", "npm downloads over its last-week reporting window and SDK version. Downloads are not users, payments or API usage.", ["stacknet.x402"]],
  ["subscriptionCount", "Reported", "Responding public billing/subscription routes / routes probed, including login gates. Not subscriber count or revenue.", ["geoff.subscription"]],
  ["miningMiners", "Estimate", "Distinct qualifying reward recipients in a sampled 60-minute payout window, excluding known house accounts. Not all active miners; facet/claims state is a separate website report.", ["surface.mining"]],
];

const NAMES = {
  "stacknet.health": "StackNet health",
  "stacknet.root": "StackNet root",
  "stacknet.network": "StackNet network summary",
  "stacknet.node": "StackNet node",
  "stacknet.keysale": "StackNet key pricing",
  "stacknet.pile": "StackNet PILE",
  "stacknet.x402": "npm x402 SDK",
  "solana.tokens": "Solana token RPC",
  "solana.treasury": "Solana treasury RPC",
  "trix.geoff": "TRIX Geoff records",
  "trix.geoff.packs": "TRIX Pack market",
  "trix.geoff.packs.purchaseAudit": "TRIX Pack receipts",
  "trix.market": "TRIX collectibles APIs",
  "geoff.keys.9g": "Solana 9G wallet RPC",
  "geoff.subscription": "Geoff public route probes",
  "surface.mining": "Mining surface + payout RPC",
};

function timestamp(value) {
  // Require an explicit timezone; never guess local time or use snapshot takenAt.
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}

function age(value, now) {
  const time = timestamp(value);
  if (!Number.isFinite(time)) return "age unknown";
  const elapsed = now - time;
  if (elapsed < 0) return "future timestamp; age unknown (clock mismatch)";
  const minutes = Math.floor(elapsed / 60_000);
  const relative = minutes < 1 ? "less than 1 min ago"
    : minutes < 60 ? `${minutes} min ago`
      : minutes < 1440 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min ago`
        : `${Math.floor(minutes / 1440)} days ago`;
  return relative + (elapsed > AGE_NOTICE_MS ? " (older than 20 min)" : "");
}

function exact(value) {
  const time = timestamp(value);
  return Number.isFinite(time) ? `${new Date(time).toISOString()} (UTC)` : "unknown";
}

function sourceState(src) {
  if (!src || typeof src !== "object") return "source missing; outcome unknown";
  if (src.skipped) return "skipped; NOT a fresh check";
  if (src.ok === false || src.lastError || Number(src.status) >= 400) return "check failed; NOT fresh";
  if (src.stale) return "last-known value; NOT fresh";
  if (src.cached) return "cached; no new source check";
  if (src.ok === true) return "check succeeded (not a data guarantee)";
  return "check outcome unknown";
}

function fieldClocks(name, src) {
  if (name === "solana.tokens") return [["Mint values (mintsCheckedAt)", src?.mintsCheckedAt]];
  if (name === "solana.treasury") return [["Signature page (signaturesCheckedAt)", src?.signaturesCheckedAt]];
  if (name === "surface.mining") return [["60m estimate (miners60mAt)", src?.miners60mAt]];
  return [];
}

function sourceBrief(name, src, now) {
  const lines = [`${NAMES[name] || name}: ${sourceState(src)}; last checked ${age(src?.checkedAt, now)}.`];
  if (src?.stale) lines.push("Cached/last-known values retained.");
  if (src?.lastAttemptAt) lines.push(`Latest attempt ${age(src.lastAttemptAt, now)}; retained checkedAt is not this attempt.`);
  for (const [label, value] of fieldClocks(name, src)) {
    const retained = src?.stale || src?.cached || src?.ok === false ||
      (Number.isFinite(timestamp(value)) && timestamp(value) < timestamp(src?.checkedAt));
    lines.push(`${label}: ${retained ? "cached/last-known; " : "separate value clock; "}${age(value, now)}.`);
  }
  if (src?.genesisStale) lines.push("Genesis: last-known fallback; value age unknown.");
  else if (src?.genesisOk === false) lines.push("Genesis check failed; NOT fresh.");
  if (src?.cardsCached) lines.push("Card catalog cached; exact value check time unknown.");
  if (typeof src?.reason === "string" && /^Partial:/i.test(src.reason)) lines.push("Partial check: some endpoints failed; NOT all fields fresh.");
  if (name === "trix.geoff") lines.push("Collection includes retained history; check time does not revalidate every record.");
  if (name === "trix.geoff.packs.purchaseAudit") lines.push("Receipts include retained history; individual transaction ages differ.");
  if (name === "geoff.docs.pricing" && src?.scraped === false) lines.push("Bundled Token Plan fallback for incomplete sections; publication age unknown.");
  return lines.join(" ");
}

/** Plain text only. Optional now makes age assertions deterministic without a DOM. */
export function sourceDescription(name, src, now = Date.now()) {
  const lines = [sourceBrief(name, src, now), `Source ID: ${name}`, `checkedAt: ${exact(src?.checkedAt)}`];
  if (!src || typeof src !== "object") return lines.join("\n");
  if (src.source) lines.push(`Reported source ID: ${src.source}`);
  lines.push(`HTTP/status: ${src.status ?? "unknown"} (collector-reported; may be synthetic or aggregate)`);
  for (const key of ["error", "httpError", "reason", "lastError"]) {
    if (src[key] != null && src[key] !== "") lines.push(`${key}: ${String(src[key])}`);
  }
  for (const [label, value] of fieldClocks(name, src)) lines.push(`${label}: ${exact(value)}`);
  for (const key of ["lastAttemptAt", "latestCheckedAt", "mintRateCheckedAt"]) {
    if (key in src) lines.push(`${key}: ${exact(src[key])}; ${age(src[key], now)}`);
  }
  for (const key of ["cached", "stale", "skipped", "genesisStale", "genesisOk", "cardsCached", "fallback"]) {
    if (key in src) lines.push(`${key}: ${String(src[key])}`);
  }
  if (src.genesisStatus != null) lines.push(`Genesis HTTP/status: ${src.genesisStatus}`);
  if (name === "geoff.docs.pricing") {
    for (const [section, state] of Object.entries(src.sections || {})) {
      lines.push(`Token Plan ${section}: ${state?.live ? "live section reported" : "bundled/static fallback"}; HTTP/status ${state?.status ?? "unknown"}; publication age unknown; ${state?.sourceUrl || "source URL unknown"}`);
    }
  }
  if (src.cardsCatalogAgeMs != null) lines.push(`Card catalog age reported at collection: ${src.cardsCatalogAgeMs} ms (not a live clock; exact check time unknown)`);
  for (const key of ["timestamp", "latestAt", "latestActivityAt", "newestAt", "silentSince", "archiveGeneratedAt"]) {
    if (src[key] != null) lines.push(`${key} (source/event time, NOT check time): ${exact(src[key])}`);
  }
  if (src.latest?.createdAt) lines.push(`Latest record event: ${exact(src.latest.createdAt)}`);
  if (src.periodStart || src.periodEnd) lines.push(`Source reporting window: ${src.periodStart ?? "unknown"} to ${src.periodEnd ?? "unknown"} (not collection age)`);
  for (const key of ["url", "sourceUrl", "rpcUrl", "docsUrl", "genesisSourceUrl", "oddsSourceUrl"]) {
    if (typeof src[key] === "string") lines.push(`${key}: ${src[key]}`);
  }
  return lines.join("\n");
}

function getSource(latest, name) {
  if (name === "trix.geoff.packs") return latest?.sources?.["trix.geoff"]?.packs;
  if (name === "trix.geoff.packs.purchaseAudit") return latest?.sources?.["trix.geoff"]?.packs?.purchaseAudit;
  return latest?.sources?.[name];
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

let currentLatest = null;
let ageTimer = null;

/** Call on every renderMetrics, including empty/offline renders. Does not fetch. */
export function renderProvenance(latest) {
  if (typeof document === "undefined") return;
  currentLatest = latest ?? null;
  const grid = document.querySelector(".metrics");
  if (!grid) return;
  const now = Date.now();
  for (const [id, evidence, meaning, sources] of METRICS) {
    const card = document.getElementById(id)?.closest(".metric");
    if (!card) continue;
    card.classList.add("has-provenance");
    let footer = card.querySelector(".metric-provenance");
    if (!footer) {
      footer = element("footer", "metric-provenance");
      footer.append(element("p", "provenance-meaning", `${evidence}: ${meaning}`), element("p", "provenance-ages"));
      card.append(footer);
    }
    footer.querySelector(".provenance-ages").textContent = sources
      .map((name) => sourceBrief(name, getSource(latest, name), now)).join("\n");
  }

  let note = document.getElementById("vitalsProvenance");
  if (!note) {
    note = element("aside", "vitals-provenance");
    note.id = "vitalsProvenance";
    note.setAttribute("aria-label", "How to read metric sources and ages");
    note.append(element("p", "", "Reading these numbers: collection age is time since a source check, NOT publication or event age. Fetching this dashboard does not mean a new source check. Unknown stays unknown; missing values do not mean zero. \"Older than 20 min\" is an informational age marker, not an SLA or a guarantee of freshness."));
    const details = element("details", "provenance-details");
    details.append(element("summary", "", "Source checks, exact UTC times and fallback states"), element("ul", "provenance-source-list"));
    note.append(details);
    grid.before(note);
  }
  const list = note.querySelector(".provenance-source-list");
  const names = [...new Set([...METRICS.flatMap((row) => row[3]), ...Object.keys(latest?.sources || {})])];
  // Keep details and existing rows in place so timer ticks do not lose focus.
  for (const child of [...list.children]) {
    if (!names.includes(child.dataset.sourceId)) child.remove();
  }
  for (const name of names) {
    const src = getSource(latest, name);
    let row = [...list.children].find((child) => child.dataset.sourceId === name);
    if (!row) {
      row = element("li", "provenance-source");
      row.dataset.sourceId = name;
      row.append(element("p", "provenance-source-text"), element("div", "provenance-links"));
      list.append(row);
    }
    row.firstElementChild.textContent = sourceDescription(name, src, now);
    const links = row.lastElementChild;
    const urls = [];
    for (const key of ["url", "sourceUrl", "rpcUrl", "docsUrl", "genesisSourceUrl", "oddsSourceUrl"]) {
      try {
        const url = new URL(src?.[key]);
        if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) urls.push([key, url.href]);
      } catch { /* Missing or invalid URLs stay plain text, never links. */ }
    }
    const signature = JSON.stringify(urls);
    if (links.dataset.urls !== signature) {
      links.replaceChildren();
      for (const [key, url] of urls) {
        const link = element("a", "", `Open ${key}`);
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        links.append(link);
      }
      links.dataset.urls = signature;
    }
  }
  if (ageTimer === null) ageTimer = setInterval(() => renderProvenance(currentLatest), 30_000);
}
