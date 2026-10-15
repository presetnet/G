import test from "node:test";
import assert from "node:assert/strict";
import { docsView, sourceCondition } from "../public/workspace.js";

test("source health distinguishes restricted routes and transient failures", () => {
  assert.equal(sourceCondition({ status: 401 }), "Access required");
  assert.equal(sourceCondition({ status: 404 }), "Route unavailable");
  assert.equal(sourceCondition({ status: 429 }), "Rate limited");
  assert.equal(sourceCondition({ status: 0, reason: "This operation was aborted" }), "Timed out");
  assert.equal(sourceCondition(null), "Not observed");
});

test("docs drilldown withholds stale content and limits changes to observed history", () => {
  const checkedAt = new Date().toISOString();
  const docs = { ok: true, checkedAt, publishedModelLayers: ["magma", "magma-2.1"], pages: [
    { id: "models", path: "/introduction/models", ok: true },
    { id: "files", path: "/api-reference/file/upload", ok: false, status: 404 },
  ] };
  const catalog = { ok: true, checkedAt, models: [{ id: "magma" }] };
  const events = [{ kind: "docs", at: checkedAt }, { kind: "docs", at: "2020-01-01" }, { kind: "version", at: checkedAt }];
  const view = docsView(docs, catalog, events);
  assert.equal(view.available, true);
  assert.equal(view.failures.length, 1);
  assert.equal(view.changes.length, 1);
  assert.deepEqual(view.missingFromCatalog, ["magma-2.1"]);
  assert.deepEqual(docsView(docs, { ...catalog, ok: false }).missingFromCatalog, [], "failed catalog cannot establish a missing model");
  const expired = docsView({ ...docs, checkedAt: "2020-01-01" }, catalog);
  assert.equal(expired.available, false);
  assert.deepEqual(expired.pages, []);
  assert.deepEqual(expired.docsModels, []);
});
