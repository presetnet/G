import assert from "node:assert/strict";
import { sourceDescription } from "../public/provenance.js";

const now = Date.parse("2026-09-05T12:00:00Z");
const describe = (source) => sourceDescription("stacknet.health", source, now);
assert.match(describe(undefined), /source missing.*outcome unknown/);
assert.match(describe({ ok: true, takenAt: "2026-09-05T12:00:00Z" }), /age unknown/);
assert.match(describe({ ok: false, checkedAt: "2026-09-05T12:00:00Z" }), /check failed; NOT fresh/);
assert.match(describe({ ok: true, cached: true, checkedAt: "2026-09-05T11:00:00Z" }), /cached; no new source check/);
assert.match(describe({ ok: true, checkedAt: "2026-09-05T11:00:00Z" }), /older than 20 min/);
assert.doesNotMatch(describe({ ok: true, checkedAt: "2026-09-05T11:40:00Z" }), /older than 20 min/);
assert.match(describe({ ok: true, checkedAt: "2026-09-05T12:01:00Z" }), /clock mismatch/);
assert.match(describe({ ok: true, checkedAt: "not a date" }), /age unknown/);
assert.match(describe({ ok: true, skipped: true }), /NOT a fresh check/);
assert.match(sourceDescription("solana.tokens", {
  ok: false, checkedAt: "2026-09-05T12:00:00Z", mintsCheckedAt: "2026-09-05T10:00:00Z",
}, now), /Mint values.*cached\/last-known; 2 hr/);
console.log("provenance: all assertions passed");
