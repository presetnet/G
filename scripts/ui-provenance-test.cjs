// Run: node scripts/ui-provenance-test.cjs [base URL]
// Optional: PLAYWRIGHT_CORE_PATH and EDGE_PATH for nonstandard installations.
const path = require('node:path');
let playwright;
try { playwright = require('playwright-core'); } catch {
  playwright = require(process.env.PLAYWRIGHT_CORE_PATH || path.join(
    process.env.LOCALAPPDATA, 'Temp', 'opencode', 'wak', 'node_modules', 'playwright-core'));
}

const base = process.argv[2] || 'http://localhost:3847';
const widths = [320, 390, 768, 1024, 1200, 1440];
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
}

async function layout(page, label) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const geometry = await page.evaluate(async () => {
    if (window.__provenanceFixture) {
      const { renderProvenance } = await import('/provenance.js');
      renderProvenance(window.__provenanceFixture);
      document.querySelector('.provenance-details').open = true;
    }
    const visible = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    const cards = [...document.querySelectorAll('.metrics > .metric')];
    const overlaps = [];
    const spills = [];
    const rect = el => el.getBoundingClientRect();
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    cards.forEach((card, i) => {
      const name = card.querySelector('strong[id]')?.id || String(i);
      cards.slice(i + 1).forEach(other => {
        if (intersects(rect(card), rect(other))) overlaps.push(name + ':card');
      });
      const children = [...card.children].filter(visible);
      children.forEach((child, j) => {
        children.slice(j + 1).forEach(other => {
          if (intersects(rect(child), rect(other))) overlaps.push(`${name}:${child.id || child.className}/${other.id || other.className}`);
        });
      });
      // Check text rects as well as boxes: text can paint outside a fixed box.
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || !visible(node.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          const c = rect(card);
          if (r.left < c.left - 1 || r.right > c.right + 1 || r.bottom > c.bottom + 1) {
            spills.push({ name, text: node.textContent.trim().slice(0, 70),
              left: Math.round(r.left - c.left), right: Math.round(r.right - c.right),
              bottom: Math.round(r.bottom - c.bottom) });
            break;
          }
        }
      }
    });
    const root = document.documentElement;
    return {
      clientWidth: root.clientWidth, scrollWidth: root.scrollWidth,
      footers: [...document.querySelectorAll('.metric-provenance')].filter(visible).length,
      overlaps, spills,
      detailsOverflow: [...document.querySelectorAll('.provenance-source')].filter(visible)
        .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.dataset.sourceId),
    };
  });
  check(label, geometry.footers === 14 && geometry.scrollWidth <= geometry.clientWidth &&
    !geometry.overlaps.length && !geometry.spills.length && !geometry.detailsOverflow.length, geometry);
}

async function main() {
  const statusResponse = await fetch(`${base}/api/status`);
  if (!statusResponse.ok) throw new Error(`Server status HTTP ${statusResponse.status}`);
  const payload = await statusResponse.json();
  if (!payload.latest) throw new Error('No latest payload: cannot test populated metrics');
  console.log(`Snapshot: ${payload.latest.takenAt}; source count: ${Object.keys(payload.latest.sources || {}).length}`);
  const browser = await playwright.chromium.launch({ headless: true,
    ...(process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : { channel: 'msedge' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    console.log(`Browser: ${browser.version()}; fresh isolated context; captured status replay; read-only boot mode`);
    // Stable real payload; no POST/poll/sniff, no SSE races during fixture rendering.
    await context.route('**/api/health', route => route.fulfill({ json: { ok: true, mode: 'vercel' } }));
    await context.route('**/api/status', route => route.fulfill({ json: payload }));
    await context.route('**/api/poll', route => route.fulfill({ json: payload }));
    const page = await context.newPage();
    const jsErrors = [], consoleErrors = [], failedRequests = [];
    page.on('pageerror', error => jsErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    async function loaded(reload = false) {
      // Express's extensionless fallback serves index.html without recording a page view.
      const response = reload ? await page.reload() : await page.goto(`${base}/ui-provenance-test`);
      if (!response.ok()) throw new Error(`Page HTTP ${response.status()}`);
      await page.waitForFunction(() => document.querySelector('#connection')?.classList.contains('live'));
      await page.locator('.metric-provenance').first().waitFor();
      await page.waitForTimeout(600);
    }
    await loaded();
    check('fresh context starts normal', await page.locator('#compactViewBtn').getAttribute('aria-pressed') === 'false');
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await layout(page, `normal ${width}`);
      await page.locator('.provenance-details > summary').click();
      await layout(page, `source details expanded ${width}`);
      await page.locator('.provenance-details > summary').click();
    }

    const fold = page.locator('details.hp-panel');
    await fold.locator(':scope > summary').click();
    await page.waitForTimeout(100);
    await loaded(true);
    check('individual normal disclosure survives reload', await fold.evaluate(el => el.open));
    await page.locator('.coverage-strip > summary').click();
    await page.locator('.provenance-details > summary').click();
    await page.locator('#compactViewBtn').click();
    check('compact folds optional disclosure', !await fold.evaluate(el => el.open));
    check('compact preserves open sources and coverage', await page.locator('.provenance-details').evaluate(el => el.open) &&
      await page.locator('#coverageChips').isVisible());
    await fold.locator(':scope > summary').click();
    await page.waitForTimeout(100);
    await loaded(true);
    const compactRestored = await page.locator('#compactViewBtn').getAttribute('aria-pressed') === 'true';
    check('compact preference survives reload', compactRestored,
      await page.evaluate(() => JSON.parse(localStorage.getItem('geoff-thermometer-compact-view-v1'))));
    check('individual compact disclosure survives reload', compactRestored && await fold.evaluate(el => el.open));
    check('source coverage survives reload', await page.locator('#coverageChips').isVisible());
    // Recover after a persistence failure so compact geometry is actually tested.
    if (!compactRestored) {
      await page.locator('#compactViewBtn').click();
      await fold.locator(':scope > summary').click();
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await layout(page, `compact ${width}`);
    }
    await fold.locator(':scope > summary').click();
    await page.waitForTimeout(100);
    await loaded(true);
    check('individual closed fold survives reload', !await fold.evaluate(el => el.open));
    if (await page.locator('#compactViewBtn').getAttribute('aria-pressed') === 'true') {
      await page.locator('#compactViewBtn').click();
    }
    check('normal disclosure choice restored', await fold.evaluate(el => el.open));

    const fixture = await page.evaluate(async () => {
      const { renderProvenance } = await import('/provenance.js');
      const old = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
      const attack = '<img src=x onerror="window.__provenanceInjected=1">';
      window.__provenanceFixture = { takenAt: new Date().toISOString(), sources: {
        'stacknet.health': { ok: false, status: 503, stale: true, checkedAt: old,
          lastAttemptAt: new Date().toISOString(), error: attack + 'x'.repeat(1500),
          url: 'javascript:window.__provenanceInjected=1', sourceUrl: 'https://example.com/' + 'x'.repeat(1500),
          rpcUrl: 'https://user:secret@example.com', docsUrl: 'data:text/html,' + attack },
        'stacknet.network': { ok: true, checkedAt: old },
        'solana.tokens': { ok: true },
      } };
      renderProvenance(window.__provenanceFixture);
      document.querySelector('.provenance-details').open = true;
      const text = id => document.getElementById(id).closest('.metric').querySelector('.provenance-ages').textContent;
      const row = document.querySelector('[data-source-id="stacknet.health"]');
      const links = [...document.querySelectorAll('.provenance-links a')];
      return {
        failed: text('stackVersion').includes('check failed; NOT fresh'),
        missing: text('pileValue').includes('source missing; outcome unknown') && text('pileValue').includes('age unknown'),
        unknownClock: text('paperSupply').includes('last checked age unknown'),
        old: text('stackNodes').includes('older than 20 min'),
        literal: row.textContent.includes(attack) && !row.querySelector('img') && !window.__provenanceInjected,
        safeLinks: links.length === 1 && links.every(link => ['https:', 'http:'].includes(new URL(link.href).protocol) &&
          !new URL(link.href).username && !new URL(link.href).password && link.target === '_blank' &&
          link.relList.contains('noopener') && link.relList.contains('noreferrer')),
      };
    });
    for (const [name, ok] of Object.entries(fixture)) check(`fixture ${name}`, ok);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await layout(page, `failed/unknown/old + long unsafe source fixture ${width}`);
    }
    check('no uncaught JavaScript errors', jsErrors.length === 0, jsErrors);
    check('no console errors', consoleErrors.length === 0, [...new Set(consoleErrors)]);
    const failureCounts = {};
    for (const { url, error } of failedRequests) {
      const key = `${new URL(url).hostname}: ${error || 'unknown'}`;
      failureCounts[key] = (failureCounts[key] || 0) + 1;
    }
    console.log(`Request failures: ${JSON.stringify({ total: failedRequests.length, byHostAndError: failureCounts })}`);
    await context.close();
  } finally { await browser.close(); }
  const failures = results.filter(result => !result.ok);
  console.log(`\n${results.length - failures.length}/${results.length} checks passed; ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
