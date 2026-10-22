const esc = (value) => String(value ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const number = (value) => value == null ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 });
const time = (value) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "not reported";
const chain = (id) => id === 8453 ? "Base" : "Ethereum";

export function renderPoolVoid(source) {
  const root = document.getElementById("poolVoidArchive");
  if (!root) return;
  const scrollTop = root.querySelector?.(".pv-feed")?.scrollTop || 0;
  const proofOpen = root.querySelector?.(".pv-proof")?.open || false;
  const expired = !Number.isFinite(Date.parse(source?.checkedAt)) || Date.now() - Date.parse(source.checkedAt) > 30 * 60_000;
  const stale = source?.stale || !source?.ok || expired;
  const counts = source?.counts || {};
  const metrics = [["ETH indexed", "eth"], ["Transfers", "transfers"], ["Transactions", "transactions"], ["Wallets", "wallets"]];
  root.innerHTML = `<header class="pv-header"><div><p class="pv-eyebrow">Cross-chain archive · Ethereum + Base</p><h3>Into the void<span>.</span></h3><p>Pool Void’s public archive, alongside the Solana receipt ledger.</p></div><a href="https://poolvoid.app/#void" target="_blank" rel="noopener noreferrer">Explore Pool Void ↗</a></header>
    <div class="pv-metrics">${metrics.map(([label, key]) => `<div><span>${label}</span><strong>${esc(number(counts[key]))}</strong><small>Source-reported${stale ? " · not current" : ""}</small></div>`).join("")}</div>
    <p class="pv-clock">${stale ? "Awaiting a current read" : "Last checked"} · ${esc(time(source?.checkedAt))}${source?.reason ? ` · ${esc(source.reason)}` : ""}</p>
    <div class="pv-targets">${(source?.targets || []).map((t) => `<div><b>${esc(t.name)}</b><span>${chain(t.chainId)} · ${!t.enabled ? "paused" : t.backfillComplete ? "backfill reported complete" : "backfill in progress"}</span><small>Synced ${esc(time(t.syncedAt))}</small></div>`).join("")}</div>
    <div class="pv-feed-head"><h4>Latest indexed transfers</h4><span>Up to 12 records · not full history</span></div>
    ${source?.transfersOk ? `<div class="pv-feed">${(source.items || []).map((r) => `<a href="https://${r.chainId === 8453 ? "basescan.org" : "etherscan.io"}/tx/${encodeURIComponent(r.hash)}" target="_blank" rel="noopener noreferrer"><span class="pv-chain">${chain(r.chainId)}</span><span><b>${esc(r.asset || r.category)}</b> → ${esc(r.target)}<small>${esc(time(r.at))}</small></span><strong>${esc(number(r.value))} ↗</strong></a>`).join("") || '<p>No records in this response.</p>'}</div>` : '<p class="desk-context">Recent transfers are unavailable; this is not zero activity.</p>'}
    <details class="pv-proof"><summary>Sources & coverage</summary><p>These are Pool Void’s indexed counts, not independently verified totals or proof of irreversible burning. Ethereum and Base activity stays separate from TRIX’s Solana deposits. Source-reported backfill completion is not a guarantee of exhaustive coverage.</p><p><a href="https://poolvoid.app/api/status" target="_blank" rel="noopener noreferrer">Status JSON ↗</a> · <a href="https://poolvoid.app/api/transfers?target=all&category=all" target="_blank" rel="noopener noreferrer">Transfers JSON ↗</a></p><code>curl 'https://poolvoid.app/api/status'</code><br><code>curl 'https://poolvoid.app/api/transfers?target=all&amp;category=all'</code></details>`;
  const feed = root.querySelector?.(".pv-feed");
  if (feed) feed.scrollTop = scrollTop;
  const proof = root.querySelector?.(".pv-proof");
  if (proof) proof.open = proofOpen;
}
