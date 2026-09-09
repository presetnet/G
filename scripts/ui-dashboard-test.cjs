// Fixture-backed browser tests: no collector, account, or shared-store writes.
// Run: node scripts/ui-dashboard-test.cjs; --serve keeps the preview at :3851.
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

function fixture() {
  const at = new Date().toISOString();
  const base = { ok: true, status: 200, checkedAt: at };
  const coins = Array.from({ length: 45 }, (_, i) => ({
    mintAddress: `fixture-mint-${i}`, ticker: `COIN${i}`, tokenName: i === 2 ? 'A deliberately long coin name to test narrow screens' : `Community coin ${i}`,
    currentMarketCap: i === 44 ? null : (45 - i) * 4250, marketCapUpdatedAt: i === 43 ? null : at,
    chain: i % 3 === 0 ? 'robinhood' : 'solana', type: i === 1 ? 'Agent' : 'Token', status: 'launched',
    logoUrl: i % 2 ? null : 'http://127.0.0.1:3851/test-logo.svg',
  }));
  const sources = Object.fromEntries(['stacknet.health', 'stacknet.root', 'stacknet.network', 'stacknet.keysale', 'stacknet.pile', 'stacknet.x402', 'solana.tokens', 'solana.treasury', 'geoff.keys.9g', 'geoff.subscription', 'surface.mining'].map(k => [k, { ...base, source: k }]));
  Object.assign(sources, {
    'trix.meme.market': { ...base, source: 'trix.meme.market', sourceUrl: 'https://trix.market/api/launches?limit=500', coins, totalCoins: 45, catalogTotal: 45, totalMarketCap: 4398750, dataUpdatedAt: at },
    'trix.boxes': { ok: false, status: 404, stale: true, checkedAt: at, sourceUrl: 'https://www.trix.market/api/mkt/leaderboard', topCoins: null, biggestPulls: null, topCollectors: null, reason: 'Not found' },
    'trix.boxboard': { ok: true, status: 200, checkedAt: at, sourceUrl: 'https://doswapz.com/api/trix-boxes', dataUpdatedAt: at, fallbackReason: 'Trix HTTP 404 https://trix.market/api/mkt/state', round: 1, roundStatus: 'warming', mintedTotal: 3874, boxesLeft: 4978,
      boxes: [{ id: 'base', type: 'BASE BOX', color: 'WHITE', hex: '#f4f4f4', minted: 3874, left: 4978, inRound: true, priceUsd: 35.1, priceSol: 0.34 }, { id: 'viral', type: 'VIRAL BOX', color: 'HOLO', hex: '#7ecbff', minted: 0, left: 4978, inRound: true, priceUsd: 175.51, priceSol: 1.7 }, { id: 'silver', type: 'SILVER BOX', minted: 0, left: 0, inRound: false, priceUsd: 0, priceSol: 0 }],
      collectors: Array.from({ length: 3 }, (_, i) => ({ rank: i + 1, username: `BoxWhale${i}`, wallet: String.fromCharCode(65 + i).repeat(32), boxes: 105 - i * 40, rips: 0, mythics: 0, earnedUsd: 0, verified: i === 0, kinds: { base: 105 - i * 40 } })),
      rarities: [{ type: 'MYTHIC', oddsPct: 0.04 }, { type: 'COMMON', oddsPct: 45.61 }, { type: 'VOID', oddsPct: 43 }],
      cards: [{ type: 'GOLD', multiplier: 1.69, priceSol: 0.69, active: true }],
      chain: { treasury: 'D8LYYH' + 'x'.repeat(35), walletsScanned: 669, boxEvents: 3924 } },
    'trix.boxchain': { ok: true, status: 200, checkedAt: at, sourceUrl: 'https://api.mainnet-beta.solana.com', treasury: 'D8LYYH' + 'x'.repeat(35), eventsSinceLaunch: 4301, totalScanned: 4301, pagesScanned: 5, newestAt: at, oldestAt: new Date(Date.now() - 5 * 86400000).toISOString() },
    'trix.geoff': { ...base, count: 780, paidSol: 9.36, records: [], latest: { createdAt: at } },
    'trix.market': { ...base, endpoints: { leaderboard: base, recentMints: base }, leaderboard: { rows: Array.from({ length: 100 }, (_, i) => ({ rank: i + 1, username: `Collector ${i}`, wallet: `fixture-wallet-${i}`, points: (100 - i) * 100, verified: i < 2 })) }, recentMints: [{ id: 'art1', name: 'A new artwork', imageUrl: 'http://127.0.0.1:3851/test-logo.svg', linkedCoinMint: 'fixture-mint-0', linkedCoinSymbol: 'COIN0' }] },
    'trix.tiers': { ...base, tiers: [{ name: 'Starter', minPoints: 0 }, { name: 'Explorer', minPoints: 5000 }] },
    'trix.money': { ...base, endpoints: { trades: base }, recentTrades: [{ id: 'trade1', signature: 'fixture-signature', side: 'buy', symbol: 'COIN0', mint: 'fixture-mint-0', solAmount: .1234, createdAt: at }], fees: { recentBuysSol: 12.34, recentSellsSol: 4.32, recentNetSol: 8.02, uniqueWallets: 12, buyCount: 15, sellCount: 6 }, treasury: { balanceSol: 143.21, balanceSolOnChain: 143.21, balanceSolOnChainAt: at, totalPoints: 98230, address: 'fixture-treasury' }, feeSplit: { platformFeeBps: 100, creatorFeeBps: 100, platformLaunchFeeSol: 0 }, geoffLeg1: { address: 'fixture-provider', balanceSol: .01, balanceSolOnChainAt: at } },
  });
  sources['trix.frontpage'] = { ...base, builtAt: at,
    featured: [{ name: 'Spotlight token', symbol: 'SPOT', mintAddress: 'A'.repeat(32), chain: 'solana', marketCap: 1234, marketCapUpdatedAt: at }],
    boosted: [{ name: 'Promoted token', symbol: 'BOOST', mintAddress: 'B'.repeat(32), chain: 'solana', marketCap: 5678, marketCapUpdatedAt: at }],
    recent: [{ name: 'New launch', symbol: 'NEW', mintAddress: 'C'.repeat(32), chain: 'solana', marketCap: 1000, marketCapUpdatedAt: at, createdAt: at }],
  };
  sources['trix.fee.config'] = { ...base, feeBps: 100, feeWallet: 'fixture-provider', treasuryWallet: 'fixture-treasury' };
  sources['trix.money'].fees.topCoins = [{ mint: 'verification', symbol: 'Verification', buySol: 0, sellSol: 0, count: 1 }, { mint: 'A'.repeat(32), symbol: 'SPOT', buySol: 1.234, sellSol: 0, count: 2 }];
  Object.assign(sources['trix.market'].recentMints[0], { artworkType: 'digital', status: 'minted', currentMarketCap: 1234, marketCapUpdatedAt: at });
  sources['solana.tokens'].mintsCheckedAt = at;
  sources['solana.tokens'].mints = [{ symbol: 'PAPER', supplyUi: 14369.47, mint: 'fixture-paper' }];
  sources['geoff.keys.9g'] = { ...base, solIn: .064, decoded: 10, windowTx: 50, senders: 5 };
  sources['surface.mining'] = { ...base, miners60m: 0, payouts60m: 0, miners60mAt: at, claimsOn: false };
  return { latest: { id: 'fixture-1', takenAt: at, sources, summary: {
    stacknetVersion: '20.4', stacknetStatus: 'ok', nodes: 8, gpus: 6, averageLoad: 0,
    availableVramGb: 242, vramGb: 738, vramAvailablePct: 33, pile: 3130000000,
    metaproofsPaperworkUsd: 695300000, metaproofsPaidUsd: 0, keySaleActive: true,
    keySalePriceUsd: 264.21, keySaleKeysSold: 207, subscriptionLiveCount: 4, subscriptionTotal: 5,
    subscriptionLiveLabels: ['Billing'], x402WeeklyDownloads: 16940, x402Version: '1.2.4',
  } }, events: [], dailyActivity: [], briefing: {}, temperature: { value: 12, label: 'cool' }, state: { pollCount: 1, lastPollAt: at }, config: { mode: 'vercel', sharedStore: true, trustMode: 'universal', sharedStoreBackend: 'fixture' } };
}

let payload = fixture();
let statusCode = 200;
let statusRequests = 0;
const app = express();
app.get('/api/status', (_req, res) => { statusRequests++; res.status(statusCode).json(statusCode === 200 ? payload : { error: 'Fixture outage' }); });
app.get('/api/health', (_req, res) => res.json({ mode: 'vercel', ok: true }));
app.get('/api/paperwork-history', (_req, res) => res.json({ series: [] }));
app.get('/api/traffic', (_req, res) => res.json({ totalViews: 0 }));
app.get('/test-logo.svg', (_req, res) => res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#ffd60a"/><path d="m8 10 8-4 8 4-8 4z m0 7 8 4 8-4" fill="none" stroke="#141416" stroke-width="2"/></svg>'));
app.use('/api', (_req, res) => res.status(405).json({ error: 'No live APIs in this test' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

async function main() {
  if (process.argv.includes('--live')) {
    // Public GET/RPC source reads only. Does not load or save any shared bundle.
    const response = await fetch('https://g-eight-psi.vercel.app/api/status');
    if (!response.ok) throw new Error(`Public status HTTP ${response.status}`);
    const previous = await response.json();
    const { runMinuteSniff } = await import('../server/sniffer.js');
    const snapshot = await runMinuteSniff({ previous: previous.latest });
    payload = { ...previous, latest: snapshot };
    console.log(JSON.stringify({ collectionMs: snapshot.durationMs, coins: snapshot.sources['trix.meme.market']?.totalCoins, boxes: snapshot.sources['trix.boxes']?.status, trades: snapshot.sources['trix.money']?.recentTrades?.length }));
  }
  const serving = process.argv.includes('--serve');
  const server = app.listen(serving ? 3851 : 0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`Isolated ${process.argv.includes('--live') ? 'public-data' : 'fixture'} preview: ${base}`);
  if (serving) return;
  let playwright;
  try { playwright = require('playwright-core'); } catch {
    playwright = require(process.env.PLAYWRIGHT_CORE_PATH || path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'wak', 'node_modules', 'playwright-core'));
  }
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true, ...(process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : { channel: 'msedge' }) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ status: 200, body: '', contentType: 'text/plain' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => document.querySelectorAll('#coinRows tbody tr').length === 20);
    assert.equal(await page.locator('#compactViewBtn').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.metrics > .metric').count(), 12);
    console.log('PASS: boot renders current coins and 12 compact vitals');

    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const tab of ['coins', 'boxes', 'activity', 'points', 'art', 'money']) {
        await page.locator(`#tab-${tab}`).click();
        const geometry = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('.metrics > .metric')].map(el => el.getBoundingClientRect());
          const overlaps = cards.some((a, i) => cards.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
          const desk = document.getElementById('trixDesk').getBoundingClientRect();
          return { overlaps, pageOverflow: document.documentElement.scrollWidth - innerWidth, desktopCardHeight: Math.max(...cards.map(r => r.height)), deskWidth: desk.width, mainWidth: document.querySelector('.metrics').getBoundingClientRect().width, visiblePanels: [...document.querySelectorAll('.desk-panel')].filter(p => !p.hidden).length };
        });
        assert.equal(geometry.overlaps, false, `${width}/${tab}: cards overlap`);
        assert.ok(geometry.pageOverflow <= 1, `${width}/${tab}: horizontal overflow ${geometry.pageOverflow}`);
        assert.equal(geometry.visiblePanels, 1);
        assert.ok(Math.abs(geometry.deskWidth - geometry.mainWidth) <= 2);
        if (width >= 1024) assert.ok(geometry.desktopCardHeight <= 130);
      }
      console.log(`PASS: ${width}px, all six tabs, no page overflow or overlapping cards`);
    }

    await page.locator('#tab-coins').click();
    for (const [view, text] of [['featured', 'SPOT'], ['boosted', 'BOOST'], ['recent', 'NEW']]) {
      await page.locator('#coinView').selectOption(view);
      assert.match(await page.locator('#coinRows').textContent(), new RegExp(text));
      assert.equal(await page.locator('#coinRows tbody tr').count(), 1);
      assert.match(await page.locator('#deskSourceText').textContent(), /trix.frontpage/);
      assert.doesNotMatch(await page.locator('#frontpageStatus').textContent(), /age unknown/);
      await page.setViewportSize({ width: 320, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.locator('#tab-money').click();
    assert.match(await page.locator('#moneyRows').textContent(), /Fee configuration \(TRIX\)/);
    assert.match(await page.locator('#moneyRows').textContent(), /100 bps \(1%\)/);
    assert.match(await page.locator('#moneyRows').textContent(), /Match/);
    await page.locator('#tab-art').click();
    assert.match(await page.locator('#artRows').textContent(), /digital/);
    assert.match(await page.locator('#artRows').textContent(), /MCap \$1.23K/);
    await page.locator('#tab-activity').click();
    await page.locator('.activity-breakdown > summary').click();
    assert.match(await page.locator('#activityFlow').textContent(), /1.234/);
    assert.equal(await page.locator('#activityFlow a[href*="verification"]').count(), 0);
    console.log('PASS: featured, boosted, new launches, fee config, artwork metadata and per-coin flow are visible');
    await page.locator('#tab-coins').click();
    await page.locator('#coinView').selectOption('all');
    await page.locator('#coinMore').click();
    assert.equal(await page.locator('#coinRows tbody tr').count(), 40);
    await page.locator('#coinSearch').fill('COIN1');
    await page.locator('#coinChain').selectOption('solana');
    const before = statusRequests;
    payload.latest.sources['trix.meme.market'].coins.find(c => c.ticker === 'COIN1').currentMarketCap = 7654321;
    payload.latest.id = 'fixture-2';
    payload.latest.sources['trix.money'].recentTrades.unshift({ id: 'trade2', side: 'sell', symbol: 'NEWTRADE', mint: 'fixture-new', solAmount: 2, createdAt: new Date().toISOString() });
    await page.waitForFunction(() => document.querySelector('#coinRows').textContent.includes('$7.65M'), null, { timeout: 22000 });
    assert.ok(statusRequests > before, 'automatic refresh must fetch the next payload');
    assert.equal(await page.locator('#coinSearch').inputValue(), 'COIN1');
    assert.equal(await page.locator('#coinChain').inputValue(), 'solana');
    await page.locator('#tab-activity').click();
    assert.match(await page.locator('#activityRows').textContent(), /NEWTRADE/);
    console.log('PASS: auto-refresh changes market cap and adds a new trade without resetting filters');

    await page.locator('#tab-boxes').click();
    assert.match(await page.locator('#boxStatus').textContent(), /Round 1 warming/);
    assert.match(await page.locator('#boxRows').textContent(), /On-chain box events 4,301/);
    assert.match(await page.locator('#boxRows').textContent(), /TRIX snapshot 3,874 minted/);
    assert.match(await page.locator('#boxRows').textContent(), /BASE BOX/);
    assert.match(await page.locator('#boxRows').textContent(), /VIRAL BOX/);
    assert.match(await page.locator('#boxRows').textContent(), /BoxWhale0/);
    assert.match(await page.locator('#boxRows').textContent(), /MYTHIC 0.04%/);
    assert.match(await page.locator('#deskSourceText').textContent(), /trix.boxboard/);
    assert.match(await page.locator('#deskSourceText').textContent(), /trix.boxchain/);
    // Real collector rows replace the 404 official feed; live chain count leads the snapshot.
    assert.equal(await page.locator('#boxRows a[href*="solscan.io/account"]').count(), 3);
    payload.latest.sources['trix.boxboard'] = { ok: false, status: 404, stale: true, checkedAt: new Date().toISOString(), sourceUrl: 'https://doswapz.com/api/trix-boxes', boxes: [], collectors: [] };
    payload.latest.sources['trix.boxes'] = { ok: true, checkedAt: new Date().toISOString(), status: 200, topCoins: [{ mint: 'box-token', symbol: 'BOX', rips: 32 }], biggestPulls: [{ ripper: 'Public user', rarity: 'Mythic', coinSymbol: 'BOX', rewardUsd: 30 }], topCollectors: [{ username: 'Collector', rips: 12, mythics: 1, earnedUsd: 30 }] };
    await page.locator('#pollBtn').click();
    await page.waitForFunction(() => document.querySelector('#boxRows').textContent.includes('Mythic'));
    assert.equal(await page.locator('#tab-boxes').getAttribute('aria-selected'), 'true');
    payload.latest.sources['trix.boxes'].topCollectors[0].username = 'A'.repeat(40);
    await page.locator('#pollBtn').click();
    await page.setViewportSize({ width: 320, height: 844 });
    await page.waitForFunction(() => document.querySelector('#boxRows').textContent.includes('A'.repeat(40)));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.box-board-grid > section')].every(el => el.getBoundingClientRect().width <= document.getElementById('boxRows').getBoundingClientRect().width + 1)), true);
    payload.latest.sources['trix.boxes'] = { ok: false, status: 404, stale: true, topCoins: null, biggestPulls: null, topCollectors: null };
    await page.locator('#pollBtn').click();
    await page.waitForFunction(() => document.querySelector('#boxRows').textContent.includes('404'));
    await page.locator('#tab-boxes').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#tab-coins').getAttribute('aria-selected'), 'true');
    console.log('PASS: on-chain box leaderboard, box types, fallback to official rows, and keyboard tabs');

    payload.latest.takenAt = new Date(Date.now() - 3600000).toISOString();
    await page.locator('#pollBtn').click();
    await page.waitForFunction(() => document.querySelector('#syncStatus').textContent.includes('delayed'));
    statusCode = 503;
    await page.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() + 25 * 60_000; });
    await page.locator('#pollBtn').click();
    await page.waitForFunction(() => document.querySelector('#syncStatus').textContent.includes('Connection lost'));
    assert.match(await page.locator('#activityRows').textContent(), /NEWTRADE/);
    assert.match(await page.locator('#trixDeskStatus').textContent(), /Stale data/);
    assert.doesNotMatch(await page.locator('#activityRows').textContent(), /<1m ago/);
    statusCode = 200;
    payload = fixture();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#syncStatus').textContent === 'Collector current');
    payload.latest.sources['trix.money'].recentTrades = [];
    payload.latest.sources['trix.geoff'].records = [{ id: 'retained-gen', feeLamports: 50, createdAt: new Date().toISOString() }];
    await page.locator('#pollBtn').click();
    await page.locator('#tab-activity').click();
    assert.match(await page.locator('#activityRows').textContent(), /No trades reported/);
    assert.doesNotMatch(await page.locator('#activityRows').textContent(), /retained-gen/);
    console.log('PASS: delayed collection, failed fetch, retained data and recovery');

    const blocked = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await blocked.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ status: 200, body: '' }));
    await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'QuotaExceededError'); }; });
    const blockedPage = await blocked.newPage();
    blockedPage.on('pageerror', e => errors.push(e.message));
    await blockedPage.goto(base);
    await blockedPage.waitForFunction(() => document.querySelectorAll('#coinRows tbody tr').length === 20);
    await blockedPage.locator('#pollBtn').click();
    assert.match(await blockedPage.locator('#syncStatus').textContent(), /current/);
    payload = { latest: null, events: [], briefing: {}, config: { mode: 'vercel' } };
    await blockedPage.reload();
    await blockedPage.waitForFunction(() => document.querySelector('#coinRows .desk-empty'));
    assert.equal(await blockedPage.locator('#coinRows tbody tr').count(), 0);
    await blockedPage.locator('#tab-money').click();
    assert.equal(await blockedPage.locator('#moneyRows .desk-money-tile').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: blocked storage and empty desk still render; no uncaught JavaScript errors');
    await blocked.close();
    await context.close();
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
