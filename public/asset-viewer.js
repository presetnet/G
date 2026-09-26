// ASSET VIEWER — paste any Solana or Ethereum wallet and see what is actually
// on chain right now: native balance, SPL/ERC-20 holdings, NFT collections
// (including The Simulation / SIM), and last activity. Every number is fetched
// live per request from the public RPC / Blockscout via /api/assets and names
// the endpoint that served it; nothing here is cached client-side beyond the
// short localStorage list of wallets you added.
const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const link = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const short = (a) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "");
const age = (at) => (Number.isFinite(Date.parse(at)) ? `${Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60000))}m ago` : "unknown");
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const fmt = (v, d = 4) => (num(v) === null ? "—" : num(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const STORE_KEY = "gt.assetViewer.wallets";
const MAX_WALLETS = 8;
const SIM_COLLECTION_ADDRESS = "0xc3706195ff60658585b58716717ee7acc5ebca60";

// Wallets the desk already talks about, so the viewer starts with real targets.
const DEFAULT_WALLETS = [
  { address: "BjLoeUtRq1QBLBWcTWgUFFfj75BsrcESZMu6F1DrMV9C", label: "SIM · SOL pot (mainnet)" },
  { address: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4", label: "SIM · void.eth rail" },
  { address: "9GjEVnpWiLe2uknUmtaH6DSfgcBvL66DtSKGREXDctZU", label: "AZY · custody wallet" },
  { address: "0xc3706195Ff60658585B58716717ee7Acc5ebcA60", label: "MAGMA · The Simulation (contract)" },
];

let savedWallets = [];
// assets = our own /api/assets read. deskSources = the desk snapshot, used only
// for the recent-payer shortcuts. Two different payloads, two variables, on
// purpose — merging them once broke render().
let assets = null;
let deskSources = null;
let busy = false;
let price = { sol: null, eth: null, at: null };

function loadSaved() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    savedWallets = Array.isArray(parsed)
      ? parsed.filter((w) => typeof w === "string" && w.trim()).slice(0, MAX_WALLETS)
      : [];
  } catch {
    savedWallets = [];
  }
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(savedWallets));
  } catch {
    /* private mode — the list is a convenience, not state */
  }
}
const allWallets = () => [...DEFAULT_WALLETS, ...savedWallets.map((address) => ({ address, label: null }))].slice(0, MAX_WALLETS);

async function fetchPrices() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    price = { sol: num(json?.solana?.usd) ?? price.sol, eth: num(json?.ethereum?.usd) ?? price.eth, at: new Date().toISOString() };
  } catch {
    /* USD is a nicety; amounts stand on their own */
  }
}

async function refresh(fresh = false) {
  if (busy) return;
  busy = true;
  render();
  const wallets = allWallets().map((w) => w.address);
  try {
    const res = await fetch(`/api/assets?wallets=${encodeURIComponent(wallets.join(","))}${fresh ? "&refresh=1" : ""}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    assets = { ...json, labels: Object.fromEntries(allWallets().map((w) => [w.address.toLowerCase(), w.label])) };
  } catch (error) {
    assets = { error: error.message, wallets: [] };
  } finally {
    busy = false;
    render();
  }
}

function render() {
  const root = document.getElementById("assetViewer");
  if (!root) return;
  const chips = allWallets()
    .map((w) => {
      const mine = savedWallets.some((s) => s.toLowerCase() === w.address.toLowerCase());
      return `<span class="av-chip"><button type="button" data-inspect="${esc(w.address)}" title="${esc(w.address)}">${esc(w.label || short(w.address))}</button>${
        mine ? `<button type="button" class="av-x" data-drop="${esc(w.address)}" title="Remove">×</button>` : ""
      }</span>`;
    })
    .join("");
  const payers = [
    ...(latestPayers() || []),
  ]
    .map(
      (p) =>
        `<button type="button" class="av-payer" data-add="${esc(p.address)}" title="${esc(p.address)}">${esc(p.label)} · ${short(p.address)}</button>`,
    )
    .join("");

  root.innerHTML = `
    <div class="desk-toolbar"><h3 id="assetViewerTitle">What is real in a wallet</h3>
      <p>Paste any Solana or Ethereum wallet. Live read from the public Solana RPC and Blockscout — native balance, tokens, NFTs (incl. The Simulation), last activity. Not a service; an observation you can re-check on the explorer.</p>
    </div>
    <form class="av-form" id="avForm">
      <input id="avInput" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="Solana base58 or 0x… Ethereum address (comma-separated ok)" aria-label="Wallet address">
      <button type="submit">Add wallet</button>
      <button type="button" id="avRefresh" ${busy ? "disabled" : ""}>${busy ? "Reading…" : "Refresh"}</button>
    </form>
    <div class="av-chips">${chips}</div>
    ${payers ? `<div class="av-payers"><small>recent payers on the desk</small>${payers}</div>` : ""}
    <div class="av-results" id="avResults" aria-live="polite">${
      busy && !assets
        ? '<p class="av-note">Reading wallets on chain…</p>'
        : assets?.error
          ? `<p class="av-note av-bad">${esc(assets.error)}</p>`
          : assets
            ? (assets.wallets || []).map((w) => renderWallet(w, assets.labels?.[w.address?.toLowerCase()] || null)).join("")
            : '<p class="av-note">Add a wallet to begin.</p>'
    }</div>`;

  root.querySelector("#avForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = root.querySelector("#avInput");
    const added = String(input?.value || "")
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter(Boolean)
      .filter((v) => !allWallets().some((w) => w.address.toLowerCase() === v.toLowerCase()))
      .slice(0, MAX_WALLETS);
    if (!added.length) return;
    savedWallets = [...savedWallets, ...added].slice(0, MAX_WALLETS);
    persist();
    if (input) input.value = "";
    refresh();
  });
  root.querySelector("#avRefresh")?.addEventListener("click", () => refresh(true));
  root.querySelectorAll("[data-drop]").forEach((b) =>
    b.addEventListener("click", () => {
      const addr = b.getAttribute("data-drop");
      savedWallets = savedWallets.filter((s) => s.toLowerCase() !== addr.toLowerCase());
      persist();
      refresh();
    }),
  );
  root.querySelectorAll("[data-add]").forEach((b) =>
    b.addEventListener("click", () => {
      const addr = b.getAttribute("data-add");
      if (savedWallets.some((s) => s.toLowerCase() === addr.toLowerCase())) return;
      savedWallets = [...savedWallets, addr].slice(0, MAX_WALLETS);
      persist();
      refresh();
    }),
  );
  root.querySelectorAll("[data-inspect]").forEach((b) =>
    b.addEventListener("click", () => {
      const addr = b.getAttribute("data-inspect");
      navigator.clipboard?.writeText(addr).catch(() => {});
      b.closest(".av-chip")?.classList.add("av-copied");
      setTimeout(() => b.closest(".av-chip")?.classList.remove("av-copied"), 900);
    }),
  );
}

function latestPayers() {
  const sources = deskSources;
  if (!sources) return [];
  const out = [];
  for (const [sourceKey, field, prefix] of [
    ["sim.chain", "solTopPayers", "SIM payer"],
    ["sim.ethm", "ethTopSenders", "mainnet sender"],
    ["azy.chain", "azyTopPayers", "AZY payer"],
  ]) {
    const rows = sources[sourceKey]?.[field];
    for (const row of (Array.isArray(rows) ? rows : []).slice(0, 3)) {
      const address = row?.wallet;
      if (address && !out.some((p) => p.address === address)) out.push({ address, label: prefix });
    }
  }
  return out.slice(0, 6);
}

function renderWallet(w, label) {
  const chainBadge = w.chain === "solana" ? "Solana" : w.chain === "ethereum" ? "Ethereum" : "unknown chain";
  const state = w.ok ? (w.stale ? "stale" : "current") : w.stale ? "stale · last read failed" : "unread";
  const rate = w.chain === "solana" ? price.sol : w.native?.usdRate ?? price.eth;
  const nativeUsd = w.native?.amount != null && rate != null ? w.native.amount * rate : w.native?.usd;
  const simHeld = w.sim?.held || 0;
  return `<article class="av-card ${w.ok ? "" : "av-card-bad"}">
    <header class="av-head">
      <span class="av-chain">${esc(chainBadge)}</span>
      <b>${esc(label || short(w.address))}</b>
      <code class="av-addr">${w.explorer?.addressUrl ? link(w.explorer.addressUrl, w.address) : esc(w.address)}</code>
      <span class="av-state av-${esc(state.split(" ")[0])}">${esc(state)}</span>
    </header>
    ${w.ok ? "" : `<p class="av-note av-bad">${esc(w.reason || "read failed")}</p>`}
    ${
      w.ok
        ? `<p class="av-native"><b>${fmt(w.native?.amount, 6)} ${esc(w.native?.symbol || "")}</b>${
            nativeUsd != null ? `<span>≈ $${fmt(nativeUsd, 0)}</span>` : ""
          }${w.identity ? `<small>${w.identity.isContract ? "contract" : "wallet"}${w.identity.name ? ` · ${esc(w.identity.name)}` : ""}${w.identity.isVerified ? " · verified" : ""}</small>` : ""}</p>`
        : ""
    }
    ${
      String(w.address || "").toLowerCase() === SIM_COLLECTION_ADDRESS
        ? `<p class="av-sim av-sim-zero">This address is The Simulation collection contract itself${w.identity?.isVerified ? " (verified on Blockscout)" : ""} — NFTs are held by people, not by the contract.</p>`
        : simHeld > 0
          ? `<p class="av-sim"><b>${simHeld}</b> The Simulation NFT${simHeld === 1 ? "" : "s"} in this wallet · ${link(w.sim.url, "OpenSea collection")}</p>`
          : w.ok && w.chain === "ethereum"
            ? `<p class="av-sim av-sim-zero">No The Simulation NFT in the first pages walked${w.nft?.capped ? " (walk capped)" : ""}.</p>`
            : ""
    }
    ${
      w.tokens?.length
        ? `<table class="av-table"><caption>tokens · ${w.tokens.length}${w.tokensCapped ? "+" : ""} shown</caption><tbody>${w.tokens
            .slice(0, 8)
            .map(
              (t) =>
                `<tr><td>${esc(t.symbol || t.name || short(t.contract || t.mint))}</td><td>${fmt(t.amount, 6)}</td><td>${t.usd != null ? `$${fmt(t.usd, 0)}` : ""}</td><td>${link(t.url, "chain")}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : ""
    }
    ${
      w.nft?.collections?.length
        ? `<p class="av-nfts">NFTs: ${w.nft.collections
            .slice(0, 6)
            .map((c) => `${esc(c.name || short(c.contract))} ×${c.count}`)
            .join(" · ")}${w.nft.collections.length > 6 ? " …" : ""}</p>`
        : ""
    }
    <p class="av-activity">last ${w.activity?.lastAt ? `${age(w.activity.lastAt)} (${esc(w.activity.lastAt.slice(0, 16).replace("T", " "))})` : "activity unread"}${
      w.activity?.count != null ? ` · ${w.activity.count}${w.activity.capped ? "+" : ""} recent` : ""
    } · checked ${age(w.checkedAt)}</p>
    ${(w.caps || []).map((c) => `<p class="av-cap">⚠ ${esc(c)}</p>`).join("")}
    ${(w.warnings || []).map((c) => `<p class="av-cap">⚠ ${esc(c)}</p>`).join("")}
    <details class="av-prov"><summary>provenance</summary><ul>${(w.provenance || []).map((p) => `<li>${esc(p)}</li>`).join("") || "<li>—</li>"}</ul></details>
  </article>`;
}

export function initAssetViewer() {
  loadSaved();
  if (!document.getElementById("assetViewer")) {
    // Own top-level fold, sibling of the SIM fold — NOT inside it. Nesting here
    // hid the viewer behind a closed <details> while the DOM still looked fine.
    const simDesk = document.getElementById("simDesk");
    const anchor = simDesk?.closest("details") || simDesk || document.getElementById("glance");
    const fold = document.createElement("details");
    fold.className = "section-fold overview-fold asset-fold";
    fold.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "Asset viewer · any Solana or Ethereum wallet";
    const section = document.createElement("section");
    section.id = "assetViewer";
    section.className = "asset-viewer";
    section.setAttribute("aria-labelledby", "assetViewerTitle");
    if (anchor?.after) anchor.after(fold);
    fold.append(summary, section);
  }
  render();
  fetchPrices();
  refresh();
  setInterval(() => {
    fetchPrices();
    refresh();
  }, 120_000);
}

export function renderAssetViewer(snapshot) {
  if (snapshot?.sources) deskSources = snapshot.sources;
  render();
}
