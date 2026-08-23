const fs = require('fs');
let c = fs.readFileSync('public/watch.js', 'utf8');
const lines = c.split('\n');
lines[47] = '    .replaceAll("\\"", ""\\"");';
fs.writeFileSync('public/watch.js', lines.join('\n'));
console.log('Fixed');