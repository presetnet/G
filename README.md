# Geoff Thermometer

Live **sniffer · translator · dashboard** for [geoff.ai](https://geoff.ai) deploys and [Stacknet](https://stacknet.magma-rpc.com) API heat.

Designed to deploy on **Vercel** with a **shared live desk** (same feed in every browser, including incognito) or run locally with a persistent file store.

## Signals

| Source | Endpoint | What we track |
| --- | --- | --- |
| geoff.ai build | `/api/version` | `buildId` |
| geoff.ai deploy | HTML | Vercel `dpl_*` + chunk fingerprint |
| Stacknet health | `/health` | version, status, MCP contract, in-flight |
| Stacknet network | `/network/summary` | nodes, GPUs, VRAM, models, capabilities, SOL |
| Stacknet models | `/v1/models` | OpenAI-compatible model cards + caps |
| Stacknet widgets | `/widgets` | public widget catalog |
| Stacknet node | `/node` | node id / tasks |
| Geoff catalogs | `/api/catalog/*` | optional auth cookie / preview code |
| TRIX Packs | `/api/mkt/state` | API-reported Pack mints + Card odds and gross reward multiples |

The translator turns diffs into a readable feed and a **temperature** score (cool → blazing).

## Deploy on Vercel

1. Import this repo in Vercel (root directory).
2. Framework preset: **Other**
3. Output / static: `public` (see `vercel.json`)
4. Deploy.

On Vercel, history is **universal** — one shared desk for every browser (incognito included). `/api/status`, `/api/poll`, and `/api/market` are read-only views of that desk. Browser traffic never triggers upstream probes.

The protected Vercel `/api/tick` cron is the only automatic collector. It runs a lightweight TRIX pass every minute and substitutes one full pass every 15 minutes. The minute pass reads the latest 48 generation records directly. A one-time historical pass traverses five mints per minute from the public launch catalog (863 at implementation time), retaining up to 2,000 deduplicated paid Geoff records. During backfill this is at most six TRIX requests per minute; afterward it is one. Redis is the preferred shared desk; the GitHub `gt-live` branch is the fallback and only receives minute writes when TRIX data or backfill progress changes. Browser refreshes only read the shared desk; the public `/api/sniff` endpoint is disabled. The GitHub workflow is manual recovery only.

Required on Vercel:
- `CRON_SECRET` (protects `/api/tick`)
- `GT_GITHUB_TOKEN` when Redis is not configured

Optional:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `GEOFF_COOKIE` / `GEOFF_PREVIEW_CODE`
- `POLL_INTERVAL_MS` (local only)
- `GT_ENABLE_POLLER=1` (explicitly enables automatic local polling; disabled by default)
- `GT_MAX_OUTBOUND_CONCURRENCY` (default `3`)
- `GEOFF_BASE_URL` / `STACKNET_BASE_URL`
- `GT_GITHUB_TOKEN` (GitHub shared desk or optional Redis cold mirror)
- `GT_REDIS_KEY` (default `gt:live:desk`)

## Local

```bash
npm install
npm start
# http://localhost:3847
```

```bash
npm run sniff   # one-shot CLI sniff
npm run dev     # watch mode
```

## Market deep dive

Home page stays the Geoff Thermometer. Use **Market deep dive** → `/market.html` for a separate Apple-clean comparison of **Geoff · Grok · OpenAI · Copilot** (catalog + live status).

## API

- `GET /api/health`
- `GET /api/status` — stored shared snapshot
- `POST /api/poll` — read-only stored snapshot refresh
- `GET /api/sniff` — disabled (`410`)
- `GET /api/stream` — SSE (local only)
- `GET /api/market` — stored/static competitor catalog
