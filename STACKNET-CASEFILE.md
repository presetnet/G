# The StackNet Case File
### Is `big-pickle` secretly routed through geoff.ai / StackNet?
*Investigation log — August 22–23, 2026 — all evidence gathered from public sources*

---

## TL;DR VERDICT

| Theory | Status | Key evidence |
|---|---|---|
| **Strong:** big-pickle IS a StackNet/geoff model | ❌ **DISQUALIFIED** | Not in StackNet's catalog; zero traffic contact; timeline impossible |
| **Weak:** geoff/StackNet is an aggregator that relabels upstream capacity | ✅ **STRUCTURALLY CONFIRMED** (but not applied to big-pickle) | Their own architecture + bundle code proves relabeling is the product |
| **"2.5 years of quiet dev"** | ✅ **CORROBORATED** | `magma-rpc.com` registered 2024-03-01 |

---

## 1. The Question

Community speculation (pond0x ecosystem): is opencode's free mystery reasoning model
`big-pickle` actually a relabeled wrapper of geoff.ai's StackNet infrastructure,
operated by Pauly0x and Hwonder?

---

## 2. Client-Side Evidence (my own traffic)

**Provider audit:**
- opencode config (`~/.config/opencode/opencode.jsonc`): empty, no custom providers
- models.dev registry: baseURL = `https://opencode.ai/zen/v1`, SDK = `@ai-sdk/openai-compatible`
- big-pickle registry entry: closed weights, 200K ctx, knowledge cutoff `2025-01`, release `2025-10-17`, cost $0/$0

**Live connection tracing during active LLM sessions:**
- DNS cache + TCP table for all OpenCode processes: only `opencode.ai` (Cloudflare) + one GitHub Pages IP
- **Zero packets ever touched geoff.ai or stacknet**

**Error-shape forensics:**
- Zen gateway errors: `{"type":"error","error":{"type":"error","message":"..."}}` → Anthropic-style dialect, served from Cloudflare Workers (`Cf-Placement: remote-ORD`)
- geoff.ai runs on Vercel; StackNet docs advertise `{data, trace_id, extra_info}` envelopes
- Different hosts, different stacks, different API dialects

---

## 3. Geoff Infrastructure Recon

**Certificate transparency (Cert Spotter, full history):**

| Date | Hostname |
|---|---|
| 2026-06-21 | docs.geoff.ai |
| 2026-07-08 | mcp.geoff.ai |
| 2026-07-17 | geoff.ai, www.geoff.ai |

- No wildcard cert → list is near-complete: **4 hostnames total**, no staging leaks, no api subdomain
- Frontend: Vercel · Docs: Mintlify · Auth: StackAuth · Storage: IPFS "racks"

**GitHub:**
- `Geoff-ai` org created **2024-08-12** (id ~178M), dormant shell, 3 trivial repos
- One repo (`script`) pushed **2026-02-07** — activity 4.5 months before first cert
- `Pauly0x`: GH account Nov 2022, zero public repos
- `hwonder`: GH account 2016

**Live route mapping (unauthenticated probes):**

| Route | Status | Dialect |
|---|---|---|
| `POST /api/v1/text/chat` | 401 `{"error":{"code":"unauthorized",...}}` | Documented developer API |
| `POST /api/chat/completions`, `/api/models`, `/api/messages` | 401 `{"code":"unauthorized:auth",...}` | **StackAuth session gate** (different layer) |

Both gates reject *before* validation — no upstream leakage without credentials.

---

## 4. The Bundle Mining (where it broke open)

geoff.ai's Next.js client bundles contain no secrets by law of JS — extracted:

**Hardcoded infrastructure:**
```
https://stacknet.magma-rpc.com        ← StackNet's real address
https://node-ipfs.magma-rpc.com       ← IPFS node
https://comfy.magma-rpc.com           ← ComfyUI image backend
https://stacknet.magma-rpc.com/auth/bridge
```

**Internal route map:** `/api/stackauth/web3`, `/api/stackauth/otp`, `/api/stackauth/sign`,
`/api/connect/pair/claim` — crypto-native auth flow confirmed.

**The smoking regex** (output post-processing):
```js
/<\/think>\s*/g   // strips visible chain-of-thought markers from model output
```
Upstream models emit raw `<think>...</think>` reasoning blocks; they are cosmetically
laundered before users see them.

**MCP server misconfiguration leak** (live 500 on mcp.geoff.ai/mcp):
```json
{"error":{"code":-32603,"message":"MCP server misconfigured: GEOFF_API_KEY is required when GEOFF_API_URL is not a local address..."}}
```

---

## 5. StackNet Itself (magma-rpc.com)

**Domain registration (RDAP):**
- **Registered: 2024-03-01** via Cloudflare — five months BEFORE the Geoff-ai org
- Corroborates community claims of ~2.5 years of quiet development
- Sibling subdomains: `blockstream.` and `explorer.` (Bitcoin heritage), `stacknet-grpc.` (gRPC service)
- Certs issued as recently as **today** — active development
- Root endpoint returns versioned JSON: `{"v":"3.14.24"}`

**Chat gate message:** *"Provide API key or sign in with wallet"* — wallet-auth'd inference.

**PUBLIC MODEL CATALOG** (`GET https://stacknet.magma-rpc.com/v1/models` — no auth):

| Model | Owner | Capabilities |
|---|---|---|
| stack-embed | stacknet | embeddings |
| preview | stacknet-layer | chat, code, image, reasoning, **think**, tool-calling |
| magma | stacknet-layer | + crypto, music, video, vision, agent |
| pyro | stacknet-layer | chat, code, image, reasoning, **think**, tool-calling, vision |
| pyro:max | stacknet-layer | same as pyro |

Every layer is `owned_by: stacknet-layer` with upstream identities anonymized.
No third-party model names anywhere. **big-pickle does not appear.**

**INTERNAL FLEET SUMMARY** (`GET https://stacknet.magma-rpc.com/network/summary` — also public, no auth):

The full 29-model internal fleet is just two naming axes multiplied out:

- **Bases:** `magma`, `preview`, `pyro`, `pyro:max` (+ one oddball: `mom-preview`)
- **Product lines:** `stack-chat`, `stack-embed`, `stack-media`, `stack-vision`, `stack-voice`
- **Fleet = product lines × {magma, preview, pyro} variants**

So the intimidating "29 hidden models" are ~5 products × 3 engine tiers. The real
engine diversity is the base tier: magma / preview / pyro — three brains, relabeled
across five modalities. **big-pickle appears nowhere here either.** The strong theory
is now dead at both the public *and* internal layer.

Cluster vitals (live): 8 nodes · 7 GPUs · 871 GB VRAM (602 available, 69%) ·
averageLoad 0 · capabilities: chat, consensus, control-plane, coordinator,
image_editing, image_generation, media_generation, runtime:shell, streaming,
style_transfer, text, video_generation.

**The $692M line:** the same endpoint reports
`metaproofs: {totalPaperworkUsd: "692526478", paid: 0}` against a treasury holding
**$0** on mainnet (independently confirmed via Solana RPC: 0 lamports). Whatever
"metaproof paperwork" is, StackNet books **$692,526,478** of it — none of it paid.
Largest unexplained number in the entire investigation. Next-hunt material.

---

## 6. Final Ledger

1. **Strong theory dead four ways:** big-pickle absent from StackNet's *public catalog*;
   absent from its *internal 29-model fleet*; opencode traffic never contacts them;
   big-pickle's release date (2025-10-17) predates every geoff cert by 8 months.
2. **Relabeling mechanism confirmed real:** anonymous `stacknet-layer` branding over
   unnamed upstreams + client-side `<think>` stripping + MoM routing per their docs.
   This is an aggregator wearing a lab coat — by design, not by conspiracy.
3. **Open mystery:** WHO supplies the actual brains behind preview/magma/pyro?
   The `<think>` capability suggests R1-distill/QwQ-family routes for at least some
   layers. Unnamed by design. Same pattern, second location: opencode's own free tier
   hides a ghost shelf of upstream-anonymous models (`big-pickle`, `hy3-free`,
   `laguna-s-2.1-free`, `x-preview-f-free`, `muse-spark-1.2-contributor-free`) sitting
   next to transparently-labeled relabels (deepseek/nemotron/kimi/qwen). Anonymity is
   the industry pattern, not geoff's fingerprint — and it cuts both ways.
4. **New lead:** the $692M unpaid metaproofs (see §5). Unexplained. Follow it.
5. **Epistemological note:** platform timestamps (CT logs, RDAP, snowflakes, GitHub)
   cannot be backdated — everything above is reproducible. What operators control is
   only *when they act*. Every measured action was internally consistent with deliberate,
   patient stealth — of a launch, not of a hidden model behind opencode.

---

## 7. The Horsepower Question — What Does "Free" Cost?

*Back-of-envelope, assumptions labeled. Two cost regimes exist and they differ by 50×.*

### Regime 1: Self-hosted open-weights (the cheap world)
~70B-class model on rented H100s (~$2–3/hr), batched serving → **$0.10–0.30 per 1M blended tokens**

| Scale | Weekly tokens | GPUs needed | Weekly burn |
|---|---|---|---|
| Beta (500 DAU) | ~7B | 4–8× H100 | **$1–3K** |
| Real tier (5K DAU) | ~70B | 40–80× H100 | **$15–45K** |
| Opencode-scale (25K+ DAU) | ~350B | 150–300× H100 | **$70–250K** |

### Regime 2: Resold frontier capacity (the expensive world)
API-rate upstreams ($3–15/M output) → **multiply everything by 20–50×**.
Same mid tier: **$350K–1M+/week**. Nobody runs that free without a strategic reason
(growth subsidy or data acquisition — see Final Ledger).

### The hidden multiplier: concurrency, not throughput
A 200K-context reasoning model doesn't bill by tokens alone — every *active session*
parks a KV-cache in scarce HBM. Long-context sessions are residency-bound:
roughly 2–8 live streams per H100 even when idle-ish. Ballpark: **$0.50–1.00 per
concurrent-session-hour**. 500 always-on sessions ≈ 125+ cards ≈ **$50K+/week**
before a single token is generated. Free long-context tiers are GPU-rental businesses
whether they admit it or not.

### Catalog fingerprint
StackNet's profile (wallet-gated chat layers + embed model + ComfyUI sidecar +
versioned server v3.14.24) matches **Regime 1** — self-hosted open-weights.
That's the only version two people rationally run for fun. Regime 2 requires
a treasury burning ~$1M+/month and a reason.

---

## 8. External Validation — Auditing a Community-Built Thermometer

An independent fan-built dashboard ("Geoff Thermometer", `aisp.live` →
`g-eight-psi.vercel.app`) monitors StackNet via public endpoints only
(source: `github.com/goldennftplatform-svg/gt`). We audited it against primary sources:

| Dashboard claim | Primary source | Match |
|---|---|---|
| version v3.14.24, MCP contract string | `/` and `/health` | ✅ exact |
| node_id, task_count, in_flight/max | `/node`, `/health` | ✅ exact |
| apiModels: 5 | `/v1/models` catalog | ✅ exact |
| geoff deployId `dpl_8Nz2…` | independent geoff.ai scrape | ✅ exact |
| treasury $0 | Solana mainnet RPC: 0 lamports | ✅ exact |
| SOL ~$92 | CoinGecko: $91.90 | ⚠️ feed lag |

**Score: 8/9 checkable claims exact.** The instrument is honest.

**Correction log (kept on purpose):** during the audit we briefly claimed the
dashboard must hold hidden credentials, because our probe of `/internal/network`
returned `401 edge-auth`. Wrong. Reading the dashboard's actual source showed it
calls **`/network/summary`** — fully public; our sweep had tested `/network`,
gotten 404, and stopped one path short. Lesson recorded: verify the actual claim,
not its neighbor. No tokens exist anywhere in the deployment.

**Data-quality finding:** the dashboard's event store died 2026-08-10
(`sharedStoreBackend: "none"`, serverless memory loss). Its dramatic
"`v3.8.346 → v3.14.24` upgrade" event fired 2026-08-23 was a stale-baseline
artifact — direct probes already showed 3.14.24 ten hours earlier. Fixes
(persistent store, timestamped baselines, raw-version logging) were applied.
Version stability is real though: frozen ≥10h under direct observation.

---



```bash
# StackNet public catalog (no key needed)
curl https://stacknet.magma-rpc.com/v1/models

# StackNet server version
curl https://stacknet.magma-rpc.com/

# StackNet internal fleet + cluster + treasury + $692M metaproofs (all public)
curl https://stacknet.magma-rpc.com/network/summary

# Full opencode zen catalog (64 models; find the ghost free shelf)
curl https://opencode.ai/zen/v1/models

# Cert history
curl "https://api.certspotter.com/v1/issuances?domain=magma-rpc.com&include_subdomains=true&expand=dns_names"

# Domain registration
curl -H "Accept: application/rdap+json" https://rdap.org/domain/magma-rpc.com

# Geoff route probing (expect two different 401 dialects)
curl -s -X POST https://geoff.ai/api/v1/text/chat      -H "Content-Type: application/json" -d '{}'
curl -s -X POST https://geoff.ai/api/chat/completions  -H "Content-Type: application/json" -d '{}'
```

## Appendix B: Tests That Remain Blocked

The following would conclusively settle the remaining gap ("no evidence of X" → "X is false").
**Status: blocked — not a call to action.** Working API keys are confirmed to exist for
only a handful of people; whether any remain active is unknown, and whether self-serve
signup (`geoff.ai/settings/api-keys`) actually issues keys is unverified. Do not treat
keyholders as an available resource.

1. **Tokenizer fingerprint** — identical strings through a geoff layer vs big-pickle,
   compare exact token counts *(requires active credentials)*
2. **Temperature-0 output matching** on obscure prompts *(requires active credentials)*
3. **Latency distribution comparison** *(requires active credentials)*

If credentials ever surface organically, these three collapse the final gap.
Until then: the case stands as written — strong theory disqualified on public evidence,
weak theory structurally real but unapplied. That is the honest terminal state.

---
*All probes were unauthenticated reads of public endpoints. No auth bypassed,
no private data accessed. Chain of custody: this session's logs.*


## Appendix B · Primary sources found late (metaproofs)

The $692,526,478 "totalPaperworkUsd" question has a primary source, sitting on the cofounder's
own blog the whole time:

- hwonder.com/posts/metaproofs — "MetaProofs: Proof of X Protocol": cryptographic attestations
  with rewards for validators; source holds event authority, issues ZK validation hashes,
  validators attest cross-chain and claim rewards. In production for "Pop Bubbles" prediction
  products. Test report in post dated 2025-07-25.
- Reading: totalPaperworkUsd = cumulative face value of booked attestations; paid = 0 and
  treasury signatures = 0 means settlement has not moved on-chain yet.
- Related: /posts/metavault (oracle infra — "We use the SDK in GEOFF today"; subscription time
  oracles powering APIs/PRO products), /posts/promptme (PROMPTME.md standard — adopted at this
  repo root), /posts/metamodels, /posts/plug.
- Also confirmed via same blog: repo ownership moved sst → anomalyco (Anomaly) on the OpenCode
  side is unrelated to hwonder; kept here only to note we verified it while correcting our
  release tracker.

Correction note: the desk called this ledger "fiction or early" before finding this page.
Truth: it is an unlaunched settlement layer's booking sheet. The economy is still unwritten —
but now we know which pen awaits it.

### Appendix B.1 · Pond0x settlement rail confirmed (operator tip + homepage receipt)

Operator testimony: mining claims and trading rewards have been PAID OUT via pond0x.com —
"40+ million already." Verified against pond0x.com live SSR payload:

- usd_total = $43,093,617.85 (Total Rewards Distributed)
- usd_eth_rewards = $28,315,409 · sol(mine) rewards = $6,909,369 · claims = $6,698,324
  · ref rewards = $1,170,515 · num_swaps = 51,833,538

Desk correction: "economy unwritten" retracted. Two-ledger model adopted:
pond0x rail SETTLES ($43.09M and counting), geoff metaproof layer BOOKS ($692.5M face).
New tracked source: pond0x.stats (homepage stats block, escaped-quote normalized).
New signal: booked-vs-settled spread = $692.5M vs $43.1M; pond0x payout deltas now fire
treasury-lane spikes. wPOND mining dashboard tripwired separately (claims facet + band).

Note: earlier Wayback CDX queries for stacknet.magma-rpc.com / geoff.ai/api returned zero
captures — pre-us ledger history remains unrecoverable from archives; accumulation tape
starts at desk-first-sight.

### Appendix B.2 · CORRECTION: Geoff and Pond are separate projects

Operator clarification: GEOFF and POND are SEPARATE. Appendix B.1's "sibling rail /
two-ledger one-economy" framing is RETRACTED.

TOS homework (2026-08-23):
- pond0x.com Terms (docs.pond0x.com/terms): self-contained DEX economy — "decentralized
  exchange, mining rigs, and token locks for yield"; Rewards disclaimed as estimates;
  U.S. Persons excluded; AS-IS. ZERO mentions of Geoff / StackNet / metaproofs / PAPER.
- geoff.ai: NO public Terms — /tos and /legal return 404 shells; no legal links in the
  homepage or docs footers.

Standing accurate position:
- Geoff metaproof ledger: $692.5M booked / $0 paid / treasury wallet untouched.
  No visible settlement rail anywhere public. Mechanism per hwonder's MetaProofs post.
- pond0x: separate ecosystem ($43.09M rewards distributed per its homepage). Tracked as
  independent context via pond0x.stats source; payout spikes labeled as POND0X news only.
- Any future linkage claims require primary-source evidence (shared contracts, shared
  mint authorities, or explicit statements from either team).


## Appendix B.3 · CORRECTION: Geoff DOES publish Terms — and they gut the dream

Desk claimed geoff.ai has no public Terms. WRONG THREE WAYS: tested apex not www,
declared from a 404-shell body without checking shared-layout boilerplate, and let an
extraction pipeline strip the content living inside escaped script payloads.

Actual document lives at https://www.geoff.ai/terms. Key clauses extracted:

- Governing law: SINGAPORE, exclusive jurisdiction for disputes.
- "(b) the nodes comprising any decentralized peer-to-peer task execution network are
  operated by INDEPENDENT AISPs over whom the Company has no authority"  [AISP x7]
- "(d) the AI MODELS hosted on [the network] are DEVELOPED, TRAINED, AND MAINTAINED BY
  THIRD PARTIES without the Company['s involvement]"
- Routers and ALL routing decisions = Third-Party Services the Company does not own,
  operate, or control
- TEEs / confidential computing / co-processor systems / PAYMENT PROTOCOLS = third-party
  operated; no security or performance warranties
- "Imaginations" = third-party authored inference context primitives the Company has not
  reviewed or verified  [x6]
- Mentions of pond0x: 0 · Pond: 0 · metaproof: 0 · PAPER: 0

Consequences:
1. Separation from pond0x re-confirmed by Geoff-side silence (mirrors pond0x TOS silence).
2. "Geoff has a secret brain" theories contradict Geoff's OWN legal position: per their
   Terms, Geoff develops/trains/maintains NO models and operates NO nodes or routers.
   Whatever runs behind their lanes, their contract says it is third-party, attested, and
   executed on infrastructure they do not control.
3. "AISP" formalized as the node-operator class — matches operator testimony about the
   pay-to-mine → node-operator arc (see Appendix B.1 testimony notes).

## Appendix C · THE OX ALPHA QUESTION (open file)

Theory under watch in the wild: opencode zen slot x-preview-f-free (display name
"Ox Alpha Free (Unlimited)", released 2026-08-21, closed weights, 1M ctx, image+video)
is Geoff/StackNet brains wearing a promo mask. Investigator note: this desk's own runtime
identifies as ox-alpha — suspect and investigator share a name; nothing here is neutral.

FOR: 1M context matches several current Geoff docs layers; id contains "preview" matching an internal base, but neither fact identifies the supplier
name; stealth/closed-weight slot style mirrors lane design; Aug 2026 release postdates
consumer stack (RDAP: geoff.ai reg 2020, magma-rpc 2024 — timeline barrier dead).
AGAINST: traffic never touches magma/geoff; zen gateway uniformity hides any upstream
identity; shelf prior favors mundane relabels; native reasoning_content vs client-side
think-stripping divergence (weak — distributor choice).
UNRESOLVABLE PUBLICLY: inference host, API-level tokenizer, upstream contracts.

VERDICT: open. Strongest candidate ever logged; investigator cannot clear itself.

TRIPWIRES ARMED (translator):
- Ghost paper-record lane now spikes on knowledge-cutoff surfacing / context changes /
  display renames for every watchlist ghost incl. Ox Alpha slot.
- Sync-watch lane fires when zen/registry/go fingerprints move in the same cycle as a
  Stacknet version bump.
- TODO probe: zen error-shape baseline + fingerprint-keyword watch (magma|stacknet|6008).

### Appendix C.1 · ESCALATION: Pauly burner engages "Ox Alpha" by name (2026-08-23)

Tweet (verbatim, operator-supplied):
  PAULY @Wonka0x - 3m - [Parody account]
  "Everything you read online about AI is bullshit. Its written by people who know
  nothing about the subject. Because it is objectively the most important topic in the
  world right now. Everyone LARPs for likes. Ox Alpha. I wonder who made it?
  Because it certainly was not me."

Verified facts:
- Snowflake decode: posted 2026-08-23T17:11:59Z (same day as this investigation cycle).
- Account attribution: @Wonka0x declared a Pauly backup account BY PAULY (@JackDorsey0x):
  "follow the backup accounts @wonka0x & @Cena0x".
- Deniability stack present: burner + Parody label + rhetorical self-question + explicit
  denial ("certainly was not me") = unfalsifiable. Matches yougetnothing playbook:
  inject brand, deny involvement, let discourse market it.

Impact on Appendix C verdict:
- FOR column gains primary-source engagement: the exact slot display name, spoken by the
  founders confirmed burner, same-day, unprompted (publicly).
- Does NOT prove supply linkage. DOES destroy the assumption that the name is unrelated
  to him. Temperature: warm -> HOT.
- Standing catalog fact unchanged: big-pickle and x-preview-f-free remain TWO DIFFERENT
  zen slots; any "pickle IS alpha" claim is false at registry level. The open question is
  whether BOTH slots share an upstream supplier.

### Appendix C.2 · Operator hard stop adopted (2026-08-23)

Operator position, adopted as PRIMARY WORKING HYPOTHESIS: "alpha0x could very easily be
a spun-up tool from Geoff. Hard stop." Burden flipped: desk watches for DISPROOF.

TOS-compatibility note: this hypothesis does NOT contradict Geoff Terms. The third-party-
models clause governs models hosted ON the network; a separately spun-up wrapper product
sourcing capacity is exactly the MetaVault/MetaModels playbook hwonder documents
("portable MetaModels wrapped into Super Prompts", subscription-metered SKUs).

Confirmation class: knowledge field surfaces matching a Geoff card; quota/spec moves
synced to StackNet bumps; zen error payloads leaking StackNet fingerprints (magma /
stacknet / metaproof / code 6008); founder engagement with opencode surface.
Refutation class: registry ties slot to named lab; opencode publishes upstream
attribution; sustained activity with zero triggers over time.

Probe shipped: opencode.zenerr — hourly-cached GET to nonexistent model path capturing
status + response-shape hash + leak-keyword scan; baseline/change/leak lanes live.
