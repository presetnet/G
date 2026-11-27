import test from "node:test";
import assert from "node:assert/strict";
import { renderOverview, renderPackActivity, compactChange, packSalesFeed } from "../public/overview.js";

test("one receipt circuit keeps small sales and spaces labeled repeats for larger amounts", () => {
  const at = new Date().toISOString();
  const signatures = ["A","B","C"].map(c => c.repeat(88));
  const payouts = [0.1, 1, 10].map((sol, i) => ({ at, signature: signatures[i], index: 0, seller: "seller", lamports: sol * 1e9 }));
  const html = packSalesFeed({ ok: true, checkedAt: at, records: [], payouts });
  for (const [i, signature] of signatures.entries()) {
    assert.equal(html.split(`data-receipt="${signature}:0:`).length - 1, i + 1);
  }
  assert.equal(html.split('class="receipt-replay"').length - 1, 3);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Sold card unknown/);
});

test("Baho's ranked artwork is never substituted for another seller's missing image", () => {
  const at = new Date().toISOString();
  const artwork = "https://example.org/baho-art.png";
  const html = packSalesFeed({ ok: true, checkedAt: at, playerArt: { Baho: { url: artwork } },
    profiles: { first: { username: "Baho" }, second: { username: "Other" } },
    payouts: ["first", "second"].map((seller, i) => ({ seller, at, signature: ["A", "B"][i].repeat(88), index: 0, lamports: 100000000 })),
  });
  assert.match(html, /baho-art\.png/);
  assert.doesNotMatch(html.slice(html.indexOf(`data-receipt="${"B".repeat(88)}`)), /<img/);
});

test("overview rejects legacy peak-held supply and separates NFT supply from Solana tokens", () => {
  const original = globalThis.document;
  const nodes = Object.fromEntries(["sourceStrip", "quickFacts", "quickChanges"].map((id) => [id, { innerHTML: "" }]));
  globalThis.document = { getElementById: (id) => nodes[id] };
  try {
    const checkedAt = new Date().toISOString();
    const latest = { sources: {
      "magma.eth": { source: "magma.eth", ok: true, checkedAt, magmaSupply: 9619 },
      "sim.chain": { simSupply: 9999313 },
      "dibzi.names": { source: "dibzi.names", ok: true, checkedAt, namesTotal: 2500, namesReported: 3303, openAuctionsTotal: 1 },
    } };
    renderOverview(latest);
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /9,619/);
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /The Simulation · NFTs/);
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /9,999,313/, "fungible supply must not compete with the NFT watch summary");
    assert.match(nodes.quickFacts.innerHTML, /1 open.*3,303 reported names/);
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /2500 total|2,500 total/);
    latest.sources["magma.eth"] = { ...latest.sources["magma.eth"], magmaSupplyVersion: 2, magmaSupply: 5131 };
    renderOverview(latest);
    assert.match(nodes.quickFacts.innerHTML, /Outstanding supply 5,131/);
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /minted 5,131/);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test("overview rounds long numeric fields without turning tiny amounts into zero", () => {
  assert.equal(compactChange("Supply 1234.56789 → 0.0000004"), "Supply ≈1,234.568 → <0.001");
  assert.equal(compactChange("mint ABC123.456789XYZ"), "mint ABC123.456789XYZ");
  assert.equal(compactChange("Delta -0.0004"), "Delta >-0.001");
});

test("overview pace counts observed receipts in trailing windows and omits missing metrics", () => {
  const original = globalThis.document;
  const nodes = Object.fromEntries(["sourceStrip", "quickFacts", "quickChanges"].map(id => [id, {}]));
  globalThis.document = { getElementById: id => nodes[id] };
  try {
    const at = minutes => new Date(Date.now() - minutes * 60000).toISOString();
    renderOverview({ sources: {
      "trix.packflow": { ok: true, checkedAt: at(0), records: [
        { at: at(2), packs: 3 }, { at: at(45), packs: 4 }, { at: at(65), packs: 20 },
      ], payouts: [{ at: at(4), lamports: 100 }, { at: at(-4), lamports: 500 }] },
      "trix.cardlistings": { ok: true, checkedAt: at(0), count: null },
    } });
    assert.match(nodes.quickFacts.innerHTML, /7 observed \/ 60m.*3 in last 15m/);
    assert.match(nodes.quickFacts.innerHTML, /1 observed \/ 60m.*1 in last 15m/);
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /Card marketplace|unread|null/);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test("activity chart shows bounded observed records and never implies empty bins are zero sales", () => {
  const now = Date.parse("2026-11-17T15:00:00Z");
  const flow = { ok: true, checkedAt: new Date(now).toISOString(), records: [
    { at: new Date(now - 3600000).toISOString(), packs: 2 },
    { at: new Date(now - 25 * 3600000).toISOString(), packs: 20 },
    { at: new Date(now + 1000).toISOString(), packs: 40 },
  ] };
  const html = renderPackActivity(flow, now);
  assert.match(html, /<strong>2<\/strong>/);
  assert.match(html, /partial scan/);
  assert.match(html, /empty bars do not establish zero activity/i);
  assert.match(renderPackActivity(null, now), /No current pack observations/);
});

test("pack signals are prominent, timestamped, and never present stale prices as current", () => {
  const original = globalThis.document;
  const nodes = Object.fromEntries(["sourceStrip", "quickFacts", "quickChanges"].map((id) => [id, { innerHTML: "" }]));
  globalThis.document = { getElementById: (id) => nodes[id] };
  try {
    const checkedAt = new Date().toISOString();
    const gate = { source: "trix.preorder", ok: true, checkedAt, globalState: { canOpen: false }, shop: { open: true, levels: [
      { id: "hype", priceLamports: 850108815 }, { id: "viral", priceLamports: 1700217630 },
    ] } };
    renderOverview({ sources: { "trix.preorder": gate } });
    assert.match(nodes.quickFacts.innerHTML, /Hype \/ Viral/);
    assert.match(nodes.quickFacts.innerHTML, /≈ 0\.850 \/ 1\.700 SOL/);
    assert.match(nodes.quickFacts.innerHTML, /Exact Hype price 0\.850108815 SOL; exact Viral price 1\.700217630 SOL/);
    assert.match(nodes.quickFacts.innerHTML, /Opening disabled/);
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /Geoff documentation/);
    gate.checkedAt = "2020-01-01T00:00:00.000Z";
    renderOverview({ sources: { "trix.preorder": gate } });
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /Hype \/ Viral|Prices unavailable/);
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /0\.850108815 SOL/);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});
