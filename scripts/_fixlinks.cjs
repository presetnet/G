const fs = require('fs');
let s = fs.readFileSync('public/watch.html', 'utf8');
const fixes = [
  // Fix mangled arrows in source links
  ['Ars Technica ?</a>', 'Ars Technica \u2197</a>'],
  ['OpenRouter blog ?</span>', 'OpenRouter blog \u2197</a>'],
  // Fix </span> closing <strong> tags in verify links
  ['<strong>Zen catalog</span>', '<strong>Zen catalog</strong>'],
  ['<strong>models.dev</span>', '<strong>models.dev</strong>'],
  ['<strong>Go price sheet</span>', '<strong>Go price sheet</strong>'],
  ['<strong>GitHub releases</span>', '<strong>GitHub releases</strong>'],
  ['<strong>This thermometer</span>', '<strong>This thermometer</strong>'],
];
for (const [from, to] of fixes) {
  if (s.includes(from)) {
    s = s.replaceAll(from, to);
    console.log('fixed:', from.slice(0, 40));
  } else {
    console.log('skip:', from.slice(0, 40));
  }
}
fs.writeFileSync('public/watch.html', s);
console.log('done');
