const fs = require('fs');
const lines = fs.readFileSync('public/watch.js', 'utf8').split('\n');
let seen = false;
let skip = false;
let brace = 0;
const out = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('function escapeHtml')) {
    if (!seen) { seen = true; }
    else { skip = true; }
  }
  if (skip) {
    for (const ch of line) {
      if (ch === '{') brace++;
      if (ch === '}') { brace--; if (brace === 0) { skip = false; continue; } }
    }
    continue;
  }
  out.push(line);
}
fs.writeFileSync('public/watch.js', out.join('\n'));
console.log('Fixed');