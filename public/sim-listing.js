// SIM LISTING PREFLIGHT — answers one question honestly: "why can't I see or
// list my Simulation NFT on OpenSea?" It reads the chain (Blockscout, public
// Ethereum RPC), the token's own metadata, the collection's image host, and the
// keyless OpenSea item page, then says which of those is actually in the way.
//
// It deliberately places no order and holds no key. There is no public OpenSea
// listing API, and a real listing is a UI click plus a wallet signature — so
// the tool stops at diagnosis and names the next step the reader has to take.
const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const link = (url, label) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : "");
const short = (a) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "");
const age = (at) => (Number.isFinite(Date.parse(at)) ? `${Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60000))}m ago` : "unknown");
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

const MAX_WALLETS = 4;
// The desk already tracks these, and the void.eth rail is the one that actually
// holds a SIM, so the fold opens on a real question rather than a blank form.
const DEFAULT_WALLETS = [
  { address: "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4", label: "SIM · void.eth rail" },
  { address: "0xE18B0E42f7eD3Bd7A1F1E1b8B0B4c1A6D8e9F0A11", label: "paste your own" },
];

let wallets = [];
let data = null;
let busy = false;

function render() {
  const root = document.getElementById("simListing");
  if (!root) return;
  const chips = wallets
    .map(
      (w) => `<span class="sl-chip"><button type="button" data-copy="${esc(w.address)}" title="${esc(w.address)}">${esc(w.label || short(w.address))}</button>` +
        (w.dismissable ? `<button type="button" class="sl-x" data-drop="${esc(w.address)}" title="Remove">×</button>` : "") +
        `</span>`,
    )
    .join("");

  root.innerHTML = `
    <div class="desk-toolbar"><h3 id="simListingTitle">Why can't I list my SIM?</h3>
      <p>Paste the wallet that holds the NFT. Live read of the holder, the Safe behind it, the token's own metadata, the collection's image host, and the public OpenSea item page. No key, no order — this says what is in the way and stops there.</p>
    </div>
    <form class="sl-form" id="slForm">
      <input id="slInput" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="0x… Ethereum address (the holder, not the owner account)" aria-label="Holder wallet address">
      <button type="submit">Check</button>
      <button type="button" id="slRefresh" ${busy ? "disabled" : ""}>${busy ? "Reading…" : "Re-read"}</button>
    </form>
    <div class="sl-chips">${chips}</div>
    <div class="sl-results" id="slResults" aria-live="polite">${
      busy && !data
        ? '<p class="sl-note">Reading the chain, the metadata and the OpenSea page…</p>'
        : data?.error
          ? `<p class="sl-note sl-bad">${esc(data.error)}</p>`
          : data
            ? (data.wallets || []).map((w) => renderWallet(w)).join("") +
              (data.notChecked || []).map((n) => `<p class="sl-cap">⚠ ${esc(n)}</p>`).join("")
            : '<p class="sl-note">Add the holder wallet to begin.</p>'
    }</div>`;

  root.querySelector("#slForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = root.querySelector("#slInput");
    const added = String(input?.value || "")
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter(Boolean)
      .filter((v) => !wallets.some((w) => w.address.toLowerCase() === v.toLowerCase()));
    if (!added.length) return;
    wallets = [...wallets, ...added.map((address) => ({ address, label: null, dismissable: true }))].slice(0, MAX_WALLETS);
    if (input) input.value = "";
    refresh();
  });
  root.querySelector("#slRefresh")?.addEventListener("click", () => refresh(true));
  root.querySelectorAll("[data-drop]").forEach((b) =>
    b.addEventListener("click", () => {
      const addr = b.getAttribute("data-drop");
      wallets = wallets.filter((w) => w.address.toLowerCase() !== addr.toLowerCase());
      refresh();
    }),
  );
  root.querySelectorAll("[data-copy]").forEach((b) =>
    b.addEventListener("click", () => {
      navigator.clipboard?.writeText(b.getAttribute("data-copy")).catch(() => {});
      b.closest(".sl-chip")?.classList.add("sl-copied");
      setTimeout(() => b.closest(".sl-chip")?.classList.remove("sl-copied"), 900);
    }),
  );
}

async function refresh(fresh = false) {
  if (busy || !wallets.length) return;
  busy = true;
  render();
  try {
    const res = await fetch(`/api/sim-listing?wallets=${encodeURIComponent(wallets.map((w) => w.address).join(","))}${fresh ? "&refresh=1" : ""}`, {
      signal: AbortSignal.timeout(60_000),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    data = { ...json, labels: Object.fromEntries(wallets.map((w) => [w.address.toLowerCase(), w.label])) };
  } catch (error) {
    data = { error: error.message, wallets: [] };
  } finally {
    busy = false;
    render();
  }
}

const VERDICT_TONE = { ready: "good", "listable-with-notes": "warn", blocked: "bad", unknown: "quiet" };
const NAME_BAD = new Set(["missing", "undefined", "trait-word", "trait-like"]);

function renderWallet(w) {
  const label = w.label || short(w.address);
  const state = !w.ok ? (w.stale ? "stale · last read failed" : "unread") : w.stale ? "stale" : "current";
  return `<article class="sl-card ${w.ok ? "" : "sl-card-bad"}">
    <header class="sl-head">
      <b>${esc(label)}</b>
      <code class="sl-addr">${esc(w.address)}</code>
      <span class="sl-state sl-${esc(state.split(" ")[0])}">${esc(state)}</span>
    </header>
    ${w.ok ? "" : `<p class="sl-note sl-bad">${esc(w.reason || "read failed")}</p>`}
    ${w.holder ? renderHolder(w.holder) : ""}
    ${w.tokens?.length ? w.tokens.map((t) => renderToken(t)).join("") : w.ok ? '<p class="sl-note sl-none">No SIM token found in this wallet — the NFT is held somewhere else, or it is a mint on another chain.</p>' : ""}
    ${(w.caps || []).map((c) => `<p class="sl-cap">⚠ ${esc(c)}</p>`).join("")}
    ${(w.warnings || []).map((c) => `<p class="sl-cap">⚠ ${esc(c)}</p>`).join("")}
    <details class="sl-prov"><summary>what was checked</summary><ul>${(w.provenance || []).map((p) => `<li>${esc(p)}</li>`).join("") || "<li>—</li>"}</ul></details>
    <p class="sl-foot">checked ${age(w.checkedAt)}${w.cached ? " · cached" : ""}</p>
  </article>`;
}

function renderHolder(h) {
  // A row served from before `ownerList` existed still carries the two parallel
  // arrays — zip them rather than dropping the panel on a cached read.
  const owners = h.ownerList?.length
    ? h.ownerList
    : (h.owners || []).map((address, i) => ({ address, isContract: h.ownersAreContracts?.[i] === true }));
  if (h.kind !== "contract" || !owners.length) return "";
  const need = Number.isFinite(h.threshold) ? `${h.threshold} of ${owners.length}` : "an unknown number of";
  return `<div class="sl-safe">
    <p class="sl-safe-head"><b>${esc(h.name || "contract wallet")}</b> — ${owners.length} owner${owners.length === 1 ? "" : "s"}, ${need} must sign</p>
    <ul class="sl-owners">${owners
      .map((o) => `<li${o.isContract ? ' class="sl-owner-contract"' : ""}><code>${esc(o.address)}</code>${o.isContract ? " · contract" : ""}</li>`)
      .join("")}</ul>
    ${Number.isFinite(h.threshold) ? "" : '<p class="sl-cap">⚠ the Safe threshold could not be read, so the signing rule above is incomplete</p>'}
  </div>`;
}

function renderToken(t) {
  const v = t.verdict || {};
  const tone = VERDICT_TONE[v.state] || "quiet";
  const image = t.image?.ok && t.image.url ? `<img class="sl-thumb" src="${esc(t.image.url)}" alt="SIM #${esc(t.id)}" loading="lazy" referrerpolicy="no-referrer">` : `<div class="sl-thumb sl-thumb-bad" title="image unread">?</div>`;
  const nameBad = t.name && NAME_BAD.has(t.name.state);
  const nameText = t.nameValue || (t.name ? `no name (${t.name.state})` : "name unread");
  const name = nameBad
    ? `<span class="sl-name-bad">${esc(nameText)}</span> <em class="sl-flag">${esc(t.name.detail)}</em>`
    : esc(nameText);

  return `<section class="sl-token sl-tone-${esc(tone)}">
    <div class="sl-token-head">${image}<div>
      <p class="sl-token-name">${name}</p>
      <p class="sl-token-id">#${esc(t.id)} · ${link(t.links?.opensea, "OpenSea item")} · ${link(t.links?.etherscan, "Etherscan")}</p>
    </div><span class="sl-verdict sl-verdict-${esc(tone)}">${esc(v.state || "unknown")}</span></div>

    <ul class="sl-facts">
      <li><span>on chain</span><b>${t.heldOnChain === true ? "held here" : t.heldOnChain === false ? (t.burned ? "burned — nobody holds it" : "not held here") : "unread"}</b></li>
      <li><span>index says</span><b>${t.held === true ? "held here" : t.held === false ? "not here" : "unread"}</b></li>
      <li><span>OpenSea page</span><b>${t.opensea?.indexed === true ? "indexed" : t.opensea?.indexed === false ? "not indexed" : "unread"}</b></li>
      <li><span>image</span><b>${t.image?.ok ? `served (${t.image.type || "binary"}, ${t.image.bytes} bytes)` : t.image?.status ? `HTTP ${t.image.status} — blank in listings` : t.image?.reason ? `unread — ${t.image.reason}` : "unread"}</b></li>
      <li><span>metadata name</span><b>${t.metadata?.read ? (nameBad ? `placeholder (${t.name.state})` : "present") : "unread"}</b></li>
    </ul>

    ${(v.blockers || []).map((b) => `<p class="sl-blocker">✕ ${esc(b)}</p>`).join("")}
    ${(v.notes || []).map((n) => `<p class="sl-note-line">· ${esc(n)}</p>`).join("")}
    ${v.nextStep ? `<p class="sl-next"><b>Do this:</b> ${esc(v.nextStep)}</p>` : ""}
    ${(t.caps || []).map((c) => `<p class="sl-cap">⚠ ${esc(c)}</p>`).join("")}
  </section>`;
}

export function initSimListing() {
  if (!wallets.length) wallets = DEFAULT_WALLETS.filter((w) => !w.dismissable);
  if (!document.getElementById("simListing")) {
    // Own top-level fold, sibling of the asset fold. Nesting inside an existing
    // closed <details> hides the tool while the DOM still looks correct.
    const anchor = document.getElementById("assetViewer")?.closest("details") || document.getElementById("simDesk")?.closest("details") || document.getElementById("glance");
    const fold = document.createElement("details");
    fold.className = "section-fold overview-fold sim-listing-fold";
    fold.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "SIM listing preflight · why OpenSea will not show it";
    const section = document.createElement("section");
    section.id = "simListing";
    section.className = "sim-listing";
    section.setAttribute("aria-labelledby", "simListingTitle");
    if (anchor?.after) anchor.after(fold);
    fold.append(summary, section);
  }
  render();
  refresh();
}

export function renderSimListing() {
  render();
}
