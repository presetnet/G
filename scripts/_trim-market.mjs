import fs from "node:fs";

const path = "public/market.js";
let s = fs.readFileSync(path, "utf8");
const log = [];

function rep(a, b, optional = false) {
  if (!s.includes(a)) {
    log.push((optional ? "skip " : "MISS ") + a.slice(0, 70).replace(/\n/g, "\\n"));
    return;
  }
  s = s.replace(a, b);
  log.push("ok   " + a.slice(0, 50).replace(/\n/g, "\\n"));
}

// helpers still present? remove them (dead after cuts)
rep(
  [
    "function statusClass(indicator) {",
    '  if (!indicator || indicator === "unknown") return "unknown";',
    '  if (indicator === "none" || indicator === "operational") return "good";',
    '  if (indicator === "minor") return "warn";',
    '  return "bad";',
    "}",
    "",
  ].join("\n"),
  "",
);

const slStart = s.indexOf("function statusLabel(indicator, description) {");
const gcStart = s.indexOf("function gradeClass(grade = \"\") {");
if (slStart >= 0 && gcStart > slStart) {
  s = s.slice(0, slStart) + s.slice(gcStart);
  log.push("ok   removed statusLabel body span");
}
const gEnd = s.indexOf("function renderDimensions");
if (gcStart >= 0 && gEnd > gcStart) {
  s = s.slice(0, gcStart) + s.slice(gEnd);
  log.push("ok   removed gradeClass span");
}

// els entries
for (const k of [
  "hints",
  "manifesto",
  "frameCards",
  "scorecard",
  "liveMeta",
  "liveGrid",
  "incidents",
  "inventories",
  "menus",
]) {
  rep(`  ${k}: document.getElementById("${k}"),\n`, "", true);
}

// applyPayload calls
for (const call of [
  "  renderHints(data.compareHints || []);\n",
  "  renderManifesto(data.manifesto);\n",
  "  renderFrameCards(data.frameCards || []);\n",
  "  renderScorecard(data.scorecard || []);\n",
  "  renderLive(data.live || {}, data.takenAt);\n",
  "  renderInventories(data.inventories || []);\n",
  "  renderMenus(catalog.vendors || []);\n",
]) {
  rep(call, "", true);
}

// leftover function defs if first pass missed them
cutBlock("function renderHints(hints = []) {", "function renderDimensions(dimensions = []) {");
function cutBlock(a, b) {
  const i = s.indexOf(a);
  const j = i >= 0 ? s.indexOf(b, i) : -1;
  if (i < 0 || j < 0) return log.push("skip block " + a.slice(0, 40));
  s = s.slice(0, i) + s.slice(j);
  log.push("ok   block " + a.slice(0, 40));
}

// error path
const errOld = [
  '    els.liveMeta.textContent = "Load failed";',
  "    els.liveGrid.innerHTML = `<p class=\"empty\">${escapeHtml(error.message)}</p>`;",
  "",
].join("\n");
rep(
  errOld,
  "    els.footnote.textContent = `Load failed: ${escapeHtml(error.message)}`;\n",
  true,
);

// opencode column
rep(
  "        <td>${escapeHtml(d.scores?.grok)}</td>",
  '        <td>${escapeHtml(d.scores?.opencode ?? "\u2014")}</td>\n        <td>${escapeHtml(d.scores?.grok)}</td>',
  true,
);

fs.writeFileSync(path, s);
console.log(log.join("\n"));
console.log("final size:", s.length);
