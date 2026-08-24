const fs = require('fs');
let c = fs.readFileSync('public/app.js', 'utf8');
c = c.replace(
  'function renderMetrics(latest) {\n  try {\n  lastLatest',
  'function renderMetrics(latest) {\n  lastLatest'
);
c = c.replace(
  '  } catch(e) { console.error("renderMetrics error:", e); }\n}',
  '\n}'
);
fs.writeFileSync('public/app.js', c);
console.log('try-catch removed');
