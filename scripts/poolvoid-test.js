import test from "node:test";
import assert from "node:assert/strict";
import { sniffPoolVoid } from "../server/sniffer.js";
import { renderPoolVoid } from "../public/poolvoid.js";

test("Pool Void preserves reported counts and separates partial transfer failures", async () => {
  const original = globalThis.fetch;
  let failTransfers = false;
  globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith('/api/status')
    ? { configured: true, counts: { eth: "123.123456789123456789", wallets: "12", transfers: null }, targets: [{ chain_id: 8453, name: "void.eth", backfill_complete: true, enabled: true }] }
    : failTransfers ? {} : { items: [{ chain_id: 8453, hash: `0x${'a'.repeat(64)}`, asset: "ETH", value: "0.001" }, { chain_id: 99, hash: "bad" }], hasMore: true }), { status: failTransfers && !String(url).endsWith('/api/status') ? 503 : 200 });
  try {
    const s = await sniffPoolVoid();
    assert.equal(s.ok, true);
    assert.equal(s.counts.eth, "123.123456789123456789");
    assert.equal(s.counts.transfers, null);
    assert.equal(s.items.length, 1);
    assert.equal(s.targets[0].chainId, 8453);
    failTransfers = true;
    const partial = await sniffPoolVoid();
    assert.equal(partial.ok, true);
    assert.equal(partial.transfersOk, false);
    assert.match(partial.reason, /unavailable/);
  } finally { globalThis.fetch = original; }
});

test("Pool Void UI labels unavailable data, escapes upstream text and links the right chain", () => {
  const original = globalThis.document;
  const root = { innerHTML: "" };
  globalThis.document = { getElementById: () => root };
  try {
    renderPoolVoid(null);
    assert.match(root.innerHTML, /Awaiting a current read/);
    assert.match(root.innerHTML, /not zero activity/);
    renderPoolVoid({ ok: true, checkedAt: new Date().toISOString(), transfersOk: true,
      items: [{ chainId: 8453, hash: `0x${'a'.repeat(64)}`, asset: '<script>', target: 'void.eth', value: '1' }] });
    assert.match(root.innerHTML, /basescan.org\/tx/);
    assert.match(root.innerHTML, /&lt;script&gt;/);
    assert.doesNotMatch(root.innerHTML, /<script>/);
  } finally { if (original === undefined) delete globalThis.document; else globalThis.document = original; }
});
