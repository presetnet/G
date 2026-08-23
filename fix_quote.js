const fs = require('fs');
let content = fs.readFileSync('public/watch.js', 'utf8');
content = content.replace(/.replaceAll.*\u201C.*\u201D.*;/, '    .replaceAll("\\"", ""\\"");');
fs.writeFileSync('public/watch.js', content);
console.log('Fixed');