const fs = require('fs');
const html = fs.readFileSync('public/watch.html', 'utf8');
const js = fs.readFileSync('public/watch.js', 'utf8');
const htmlIds = new Set([...html.matchAll(/id="(\w+)"/g)].map(m => m[1]));
const jsIds = new Set([...js.matchAll(/getElementById\("(\w+)"\)/g)].map(m => m[1]));
const missing = [...jsIds].filter(id => !htmlIds.has(id));
console.log('JS expects but HTML lacks:', missing.length ? missing.join(', ') : 'NONE');
const unused = [...htmlIds].filter(id => !jsIds.has(id));
console.log('HTML has but JS never fetches:', unused.length ? unused.join(', ') : 'none');
