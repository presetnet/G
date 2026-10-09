# Public stack audit — 9 October 2026

## Scope and evidence

Observed approximately **18:35–18:48 UTC**. This audit covers the 52 sources in the deployed dashboard, live first-party and third-party public routes, rendered pages, shipped client code, the verified Simulation contract and block-pinned state, public Solana protocol accounts, Git/deployment metadata, and the local dependency/test state. It is a public-surface and telemetry audit, not access to private repositories, authenticated account records, or an exhaustive smart-contract security audit.

**The 4,500 and 8,000 values are user-supplied investigative hints. Neither is established here as an automatic release trigger.**

Evidence is saved locally under `data/public-audit-2026-10-09/` (ignored by Git):

- `manifest.json`: 37 initial public fetches, times, HTTP status, final URLs, server dates, cache age, and SHA-256 of original response bodies.
- `summary.json`: source-by-source production freshness and public API summaries.
- `followup.json`: Ethereum block-pinned reads, Solana account reads, payout signatures, and selected production telemetry.
- `deep.json`: first-party SIM formulas/counts, historical Ethereum reads, bundle hint searches, and source-health totals.
- `SimulationTypes.sol`: verified source obtained from Blockscout.
- Public response bodies and relevant client bundles. Credential URL parameters are redacted before saving; original-response hashes therefore need not equal redacted-file hashes.
- Rendered browser observations below complement HTTP bodies. This matters: SIM's initial HTML says “NOT OPEN YET,” but the hydrated page shows working collapse recipes.

## Executive findings

1. **Our SIM supply collector is wrong after burns.** Production reports 9,619; Ethereum, SIM's gallery API, and a fresh Blockscout token response agree on **5,131**. `sniffMagmaEth()` clamps supply to its historical maximum.
2. **Prepaid rig entitlement is separate from a running miner and from payout availability.** The Pond client gates activation on `user.miner_hash`, starts a signed session, then runs a browser worker. A missing entitlement flag can show “Activate” even when the user expects prior payment to qualify. We did not inspect an individual account or establish a particular payment failure.
3. **The tracked mining payout route is inactive in the observed period.** Its latest account signature is **2026-08-27 15:40:03 UTC**. The third-party mining page says claims OFF; its historical archive was generated August 11. This cannot establish the status of every possible replacement payout route.
4. **4,500 SIM watch:** current live supply 5,131 leaves **631 net reductions** if the hint refers to outstanding ERC-721 supply. No 4,500 trigger was found in the reviewed SimulationTypes source or loaded main client bundle.
5. **8,000 TRIX watch:** DOSWAPZ reports **7,030 receipts/boxes**, leaving **970**. It now publishes a valid BuyPack program and pack-config address, independently confirmed to exist and be linked by ownership on Solana. No verified 8,000 unlock condition was found.
6. **DIBZI changed materially:** 3,303 names, **one open auction**, 42 morphed names. Its rendered announcement explicitly says **“One-time 0.1 SOL immutable.”** Morphing is not mining or an income promise.
7. **Git attribution correction:** Geoff's current official docs link **`github.com/geoffai`**, not the hyphenated `Geoff-ai` account used in the old case file. The linked organization has three empty public repositories.
8. **Dependency audit worsened:** installed `proxy-addr@2.0.7` has a critical advisory; `qs@6.15.3` has moderate advisories. Available fixes are reported. Tests still pass 29/29; passing fixtures do not validate live semantics.

## 1. Mining: prepayment, recognition, execution, payout

### What the actual client does

Source: [Pond mining](https://www.pond0x.com/mining), dynamically loaded `/_next/static/chunks/91199.6fb0890139cbf021.js`.

| Stage | Public code evidence | Interpretation |
|---|---|---|
| Entitlement | Button label is effectively `user && user.miner_hash ? "Mine" : "Activate"` | Connecting a wallet alone is insufficient. Prepaid activation must be reflected in the authenticated user record. |
| Activation offer | `scription:{activate:true}`, `path:"accounts"`, `key:"miner_hash"`; minimum 1 SOL, displayed options 1/10/20 SOL | A payable activation flow exists. This is not an instruction to pay again. Historical entitlement terms cannot be inferred from today's offer. |
| Boost | Separate `key:"miner_hash_sol"`, `hashboost:true`, minimum 0.01 SOL | Boost is distinct from activation. A boost payment is not proof the activation flag was set. |
| Session | Signs “Securely connect xMiner to network”; session result passed to the rig | Recognition of activation is only the first gate. |
| Work | Loads `/mining-worker.js`; client logs identify `xMiner::2.7`; broadcasts `peer_hash_validation` through `peersx` | Executable browser-work code exists. Its existence does not prove the reward backend is serving this user. |
| Status | Polls `/api/user/minesession/...`; handles JOINING, RUNNING, CLAIMING, EXPIRED | Server-reported session state is needed to establish productive mining. |
| Claims | Default `min:1e8`; warns stopping below minimum results in zero claims | Local animation/hashrate is not a settled payout. |
| Environment | Displays “Connecting to Cluster: public-beta” | Beta branding is confirmed. It does not establish a future launch date. |

The FAQ says mining begins after the check-in window and SOL is required. The page's initial unauthenticated view is “Activate to start mining / CONNECT WALLET.” This generic text does **not** prove a paid miner needs a new rig.

### Specific recognition failure worth investigating

The client has two account-state paths:

- The Mine/Activate gate reads `g = useUser()` from the authenticated user store (`getUserForStore` / `refreshUserDataForStore`).
- Wallet changes and activation-modal changes call `updatePondAccount(...)` on a separate store.
- The payment component confirms a Solana transaction, then posts its signature and `path/key` to `/api/user/chx`.
- The activation modal uses `onTransactionSuccess: ex ? ew : undefined`; the observed activation branch does not explicitly call the authenticated store's `refreshUserData`.

**Finding: a credible state-refresh/account-crediting failure path, not a proven diagnosis.** Chain payment, backend crediting, and browser user-store refresh are different steps. A legacy activation migration/reset was not documented in the reviewed public surfaces.

If someone already prepaid, the useful support question is: **“Is my previous activation credited to the account's `miner_hash` entitlement used by the current xMiner client, and are the authenticated account and connected Solana account aligned?”** Merely offering another activation payment does not answer that.

The user's clarification establishes that prepayment is required. It does not by itself identify when they paid, which historical product they paid for, or the backend status of their account.

### Payout evidence and age

- [Tracked reward token account](https://solscan.io/account/2Ag1QgyyJj2nS6nD6SLbpAUFaWPhaDrmHwrGwWpMqV9K): latest signature August 27, independently queried from Solana mainnet. Roughly **43 days without new activity on this account** at audit time.
- [Third-party mining dashboard](https://wpond-mining-dashboard.vercel.app/): claims OFF, facet OFF.
- Production telemetry: `miners60m:0`, `payouts60m:0`, latest payout date August 27. These miners are inferred from payouts, **not a census of running rigs**.
- [Archive](https://wpond-mining-dashboard.vercel.app/band-claims-archive.json): generated **August 11**, 16,095 claims, 2,686 wallets. Its 30/90/180-day windows are anchored to that archive, not today.
- Archive top-level `totalWpond` differs from `periods.all.totalWpond` (about 10.342T vs 6.686T). Do not interchange them without establishing their definitions.

**Conclusion:** not enough evidence to call this simply “pre-launch.” There is real mining client code, an entitlement gate, historical payouts, and current inactivity on the monitored reward route. Our dashboard should expose those four facts separately.

## 2. The Simulation and the 4,500 hint

Contract: [`0xc3706195ff60658585b58716717ee7acc5ebca60`](https://etherscan.io/address/0xc3706195ff60658585b58716717ee7acc5ebca60#code), Ethereum mainnet.

### Block-pinned facts

At block **26,156,713**, **2026-10-09 18:41:47 UTC**:

| Metric | Value |
|---|---:|
| `totalSupply()` | **5,131** |
| `nextTokenId()` | 11,449 |
| Lifetime issued, `nextTokenId - 1` | 11,448 |
| Lifetime burned, issued minus live supply | 6,317 |
| Difference above 4,500 | **631** |
| `collapseFee()` | **0.003 ETH**, excluding gas |
| `formulaCount()` | 14 |
| Active formula IDs | **8–14** |
| Inactive formula IDs | 1–7 |

The same 5,131 supply is independently returned by [SIM gallery counts](https://sim.tech/api/mainnet/gallery-counts) and [Blockscout token metadata](https://eth.blockscout.com/api/v2/tokens/0xc3706195ff60658585b58716717ee7acc5ebca60).

The source's initial fee is 0.0069 ETH, but the **current state is 0.003 ETH**. Reading a source initializer alone would give the wrong current fee.

### Active recipes

The [first-party formulas API](https://sim.tech/api/mainnet/formulas) agrees with the active IDs from the contract. Names below come from that API; input modes/quantities are also checked on-chain.

| ID | Inputs | Output | Net supply reduction per successful collapse |
|---|---|---|---:|
| 8 | 4 of the same allowed primitive type | DESCENT | 3 |
| 9 | Any 2 allowed primitives | FRACTURE | 1 |
| 10 | 6 UNDO | OVERDO | 5 |
| 11 | Any 12 allowed primitives | STATIC | 11 |
| 12 | 3 UNHOLY | QUANTUM | 2 |
| 13 | 3 UNREALITY | WAVE | 2 |
| 14 | Any 6 allowed primitives | MATRIX | 5 |

Each collapse burns its inputs and issues **one replacement**, so input count is not net contraction. This table is descriptive, not a recommendation to destroy assets to pursue an unconfirmed milestone.

### Recent supply movement

Historical reads are pinned to actual block timestamps:

| Sample | Timestamp UTC | Live supply | Issued lifetime | Net reduction to audit block |
|---|---|---:|---:|---:|
| ~1 hour | Oct 9 17:41:23 | 5,136 | 11,447 | 5 |
| ~6 hours | Oct 9 12:40:23 | 5,141 | 11,446 | 10 |
| ~24 hours | Oct 8 18:36:35 | 5,151 | 11,444 | 20 |

These windows imply highly variable pace. There is no defensible scheduled arrival date for 4,500 from these observations. The owner can also mint/airdrop and change formulas/fees.

### Is 4,500 “magic”?

- No literal 4,500 threshold or total-supply-dependent release branch was found in the reviewed `SimulationTypes` source. `collapse` checks active recipe, input count/types, ownership and fee; it does not unlock a new phase when total supply crosses 4,500.
- No 4,500 literal was found in the loaded main SIM client bundle searched here.
- An operator could still act manually, publish a new recipe, update artwork, or run an off-chain event at that number. This audit cannot exclude a private plan.
- The current monitor's **6,000** target is hardcoded in `server/sim-pulse.js:5`. It should become a configurable, explicitly user-supplied **4,500 watch hypothesis**, not a claimed contract rule.

### Our supply bug and an upstream index inconsistency

`server/sniffer.js:5803–5805` assumes supply only grows and uses `Math.max(rawSupply, prevSupply)`. Production consequently shows **9,619** while fresh chain state shows **5,131**, an overstatement of **4,488**.

Blockscout also reports 8,590 holders alongside 5,131 live ERC-721s. If “holders” means current nonzero owners, that is impossible. Treat the holder index as inconsistent/stale until reconciled; do not infer adoption from it.

The initial `sim.tech` HTML says “NOT OPEN YET.” **Browser rendering replaces that placeholder with the live collapse interface**, seven active recipes, and recent collapse activity. Raw HTML alone produces a false pre-launch reading here.

## 3. TRIX boxes and the 8,000 hint

### Current public facts

- [Global gate](https://trix.market/api/mkt/g) and [alias](https://trix.market/api/mkt/preorder): `isGenesis:true`, `canReserve:true`, `canOpen:false`, `maxOrderQty:20`.
- `owned:0` is the anonymous response, not a claim about a connected user's holdings.
- `/api/mkt/state`: 404; `/api/mkt/leaderboard` on **www also returns 404**. The previous assertion that www still works is not supported by today's live check.
- Anonymous eligibility: 401.
- [DOSWAPZ box feed](https://doswapz.com/api/trix-boxes): **7,030** minted/receipts, **708** collector wallets, largest sampled count **384**, `boxesLeft:null`, `availableCap:null`.
- Difference to user-supplied 8,000: **970**, or 87.875% of the hypothesized milestone reached. This is not an official allocation percentage.
- The same feed reports 18,410 post-sequence arrivals and 1,069 launches. Its slower census is 14,388, timestamped **September 27**. These are different counters and freshness levels.
- The individual box rows still carry `stale:true`; a fresh top-level timestamp does not refresh those rows.

### BuyPack provenance is now available

The third-party feed's `chain` object publishes:

- Program: `HTrrq6C6j9NYySUrpSLn9nDjFbKNBD6pS3xBuLppfW4F`
- Pack config: `AZxmdJhmHLYg3tufFjUq6Ujm41VBFZ2DAjQGb14Qoou`

Independent Solana reads at slots **454,962,121–122** confirm the program is executable and the 106-byte config account is owned by that program. The config bytes contain little-endian 7,030 at offset 17, corroborating the published count at a raw-data level. **We have not established the field layout from a verified IDL or independently enumerated all receipts**, so this is not a complete purchase-account audit.

The old temporary program string omitted characters. The published full address above is valid and exists. Our source's blanket statement that no public source names the program is now outdated; an official TRIX publication remains distinct from the third-party attribution.

### Is 8,000 an unlock?

No 8,000 unlock appeared in the reviewed preorder bundle. The global `canOpen` remains false. A generic `8e3` elsewhere is an **8-second UI timer**, not a box threshold. No 8,000 unsigned 64-bit value appeared in the sampled config bytes, but that narrow byte check cannot disprove a threshold in program code or a backend.

Watch **both count and state**: 8,000 crossing, `canOpen`, `canReserve`, round/genesis changes, and actual opening transactions. A count crossing without a gate change proves only the count crossed.

During this browser session, navigating to Preorder produced “Something went wrong”; the console also reported price-websocket handshakes returning HTTP 200. That is a reproducible observation in this audit environment, not proof every user is affected or that both errors share a cause. The API gate can be healthy while the page fails.

## 4. DIBZI

From [config](https://dibzi.ai/api/config), the full [names response](https://dibzi.ai/api/names), and the rendered [About page](https://dibzi.ai/about):

| Metric | Observation |
|---|---|
| Network | mainnet |
| Names returned | **3,303** |
| Open at site clock | **1** |
| Open name | `superintelligence` |
| Current bid | 0.069 SOL, one bid |
| Computed next step | 0.099 SOL under `max(0.03 SOL, 7.5%)` |
| Morphed names | **42** |
| Morph enabled | true |
| Flash sale | inactive |

About-page economics are more detailed than the config's single opening value: opening bids **0.069–0.33 SOL** by tier, buy-now **1 SOL**, six-hour auctions with final-15-minute extensions, outbid refunds less a **5% platform fee**. Resolution renews at **0.1 SOL/year**; name ownership itself does not expire.

The current announcement says **“MORPH YOUR DIBZI — One-time 0.1 SOL immutable.”** That is a site-published product term, not independently executed here. It is separate from opening a name auction and from the annual resolver fee.

The About page calls this a proposed context namespace, and explicitly says any platform usage-metering/value-sharing integration would need to be built by that platform; DIBZI makes no commitment to provide it. Do not turn that possibility into guaranteed royalties, mining or a launch date.

## 5. Geoff / StackNet / docs / MCP / SDK

| Surface | Fresh result | What it establishes |
|---|---|---|
| `geoff.ai` | HTTP 200, redirects to www | Website available |
| `/api/version` | `67b16b37c435e7aec84cf034d9f1ad9b48ddba39` | Current published build identifier |
| StackNet `/` and `/health` | `{"status":"ok"}` | Basic service response, not fleet capacity |
| `/network/summary` | 401 | Current node/GPU/load/treasury data unavailable anonymously |
| `/node` | 404 | Old public node route unavailable |
| `/widgets` | 401 | Public inventory withheld |
| Node-key pile and pricing | 401 | Cannot establish current key-sales totals/prices |
| `/v1/models` | **magma, pyro, pyro:max, jef** | Four advertised public model IDs |
| `mcp.geoff.ai/mcp` | **500**, GEOFF_API_KEY configuration error | Public MCP endpoint remains misconfigured on this probe |
| `@stacknet/x402payg` | **0.3.7** | Published SDK artifact, not proof of live billing settlement |

**New catalog point:** `jef` advertises a **decision** capability returning structured choices, scores or probabilities rather than normal chat. The historic `preview` and `stack-embed` are absent from this response. This does not prove they are unavailable behind authentication.

The live [Model Layers docs](https://docs.geoff.ai/introduction/models) advertise **Magma 2.1 (`magma-2.1`)**, Magma and Pyro, with 1M context claims. `magma-2.1` is not in this anonymous catalog. This is a docs/catalog discrepancy, not proof of a hidden release date or underlying provider identity.

Old case-file fleet figures (8 nodes, 7 GPUs, 871 GB VRAM, unpaid metaproof totals) must remain **historical**. The production feed retains September timestamps and marks these sources expired. A healthy `/health` must not revive them as current.

## 6. AZY and other public surfaces

### AZY

[azy.life](https://azy.life/) renders an active Posts/Activity/Icons application. Its HTML is a Vite-style shell with a leftover canonical/OG host of `azy.replit.app`; that is a deployment/configuration clue, not proof of backend ownership.

Fresh public APIs:

- `/api/posts?limit=20&offset=0`: **61,151 posts** reported; newest returned post timestamp 18:00:21 UTC on Oct 9.
- `/api/items`: **89 items**, **87 enabled**.
- `/api/agents`: **15 configurations**, provider labels **13 `grok` / 2 `together-llama`**. These are published configuration labels, not packet-level verification of execution.
- `/api/auth/user-info`: 401 in an unauthenticated browser, as expected.

Our stored AZY rail reports **226.405224789 SOL / 2,937 inbound events**, 95 retained unique payers, campaign since Sep 24; five trailing-day events totaling 0.0108 SOL. These are **our collector's aggregate observations**, not independently replayed in full during this audit.

Important attribution: `geoff.keys.9g` and `azy.chain` both inspect `9GjEVnpWiLe2uknUmtaH6DSfgcBvL66DtSKGREXDctZU`. Incoming SOL to the same address is not independently evidence of Geoff node-key purchases and AZY spending. Avoid treating the two labels as additive revenue streams.

### Pond homepage

Rendered totals: **53,246,740 swaps**, **$43,094,239 total rewards** (raw stored value $43,094,238.54959206), pondSOL displayed APY **9.45%**, Spawn displayed **98.9%**. These are the site's aggregate/UI claims, not new mining payout evidence or guaranteed future yield.

### OpenCode comparison surfaces

Zen model catalog and Go page return 200. Latest public OpenCode release is **v1.18.35, October 6**. These are comparison feeds. Neither an overlapping label nor an anonymous model name establishes a shared upstream with StackNet.

## 7. Git, deployment, dependencies and operational data

### Git and deployment

- Local `main` and `origin/main`: **`1a4a01e52c74cc40943bd7876195d4f91a317dce`**.
- Origin: `presetnet/G`; source was clean before this audit's report/scripts.
- GitHub production deployment **6800771057** marks that SHA successful on **October 2**, at `https://g-kqdecx8dm-nicks-projects-beec597b.vercel.app`.
- Public homepage configured in GitHub: `https://g-eight-psi.vercel.app`.
- `golden` remote main: **`46490a1870b093ad1166d70a9fc318d4311c4069`**, behind origin's later work.
- The live site's health reports **GitHub shared storage at `goldennftplatform-svg/gt`, branch `gt-live`**. This is a different repo/branch from code origin.
- That data branch was actively ticking: observed commit `caf5c5829e3052fcadd46a798244bde66eb68177`, October 9 18:40:14 UTC.
- Health responding is corroborated by recent snapshot/data-branch timestamps; cron wiring alone would not prove the collector ran.

### Correct official Geoff GitHub link

The current docs link [GeoffAi](https://github.com/geoffai), organization created **August 26, 2026**, `blog:https://geoff.ai`:

- `GeoffAi/Director-1.5`
- `GeoffAi/Geoff-v1.8`
- `GeoffAi/Studio-2`

Each contents API reports **“This repository is empty.”** Names do not establish released source or product versions. The hyphenated `Geoff-ai` account's old trivial repositories are a different namespace and should not be used as the project's official development history without additional attribution.

### Runtime stack

Local package: ESM Node app, Node >=18, Express **5.2.1 installed**, ethers **6.17.x** dependency range, static browser modules. Vercel functions declare a 60-second maximum and one-minute protected tick schedule. The full pass occurs every 15 minutes; minute passes update selected sources. Storage uses GitHub in the observed deployment, even though Redis support exists in code.

Snapshot sampled at **18:38:09 UTC**:

- **52 sources**, **43 `ok:true`**, **9 unavailable/failed**.
- Failed: `geoff.catalog`, `trix.boxes`, `trix.boxchain`, `stacknet.network`, `stacknet.pile`, `stacknet.keysale`, `stacknet.node`, `stacknet.widgets`, `solana.treasury`.
- TRIX treasury signatures and Solana treasury reads encountered **429** rate limits.
- Docs coverage is **22/24 sampled pages**, not a full documentation crawl.
- `ok:true` includes intentionally successful probes of error shapes; it does not mean every source represents an operational end-user product.

### Dependency/security findings

`npm audit --omit=dev --json` reports:

| Package | Installed | Severity | Advisory / recommendation |
|---|---|---|---|
| proxy-addr | 2.0.7 | Critical | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), affected below 2.0.8; update and review trust-proxy use |
| qs | 6.15.3 | Moderate | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g); update to a fixed version, including >=6.16.0 for the latter |

This establishes vulnerable installed dependencies, not a demonstrated exploit against the deployment. No explicit `trust proxy` setting was found in the reviewed server entry point. The old `/api/rpc-endpoint` warning was not re-established in current `api/` or `server/index.js`; do not present that historic claim as a newly verified exposure.

`npm test`: **29 passed, 0 failed**. `git diff --check`: clean at review. No application or dependency fixes were applied in this audit.

## 8. Findings in our measurement logic

| Priority | Finding | Required correction |
|---|---|---|
| P0 data | `sniffMagmaEth` peak-clamps a burnable supply | Report block-pinned current supply, issued lifetime, burned lifetime and net change separately. Preserve provenance rather than enforcing monotonic supply. |
| P1 operations | Vulnerable installed proxy-addr / qs | Update lockfile deliberately, verify runtime paths, run suite. |
| P1 data | SIM target remains 6,000 | Store 4,500 as a user-supplied hypothesis; no automatic-unlock claim. Keep prior target history. |
| P1 mining | Payout-derived `miners60m` can be mistaken for active rigs | Rename to paid-recipient estimate; expose payout-account scope and last-activity age. Add public client/entitlement-gate evidence without collecting personal sessions. |
| P1 attribution | `geoff.keys.9g` and `azy.chain` overlap | Require product-specific receipts before attributing deposits; avoid double-counting the address. |
| P1 data | Unique-payer/sender arrays cap at 400 | `sniffer.js:4962` and `:5441` retain at most 400. Production SIM SOL and ETH unique counts equal 400: label capped/lower-bound rather than exact participation. |
| P1 TRIX | New public program evidence conflicts with prior no-program claim | Record third-party publication plus verified executable/config ownership. Obtain/verify IDL before decoding named fields or asserting an unlock threshold. |
| P2 TRIX | `sniffTrixPreorder` sets `ok=true` even after invalid state response | Separate primary gate success from ancillary probe success; unknown must not be healthy. |
| P2 DIBZI | Increment parser extracts a SOL number and percentage without validating `max(...)` semantics | Reject changed operators/rules; a future `min(...)` must not silently be computed as max. |
| P2 DIBZI | Open-board filtering tests deadline only | Validate settlement/cancellation semantics before promising an item is biddable. |
| P2 freshness | Static archive windows and stale nested box rows | Carry original data timestamps into each metric; retrieval time is not observation time. |
| P2 docs | Historical case file overstates current availability/attribution | Keep historical observations labeled; correct official GitHub namespace and docs/catalog drift. |

## 9. Concrete next-step watchlist

1. **Repair the live-supply measurement first.** Use the independently agreeing 5,131 value, not 9,619, when discussing the 4,500 hint.
2. **Track 4,500 as a hypothesis:** distance, actual net contractions, `FormulaCreated`, `FormulaActiveUpdated`, `CollapseFeeUpdated`, renderer/metadata and site-section changes. Operator action matters more than numerology.
3. **Track 8,000 as a hypothesis:** count, source provenance, `canOpen`, `canReserve`, round/genesis changes, opening receipts, and a verified account schema. At this audit, the gap is 970 and opening remains disabled.
4. **Treat existing paid rigs as an entitlement-reconciliation issue first.** Verify old activation credit is represented in the current user store; only then investigate session/worker/reward state. Do not use another activation purchase as a diagnostic test.
5. **Replace stale mining narrative with scoped facts:** no recent activity on the tracked payout account, historical archive age, present client version, and no confirmed migration announcement found.
6. **Fix dependency and provenance issues**, especially overlapping revenue labels and capped participant counts, before adding broader “launch” conclusions.

### What remains unproven

The user's individual entitlement; whether old prepaid rigs were migrated or reset; every possible mining payout channel; private development activity; a 4,500 or 8,000 automatic trigger; guaranteed DIBZI integrations/revenue; and a relationship between anonymous OpenCode models and StackNet upstreams. Those are open questions, not facts to fill in from the available numbers.
