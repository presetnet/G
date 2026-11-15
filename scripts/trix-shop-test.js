import test from "node:test";
import assert from "node:assert/strict";
import { parseTrixShop } from "../server/sniffer.js";
import { renderPackShop } from "../public/trix-shop.js";

test("pack shop preserves exact price and fee fields, unknowns and disabled opening", () => {
  const shop = parseTrixShop({ open: true, levels: [
    { id: "base", name: "Base Pack", priceLamports: 340043526, mintFeeLamports: 30000000 },
    { id: "hype", name: "Hype Pack", priceLamports: 850108815, mintFeeLamports: 30000000 },
    { id: "unknown", name: "<script>", priceLamports: null, mintFeeLamports: -1 },
  ] });
  const source = { shop, ok: true, checkedAt: new Date().toISOString(), globalState: { canOpen: false } };
  const html = renderPackShop(source);
  assert.match(html, /Hype Pack/);
  assert.match(html, /0\.850108815 SOL/);
  assert.match(html, /0\.03 SOL/);
  assert.match(html, /Disabled/);
  assert.match(html, /Not reported/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(shop.levels[2].priceLamports, null);
  assert.equal(renderPackShop({ ...source, stale: true }), "");
  assert.equal(renderPackShop({ ...source, checkedAt: "2020-01-01" }), "");
  assert.equal(parseTrixShop(null), null);
});
