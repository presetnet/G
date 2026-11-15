const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sol = (value) => Number.isSafeInteger(value) && value >= 0
  ? `${(value / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL` : "Not reported";

export function renderPackShop(source) {
  const shop = source?.shop;
  if (!shop || source.ok !== true || source.stale) return "";
  const time = Date.parse(source.checkedAt);
  if (!Number.isFinite(time) || Date.now() - time > 20 * 60000 || time > Date.now()) return "";
  const opening = source.globalState?.canOpen;
  return `<section aria-label="TRIX public pack shop"><h4 class="board-subhead">Pack shop · ${shop.open === true ? "Open" : shop.open === false ? "Closed" : "Status unknown"}</h4>
    <p class="desk-context">Opening: <b>${opening === true ? "Enabled" : opening === false ? "Disabled" : "Unknown"}</b> · source checked <time datetime="${esc(source.checkedAt)}">${esc(new Date(time).toISOString())}</time></p>
    <div class="box-board-grid">${(shop.levels || []).map((pack) => `<article><h3>${esc(pack.name)}</h3><p><b>${sol(pack.priceLamports)}</b> · reported pack price</p><p>Mint fee field: <b>${sol(pack.mintFeeLamports)}</b></p></article>`).join("") || '<p class="desk-context">No pack tiers reported.</p>'}</div>
    <p class="desk-context">API price and mint fee are shown separately; checkout totals have not been verified. Public shop state does not establish wallet eligibility, card contents, or conversion of legacy boxes.</p>
    <p class="desk-context"><a href="https://www.trix.market/shop" target="_blank" rel="noopener noreferrer">Official shop ↗</a> · <a href="https://www.trix.market/api/mkt/g" target="_blank" rel="noopener noreferrer">Public gate API ↗</a></p></section>`;
}
