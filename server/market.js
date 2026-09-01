import { marketCatalog } from "./market-catalog.js";
import { scrapeMarketIntel } from "./market-scrape.js";
import { runSniff } from "./sniffer.js";
import {
  buildPlanSheet,
  FALLBACK_TOKEN_PLAN,
  FEATURE_MATRIX,
  TOKEN_PLAN_URLS,
} from "./token-plan.js";

function pickTokenPlan(geoffSnap) {
  const src = geoffSnap?.sources?.["geoff.docs.pricing"];
  const base = src?.plans?.length
    ? {
        scraped: Boolean(src.scraped),
        model: src.model || FALLBACK_TOKEN_PLAN.model,
        unfilteredNote: Object.hasOwn(src, "unfilteredNote")
          ? src.unfilteredNote
          : FALLBACK_TOKEN_PLAN.unfilteredNote,
        plans: src.plans,
        estimates: null,
        matrix: src.matrix || FEATURE_MATRIX,
        wins: src.wins || FALLBACK_TOKEN_PLAN.wins,
        sourceUrls: src.sourceUrls || TOKEN_PLAN_URLS,
        reason: src.reason || null,
        fingerprint: src.fingerprint || null,
        observed: src.observed || null,
        sections: src.sections || null,
      }
    : {
        scraped: false,
        model: FALLBACK_TOKEN_PLAN.model,
        unfilteredNote: FALLBACK_TOKEN_PLAN.unfilteredNote,
        plans: FALLBACK_TOKEN_PLAN.plans.map((p) => ({ ...p })),
        estimates: null,
        matrix: FEATURE_MATRIX,
        wins: FALLBACK_TOKEN_PLAN.wins,
        sourceUrls: TOKEN_PLAN_URLS,
        reason: "Using bundled Token Plan values pending a complete live docs parse",
        fingerprint: null,
        observed: { plans: false, limits: false },
        sections: null,
      };
  return {
    ...buildPlanSheet(base),
    scraped: base.scraped,
    reason: base.reason,
    fingerprint: base.fingerprint,
    observed: base.observed,
    sections: base.sections,
    sourceUrls: base.sourceUrls,
  };
}

function enrichCatalog(catalog, tokenPlan) {
  const vendors = (catalog.vendors || []).map((v) => {
    if (v.id !== "geoff") return v;
    const planLine = (tokenPlan.plans || [])
      .map((p) => `${p.name} ${p.price} (${p.tokens})`)
      .join(" · ");
    return {
      ...v,
      horsepower: {
        ...v.horsepower,
        pricingModel: planLine
          ? `Token Plan: ${planLine}`
          : v.horsepower?.pricingModel,
      },
      delivers: [
        ...(v.delivers || []).filter((d) => !/token plan|pricing|seat/i.test(d)),
        "Public Token Plan seats on docs.geoff.ai (Basic → Turbo)",
      ],
      research: [
        { label: "Token Plan usage limits", href: TOKEN_PLAN_URLS.usage },
        { label: "Token Plan overview", href: TOKEN_PLAN_URLS.overview },
        ...((v.research || []).filter(
          (r) => !/token plan/i.test(r.label || ""),
        )),
      ],
    };
  });

  const dimensions = (catalog.dimensions || []).map((d) => {
    if (d.id !== "price") return d;
    const cheap = tokenPlan.plans?.[0];
    const rich = tokenPlan.plans?.[tokenPlan.plans.length - 1];
    return {
      ...d,
      scores: {
        ...d.scores,
        geoff:
          cheap && rich
            ? `${cheap.price} → ${rich.price}`
            : d.scores?.geoff,
      },
    };
  });

  return { ...catalog, vendors, dimensions };
}

export function buildStoredMarketPayload(geoffSnap = null) {
  const tokenPlan = pickTokenPlan(geoffSnap);
  const catalog = enrichCatalog(marketCatalog, tokenPlan);
  return {
    takenAt: geoffSnap?.takenAt || null,
    catalog,
    tokenPlan,
    live: {},
    scraped: {},
    scorecard: [],
    manifesto: [],
    frameCards: [],
    inventories: [],
    compareHints: ["Stored dashboard data only; browser-triggered market scraping is disabled."],
  };
}

export async function buildMarketPayload() {
  const geoffSnap = await runSniff().catch(() => null);
  const intel = await scrapeMarketIntel(geoffSnap);
  const tokenPlan = pickTokenPlan(geoffSnap);
  const catalog = enrichCatalog(marketCatalog, tokenPlan);

  const inventories = [
    {
      id: "geoff-pricing",
      title: "Geoff Token Plan (docs)",
      subtitle: tokenPlan.scraped
        ? "Sniffed from docs.geoff.ai"
        : "Bundled fallback values",
      items: (tokenPlan.plans || []).map(
        (p) =>
          `${p.name}: ${p.price} · ${p.tokens} tokens · ${p.rpm || "—"} RPM`,
      ),
      extras: [
        "shared monthly token pool",
        `prices:${TOKEN_PLAN_URLS.overview}`,
        `limits:${TOKEN_PLAN_URLS.usage}`,
      ],
    },
    ...(intel.inventories || []),
  ];

  if (intel.live?.geoff) {
    intel.live.geoff.components = [
      ...(intel.live.geoff.components || []),
      {
        name: "Token Plan docs",
        status: tokenPlan.scraped ? "operational" : "bundled fallback",
      },
      {
        name: "Cheapest seat",
        status: tokenPlan.plans?.[0]
          ? `${tokenPlan.plans[0].name} ${tokenPlan.plans[0].price}`
          : "—",
      },
      {
        name: "Top seat",
        status: tokenPlan.plans?.[tokenPlan.plans.length - 1]
          ? `${tokenPlan.plans.at(-1).name} ${tokenPlan.plans.at(-1).price}`
          : "—",
      },
    ];
  }

  return {
    takenAt: new Date().toISOString(),
    catalog,
    tokenPlan,
    live: intel.live,
    scraped: intel.scraped,
    scorecard: intel.scorecard,
    manifesto: intel.manifesto,
    frameCards: intel.frameCards,
    inventories,
    compareHints: [
      "Headline: Geoff is universal utility token capacity — not a seat twin of Copilot, not a 1:1 Grok/OpenAI meter.",
      "Non-apples: shared multimodal pool vs $ / 1M call meters vs monthly cockpit seats. Rank units before prices.",
      "Geoff column = live Stacknet sniff + Token Plan tables. Grok/OpenAI/Copilot = public docs + status boards.",
      "Soft edge: storytelling companion energy — creative shadow booster, not the protagonist of the page.",
      "Seat products can look “all green” while horsepower stays behind plan gates.",
    ],
  };
}
