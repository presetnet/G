import test from "node:test";
import assert from "node:assert/strict";
import { createPoolVoidHall, normalizeBoard, decimal } from "../server/poolvoid-hall.js";
import { createHandler } from "../api/poolvoid.js";
import { rankPoolRows, renderPoolBadge } from "../public/poolvoid-hall.js";

const address = `0x${"a".repeat(40)}`;
const other = `0x${"b".repeat(40)}`;
const reply = (j, status = 200) => new Response(JSON.stringify(j), { status });
const row = { rank: 1, address, eth: "1.000000000000000001", points: "9007199254740993.1", achievements: 3, transactions: "5" };

test("Hall retains every valid row, discloses omissions, and preserves exact decimal values", () => {
  const rows = Array.from({ length: 130 }, (_, i) => ({ ...row, address: `0x${i.toString(16).padStart(40, '0')}` }));
  const board = normalizeBoard({ items: [...rows, rows[0], { address: "bad" }], hasMore: true });
  assert.equal(board.items.length, 130);
  assert.equal(board.omitted, 2);
  assert.equal(board.hasMore, true);
  assert.equal(board.items[0].points, row.points);
  assert.equal(decimal(null), null);
  assert.equal(decimal("NaN"), null);
  assert.equal(decimal("-9.5"), "-9.5");
});

test("Hall sorts large and fractional numbers exactly and leaves unknown values last", () => {
  const rows = [{ address, points: "9007199254740993.1" }, { address: other, points: "9007199254740993.2" }, { address: "z", points: null }];
  assert.deepEqual(rankPoolRows(rows, "points").map((r) => r.address), [other, address, "z"]);
  assert.equal(rankPoolRows([{ address, eth: "0.100000000000000001" }, { address: other, eth: "0.1" }])[0].address, address);
  assert.equal(rankPoolRows([{ address, points: "-9" }, { address: other, points: "-1" }], "points")[0].address, other);
});

test("Hall caches/coalesces public GETs and retains dated evidence when a source fails", async () => {
  let now = Date.parse('2026-10-28T00:00:00Z'), calls = 0, fail = false;
  const client = createPoolVoidHall({ now: () => now, fetchImpl: async (url, options) => {
    calls++; assert.equal(options.method, undefined);
    if (fail && url.endsWith('/api/leaderboard')) return reply({}, 503);
    return reply(url.endsWith('/api/scoring/rules') ? { rules: [{ id: 1, name: "VOID", enabled: true }], state: { dirty: true } } : { items: [row] });
  } });
  const [first, second] = await Promise.all([client.hall(), client.hall()]);
  assert.equal(calls, 3);
  assert.equal(first.board.checkedAt, second.board.checkedAt);
  assert.equal(first.rules.recalculating, true);
  await client.hall(); assert.equal(calls, 3);
  now += 301_000; fail = true;
  const failed = await client.hall();
  assert.equal(failed.board.ok, false);
  assert.equal(failed.board.stale, true);
  assert.equal(failed.board.checkedAt, first.board.checkedAt);
  assert.equal(failed.board.items[0].eth, row.eth);
  assert.equal(failed.weekly.ok, true);
  assert.match(failed.board.reason, /503/);
});

test("Profile unlocks keep source receipts and identity failures do not invent awards", async () => {
  let calls = 0;
  const client = createPoolVoidHall({ fetchImpl: async (url, options) => {
    calls++; assert.equal(options.method, undefined, 'no receipt POSTs');
    if (url.includes('/identity/')) return reply({}, 503);
    return reply({ profile: { address }, stats: { eth: "2", transactions: "4" }, score: { points: "-12.5", achievement_count: 1 },
      unlocks: [{ id: 7, name: "VOID", kind: "achievement", chain_id: 8453, hash: `0x${'c'.repeat(64)}`, occurrences: 2 }], scoring: { dirty: true } });
  } });
  const p = await client.profile(address);
  assert.equal(calls, 2);
  assert.equal(p.profile.points, '-12.5');
  assert.equal(p.profile.unlocks.length, 1);
  assert.equal(p.identity.ok, false);
  assert.equal(p.profile.recalculating, true);
  assert.match(renderPoolBadge(p.profile.unlocks[0], true), /basescan.org\/tx/);
  assert.doesNotMatch(renderPoolBadge(p.profile.unlocks[0], false), /basescan.org/);
  await assert.rejects(client.profile('https://example.com'), /valid/);
  assert.equal(calls, 2);
});

test("Badge markup escapes source names and refuses unsupported explorer targets", () => {
  const badge = { name: '<img src=x onerror=alert(1)>', kind: 'achievement', tier: 'red" onclick="x', chainId: 999, hash: 'javascript:alert(1)' };
  const html = renderPoolBadge(badge, true);
  assert.doesNotMatch(html, /<img|onclick="|href="javascript/);
  assert.match(html, /&lt;img/);
  assert.match(html, /pvh-tier-neutral/);
});

test("API validates methods, views and addresses before requesting upstream data", async () => {
  let calls = 0;
  const handler = createHandler({ hall: async () => { calls++; return { board: { ok: true }, weekly: { ok: true }, rules: { ok: true } }; }, profile: async () => { calls++; } });
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.code = v; return this; }, json(v) { this.body = v; return this; } };
  await handler({ method: 'POST', query: {} }, res); assert.equal(res.code, 405);
  await handler({ method: 'GET', query: { view: 'other' } }, res); assert.equal(res.code, 400);
  await handler({ method: 'GET', query: { view: 'profile', address: ['bad'] } }, res); assert.equal(res.code, 400);
  assert.equal(calls, 0);
  await handler({ method: 'GET', query: {} }, res); assert.equal(res.code, 200);
  assert.equal(calls, 1); assert.match(res.headers['Cache-Control'], /s-maxage=60/);
});
