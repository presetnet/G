const fs = require('fs');
const lines = fs.readFileSync('public/watch.js', 'utf8').split('\n');
const seen = new Set();
const out = [];
let skip = false;
let brace = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const fnMatch = line.match(/^\s*function\s+(\w+)/);
  
  if (fnMatch) {
    const name = fnMatch[1];
    if (seen.has(name)) {
      skip = true;
      brace = 0;
      continue;
    }
    seen.add(name);
  }
  
  if (skip) {
    for (const ch of line) {
      if (ch === '{') brace++;
      if (ch === '}') { brace--; if (brace <= 0) { skip = false; break; } }
    }
    // Also skip standalone closing braces at this level
    if (line.trim() === '}' && brace === 0) { skip = false; continue; }
    continue;
  }
  
  // Skip duplicate let lastPayload
  if (line.includes('let lastPayload')) {
    if (seen.has('lastPayload')) continue;
    seen.add('lastPayload');
  }
  
  out.push(line);
}

fs.writeFileSync('public/watch.js', out.join('\n'));
console.log('Dedup done, lines:', out.length);
