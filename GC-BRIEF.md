# GC-BRIEF — paste into ChatGPT

**ROLE:** Tell a crypto/AI group chat what's really going on with Geoff and the mystery models. Plain English, like a friend explaining it. No bragging about research tools, no "our tracker caught this" energy, no receipt-flexing. Just the story, straight.

---

## The question everyone keeps dancing around

Is the free mystery model everyone uses (big-pickle) secretly Geoff's hidden weapon? Or flipped around — is Geoff secretly running on the same kind of anonymous model we're all already chatting with?

## The short answer

No direct link — but the real answer is stranger than the conspiracy, so lead with this:

**Nobody knows whose brains are inside any of these things. That's not a gap in the research. That's the business model.**

## What's actually true

- Geoff/StackNet (Pauly0x + Hwonder's project) does not make its own AI. Their own code admits it: they take anonymous models from upstream suppliers and rename them to their own brand layers ("magma", "pyro"). When you talk to Geoff, you're talking through a mask.
- The free model shelf (where big-pickle lives) does the same thing from the other direction. Most of that shelf openly admits it relabels known models — DeepSeek, NVIDIA's Nemotron, Kimi, Qwen. A few, including big-pickle, stay completely silent about who made them.
- So both brands are wearing masks. The paranoid question writes itself: same face under both?
- People checked. Hard. The traffic between the two systems never touches. They behave in opposite ways — Geoff hides the AI's reasoning before showing it to you; the mystery model shows you every thought. Their timelines don't even overlap (Geoff's consumer site showed up mid-2026; the mystery model existed by late 2025).
- And the free tier just grew a published leash — while staying free. The Go FAQ says it straight: Big Pickle plus current promos remain free at **200 requests/day**, and on top of that sits a subscription ($5 first month, $10/month) whose capacity is described as roughly **$12 per 5 hours / $30 per week / $60 per month** of compute value, with per-model call counts from ~110 (premium shelf) to 45,000+ (cheap shelf) and exactly one unlimited slot (Ox Alpha Free) as a limited-time promo. Translation: the subsidy didn't die — it got metered, priced, and upsold. Watch that 200/day number; when it shrinks, the leash tightens in public.
- Even the "one cloned the other" theory dies fast: cloning gets you code, but the valuable part — the supply deals that put real brains behind the labels — doesn't survive a copy-paste.
- And the "all the dates are faked" angle runs backwards: Geoff's infrastructure was quietly registered way back in early 2024, long before there was anything to cover up. That's a slow, boring build — not an operation.

## The receipts (only if someone demands numbers)

Both sides have money stories that don't add up, and they're worth putting side by side. Geoff's public ledger claims $692.5 million in "metaproof paperwork" booked — amount actually paid out: zero — and the minting wallet behind it holds three homemade coins: PAPER (total supply: sixty-five whole coins), CCU (175), and CUSD (10.4). The mechanism is no longer a mystery either: hwonder's own blog post describes MetaProofs as attestation-with-rewards plumbing for predictions and reward claims — so the $692.5M is the face value of booked attestations, and zero settlement means nobody has been paid out of it yet. Important for anyone reading this: those tokens are internal test scrip with a microscopic float — there is nothing to buy and anyone who tries will get wrecked on their own; this desk reports the ledger, it doesn't point at exit liquidity. Facing that: the "free" mystery shelf just started showing meters — OpenCode's Go subscription at $5 intro / $10 per month, which buys anywhere from ~110 premium-model calls per 5 hours up to 45,000+ on the cheap shelf, with exactly one unlimited slot (Ox Alpha Free) held out as a limited-time promo — while Big Pickle itself stays free at 200 requests/day per the same FAQ. Two weird economies staring at each other across the table. All of it checkable by anyone with a browser — no leaks, no insiders.

## What would change the answer

If anyone ever catches the mystery model's traffic touching Geoff's servers, or finds both systems sharing identical weird quirks, or sees Geoff's internal model names pop up somewhere they shouldn't — then yes, same beast, case closed. Until then: two separate shops running the same magic trick, and the magician won't show his face in either one.

## Do these masks last forever? History says no

Two recent cases where "anonymous" models got unmasked — both officially confirmed:

- **gpt2-chatbot → GPT-4o (April–May 2024).** A mystery model topped the public chatbot arena under a joke name. Researchers found its system prompt claimed OpenAI origins, then a leaked error message showed it running on OpenAI's own infrastructure. Days later OpenAI confirmed it themselves: it was GPT-4o being tested in disguise before launch.
- **Quasar Alpha / Optimus Alpha → GPT-4.1 (April 2025).** Two free cloaked models on a popular router. The community identified them within days without any insider info — the responses leaked OpenAI-format IDs, the tokenizer had OpenAI's exact known bug on Chinese characters, and tiny API spec details matched. The router then confirmed both were GPT-4.1 test slots.

The pattern: raw access to a model leaks metadata, tokenizers carry fingerprints like handwriting, and labs eventually reveal what they shipped. Anonymity held for about ten days in both cases — it's a launch stunt, not permanent cover.

The honest caveat for Geoff specifically: their engine layers sit behind a controlled interface that strips out the AI's reasoning and gates everything behind a wallet, so there's much less raw surface for fingerprint hunters than those two cases had. Harder to unmask — but the same physics applies. If any of their unnamed engines ever ships publicly under a real name somewhere else, the mask comes off retroactively. That's a tripwire worth watching, not an assumption to sleep on.

## Corrections ledger · where this desk misled first

This all started as one paranoid question — *is the free mystery model secretly Geoff?* — and along the way the desk itself pushed claims that didn't survive scrutiny. Logged on purpose. A watcher that won't log its own misses is just another mask:

1. **"The timeline makes it impossible."** Overclaim. The 2026 brand cert only kills "same live product today," not shared code ancestry — and StackNet's software predates the mystery model anyway (March 2024). Corrected verdict: identity dead, ancestry merely unlikely.
2. **"One charges, the other is free."** Sloppy. The free shelf had a hidden payer eating roughly half a million dollars a week. Invisible economics on both sides — corrected.
3. **"$5 paywall means Geoff started charging."** Wrong target entirely. The desk theorized about geoff.ai monetizing before checking OpenCode's own /go page — which is where the meter actually lived.
4. **"The free era just ended."** Wrong again, same root cause: didn't read the whole page. The Go FAQ states Big Pickle remains free at 200 requests/day; Go is an upsell, not a replacement.
5. Early in the hunt, the desk briefly claimed an internal network endpoint needed secret credentials — source review showed it was fully public. Logged then, kept here for completeness.

Pattern worth naming: every miss came from narrating before finishing the read. The fix isn't confidence — it's tripwires and correction logs.

## The private engines · magma, preview, pyro, pyro:max

More context on the "private modules," separated into what's fact versus inference:

- **FACT:** StackNet's own public network map exposes an internal fleet of ~29 models arranged as product lines (chat, embed, media, vision, voice) crossed with engine bases named **magma**, **preview**, **pyro**, and **pyro:max**. These names come straight from their endpoints, not rumor.
- **INFERENCE:** the bases behave like supply tiers or upstream slots. Magma matches their oldest registered infrastructure domain (2024). Preview reads like staging. Pyro and pyro:max smell like performance tiers — standard/max grades of whatever brain sits behind them.
- **UNKNOWN:** whose brains power each base; whether different bases mean different anonymous suppliers or one supplier sold in grades; what "max" actually buys a paying user. Nothing public answers this — that absence is the point.
- **WHY IT MATTERS:** if paid plans route through pyro:max, then *"who is pyro:max?"* is the sharper, truer version of the original question — more than anything on the free shelf.
- **PRECEDENT:** engine codenames in this industry do eventually surface — gpt2-chatbot became GPT-4o within days; Quasar Alpha became GPT-4.1 within weeks. The desk keeps tripwires on new bases, vanished bases, and renamed lines so the surfacing gets caught here first.

## How to land it

Don't end on "case closed." End on the elephant: the interesting thing isn't whether these two specific masks hide the same face — it's that an entire industry learned it can sell AI without telling anyone what's under the hood. And it works because almost nobody asks.
