# TRIX API audit and lower-cost build handoff

Audited live 2026-09-13 UTC by ASTRA. Scope: current main bundle plus 26 directly referenced chunks and selected unauthenticated GET endpoints. This identifies missing coverage, not the date each upstream feature launched. Existing uncommitted TRIX legal/Pond0x work must be preserved.

## Confirmed evidence

Entry: `/assets/e-D4LtBQY7.js`; main: `/assets/m-D20d-9F_.js`.

| Endpoint | Live result | Priority |
| --- | --- | --- |
| `/api/artworks?pageSize=2` | 200 `{items,nextCursor}`; following returned cursor yields two different artwork IDs and another cursor | P0: real history backfill |
| `/api/artworks?limit=2` | 200 legacy array | Keep compatibility |
| `/api/posts?limit=20` | 200 `{posts,nextCursor,nextCursorId,nextCursorValue,hasMore,promotedPostId,promotedSlot}`; rows include ID, createdAt, memeTokenMint, memeGenerator, reactions/replies | P1: distinct social/generator evidence |
| `/api/boosts/active` | 200 array `{chain,tokenAddress,expiresAt}`; one active boost at observation | P1: expiry-aware enrichment |
| `/api/coin-verifications` | 200 array `{chain,tokenAddress}`; 128 entries at observation, including Solana and Robinhood | P1: authoritative current verification |
| `/api/news` | 200 `{dispatches}`; IDs, coinMint, headline, body, tag, createdAt; observed satirical/fictional content | P2: optional labeled content archive |
| `/api/footer-prices` | 200 BTC/ETH/SOL prices and 24h values; no observed source timestamp | P2: mostly duplicates existing market context |
| `/api/mkt/g` | 200 anonymous genesis/access defaults, including maxOrderQty=20 | Do not infer global ownership/activity |
| `/api/mkt/state` | 404 | Existing fallback remains necessary |
| `/api/void/quest-totals`, `/api/payg/config` | 401 | Auth-gated; no collector |
| `/api/artworks/cursor` | 404 Artwork not found | Client query-cache key, NOT the pagination endpoint |

Pagination evidence: chunk `m-DSDcOVPd.js` uses queryKey `/api/artworks/cursor`, but actually fetches `/api/artworks?` with `pageSize` and optional `cursor`. It consumes `items` and `nextCursor`, deduplicating by artwork ID. Existing `server/sniffer.js` comment near TRIX_ARTWORK_WINDOW says pagination is ignored; the new protocol supersedes that assumption. Two verified pages had IDs [48b3146a-a03e-4cee-aff1-65885090bc73,c5723138-bd75-483a-921e-167bd505b1f0] and [fc8e7e0b-f719-429b-9f56-94f1b0695950,4653a29a-fc88-4df1-96d8-dddccc865b9e].

Other bundle-discovered candidates (NOT live-verified): `/api/ohlcv/{mint}?interval=...&time_from=...&time_to=...`, holders limit 33, mint-filtered `/api/feed/trades?limit=50&mint=...`, coin-profile metadata. Admin and transaction routes were discovered as strings only; do not call them for this audit.

## Build plan (target ~45–60 minutes, not a completion guarantee)

Use Claude Sonnet 4.6 if available in the model picker; confirm actual provider pricing before calling it lower-cost. This ASTRA session cannot select a delegated model: task tool exposes no model argument, CLI is absent from PATH, inspected global config has no model/agent routing. No lower-cost build has been launched.

1. **P0, 20–25 min:** Add a small dedicated `server/trix-feeds.js` for public response validation and bounded artwork cursor reads. Preserve legacy array handling. Budget 6s/request, bounded pages, dedup IDs, reject repeated cursors, retry failed pages on resume. Keep unknown numbers null. Use existing outbound concurrency/freshness conventions; inspect them before coding.
2. **Backfill, 10–15 min:** Add `scripts/trix-backfill.js` with explicit dataset, max-pages and resume options. Persist normalized artwork history and opaque cursor checkpoints atomically under a task-specific `data/` path consistent with store conventions. Existing production snapshots must not be overwritten. Merge by upstream ID; preserve original createdAt, record fetchedAt separately. Run a bounded real artwork backfill and then rerun to prove idempotency. Report actual count, oldest/newest timestamps, remaining cursor and completion flag. A page budget being exhausted is NOT complete history. Wire stored history into the intended server payload only after inspecting current persistence; avoid orphan archives advertised as dashboard integration.
3. **P1, 10–15 min:** Add current verification + boost expiry enrichment using `(chain,tokenAddress)` joins (preserve Solana address case). Prefer existing compact rows/provenance over new cards. Public posts can be an independent source with validated IDs/time/generator/mint, but verify pagination request parameters before historical backfill. Do NOT count social posts as newly generated paid memes or infer tx signatures from `meme:<id>` strings. Distinguish generator labels from payment proof. If scope exceeds hour budget, finish P0 and explicitly defer posts/enrichment rather than claiming complete.
4. **Verification, 10 min:** Fixture tests for cursor progress, duplicates, repeated cursor, malformed JSON, empty terminal page, network failure/resume, timestamp preservation, second-run idempotency, cross-chain joins. Run existing suites below. No commit/deploy requested.

## Regression commands

```
node --experimental-vm-modules scripts/pond0x-live-test.js
node --experimental-vm-modules scripts/trix-live-test.js
node --experimental-vm-modules scripts/source-freshness-test.js
node --experimental-vm-modules scripts/provenance-test.js
node --experimental-vm-modules scripts/trix-odds-test.js
node scripts/ui-dashboard-test.cjs
```

Current full/minute source expectations are 42/19; only change if genuinely adding sources. Maintain stale evidence timestamps and suppress backfill-derived 'new activity' alerts. No new dashboard panels. Current-status lists (boosts/verifications) have no proven historical endpoint: seed them at observation time, never fabricate earlier state. The news feed must retain content-source/satire context and is deferred from the initial build.

## Execution update — 2026-09-13

Implemented P0 as a clean archive path, not a new dashboard panel:

- Added `server/trix-feeds.js` for validated `/api/artworks?pageSize=&cursor=` reads, normalization, cursor de-duplication, repeated-cursor refusal, archive merge, archive summaries, and atomic data writes.
- Added `scripts/trix-backfill.js` for explicit `--dataset artworks`, `--max-pages`, `--page-size`, `--restart`, and `--dry-run` runs.
- Added `scripts/trix-backfill-test.js` with fixture coverage for cursor progress, duplicate IDs, repeated cursor, malformed JSON, HTTP failure, timestamp preservation, save/load, and rerun idempotency.

Live backfill results:

- Command: `node scripts/trix-backfill.js --dataset artworks --max-pages 3 --page-size 100`
- Archive path: `data/trix-artworks-history.json` (ignored by git via existing `data/` rule).
- Result: 120 unique artwork IDs, API returned no `nextCursor`, archive marked `completed=true`.
- Oldest `createdAt`: `2026-06-30T16:37:41.914Z`.
- Newest `createdAt`: `2026-09-13T18:49:22.915Z`.
- Normal rerun skipped because archive is complete.
- Restart sample command: `node scripts/trix-backfill.js --dataset artworks --max-pages 1 --page-size 100 --restart`; fetched 1 page, merged `newItems=0`, count stayed 120.

Notes:

- `/api/artworks?pageSize=2` produced cursors during audit, but live `pageSize=100` returned the full current archive in one page with no cursor. Treat `completed=true` as current API evidence, not a guarantee that TRIX will never paginate differently later.
- No new dashboard panel or event source was added. The archive is intentionally quiet and does not create backfill-derived activity alerts.
- P1 boosts/verifications/posts/news remain deferred; the priority build completed P0 artwork cursor/backfill only.
