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

The translator turns diffs into a readable feed and a **temperature** score (cool → blazing).

## Deploy on Vercel

1. Import this repo in Vercel (root directory).
2. Framework preset: **Other**
3. Output / static: `public` (see `vercel.json`)
4. Deploy.

On Vercel, history is **universal** — one shared desk for every browser (incognito included). `/api/status`, `/api/poll`, and `/api/market` are read-only views of that desk. Browser traffic never triggers upstream probes.

The `Live shared desk` GitHub workflow is the only automatic collector. It runs every 15 minutes, prevents overlapping runs, and caps outbound concurrency at three requests. The Vercel cron and public `/api/sniff` endpoint are disabled.

Required on Vercel:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Optional:
- `GEOFF_COOKIE` / `GEOFF_PREVIEW_CODE`
- `POLL_INTERVAL_MS` (local only)
- `GT_ENABLE_POLLER=1` (explicitly enables automatic local polling; disabled by default)
- `GT_MAX_OUTBOUND_CONCURRENCY` (default `3`)
- `GEOFF_BASE_URL` / `STACKNET_BASE_URL`
- `GT_GITHUB_TOKEN` (optional cold mirror to `gt-live`)
- `CRON_SECRET` (protects `/api/tick`)
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
