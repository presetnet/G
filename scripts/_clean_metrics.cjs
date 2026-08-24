const fs = require('fs');
const lines = fs.readFileSync('public/app.js', 'utf8').split('\n');

// Find boundaries
let wpondEnd = -1;   // last line of wPOND rendering
let exploreStart = -1; // first line of explore rendering
let fnClose = -1;     // the } that should close renderMetrics

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('els.miningBand.textContent')) wpondEnd = i;
  if (lines[i].includes('if (els.exploreCount)') && exploreStart < 0) exploreStart = i;
}

// Find the closing brace of renderMetrics (first } after exploreMeta block)
for (let i = exploreStart; i < lines.length; i++) {
  if (lines[i].includes('els.exploreMeta.title')) {
    // Next non-empty line should be }
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '}') { fnClose = j; break; }
      if (lines[j].trim() !== '') { fnClose = j; break; }
    }
    break;
  }
}

if (wpondEnd < 0 || exploreStart < 0 || fnClose < 0) {
  console.log('MISS: wpondEnd=' + wpondEnd + ' exploreStart=' + exploreStart + ' fnClose=' + fnClose);
  process.exit(1);
}

// Remove everything between wpondEnd+1 and exploreStart-1 (the broken code)
const remove1 = exploreStart - wpondEnd - 1;
if (remove1 > 0) {
  lines.splice(wpondEnd + 1, remove1);
  console.log('Removed', remove1, 'broken lines between wPOND and explore');
}

// Recalculate fnClose after removal, then remove extra braces after it
// Find exploreMeta.title line again
let newTitleLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('els.exploreMeta.title')) { newTitleLine = i; break; }
}
if (newTitleLine >= 0) {
  // Find the } that closes exploreMeta if
  let closeIf = newTitleLine + 1;
  while (closeIf < lines.length && lines[closeIf].trim() !== '}') closeIf++;
  // Now remove everything between closeIf+1 and the line before renderExploreCue
  let cueLine = -1;
  for (let i = closeIf + 1; i < lines.length; i++) {
    if (lines[i].includes('function renderExploreCue')) { cueLine = i; break; }
  }
  if (cueLine > closeIf + 2) {
    const extraBraces = cueLine - closeIf - 2; // keep one } and one blank line
    if (extraBraces > 0) {
      lines.splice(closeIf + 2, extraBraces);
      console.log('Removed', extraBraces, 'extra closing braces');
    }
  }
}

fs.writeFileSync('public/app.js', lines.join('\n'));
console.log('Cleaned');
