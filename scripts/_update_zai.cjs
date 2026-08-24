const fs = require('fs');

// 1) watch.html — add Z.ai identification banner
let w = fs.readFileSync('public/watch.html', 'utf8');
const banner = `
      <!-- IDENTIFIED: Z.ai -->
      <section class="section identified-banner">
        <div class="identified-badge">IDENTIFIED</div>
        <h2>Ox Alpha = Z.ai (Zhipu)</h2>
        <p>Unreleased GLM-5-gen model. Server fingerprinted via malformed request — upstream leaked its own Java class: <code>com.wd.paas.api.domain.v4.chat.ChatCompletionRequest</code> · route <code>/api/paas/v4/chat/completions</code> · error codes 1214/1210 matching Z.AI GLM · tokenizer 30/30 match with GLM-5.3 · Chinese-locale validation messages.</p>
        <p class="identified-note">Reproducible with one curl, no API key. OpenCode proxies raw — OpenRouter blocks at edge. The server named itself.</p>
      </section>

      <!-- KEY METRICS -->`;
w = w.replace('      <!-- KEY METRICS -->', banner);
w = w.replace('Z.ai GLM-5-gen \u00b7 1M ctx \u00b7 stealth promo', 'Z.ai (Zhipu) GLM-5-gen \u00b7 1M ctx \u00b7 confirmed via server fingerprint');
fs.writeFileSync('public/watch.html', w);
console.log('watch.html: banner added, subtitle updated');

// 2) market.html — update OpenCode entry
let m = fs.readFileSync('public/market.html', 'utf8');
m = m.replace(
  'Big Pickle free at 200/day \u00b7 Z.ai backend',
  'Big Pickle free at 200/day \u00b7 Ox Alpha backend confirmed: Z.ai (Zhipu) GLM-5-gen via server fingerprint'
);
fs.writeFileSync('public/market.html', m);
console.log('market.html: OpenCode entry updated');

// 3) Add CSS for identified banner
let css = fs.readFileSync('public/styles.css', 'utf8');
if (!css.includes('identified-banner')) {
  css += '\n.identified-banner { text-align:center; padding:2rem 1.5rem; background:rgba(52,211,153,0.06); border-top:1px solid rgba(52,211,153,0.2); border-bottom:1px solid rgba(52,211,153,0.2); }\n';
  css += '.identified-badge { display:inline-block; padding:0.3rem 0.9rem; border-radius:999px; font-size:0.7rem; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#34d399; background:rgba(52,211,153,0.12); border:1px solid rgba(52,211,153,0.3); margin-bottom:0.75rem; }\n';
  css += '.identified-banner h2 { font-size:1.4rem; font-weight:700; color:var(--ink); margin-bottom:0.5rem; }\n';
  css += '.identified-banner p { color:var(--muted); font-size:0.9rem; line-height:1.6; max-width:800px; margin:0 auto 0.5rem; }\n';
  css += '.identified-banner code { font-family:"JetBrains Mono",monospace; font-size:0.8rem; color:var(--accent); background:rgba(255,214,10,0.08); padding:0.1rem 0.3rem; border-radius:3px; }\n';
  css += '.identified-note { font-style:italic; font-size:0.82rem; }\n';
  fs.writeFileSync('public/styles.css', css);
  console.log('CSS: identified banner styles added');
}
