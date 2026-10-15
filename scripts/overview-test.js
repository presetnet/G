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
