const fs = require('fs');
const content = fs.readFileSync('public/watch.js', 'utf8');
const lines = content.split('\n');
let seenEscape = false;
let inSecondEscape = false;
let braceCount = 0;
let inSecondFunction = false;
const newLines = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.includes('function escapeHtml')) {
    if (!seenEscape) {
      seenEscape = true;
      newLines.push(line);
    } else {
      // Skip this entire function
      inSecondFunction = true;
      continue;
    }
  }
  
  if (inSecondFunction) {
    // Track braces to find end of function
    for (const ch of lines[i-1]) {
      if (ch === '{') {
        if (!inSecondFunction) { /* already in */ }
      }
      // Check for braces in current line
      for (const ch of lines[i]) {
        if (ch === '{') braceCount++;
        if (ch === '}') braceCount--;
      }
      if (braceCount === 0) {
        inSecondFunction = false;
      }
      continue;
    }
    
    newLines.push(line);
  }
  
  fs.writeFileSync('public/watch.js', newLines.join('\n'));
  console.log('Fixed');