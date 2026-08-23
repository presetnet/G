const fs = require('fs');
let c = fs.readFileSync('public/watch.js', 'utf8');
c = c.replace(/.replaceAll.*\u201C.*\u201D.*;/, '    .replaceAll("\\"", ""\\"");');
fs.writeFileSync('public/watch.js', c);
console.log('Fixed');