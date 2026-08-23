const els = {
  connection: document.getElementById("ptConnection"),
  headline: document.getElementById("ptHeadline"),
  sentence: document.getElementById("ptSentence"),
  freshMeta: document.getElementById("ptFreshMeta"),
  tabs: document.getElementById("ptTabs"),
  editor: document.getElementById("ptEditor"),
  count: document.getElementById("ptCount"),
  copyBtn: document.getElementById("ptCopyBtn"),
};

let data = { summary: null, events: [], takenAt: null };
let flavor = "drop";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function relTime(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function fmtMoney(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtCtx(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B tok`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M tok`;
  return `${Math.round(n / 1e3)}K tok`;
}

function lastZenMove(events) {
  const moves = events
    .filter((e) => e.kind === "zen")
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  return moves[0] ?? null;
}

const FLAVORS = {
  drop({ s, ghosts, move }) {
    const booked =
      s.metaproofsPaperworkUsd != null ? fmtMoney(Number(s.metaproofsPaperworkUsd)) : "$692.5M";
    const paid = s.metaproofsPaidUsd != null ? fmtMoney(Number(s.metaproofsPaidUsd)) : "$0";
    const lines = [
      `[ PICKLE WATCH · ${new Date().toISOString().slice(0, 10)} ]`,
      "",
      `The verdict nobody wants: nobody knows whose brains run these models. That IS the business model.`,
      "",
      `Geoff's books: ${booked} paperwork booked · ${paid} paid · treasury wallet empty, never touched once (on-chain verified).`,
      `Geoff cluster: ${s.nodes ?? "?"} nodes · ${s.gpus ?? "?"} GPUs — self-published.`,
      `opencode fleet: not published. The asymmetry is the point.`,
      `Free ghost shelf: ${ghosts.length}/5 alive${
        ghosts.length ? ` (${ghosts.join(", ")})` : ""
      }.`,
      move ? `Last shelf move: ${move.title} · ${relTime(move.at)}` : "No shelf moves on tape yet.",
      "",
      "Live tracker: aisp.live/watch.html",
    ];
    return lines.join("\n");
  },

  thread({ s, ghosts, move }) {
    const booked =
      s.metaproofsPaperworkUsd != null ? fmtMoney(Number(s.metaproofsPaperworkUsd)) : "$692.5M";
    const parts = [
      `1/ The question everyone dances around: is the free mystery model secretly Geoff? Is Geoff secretly running on models like it? Short answer: no direct link. Long answer is weirder.`,
      `2/ Geoff doesn't make AI. Their own code admits it — anonymous upstream models renamed to their brand layers. The free shelf does the same trick from the other side. Both brands are masks.`,
      `3/ Same face under both? People checked hard. Traffic never crosses between them. One hides the AI's thinking before showing you; the other shows every thought. Timelines don't even overlap. No link found.`,
      `4/ And kill the "free vs paid" framing. The ghost shelf burns an estimated $400-900k/wk that some unnamed payer eats. A subsidy isn't free — it's a payer who won't show his face. Same trick as the models themselves.`,
      `5/ Geoff's money is equally weird: ${booked} of "metaproof paperwork" booked, zero paid, and their Solana wallet has never received a single transaction in its existence. Chain-verified, not website-verified.`,
      `6/ Fork theory dies too: cloning gets you a router shell, not the supply deals that put brains behind labels. And CT-log dates can't be backdated — Geoff's infra was registered March 2024, long before anything needed covering up. Slow build, not psyop.`,
      `7/ Masks come off in this industry. gpt2-chatbot became GPT-4o in 10 days flat (2024). Quasar/Optimus Alpha were identified via tokenizer fingerprints within days, then confirmed as GPT-4.1 tests (2025). Raw access leaks metadata. Always.`,
      `8/ The elephant: an entire industry learned it can sell AI without telling anyone what's under the hood — and it works because almost nobody asks. Now you have a desk that asks automatically.`,
      move
        ? `9/ Latest public move: ${move.title} · ${relTime(move.at)}. Live tripwires on every ghost: aisp.live/watch.html`
        : `9/ Live tripwires on every ghost model: aisp.live/watch.html`,
    ];
    void s;
    void ghosts;
    return parts.join("\n\n");
  },

  skeptic({ s }) {
    const booked =
      s.metaproofsPaperworkUsd != null ? fmtMoney(Number(s.metaproofsPaperworkUsd)) : "$692.5M";
    return [
      `PRE-LOADED ANSWERS FOR THE USUAL PUSHBACK`,
      ``,
      `"The dates are faked / backloaded."`,
      `Certificate-transparency logs can't be backdated. Geoff's infra domain was registered March 2024 — 19 months before the mystery model existed. If anything, the timeline shows a slow quiet build, which is the opposite of a coordinated psyop launch.`,
      ``,
      `"They just cloned StackNet."`,
      `A clone gets you a router shell with nobody's brains behind it. The value is upstream supply deals + GPU fleet + wallet rails — none of that survives git clone. Behaviorally they're opposites anyway: one strips the AI's reasoning out, the other shows all of it.`,
      ``,
      `"Free models are bait."`,
      `Correct instinct, wrong conclusion. Someone IS paying — roughly $400-900k/week of compute for the free shelf. The point isn't "free," it's that the payer hides. Notice Geoff hides whether anyone will ever get paid. Invisible economics on both sides of the table.`,
      ``,
      `"You can't prove it's NOT them."`,
      `True — ancestry is unfalsifiable from outside, and we say so. What WOULD flip the verdict instantly: traffic touching their servers, matching TLS fingerprints, or identical API quirks. None observed across hundreds of traced sessions.`,
      ``,
      `"$${booked.replace("$", "")} is made-up hype numbers."`,
      `It's their own public ledger, readable without a login. Booked ≠ paid: paid is $0, and the receiving wallet has zero lifetime transactions on-chain. We're reporting their fiction, not endorsing it — that's exactly why the number is interesting.`,
      ``,
      `"So what ARE those engines then?"`,
      `Unknown — and that's the honest answer everyone should sit with. Their unnamed magma/pyro layers could unmask any day, the same way gpt2-chatbot became GPT-4o and Quasar Alpha became GPT-4.1. History says masks don't hold.`,
      ``,
      `Live numbers refresh at: aisp.live/watch.html`,
    ].join("\n");
  },

  stats({ s, ghosts }) {
    const lines = [
      `RAW STATS · ${new Date().toISOString().slice(0, 10)}`,
      ``,
      `-- GEOFF / STACKNET (self-published endpoints) --`,
      `Version: ${s.stacknetVersion ?? "?"}`,
      `Cluster: ${s.nodes ?? "?"}/${s.totalNodes ?? "?"} nodes · ${s.gpus ?? "?"} GPUs · ${
        s.vramGb != null ? `${Math.round(Number(s.vramGb))} GB VRAM` : "?"
      }`,
      `Models: ${s.models ?? "?"} internal · ${s.apiModels ?? "?"} public catalog cards`,
      `Paperwork: ${
        s.metaproofsPaperworkUsd != null ? fmtMoney(Number(s.metaproofsPaperworkUsd)) : "?"
      } booked · ${s.metaproofsPaidUsd != null ? fmtMoney(Number(s.metaproofsPaidUsd)) : "?"} paid · ${
        s.metaproofsTotal ?? "?"
      } records`,
      `Treasury: chain balance ${Number(s.treasuryRpcSol ?? 0).toFixed(3)} SOL · ${
        s.treasuryRpcSigCount ?? 0
      } lifetime txs`,
      ``,
      `-- OPENCODE / PICKLE SIDE (public telemetry only) --`,
      `Ghost shelf: ${ghosts.length}/5 present`,
      ghosts.length ? `Ghosts: ${ghosts.join(", ")}` : `Ghosts: none`,
      `Zen catalog: ${s.zenModelCount ?? "?"} models · ${s.zenFreeCount ?? "?"} free`,
      s.zenFreeContextTotal != null
        ? `Free-shelf context capacity: ${fmtCtx(Number(s.zenFreeContextTotal))}`
        : null,
      `models.dev slice: ${s.ocRegistryModels ?? "?"} entries · ${s.ocRegistryProviders ?? "?"} providers`,
      s.ocReleaseTag ? `Latest release: ${s.ocReleaseTag}${relTime(s.ocReleaseAt) ? ` · ${relTime(s.ocReleaseAt)}` : ""}` : null,
      ``,
      `-- REFERENCE DEMAND RECEIPT --`,
      `Quasar Alpha (cloaked, Apr 2025): ~67B tokens/day peak ≈ ~780k tok/s sustained-average while anonymous`,
      ``,
      `Verify everything yourself: aisp.live/watch.html`,
    ];
    return lines.filter((l) => l !== null).join("\n");
  },

  elephant() {
    return [
      `THE ELEPHANT IN THE ROOM`,
      ``,
      `Everyone argues about WHICH company is behind the mask. Wrong argument. Here's the actual situation:`,
      ``,
      `Geoff admits in its own code that it buys anonymous models and renames them. The free shelf you're typing into stocks anonymous models too — half of them openly relabeled DeepSeek, Nemotron, Kimi, Qwen; a few fully silent about origin.`,
      ``,
      `Both brands stand in front of the same kind of curtain. Nobody can prove it's the same curtain. Nobody can prove it isn't. And the industry works precisely BECAUSE nobody asks.`,
      ``,
      `History says the curtains don't hold: gpt2-chatbot turned out to be GPT-4o. Quasar Alpha turned out to be GPT-4.1. Ten days of anonymity, then the reveal. When raw access exists, tokenizers act like fingerprints and metadata leaks like water.`,
      ``,
      `So the question isn't "which mask is which face." It's: when do these ones slip — and will you notice before or after? There's a desk for that now.`,
      ``,
      `aisp.live/watch.html · public data only, always.`,
    ].join("\n");
  },
};

function applyFlavor() {
  const s = data.summary ?? {};
  const ctx = {
    s,
    ghosts: Array.isArray(s.zenGhostIds) ? s.zenGhostIds : [],
    move: lastZenMove(data.events),
  };
  els.editor.value = FLAVORS[flavor](ctx);
  updateCount();
}

function updateCount() {
  const len = els.editor.value.length;
  els.count.textContent = `${len} chars`;
}

async function load() {
  els.connection.textContent = "loading";
  try {
    const [statusRes, eventsRes] = await Promise.all([
      fetch("/api/status", { cache: "no-store" }),
      fetch("/api/events?limit=120", { cache: "no-store" }).catch(() => null),
    ]);
    if (!statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
    const status = await statusRes.json();
    data.summary = status?.latest?.summary ?? {};
    data.takenAt = status?.latest?.takenAt ?? null;
    let events = [];
    if (eventsRes && eventsRes.ok) {
      const payload = await eventsRes.json().catch(() => null);
      events = Array.isArray(payload?.events) ? payload.events : [];
    }
    data.events = events;

    els.headline.textContent = "Ammunition ready";
    const fresh = relTime(data.takenAt);
    els.sentence.textContent = fresh
      ? `Numbers pulled from a sniff taken ${fresh}. Edit anything below before sending.`
      : "Edit anything below before sending.";
    els.freshMeta.textContent = fresh ? `last sniff ${fresh}` : "";
    els.connection.textContent = "live";
    applyFlavor();
  } catch (error) {
    els.connection.textContent = "offline";
    els.headline.textContent = "Telemetry unreachable";
    els.sentence.textContent = error.message;
    if (!els.editor.value || els.editor.value === "loading…") {
      els.editor.value =
        "Could not reach live telemetry. The static brief still works:\n\n" +
        "Verdict: nobody knows whose brains run these models - that IS the business model.\n" +
        "Geoff: $692.5M booked / $0 paid / wallet never touched (on-chain).\n" +
        "Ghost shelf watch: aisp.live/watch.html";
      updateCount();
    }
  }
}

els.tabs?.addEventListener("click", (event) => {
  const btn = event.target.closest(".pt-tab");
  if (!btn) return;
  flavor = btn.dataset.flavor || "drop";
  for (const tab of els.tabs.querySelectorAll(".pt-tab")) {
    tab.classList.toggle("active", tab === btn);
  }
  applyFlavor();
});

els.editor?.addEventListener("input", updateCount);

els.copyBtn?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.editor.value);
    els.copyBtn.textContent = "Copied";
  } catch {
    els.editor.select();
    document.execCommand?.("copy");
    els.copyBtn.textContent = "Copied";
  }
  setTimeout(() => (els.copyBtn.textContent = "Copy"), 1500);
});

load();
setInterval(load, 120_000);
void escapeHtml;
