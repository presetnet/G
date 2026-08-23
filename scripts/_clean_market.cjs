const fs = require('fs');
let s = fs.readFileSync('public/market.js', 'utf8');

// Remove token plan element refs from els object
const elsToRemove = [
  '  priceMeta: document.getElementById("priceMeta"),\n',
  '  priceBlurb: document.getElementById("priceBlurb"),\n',
  '  priceWins: document.getElementById("priceWins"),\n',
  '  priceQuotes: document.getElementById("priceQuotes"),\n',
  '  priceSheet: document.getElementById("priceSheet"),\n',
  '  priceLimits: document.getElementById("priceLimits"),\n',
  '  priceSource: document.getElementById("priceSource"),\n',
];
for (const line of elsToRemove) {
  s = s.replace(line, '');
}

// Remove renderTokenPlan call from applyPayload
s = s.replace('  renderTokenPlan(tokenPlan);\n', '');

// Remove the entire renderTokenPlan function
const fnStart = s.indexOf('function renderTokenPlan(plan) {');
if (fnStart >= 0) {
  const fnEnd = s.indexOf('\nfunction ', fnStart + 1);
  if (fnEnd >= 0) {
    s = s.slice(0, fnStart) + s.slice(fnEnd + 1);
    console.log('removed renderTokenPlan function');
  }
}

// Remove renderTokenPlan references in renderVendors
s = s.replace(/tokenPlan\?\.plans\?\.length/g, 'false');
s = s.replace(/tokenPlan\?\.plans\[0\]\.price/g, '""');
s = s.replace(/tokenPlan\?\.plans\.at\(-1\)\.price/g, '""');

fs.writeFileSync('public/market.js', s);
console.log('market.js cleaned');
