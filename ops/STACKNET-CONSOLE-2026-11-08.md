# Stacknet public console inspection — 2026-11-08

## Observed, not a dated release announcement

The developer console and calculator are reachable. Documentation pages display
September 12, 2026 as their last-updated date. No previous bundle comparison was
performed, so this inspection does not establish a new deployment date.

Sources:
- https://devconsole-indol.vercel.app/docs/key-calculator
- https://devconsole-indol.vercel.app/aisp/node-keys
- https://devconsole-indol.vercel.app/aisp/running-nodes
- https://devconsole-indol.vercel.app/docs/quickstart

## Calculator verified in rendered browser and JavaScript

Client bundle:
https://devconsole-indol.vercel.app/_next/static/immutable/chunks/0b0ekuxuzb-se.js

The calculator uses February 26, 2026 as the epoch, computes elapsed whole days,
then cycleDay = elapsedDays % 90. Price = 100 + 400 * sqrt(cycleDay / 89).
At inspection the rendered page displayed day 75, cycle 3, $467.19.
This is clock-derived, not an observed transaction price or fetched sale quote.

Default assumptions: one key, 12 months, 50% utilization, $2 per million tokens.
Code computes monthly tokens = utilization/100 * 1e9 * keys; monthly revenue =
monthly tokens/1e6 * assumed rate; total revenue = monthly revenue * months.
The default output was $1,000 monthly, $12,000 total, +2468.5% ROI.
These are scenario outputs, not measured earnings. The inspected formula does
not deduct hardware/electricity costs or decrement a finite token allocation
across months. Docs describe key-bound tokens and burning remaining tokens on
filing; the monthly allocation interpretation needs clarification from the source.

## API and client availability

- `https://stacknet.magma-rpc.com/health`: HTTP 200, `{"status":"ok"}`.
- `/api/v2/node-keys/pricing`: HTTP 401, authentication required.
- `/api/v2/node-keys/pile`: HTTP 401, authentication required.
- `https://www.stacknet.org/`, `/downloads`, and
  `https://stacknet.org/download`: TLS failures from this environment.
  Browser navigation also failed. This does not establish a global outage.
- Running Nodes docs link to singular `/download`; the user supplied plural
  `/downloads`. Neither could be verified here. No executable was downloaded.

No verified public testnet points endpoint was identified in these pages. The
calculator is not a points feed and its numbers must not populate live earnings
or testnet balance metrics.

## VOID data freshness readback

The deployed dashboard API reported trix.voids checked at
2026-11-08T21:22:09.107Z, stale=false, reason=null, with 466 wallets and 664 assets.
Market join timestamp: 21:21:09.214Z; catalog timestamp: 16:46:09.099Z.
trix.meme.market checkedAt: 21:22:09.349Z, stale=false.
This confirms a recent collector check, not freshness of every underlying price
or completeness of every wallet's history. No collector was manually triggered.
