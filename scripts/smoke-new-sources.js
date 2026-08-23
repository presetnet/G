import { sniffOpencodeZen, sniffSolanaTreasury } from "../server/sniffer.js";
import { translate, normalizeEvents, inferAgentDesk } from "../server/translator.js";

const mkSnap = (sources) => ({
  takenAt: new Date().toISOString(),
  sources: Object.fromEntries(sources.map((s) => [s.source, s])),
  summary: {},
});

console.log("=== LIVE: opencode zen ===");
const zen = await sniffOpencodeZen();
console.log(JSON.stringify({ ok: zen.ok, count: zen.count, freeCount: zen.freeCount, ghosts: zen.ghostIds, missing: zen.missingGhosts }, null, 1));

console.log("\n=== LIVE: solana treasury ===");
const sol = await sniffSolanaTreasury();
console.log(JSON.stringify({ ok: sol.ok, lamports: sol.lamports, sol: sol.sol, sigCount: sol.sigCount, latest: sol.latestActivityAt, reason: sol.reason }));

console.log("\n=== SYNTHETIC DIFF TESTS ===");
const base = {
  "stacknet.network": {
    source: "stacknet.network", ok: true, status: 200, ms: 100,
    models: ["magma", "preview", "pyro", "pyro:max",
      "stack-chat-magma", "stack-chat-preview", "stack-chat-pyro"],
    capabilities: ["chat"], treasury: { totalLamports: "0", totalUsd: 0 },
    metaproofs: { total: 0, totalPaperworkUsd: "692526478", paidPaperworkUsd: "0", outstandingUsd: "692526478" },
  },
  "solana.treasury": { source: "solana.treasury", ok: true, status: 200, address: "X", lamports: 0, sigCount: 3 },
  "opencode.zen": { source: "opencode.zen", ok: true, status: 200, count: 64, ids: ["a", "big-pickle", "b"], freeIds: ["hy3-free"], ghostIds: ["big-pickle"], freeCount: 1, fingerprint: "f1" },
};
const prev = mkSnap(Object.values(base).map((s) => structuredClone(s)));

const currNetwork = structuredClone(base["stacknet.network"]);
currNetwork.metaproofs = { total: 0, totalPaperworkUsd: "700000000", paidPaperworkUsd: "5000000", outstandingUsd: "695000000" };
currNetwork.models = [...currNetwork.models.slice(0, 4), "grok-9", ...currNetwork.models.slice(4), "stack-video-magma"];
currNetwork.treasury = { totalLamports: "42000000000".slice(0,10), totalUsd: 6.5 };
const currChain = { source: "solana.treasury", ok: true, status: 200, address: "X", lamports: 6500000000, sigCount: 5 };
const currZen = { source: "opencode.zen", ok: true, status: 200, count: 65, ids: ["a", "big-pickle", "b", "mystery-x-free"], freeIds: ["hy3-free", "mystery-x-free"], ghostIds: ["big-pickle"], freeCount: 2, fingerprint: "f2" };
const curr = mkSnap([currNetwork, currChain, currZen]);

const raw = translate(prev, curr);
const evts = normalizeEvents(raw);
for (const e of evts) console.log(`[${e.rank}] ${e.kind}: ${e.title} — ${e.summary}`);

const desk = inferAgentDesk({ summary: {} }, evts);
console.log("\ndesk:", desk?.status ?? "n/a");
