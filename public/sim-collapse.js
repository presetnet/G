// This panel stores no wallet, token ID, or transaction history. Only the
// public recipe table loads automatically; receipts require an explicit lookup.
const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const link = (url, label) => /^https:\/\/(?:etherscan\.io|opensea\.io)\//.test(url || "")
  ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : esc(label);
const stamp = (value) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "unknown time";
let root;
let recipeData = null;
let recipeBusy = false;
let decodeId = 0;
let activeDecode = null;

function originalTypes(ids) {
  return ids.length === 8 && ["1", "2", "3", "4", "5", "6", "7", "8"].every((id) => ids.includes(id));
}
function inputRule(f, types) {
  if (f.mode === 2) return f.inputTypes.map((id, i) => `${f.counts[i]} × ${types[id] || `TYPE ${id}`}`).join(" + ");
  if (f.inputTypes.length === 1) return `${f.quantity} × ${types[f.inputTypes[0]] || `TYPE ${f.inputTypes[0]}`}`;
  const pool = originalTypes(f.inputTypes) ? "originals" : f.inputTypes.map((id) => types[id] || `TYPE ${id}`).join(" / ");
  return `${f.quantity} ${pool} · ${f.mode === 1 ? "all the same TYPE" : "mixed TYPEs allowed"}`;
}
function recipeTable(rows, types) {
  if (!rows.length) return '<p class="sc-note">None reported.</p>';
  return `<div class="sc-table-wrap"><table class="sc-table"><thead><tr><th>Burn</th><th>Receive one</th><th>Formula</th></tr></thead><tbody>${rows.map((f) => {
    const total = f.weights.reduce((sum, w) => sum + w, 0);
    const outputs = f.outputTypes.map((id, i) => `${esc(types[id] || `TYPE ${id}`)}${f.outputTypes.length > 1 ? ` (${(100 * f.weights[i] / total).toFixed(2)}%)` : ""}`).join(" / ");
    const inputs = f.inputTypes.map((id) => types[id] || `TYPE ${id}`).join(", ");
    return `<tr><td title="Allowed TYPEs: ${esc(inputs)}">${esc(inputRule(f, types))}</td><td><b>${outputs}</b></td><td>#${esc(f.id)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}
function renderRecipes(error = null) {
  const target = root.querySelector("#scRecipes");
  if (!recipeData) {
    target.innerHTML = `<p class="sc-note${error ? " sc-error" : ""}">${esc(error || "Reading the active recipes and fee from Ethereum…")}</p>`;
    return;
  }
  const r = recipeData;
  const sorted = [...r.formulas].sort((a, b) => a.quantity - b.quantity || Number(a.id) - Number(b.id));
  target.innerHTML = `${error ? `<p class="sc-error">Refresh failed: ${esc(error)}. The table below is the previous snapshot.</p>` : ""}
    <p class="sc-fee"><b>${esc(r.feeEth)} ETH</b> collapse fee per transaction <span>+ network gas</span></p>
    <p class="sc-note">Fee and recipe availability can change. Checked ${esc(stamp(r.checkedAt))} · block ${esc(r.block)}${r.cached ? " · cached ≤ 60s" : ""}.</p>
    ${recipeTable(sorted.filter((f) => f.active), r.types)}
    <details class="sc-disabled"><summary>Disabled recipes (${sorted.filter((f) => !f.active).length})</summary>${recipeTable(sorted.filter((f) => !f.active), r.types)}</details>
    <p class="sc-note">Original TYPEs: ${["1", "2", "3", "4", "5", "6", "7", "8"].map((id) => esc(r.types[id] || `TYPE ${id}`)).join(", ")}.</p>
    <p class="sc-note">ENIGMA and EN1GMA are different TYPE names. An upgraded token is eligible only when a recipe explicitly includes its TYPE. ${link(r.source, "Read the contract")}</p>`;
}
async function refreshRecipes() {
  if (recipeBusy) return;
  recipeBusy = true;
  const button = root.querySelector("#scRefresh");
  button.disabled = true;
  button.textContent = "Reading recipes…";
  try {
    const response = await fetch(`/api/sim-collapse${recipeData ? "?refresh=1" : ""}`, { signal: AbortSignal.timeout(55_000) });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
    recipeData = data;
    renderRecipes();
  } catch (e) { renderRecipes(e.message); }
  finally { recipeBusy = false; button.disabled = false; button.textContent = "Reload recipes"; }
}

function batchCard(batch) {
  const o = batch.output;
  const t = o.traits;
  return `<section class="sc-batch">
    <h4>${esc(batch.quantity)} burned → ${link(o.url, `${o.name || "TYPE unread"} #${o.id}`)}</h4>
    <p class="sc-note">Formula #${esc(batch.formulaId)} · each input below was burned in this batch.</p>
    <ul class="sc-burn-list">${batch.burns.map((b) => `<li><b>${esc(b.name || "TYPE unread")}</b><span>#${esc(b.id)}</span>${b.reason ? `<small>${esc(b.reason)}</small>` : ""}</li>`).join("")}</ul>
    <div class="sc-mix">${batch.typeCounts.map((t) => `<span>${esc(t.count)} × ${esc(t.name)}</span>`).join("")}</div>
    ${t ? `<dl class="sc-traits"><div><dt>MEMETIC</dt><dd>${esc(t.memetic)}</dd></div><div><dt>CONSENSUS</dt><dd>${esc(t.consensus)}</dd></div><div><dt>INTENT</dt><dd>${esc(t.intent)}</dd></div><div><dt>OBSERVE</dt><dd>${t.observe ? "true" : "false"}</dd></div><div><dt>ANOMALY</dt><dd>${t.anomaly ? "yes" : "no"}</dd></div></dl>` : ""}
    <p class="sc-note">${o.traitProof === "matched" ? "Output seed and all six traits independently reproduced from the mint recipient + output ID." : o.traitProof === "mismatch" ? "Trait prediction did not match the chain." : "Output trait prediction could not be verified."}</p>
    ${batch.warnings.map((w) => `<p class="sc-warning">${esc(w)}</p>`).join("")}
  </section>`;
}
function renderResults(results) {
  const seen = new Set();
  const unique = results.filter((r) => {
    if (!r.ok) return true;
    if (seen.has(r.tx)) return false;
    seen.add(r.tx);
    return true;
  });
  const good = unique.filter((r) => r.ok);
  const batches = good.flatMap((r) => r.batches);
  root.querySelector("#scResults").innerHTML = `${batches.length ? `<p class="sc-score"><b>${batches.reduce((sum, b) => sum + b.quantity, 0)} inputs → ${batches.length} outputs</b> · ${good.length} verified transaction${good.length === 1 ? "" : "s"}</p>` : ""}${unique.map((r) => r.ok
    ? `<article class="sc-receipt"><header><b>Receipt verified</b> ${link(r.source, `${r.tx.slice(0, 10)}…${r.tx.slice(-6)}`)}</header>
      <p class="sc-note">Block ${esc(r.block)} · input TYPEs read at block ${esc(r.historicalBlock)}.</p>
      <div class="sc-batches">${r.batches.map(batchCard).join("")}</div>
      <p class="sc-cost">${r.directCollapse ? "Collapse payment" : "Whole transaction value"}: ${esc(r.transactionValueEth)} ETH · whole transaction gas: ${esc(r.gasEth ?? "unavailable")} ETH.</p>
      <p class="sc-note">These are transaction costs, not the purchase cost or market value of the NFTs.</p></article>`
    : `<p class="sc-error">${esc(r.lookup)}: ${esc(r.error)}</p>`).join("")}`;
}
function clearLookups() {
  ++decodeId;
  activeDecode?.abort();
  activeDecode = null;
  root.querySelector("#scInput").value = "";
  root.querySelector("#scDecode").disabled = false;
  root.querySelector("#scDecode").textContent = "Decode batches";
  root.querySelector("#scResults").innerHTML = '<p class="sc-note">Paste a collapse transaction hash or output token ID to recover its exact burn batch.</p>';
}
async function decodeLookups(event) {
  event.preventDefault();
  const items = root.querySelector("#scInput").value.trim().split(/[,\s]+/).filter(Boolean);
  if (!items.length || items.length > 4 || items.some((v) => !/^(?:0x[0-9a-f]{64}|#?[1-9]\d{0,17})$/i.test(v))) {
    root.querySelector("#scResults").innerHTML = '<p class="sc-error">Enter 1–4 full transaction hashes or output token IDs, separated by commas or spaces. No wallet address is needed.</p>';
    return;
  }
  const id = ++decodeId;
  activeDecode?.abort();
  const controller = new AbortController();
  activeDecode = controller;
  const timer = setTimeout(() => controller.abort(), 55_000);
  const button = root.querySelector("#scDecode");
  button.disabled = true;
  button.textContent = "Decoding…";
  root.querySelector("#scResults").innerHTML = '<p class="sc-note">Checking receipts, burn events, and pre-burn TYPEs…</p>';
  try {
    const res = await fetch("/api/sim-collapse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }), signal: controller.signal });
    const data = await res.json();
    if (id !== decodeId) return;
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    renderResults(data.results);
  } catch (e) {
    if (id === decodeId) root.querySelector("#scResults").innerHTML = `<p class="sc-error">${esc(e.message)}</p>`;
  } finally {
    clearTimeout(timer);
    if (id === decodeId) { activeDecode = null; button.disabled = false; button.textContent = "Decode batches"; }
  }
}

export function initSimCollapse() {
  if (document.getElementById("simCollapse")) return;
  const fold = document.createElement("details");
  fold.className = "section-fold overview-fold sc-fold";
  fold.open = true;
  fold.innerHTML = `<summary>SIM burn → upgrade · recipes & collapse decoder</summary><section id="simCollapse" class="sim-collapse" aria-labelledby="scTitle">
    <div class="desk-toolbar"><h3 id="scTitle">Burn → upgrade</h3><p>Live recipes and exact burn batches. Read-only; no wallet connection, saved addresses, or saved lookup history.</p></div>
    <div class="sc-layout"><section><div class="sc-subhead"><h4>Current recipes</h4><button type="button" id="scRefresh">Reload recipes</button></div><div id="scRecipes" aria-live="polite"><p class="sc-note">Reading recipes…</p></div></section>
    <section><h4>What went into a collapse?</h4><form id="scForm" class="sc-form"><label for="scInput">Transaction hashes or output token IDs · up to four</label><textarea id="scInput" rows="2" autocomplete="off" spellcheck="false" placeholder="Paste 0x… transaction hashes or output token IDs"></textarea><div><button id="scDecode" type="submit">Decode batches</button><button id="scClear" type="button">Clear lookups</button></div></form><div id="scResults" aria-live="polite"><p class="sc-note">Each result lists the burned names and IDs together under the output they created.</p></div></section></div>
    <details class="sc-mechanics"><summary>What determines the upgrade and its traits?</summary><p>The chosen formula defines the output TYPE pool. Your input token IDs, rarity and other traits do not enter the output seed; they only have to meet the recipe.</p><p>Seed = keccak256(abi.encode(chain ID, collection, mint recipient, new token ID)). Secondary traits are deterministic. Another mint or collapse can advance the shared token counter before your transaction lands. Direct minting is owner-only.</p><p>Existing TYPE names are intentional, including UNDEFINED. New recipes and fee changes can be introduced by the owner. This panel reads the current state rather than assuming yesterday’s rules.</p></details>
  </section>`;
  const anchor = document.getElementById("assetViewer")?.closest("details") || document.getElementById("simDesk")?.closest("details");
  if (anchor) anchor.before(fold);
  else (document.querySelector("main") || document.body).append(fold);
  root = fold.querySelector("#simCollapse");
  root.querySelector("#scRefresh").addEventListener("click", refreshRecipes);
  root.querySelector("#scForm").addEventListener("submit", decodeLookups);
  root.querySelector("#scClear").addEventListener("click", clearLookups);
  const reveal = () => {
    if (location.hash === "#simCollapse") { fold.open = true; root.scrollIntoView({ block: "start" }); }
  };
  window.addEventListener("hashchange", reveal);
  document.querySelector('a[href="#simCollapse"]')?.addEventListener("click", () => {
    fold.open = true;
    requestAnimationFrame(() => root.scrollIntoView({ block: "start" }));
  });
  requestAnimationFrame(reveal);
  refreshRecipes();
}
