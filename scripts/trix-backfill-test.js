// Run: node scripts/trix-backfill-test.js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../server/config.js";
import {
  collectTrixArtworkCursorPages,
  fetchTrixArtworkCursorPage,
  loadTrixArtworkArchive,
  mergeTrixArtworkArchive,
  saveTrixArtworkArchive,
  summarizeTrixArtworkArchive,
} from "../server/trix-feeds.js";

const pages = new Map([
  ["", {
    items: [
      { id: "a1", name: "One", imageUrl: "/one.png", createdAt: "2026-09-13T03:00:00Z", printedSupply: "1" },
      { id: "a2", name: "Two", imageUrl: "https://cdn.test/two.png", createdAt: "2026-09-13T02:00:00Z" },
    ],
    nextCursor: "c1",
  }],
  ["c1", {
    items: [
      { id: "a2", name: "Two Duplicate", imageUrl: "/two.png", createdAt: "2026-09-13T02:00:00Z" },
      { id: "a3", name: "Three", imageUrl: "/three.png", createdAt: "2026-09-13T01:00:00Z" },
    ],
    nextCursor: "c2",
  }],
  ["c2", { items: [], nextCursor: null }],
]);

function fixtureFetch(map = pages) {
  const requests = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    requests.push(url.href);
    const cursor = url.searchParams.get("cursor") || "";
    const payload = map.get(cursor);
    if (payload instanceof Error) throw payload;
    if (payload === "malformed") return { ok: true, status: 200, text: async () => JSON.stringify({ nope: true }) };
    if (payload === "bad-json") return { ok: true, status: 200, text: async () => "not json" };
    if (!payload) return { ok: false, status: 404, text: async () => JSON.stringify({ message: "not found" }) };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  fetchImpl.requests = requests;
  return fetchImpl;
}

const page = await fetchTrixArtworkCursorPage({ fetchImpl: fixtureFetch(), pageSize: 2 });
assert.equal(page.ok, true);
assert.equal(page.items.length, 2);
assert.equal(page.items[0].id, "a1");
assert.equal(page.items[0].imageUrl, "https://www.trix.market/one.png");
assert.equal(page.items[0].printedSupply, 1);
assert.equal(page.nextCursor, "c1");

const fetchImpl = fixtureFetch();
const collected = await collectTrixArtworkCursorPages({ fetchImpl, pageSize: 2, maxPages: 3 });
assert.equal(collected.ok, true);
assert.equal(collected.pagesFetched, 3);
assert.equal(collected.completed, true);
assert.equal(collected.stoppedReason, "terminal-page");
assert.deepEqual(collected.items.map((item) => item.id), ["a1", "a2", "a3"]);
assert.equal(fetchImpl.requests[0], "https://www.trix.market/api/artworks?pageSize=2");
assert.match(fetchImpl.requests[1], /cursor=c1/);

const partial = await collectTrixArtworkCursorPages({ fetchImpl: fixtureFetch(), pageSize: 2, maxPages: 1 });
assert.equal(partial.completed, false);
assert.equal(partial.stoppedReason, "page-budget-exhausted");
assert.equal(partial.nextCursor, "c1");

const repeatMap = new Map([["", { items: [{ id: "r1", createdAt: "2026-09-13T00:00:00Z" }], nextCursor: "again" }], ["again", { items: [{ id: "r2" }], nextCursor: "again" }]]);
const repeat = await collectTrixArtworkCursorPages({ fetchImpl: fixtureFetch(repeatMap), maxPages: 3 });
assert.equal(repeat.ok, false);
assert.equal(repeat.stoppedReason, "repeated-cursor");

await assert.rejects(
  () => fetchTrixArtworkCursorPage({ fetchImpl: fixtureFetch(new Map([["", "malformed"]])) }),
  /missing items array/,
);
await assert.rejects(
  () => fetchTrixArtworkCursorPage({ fetchImpl: fixtureFetch(new Map([["", "bad-json"]])) }),
  /missing items array/,
);
await assert.rejects(
  () => fetchTrixArtworkCursorPage({ fetchImpl: fixtureFetch(new Map()) }),
  /HTTP 404/,
);

const archive = mergeTrixArtworkArchive(await loadTrixArtworkArchive({ file: "test-trix-artworks-history.json" }), partial, { now: "2026-09-13T04:00:00Z" });
assert.equal(archive.items.length, 2);
assert.equal(archive.nextCursor, "c1");
assert.equal(archive.completed, false);
assert.equal(archive.items[0].createdAt, "2026-09-13T03:00:00.000Z");
const rerun = mergeTrixArtworkArchive(archive, partial, { now: "2026-09-13T04:05:00Z" });
assert.equal(rerun.items.length, 2);
assert.equal(rerun.items[0].fetchedAt, archive.items[0].fetchedAt);

const file = "test-trix-artworks-history.json";
try { await fs.unlink(path.join(config.dataDir, file)); } catch {}
await saveTrixArtworkArchive(rerun, { file });
const loaded = await loadTrixArtworkArchive({ file });
assert.equal(loaded.items.length, 2);
assert.deepEqual(summarizeTrixArtworkArchive(loaded), {
  count: 2,
  oldestCreatedAt: "2026-09-13T02:00:00.000Z",
  newestCreatedAt: "2026-09-13T03:00:00.000Z",
  nextCursor: "c1",
  completed: false,
  updatedAt: "2026-09-13T04:05:00.000Z",
  pagesFetched: 2,
});
await fs.unlink(path.join(config.dataDir, file));

console.log("trix backfill: cursor, validation, persistence and idempotency assertions passed");
