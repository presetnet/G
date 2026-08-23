# GC-BRIEF — paste this whole file into ChatGPT

**ROLE:** You're briefing a crypto/AI group chat ("the GC") on a finished investigation. Tone: confident, receipts-first, zero hedging, light humor allowed. Short punchy paragraphs. No corporate voice, no "further research needed" filler.

**THE QUESTION:** Is opencode's free mystery model `big-pickle` secretly Geoff/StackNet (Pauly0x + Hwonder) wearing a mask?

**THE VERDICT: NO — killed four ways, all public data, all reproducible:**
1. StackNet's public catalog sells exactly **5 models**. No pickle on the menu.
2. StackNet's **internal 29-model fleet** leaked through a public endpoint — pure taxonomy (5 product lines × 3 engine tiers). No pickle there either. Dead at both layers.
3. Live traffic tracing: big-pickle sessions only ever touch `opencode.ai`. Zero packets to geoff or magma-rpc.
4. Brand timeline: big-pickle existed October 2025; the geoff.ai launch brand's first TLS cert is June 2026. (Kills "same live product" — not "shared code ancestry," see fork defense below.)

**FORK DEFENSE (in case someone yells "they cloned it, backdated everything"):** Identity ≠ ancestry. StackNet-the-software predates big-pickle anyway (magma-rpc.com, March 2024 — a 19-month quiet build, the opposite of a psyop launch). And clones diverge on visible behavior: StackNet strips `<think>` reasoning client-side; big-pickle exposes full native thinking. One wallet-gates every call ($692.5M booked / $0 paid); the other is free and keyless. Forking also gets you nothing — the value is upstream model contracts + GPU fleet + wallet rails, which don't survive `git clone`. What would flip the verdict: pickle traffic touching magma/geoff IPs, matching TLS fingerprints, or identical strip-think API quirks. None seen across hundreds of traced sessions.

**WHAT STACKNET ACTUALLY IS:** A relabeling aggregator — proven by their own code. Anonymous upstream models branded `stacknet-layer`, `<think>` reasoning stripped client-side before users see it, wallet-gated inference. And the lore checks out: `magma-rpc.com` registered **March 2024** — the "2.5 years of quiet dev" story is real.

**THE NUMBERS RIGHT NOW** *(live public endpoints, chain-verified)*:
- **$692,526,478** of "metaproof paperwork" booked · **$0 paid**
- Treasury: **0 SOL, ZERO lifetime signatures** — confirmed straight from Solana RPC. Wallet never touched. Their entire economy is unwritten.
- Cluster: 8 nodes · 7 GPUs · 871 GB VRAM · currently idle
- Server: `v3.14.24`

**PLOT TWIST:** opencode's own free tier hides anonymous ghosts too (`big-pickle`, `hy3-free`, `laguna-s-2.1-free`, `x-preview-f-free`). Anonymity is the industry pattern — not a Geoff fingerprint.

**WHAT WE'RE WATCHING NEXT:** A fan-built dashboard (**aisp.live** — public-data-only, passed an independent audit 8-of-9 exact match) now has tripwires on: first metaproof payment, first SOL entering the treasury, any new engine tier joining the fleet, and any ghost model appearing or vanishing. The moment their economy goes live, we call it in real time.

**DELIVERY:** Lead with the verdict in one line. Then the four kills. Then the money number ($692.5M / $0 / empty wallet). Close with what's being watched. If challenged: every claim reproduces with plain `curl` — no keys, no leaks, no LARP.
