import assert from "node:assert/strict";
import { metricStatus, renderProvenance, sourceDescription } from "../public/provenance.js";
import { initCompactView } from "../public/compact-view.js";

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

const recent = "2026-09-05T11:58:00Z";
const old = "2026-09-05T10:00:00Z";
const current = "2026-09-05T12:00:00Z";
const source = { ok: true, checkedAt: recent };
const label = (id, sources) => metricStatus(id, { takenAt: current, sources }, now).label;
for (const [value, expected] of [
  [undefined, "Unavailable"],
  [{ ok: true, takenAt: current }, "No clock"],
  [{ ...source, checkedAt: "2026-09-05T11:58:00" }, "No clock"],
  [{ ...source, checkedAt: now }, "No clock"],
  [{ ...source, checkedAt: "2026-09-05T12:01:00Z" }, "No clock"],
  [{ ...source, checkedAt: "invalid" }, "No clock"],
  [source, "2m"],
  [{ ...source, checkedAt: "2026-09-05T11:59:59Z" }, "<1m"],
  [{ ...source, checkedAt: "2026-09-05T13:58:00+02:00" }, "2m"],
  [{ ...source, checkedAt: "2026-09-05T11:40:00Z" }, "20m"],
  [{ ...source, checkedAt: "2026-09-05T11:39:59Z" }, "Stale"],
  [{ ...source, checkedAt: old }, "Stale"],
  [{ ...source, ok: false }, "Unavailable"],
  [{ ...source, ok: undefined }, "Unavailable"],
  [{ ...source, status: 503 }, "Unavailable"],
  [{ ...source, lastError: "offline" }, "Unavailable"],
  [{ ...source, ok: false, stale: true, lastAttemptAt: current }, "Stale"],
  [{ ...source, skipped: true }, "Stale"],
  [{ ...source, cached: true }, "Cached"],
  [{ ...source, cached: true, checkedAt: old }, "Stale"],
  [{ ...source, reason: "Partial: one route failed" }, "Partial"],
]) {
  assert.equal(label("pileValue", { "stacknet.pile": value }), expected, JSON.stringify(value));
}
assert.equal(metricStatus("pileValue", null, now).label, "Unavailable");
assert.equal(label("stackVersion", { "stacknet.health": source, "stacknet.root": { ...source, checkedAt: old } }), "Stale");
assert.equal(label("stackVersion", { "stacknet.health": { ...source, checkedAt: current }, "stacknet.root": source }), "2m");
for (const [id, name, field] of [
  ["paperSupply", "solana.tokens", "mintsCheckedAt"],
  ["miningMiners", "surface.mining", "miners60mAt"],
]) {
  assert.equal(label(id, { [name]: source }), "No clock");
  assert.equal(label(id, { [name]: { ...source, [field]: old } }), "Stale");
  assert.equal(label(id, { [name]: { ...source, checkedAt: current, [field]: recent } }), "2m");
}
assert.equal(label("paperworkUsd", {
  "stacknet.network": source,
  "solana.tokens": { ...source, mintsCheckedAt: recent },
  "solana.treasury": { ...source, signaturesCheckedAt: old },
}), "Stale");

const launch = {
  ...source,
  sourceUrl: "https://www.trix.market/api/launches?sort=latest&limit=500",
  dataUpdatedAt: recent,
  coins: [{ ticker: "NEW", marketCapUpdatedAt: recent }, { ticker: "OLD", marketCapUpdatedAt: old }],
};
const launchText = sourceDescription("trix.meme.market", launch, now);
assert.match(launchText, /TRIX launch ranking.*Launch catalog endpoint/);
assert.match(launchText, /sourceUrl: https:\/\/www\.trix\.market\/api\/launches\?/);
assert.match(launchText, /dataUpdatedAt \(newest reported row, NOT every row or check time\): 2026-09-05T11:58:00.000Z/);
assert.match(launchText, /marketCapUpdatedAt row clocks: 2\/2 known/);
assert.match(launchText, /Oldest reported row: 2026-09-05T10:00:00.000Z.*2 hr/);
assert.match(launchText, /Row 2 \(OLD\) marketCapUpdatedAt: 2026-09-05T10:00:00.000Z/);
assert.equal(label("trixMemeMarketCount", { "trix.meme.market": launch }), "Stale");
assert.equal(label("trixMemeMarketCount", { "trix.meme.market": { ...launch, coins: [launch.coins[0]] } }), "2m");
const noRowClock = { ...launch, coins: [launch.coins[0], { ticker: "NO_CLOCK", takenAt: current }] };
assert.equal(label("trixMemeMarketCount", { "trix.meme.market": noRowClock }), "No clock");
assert.match(sourceDescription("trix.meme.market", noRowClock, now), /Row 2 \(NO_CLOCK\) marketCapUpdatedAt: unknown; age unknown/);
assert.equal(label("trixMemeMarketCount", { "trix.meme.market": { ...launch, coins: [null] } }), "No clock");
const futureRow = { ...launch, coins: [{ marketCapUpdatedAt: "2026-09-05T12:01:00Z" }] };
assert.equal(label("trixMemeMarketCount", { "trix.meme.market": futureRow }), "No clock");
assert.match(sourceDescription("trix.meme.market", futureRow, now), /1 future \(clock mismatch\)/);
for (const sourceUrl of [undefined, "https://www.trix.market/api/meme-market", "https://www.trix.market/api/boxes/leaderboard", "https://fixture.test/api/launches"]) {
  const historical = { ...launch, sourceUrl, snapshotAt: old, coins: [] };
  assert.equal(label("trixMemeMarketCount", { "trix.meme.market": historical }), "Stale");
  const text = sourceDescription("trix.meme.market", historical, now);
  assert.match(text, /Historical or unverified TRIX snapshot; NOT current launch ranking data/);
  assert.match(text, /snapshotAt \(source\/event time, NOT check time\): 2026-09-05T10:00:00.000Z/);
}
// Persisted pack descriptions remain readable without being promoted to current data.
assert.match(sourceDescription("trix.geoff.packs", { ...source, snapshotStale: true }, now), /TRIX Pack market.*pack snapshot as stale/);
assert.match(sourceDescription("trix.geoff.packs", { ...source, snapshotAgeMs: 100 }, now), /100 ms; not a current clock/);
assert.match(sourceDescription("trix.geoff.packs.purchaseAudit", source, now), /TRIX Pack receipts.*retained history/);

// Minimal offline DOM for state/structure assertions, not a browser layout test.
class Element extends EventTarget {
  constructor(tagName, className = "", id = "") {
    super();
    Object.assign(this, { tagName, className, id, children: [], dataset: {}, attributes: {}, open: false, textContent: "" });
  }
  get classList() {
    return {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (name) => this.classList.toggle(name, true),
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) names.add(name);
        else names.delete(name);
        this.className = [...names].join(" ");
      },
    };
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  matches(selectors) {
    return selectors.split(",").some((selector) => {
      selector = selector.trim();
      if (selector.startsWith("#")) return this.id === selector.slice(1);
      if (selector.startsWith("[")) return this.getAttribute(selector.slice(1, -1)) !== null;
      const [tag, ...classes] = selector.split(".");
      return (!tag || this.tagName === tag) && classes.every((name) => this.classList.contains(name));
    });
  }
  querySelectorAll(selector) {
    if (selector.startsWith(":scope > ")) return this.children.filter((child) => child.matches(selector.slice(9)));
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  before(node) { node.remove(); node.parentElement = this.parentElement; this.parentElement.children.splice(this.parentElement.children.indexOf(this), 0, node); }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
}

function fixture(withTools = true) {
  const body = new Element("body");
  const main = new Element("main", "shell");
  const grid = new Element("section", "metrics");
  const tools = withTools ? new Element("div", "", "vitalsTools") : null;
  body.append(main);
  if (tools) main.append(tools);
  main.append(grid);
  for (const id of ["stackVersion", "stackNodes", "vramText", "paperworkUsd", "paperSupply", "trixGeoffCount", "keysoldUsd", "pileValue", "keys9gValue", "x402Downloads", "subscriptionCount", "miningMiners"]) {
    const card = new Element("article", "metric");
    card.append(new Element("strong", "", id));
    grid.append(card);
  }
  const desk = new Element("section", "trix-desk", "trixDesk");
  desk.append(new Element("strong", "", "trixMemeMarketCount"), new Element("strong", "", "trixMarketCount"));
  const tab = new Element("details", "fold");
  tab.open = true;
  desk.append(tab);
  main.append(desk);
  const optional = new Element("details", "hp-panel", "optional");
  optional.open = true;
  optional.append(new Element("summary"));
  const data = new Element("details", "section-fold");
  data.open = true;
  data.append(new Element("p", "", "priceSource"));
  main.append(optional, data);
  globalThis.document = {
    body,
    querySelector: (selector) => body.querySelector(selector),
    getElementById: (id) => body.querySelector(`#${id}`),
    createElement: (tag) => new Element(tag),
  };
  return { body, main, grid, tools, optional, data, tab, desk };
}

const previousGlobals = Object.fromEntries(["document", "localStorage", "setInterval"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const previousNow = Date.now;
let saved = null;
let blocked = false;
let clockNow = now;
const ticks = [];
try {
  Date.now = () => clockNow;
  globalThis.setInterval = (callback, delay) => { assert.equal(delay, 30_000); ticks.push(callback); return 1; };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem(key) {
      assert.equal(key, "geoff-thermometer-compact-view-v1");
      if (blocked) throw new Error("blocked");
      return saved;
    },
    setItem(key, value) {
      assert.equal(key, "geoff-thermometer-compact-view-v1");
      if (blocked) throw new Error("blocked");
      saved = value;
    },
  } });
  let dom = fixture();
  const payload = { takenAt: current, sources: { "stacknet.pile": source, "trix.meme.market": launch } };
  renderProvenance(payload);
  assert.equal(dom.grid.querySelectorAll(".metric-provenance").length, 12);
  assert.equal(dom.desk.querySelectorAll(".metric-provenance").length, 0);
  dom.desk.classList.add("metric");
  renderProvenance(payload);
  assert.equal(dom.desk.querySelectorAll(".metric-provenance").length, 0, "even .metric elements outside the grid are ignored");
  const pile = document.getElementById("pileValue").closest(".metric");
  const disclosure = pile.querySelector(".metric-source-details");
  const status = pile.querySelector(".metric-source-status");
  const summary = disclosure.querySelector("summary");
  assert.equal(summary.textContent, "Source");
  assert.match(summary.title, /Reported unredeemed earnings.*not live earnings/);
  assert.match(summary.getAttribute("aria-label"), /^Source: /);
  assert.equal(disclosure.open, false);
  assert.equal(status.textContent, "2m");
  assert.equal(status.dataset.state, "checked");
  assert.match(status.getAttribute("aria-label"), /oldest required source\/value clock/);
  const click = new Event("click", { bubbles: true });
  let stopped = false;
  click.stopPropagation = () => { stopped = true; };
  disclosure.dispatchEvent(click);
  assert.equal(stopped, true);
  disclosure.open = true;
  const allSources = document.querySelector(".provenance-details");
  allSources.open = true;
  clockNow += 21 * 60_000;
  ticks[0]();
  assert.equal(status.textContent, "Stale", "clock advances without a new snapshot");
  assert.equal(disclosure.open, true);
  assert.equal(pile.querySelector(".metric-source-details"), disclosure, "timer preserves disclosure/focus nodes");
  assert.equal(ticks.length, 1);
  renderProvenance(null);
  assert.equal(status.textContent, "Unavailable");
  assert.equal(allSources.open, true);

  initCompactView();
  let button = document.getElementById("compactViewBtn");
  assert.equal(dom.tools.contains(button), true);
  assert.equal(button.textContent, "Compact");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(dom.main.classList.contains("compact-vitals"), true);
  assert.equal(dom.body.classList.contains("compact-vitals"), true);
  assert.equal(dom.optional.open, false);
  assert.equal(dom.data.open && dom.tab.open && disclosure.open && allSources.open, true);
  initCompactView();
  assert.equal(dom.main.querySelectorAll("#compactViewBtn").length, 1);
  dom.optional.open = true;
  dom.optional.dispatchEvent(new Event("toggle"));
  button.dispatchEvent(new Event("click"));
  assert.equal(button.textContent, "Comfortable");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(dom.main.classList.contains("compact-vitals"), false);
  assert.equal(dom.body.classList.contains("compact-vitals"), false);
  dom.optional.open = false;
  // Switch before the native toggle arrives; both mode-specific choices must survive.
  button.dispatchEvent(new Event("click"));
  dom.optional.dispatchEvent(new Event("toggle"));
  assert.equal(dom.optional.open, true);
  assert.equal(dom.data.open && dom.tab.open && disclosure.open && allSources.open, true);
  assert.equal(JSON.parse(saved).compact["id:optional:1"], true);
  assert.equal(JSON.parse(saved).normal["id:optional:1"], false);
  assert.deepEqual(Object.keys(JSON.parse(saved).normal), ["id:optional:1"], "unmanaged disclosures are not persisted");
  dom = fixture(false);
  initCompactView();
  button = document.getElementById("compactViewBtn");
  assert.equal(dom.main.children.indexOf(button.parentElement) + 1, dom.main.children.indexOf(dom.grid));
  assert.equal(dom.optional.open, true, "saved compact expansion survives reload");
  button.dispatchEvent(new Event("click"));
  assert.equal(dom.optional.open, false, "saved comfortable choice survives reload");
  dom = fixture();
  initCompactView();
  assert.equal(document.getElementById("compactViewBtn").textContent, "Comfortable", "explicit disabled preference is preserved");
  for (const value of ["invalid json", '{"enabled":true,"compact":{"id:optional:1":"invalid"}}', null]) {
    saved = value;
    blocked = value === null;
    dom = fixture();
    initCompactView();
    button = document.getElementById("compactViewBtn");
    assert.equal(button.textContent, "Compact");
    assert.equal(dom.optional.open, false);
    button.dispatchEvent(new Event("click"));
    assert.equal(button.textContent, "Comfortable");
  }
} finally {
  Date.now = previousNow;
  for (const [key, descriptor] of Object.entries(previousGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

console.log("provenance: descriptions, card clocks, compact controls and offline DOM assertions passed");
