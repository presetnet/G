const fs = require('fs');
const lines = fs.readFileSync('public/watch.js', 'utf8').split('\n');
let seenEscape = false;
let seenSetConn = false;
let skip = false;
let brace = 0;
const out = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.includes('function escapeHtml')) {
    if (!lines[i-1]?.includes('function escapeHtml')) {
      // First occurrence
      if (false) {} // placeholder
    }
    // Check if we've seen this function before
    if (line.includes('function escapeHtml')) {
      // Check if we've seen it before by looking at previous lines
      let seen = false;
      for (let j = 0; j < i; j++) {
        if (lines[j].includes('function escapeHtml')) {
          // This is a duplicate, skip this function
          let brace = 0;
          let inFunc = false;
          for (let j = i; j < lines.length; j++) {
            for (const ch of lines[j]) {
              if (ch === '{') brace++;
              if (ch === '}') {
                brace--;
                if (brace === 0) {
                  // Skip this line and continue to next
                  break;
                }
              }
            }
            if (brace === 0) break;
          }
          continue;
        }
      }
    }
    
    if (line.includes('function setConn')) {
      if (skip) continue;
      // Check if we've seen setConn before
      let seen = false;
      for (let j = 0; j < i; j++) {
        if (lines[j].includes('function setConn')) {
          // Found duplicate, skip this function
          let brace = 0;
          let started = false;
          for (let j = i; j < lines.length; j++) {
            for (const ch of lines[j]) {
              if (ch === '{') {
                if (!started) started = true;
                if (started) brace++;
              }
              if (ch === '}') {
                if (started) {
                  brace--;
                  if (brace === 0) break;
                }
              }
            }
            if (brace === 0) break;
          }
          continue;
        }
      }
    }
  }
  
  // This is getting too complex. Let me just read the file and do a simple regex replace
  console.log('Done checking');
  process.exit(0);