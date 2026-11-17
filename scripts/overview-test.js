import test from "node:test";
import assert from "node:assert/strict";
import { renderOverview } from "../public/overview.js";

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
    assert.match(nodes.quickFacts.innerHTML, /Old peak-held counts withheld/);
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /9,999,313/, "fungible supply must not compete with the NFT watch summary");
    assert.match(nodes.quickFacts.innerHTML, /1 open · 3,303 reported names/);
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
    assert.match(nodes.quickFacts.innerHTML, /0\.850108815 SOL \/ 1\.70021763 SOL/);
    assert.match(nodes.quickFacts.innerHTML, /Opening disabled/);
    assert.ok(nodes.quickFacts.innerHTML.indexOf("TRIX pack shop") < nodes.quickFacts.innerHTML.indexOf("Geoff documentation"));
    gate.checkedAt = "2020-01-01T00:00:00.000Z";
    renderOverview({ sources: { "trix.preorder": gate } });
    assert.match(nodes.quickFacts.innerHTML, /Prices unavailable/);
    assert.doesNotMatch(nodes.quickFacts.innerHTML, /0\.850108815 SOL/);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});
