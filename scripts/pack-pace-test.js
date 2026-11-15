import test from "node:test";
import assert from "node:assert/strict";
import { packPace, packLabel } from "../public/pack-pace.js";

test("pack pace uses timestamped receipt growth, not cumulative totals or polling frequency", () => {
  const now = Date.now();
  const chain = (at, receipts) => ({ engine: "receipts", program: "p", packConfig: "c", updatedAt: new Date(at).toISOString(), receipts });
  let pace = packPace(chain(now - 3600000, 8500), [], now - 3600000);
  assert.equal(pace.perHour, null);
  for (let i = 1; i <= 4; i++) pace = packPace(chain(now - 3600000 + i * 900000, 8500 + i * 20), pace.samples, now - 3600000 + i * 900000);
  assert.equal(pace.perHour, 80);
  assert.equal(pace.delta, 80);
  const same = packPace(chain(now, 8580), pace.samples, now);
  assert.equal(same.samples.length, pace.samples.length);
  assert.equal(same.perHour, 80);
  assert.equal(packPace(chain(now, 8580), pace.samples, now + 21 * 60000).perHour, null);
  assert.equal(packPace(chain(now + 60000, 8000), pace.samples, now + 60000).perHour, null);
  assert.equal(packPace(chain(now + 60000, 8000), pace.samples, now + 60000).samples.length, 1);
  assert.equal(packPace(chain(now, null), pace.samples, now).perHour, null);
  assert.equal(packPace(chain(now, 8580), [pace.samples[0]], now).perHour, null, "hour-long outage is not continuous coverage");
  assert.equal(packPace(chain(now + 60000, 8580), pace.samples, now).perHour, null);
  assert.equal(packLabel("BASE BOX / boxes"), "BASE Pack / Packs");
});

test("a measured zero is distinct from unavailable and short windows warm up", () => {
  const now = Date.now();
  const chain = { engine: "receipts", program: "p", updatedAt: new Date(now).toISOString(), receipts: 20 };
  assert.equal(packPace(chain, [{ at: now - 900000, count: 20, identity: "p:" }], now).perHour, 0);
  assert.equal(packPace(chain, [{ at: now - 60000, count: 19, identity: "p:" }], now).perHour, null);
});
