/**
 * Geoff Token Plan — public rates from docs.geoff.ai.
 * Scraped live from docs.geoff.ai; unavailable when the public page cannot be parsed.
 */

export const TOKEN_PLAN_URLS = {
  overview: "https://docs.geoff.ai/token-plan/overview",
  usage: "https://docs.geoff.ai/token-plan/usage",
  billing: "https://geoff.ai/settings/billing",
};

const PLAN_ORDER = ["basic", "pro", "max", "turbo"];

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizePlanName(name) {
  const n = decodeEntities(name).toLowerCase();
  if (n.includes("turbo")) return "turbo";
  if (n.includes("max")) return "max";
  if (n.includes("pro")) return "pro";
  if (n.includes("basic")) return "basic";
  return n.replace(/[^a-z0-9]+/g, "") || null;
}

/**
 * Parse plan price/token rows and rate limits from Mintlify SSR HTML.
 */
export function parseTokenPlanHtml(html) {
  const text = String(html || "");
  const byId = new Map();

  const planRow =
    /<strong>\s*(Basic|Pro|Max|Turbo)\s*<\/strong>\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>\s*(\$[^<]+?)\s*<\/td>/gi;
  for (const m of text.matchAll(planRow)) {
    const id = normalizePlanName(m[1]);
    if (!id) continue;
    const tokens = decodeEntities(m[2]);
    const price = decodeEntities(m[3]);
    if (!/[MBK]/i.test(tokens) && /^\d+$/.test(tokens)) continue;
    const prev = byId.get(id) || { id, name: m[1] };
    byId.set(id, { ...prev, name: m[1], tokens, price });
  }

  const limitRow =
    /<strong>\s*(Basic|Pro|Max|Turbo)\s*<\/strong>\s*<\/td>\s*<td[^>]*>\s*([\d,.]+)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/gi;
  for (const m of text.matchAll(limitRow)) {
    const id = normalizePlanName(m[1]);
    if (!id) continue;
    const rpm = decodeEntities(m[2]);
    const inputTpm = decodeEntities(m[3]);
    const outputTpm = decodeEntities(m[4]);
    if (!/^\d+$/.test(rpm.replace(/,/g, ""))) continue;
    const prev = byId.get(id) || { id, name: m[1] };
    byId.set(id, { ...prev, name: m[1], rpm, inputTpm, outputTpm });
  }

  const plans = PLAN_ORDER.map((id) => byId.get(id)).filter(Boolean);

  return {
    plans,
    model: "Public docs response",
    unfilteredNote: /Unfiltered requests[\s\S]{0,240}?10x tokens/i.test(text)
      ? "Unfiltered requests such as NSFW use 10x tokens."
      : null,
    estimates: null,
    matrix: [],
    wins: [],
    observed: {
      plans: PLAN_ORDER.every((id) => byId.get(id)?.price && byId.get(id)?.tokens),
      limits: PLAN_ORDER.every((id) =>
        byId.get(id)?.rpm && byId.get(id)?.inputTpm && byId.get(id)?.outputTpm
      ),
    },
  };
}

/** Build the glanceable Apple-style comparison sheet payload. */
export function buildPlanSheet(plan) {
  const plans = (plan?.plans || []).map((p) => ({ ...p }));

  const matrix = plan?.matrix || [];
  const wins = plan?.wins || [];

  // Compact “everyone gets” vs “unlocks at” for the sheet header story
  const everyone = matrix.filter((r) => r.levels.every((l) => l === "yes")).map((r) => r.label);
  const unlocks = [
    { at: "Pro+", label: "Memory + extended creation" },
    { at: "Max+", label: "MoM · train-your-own · max agents" },
    { at: "Turbo", label: "Multi-agent · unfiltered" },
  ];

  return {
    model: plan?.model || "Public docs response",
    unfilteredNote: plan && Object.hasOwn(plan, "unfilteredNote")
      ? plan.unfilteredNote
      : null,
    plans,
    matrix,
    wins,
    estimates: null,
    everyone: everyone.slice(0, 6),
    unlocks,
    headline: "Geoff Token Plan",
    subhead: "Apple-simple sheet. One pool. Every modality. Public numbers.",
    kicker: "Value sheet · docs.geoff.ai",
  };
}

export function fingerprintTokenPlan(plan) {
  const payload = (plan?.plans || []).map((p) =>
    [p.id, p.price, p.tokens, p.rpm, p.inputTpm, p.outputTpm].join("|"),
  );
  return [
    payload.join("::"),
    plan?.unfilteredNote || "no-unfiltered-note",
    plan?.observed?.plans,
    plan?.observed?.limits,
  ].join("::");
}
