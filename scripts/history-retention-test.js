import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBundle, archiveEvents, loadSharedBundle } from "../server/shared-store.js";
import { filterEvidence } from "../public/evidence.js";
import { docsView, renderWorkspace } from "../public/workspace.js";
import { recoverMissingHistory } from "../server/history-recovery.js";

test("a multi-day outage preserves the storage baseline but never revives live values", () => {
  const at = new Date(Date.now() - 3 * 86400000).toISOString();
  const docs = { source: "geoff.docs.surface", ok: true, checkedAt: at, total: 2,
    publishedModelLayers: ["documented-model"], pages: [
      { id: "models", path: "/introduction/models", label: "<unsafe>", ok: true },
      { id: "files", path: "/api-reference/files", ok: false, status: 404 },
    ] };
  const event = { id: "old", kind: "docs", at, title: "Old observation" };
  const stored = normalizeBundle({ latest: { takenAt: at, sources: { "geoff.docs.surface": docs } },
    events: [event], state: { startedAt: at, pollCount: 98018, lastPollAt: at } });
  assert.equal(stored.state.pollCount, 98018);
  assert.equal(stored.latest.sources["geoff.docs.surface"].pages.length, 2);
  assert.equal(stored.events.length, 0);
  assert.equal(stored.historicalEvents.length, 1);
  const display = filterEvidence(stored.latest);
  assert.equal(display.sources["geoff.docs.surface"].pages, undefined);
  const view = docsView(display.sources["geoff.docs.surface"], null, [], display.historicalSources["geoff.docs.surface"]);
  assert.equal(view.available, false);
  assert.equal(view.historical, true);
  assert.equal(view.pages.length, 2);
  assert.deepEqual(view.missingFromCatalog, []);
  assert.equal(view.observation.checkedAt, at);

  const ids = ["docsDesk", "workspaceHealth", "docsOverview", "docsPageCount", "docsPages", "docsChanges", "miningEvidence", "sourceIssues", "historicalSources", "historicalEvents"];
  const nodes = Object.fromEntries(ids.map((id) => [id, { innerHTML: "" }]));
  const prior = globalThis.document;
  globalThis.document = { getElementById: (id) => nodes[id] || null };
  try {
    renderWorkspace(display, [], stored.historicalEvents, stored.state);
    assert.match(nodes.docsOverview.innerHTML, /Historical observation/);
    assert.match(nodes.docsPages.innerHTML, /Last read: Responding/);
    assert.match(nodes.docsPages.innerHTML, /&lt;unsafe&gt;/);
    assert.doesNotMatch(nodes.docsPages.innerHTML, /<unsafe>/);
    assert.match(nodes.historicalEvents.innerHTML, /Old observation/);
  } finally { globalThis.document = prior; }
});

test("historical event archive deduplicates, excludes future dates and retains only 30 days", () => {
  const event = { id: "one", at: new Date(Date.now() - 2 * 86400000).toISOString() };
  assert.deepEqual(archiveEvents([event, event, { id: "ancient", at: "2020-01-01" },
    { id: "future", at: "2099-01-01" }]), [event]);
  const first = normalizeBundle({ events: [event] });
  assert.deepEqual(normalizeBundle(first).historicalEvents, first.historicalEvents);
});

test("backup recovery fills missing sources without replacing current data or ledger", () => {
  const oldAt = new Date(Date.now() - 3 * 86400000).toISOString();
  const liveAt = new Date().toISOString();
  const ledger = { version: 1, records: [] };
  const current = { latest: { takenAt: liveAt, sources: { market: { checkedAt: liveAt, value: 2 } } }, voidLedger: ledger, state: { pollCount: 9 } };
  const backup = { latest: { takenAt: oldAt, sources: { market: { checkedAt: oldAt, value: 1 }, docs: { checkedAt: oldAt, pages: ["old"] } } } };
  const { bundle, recoveredSources } = recoverMissingHistory(current, backup);
  assert.deepEqual(recoveredSources, ["docs"]);
  assert.equal(bundle.latest.sources.market.value, 2);
  assert.equal(bundle.latest.sources.docs.checkedAt, oldAt);
  assert.equal(bundle.latest.takenAt, liveAt);
  assert.equal(bundle.voidLedger, ledger);
  assert.equal(bundle.state.pollCount, 9);
  assert.equal(current.latest.sources.docs, undefined);
});

test("storage outages fail closed instead of seeding a fresh empty collector", async () => {
  const originalFetch = globalThis.fetch;
  const env = { UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN };
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-only";
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw Error("store offline"); };
    await assert.rejects(loadSharedBundle(), /store offline/);
    assert.equal(calls, 1, "Redis failure must not fall through to a potentially different baseline");
    globalThis.fetch = async (url) => {
      if (url === "https://redis.invalid") return { ok: true, json: async () => ({ result: null }) };
      return { ok: false, status: 503 };
    };
    await assert.rejects(loadSharedBundle(), /github contents HTTP 503/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
