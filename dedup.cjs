const fs = require('fs');
let c = fs.readFileSync('public/watch.js', 'utf8');
const lines = c.split('\n');
let seenEscape = false;
const newLines = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('function escapeHtml')) {
    if (seenEscape) {
      // Skip this entire function
      let braceCount = 0;
      let started = false;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') {
            if (!started) started = true;
            if (started) braceCount++;
          }
          if (started && ch === '}') {
            braceCount--;
            if (braceCount === 0) {
              // Skip this line too
              break;
            }
          }
        }
      }
      // Find the closing brace
      let braceCount = 0;
      let started = false;
      let endIdx = -1;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') {
            if (!started) started = true;
            if (started) braceCount++;
          }
          if (started && ch === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIdx = j;
              break;
            }
          }
        }
        if (endIdx >= 0) {
          // Skip all lines from i to endIdx
          i = endIdx;
          break;
        }
      }
      continue;
    } else {
      seenEscape = true;
    }
  }
  newLines.push(line);
}
fs.writeFileSync('public/watch.js', newLines.join('\n'));
console.log('Fixed');