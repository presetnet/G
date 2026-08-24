const fs = require('fs');
const lines = fs.readFileSync('public/index.html', 'utf8').split('\n');
let removeRanges = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Zen error probe') || lines[i].includes('zenErrStatus')) {
    let start = i;
    while (start > 0 && !lines[start].includes('<article')) start--;
    let end = i;
    while (end < lines.length && !lines[end].includes('</article>')) end++;
    removeRanges.push([start, end]);
    console.log('Zen error probe: lines ' + (start+1) + '-' + (end+1));
  }
  if (lines[i].includes('Ghost shelf') && lines[i].includes('class="k"')) {
    let start = i;
    while (start > 0 && !lines[start].includes('<article')) start--;
    let end = i;
    while (end < lines.length && !lines[end].includes('</article>')) end++;
    removeRanges.push([start, end]);
    console.log('Ghost shelf: lines ' + (start+1) + '-' + (end+1));
  }
}
removeRanges.sort((a,b) => b[0] - a[0]);
for (const [start, end] of removeRanges) {
  lines.splice(start, end - start + 1);
}
fs.writeFileSync('public/index.html', lines.join('\n'));
console.log('Removed ' + removeRanges.length + ' cards');
