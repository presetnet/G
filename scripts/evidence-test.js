import assert from "node:assert/strict";
import { evidenceState, filterEvidence, EVIDENCE_WINDOW } from "../public/evidence.js";
import { summarizeSnapshot } from "../server/sniffer.js";
const now = Date.now();
const old = new Date(now - EVIDENCE_WINDOW - 1).toISOString();
const current = new Date(now).toISOString();
const snapshot = { takenAt: current, summary: { pile: 999 }, sources: {
  "stacknet.pile": { ok: false, status: 401, checkedAt: old, pile: 999 },
  "dibzi.names": { ok: true, status: 200, checkedAt: current, namesTotal: 12 },
  "trix.boxboard": { ok: true, checkedAt: current, dataUpdatedAt: old, mintedTotal: 100 },
}};
const filtered = filterEvidence(snapshot, now);
assert.equal(filtered.sources["stacknet.pile"].pile, undefined);
assert.equal(filtered.sources["trix.boxboard"].mintedTotal, undefined);
assert.equal(filtered.sources["dibzi.names"].namesTotal, 12);
assert.equal(snapshot.sources["stacknet.pile"].pile, 999);
assert.equal(summarizeSnapshot(filtered.sources, current).pile, null);
assert.equal(evidenceState({ ok: false, status: 401, checkedAt: current }, now), "ACCESS REQUIRED");
assert.equal(evidenceState({ ok: true }, now), "UNAVAILABLE");
console.log("PASS: source expiry, underlying data age, access status, immutable filtering and derived summary");
