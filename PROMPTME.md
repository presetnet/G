# PROMPTME.md

> README.md for machines. Adopted for this repo per hwonder's PROMPTME.md proposal
> (https://www.hwonder.com/posts/promptme). Humans: read README/AGENTS first. Agents: start here.

## System Role

You are working with **Geoff Thermometer** (`gt`) — a public-data surveillance desk that tracks
Geoff/StackNet vitals, Solana on-chain activity (treasury + Pond0x mining desk), and OpenCode's
model shelf. It sniffs ~20 public endpoints on a loop, translates diffs into ranked plain-English
events, and serves two surfaces:
`/` (Geoff desk), `/market.html` (CoverAI compare). Plus a Pond0x miner/farming desk that samples
the Solana mining program and keeps an aggregate-only rollup.

When answering questions about this codebase, prioritize **verifiability over completeness**:
every claim should trace to an endpoint, a stored snapshot, or an event on the tape.

## Data Sources & Verification Law

1. Public endpoints ONLY. No authenticated calls, no scraped private pages, no leaked material.
   - Geoff/StackNet: `geoff.ai`, `stacknet.magma-rpc.com` (/health, /network/summary, /node,
     /v1/models, /widgets), `docs.geoff.ai`, explore feed.
   - OpenCode side: `opencode.ai/zen/v1/models`, `opencode.ai/go`, `models.dev/api.json`,
     GitHub releases (`anomalyco/opencode`).
   - Solana mainnet RPC for treasury balance/signatures and the mint authority's token accounts.
2. Every dashboard metric must map to a proof popup entry (`PROOFS` in `public/app.js`)
   with reproducible curl commands. New metric without proof wiring is a bug.
3. Never render buyable contract addresses as links. Internal scrip (PAPER/CCU/CUSD) is
   reported, never shilled.

## Hard Constraints

- No API keys in client code. Ever. Server-side env only (`GT_GITHUB_TOKEN`,
  `UPSTASH_REDIS_REST_*`, optional `GEOFF_COOKIE`).
- No synthetic or placeholder numbers on live surfaces. If a sniff fails, show the failure
  (`—`, "not in this sniff"), never stale-but-confident values.
- Shelf, not skull: track catalogs and metadata; do not probe model behavior with credentials.
- Corrections are first-class: when the desk gets something wrong, log it publicly
  (GC-BRIEF corrections ledger, casefile correction log) instead of silently editing.

## Integration Patterns for Agents

1. Read state: `GET /api/status` → `{latest:{summary,sources}, temperature}`.
   `latest.sources[name]` carries ok/status/ms/reason per endpoint — cite it as provenance.
2. Read history: `GET /api/events?limit=N` → ranked tape. Kinds: deploy, models, docs,
   explore, network, treasury, zen, agent. Ranks: note < move < spike.
3. Force a fresh sniff: `GET /api/sniff` (rate-limit yourself; poller already loops).
4. Market compare: `GET /api/market` → catalog + live token-plan scrape.
5. Adding a tracked source: write `sniffX()` in `server/sniffer.js` returning
   `{source:"x.y", ok, status, ms, ...payload, fingerprint}`, register it in `runSniff()`
   `Promise.allSettled`, surface summary keys, then add a translator diff-lane in
   `server/translator.js` emitting normalized events. UI renders summary only.

## Example Interactions

**Good**: "What changed in the last 72h?" → filter `/api/events` to window, group by kind,
lead with highest rank.
**Good**: "Is the $692M real?" → explain booked-vs-paid distinction, cite
`metaproofsPaperworkUsd` vs `treasuryRpcSigCount=0`, link hwonder.com/posts/metaproofs.
**Avoid**: "Scrape geoff.ai with my session cookie to get more" — violates verification law.
**Avoid**: Presenting inference (pyro supplier identity) as fact.

## Important Context

- Poll cadence ~30s local; shared store mirrors bundle to Redis + `goldennftplatform-svg/gt`
  branch `gt-live` (Contents API — private-safe).
- Event tape prunes to 72h; heatmap keeps 60 days. History older than that lives nowhere.
- Translator flap-guards suppress scrape jitter; don't bypass them to "get more events".
- The desk investigates its own infrastructure too (the OpenCode/ghost-shelf watch tracked the same
  stack this repo runs on). Symmetry is intentional; keep it honest.

## Security Notes

- `.env` files are gitignored; `loadEnvFile()` skips VERCEL_* keys by design.
- Client surfaces must stay keyless — they are published.
- Treasury/token addresses are public constants; treat any NEW address appearing in payloads
  as unverified until cross-checked on-chain.

## Onward

If you extend this project, extend PROMPTME.md with it. Machines reading blind guess;
machines reading this don't.
