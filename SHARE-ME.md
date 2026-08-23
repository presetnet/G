# 🧠 Brain-Safe Sharing Kit
*Three sizes. Pick your audience. Nobody has to read the case file unless they want the receipts.*

---

## ⚡ The 5-Second Version (comments, replies)

> We audited geoff.ai's whole stack. Big-pickle isn't theirs — but they ARE running an anonymous model-relabeling machine at magma-rpc.com since March 2024. Receipts public.

---

## 📱 The Thread Version (post as 6 tweets)

**1/**
The rumor: opencode's free mystery model "big-pickle" is secretly geoff.ai in disguise.
We tested it with actual forensics instead of vibes. Here's everything. 🧵

**2/**
Step 1 — watch the traffic. Ran live sessions with packet tracing.
Model talks to exactly TWO places: opencode's gateway and GitHub.
Never geoff. Never stacknet. Zero packets. That alone nearly ends it.

**3/**
Step 2 — paper trail. geoff.ai has FOUR hostnames total. First cert: June 2026.
But its infra domain magma-rpc.com was registered March 2024 —
five months BEFORE their GitHub org existed. They built quiet for 2+ years.
Your patience theories were right.

**4/**
Step 3 — we opened their own JavaScript. It confessed:
→ stacknet.magma-rpc.com (the real address)
→ a regex that DELETES <think> tags from model output
→ wallet-gated inference, ComfyUI backend, Bitcoin-era infra
Even their MCP server leaked its own config in a 500 error 💀

**5/**
Final receipt: StackNet's model list is PUBLIC.
preview • magma • pyro • pyro:max — all "owned_by: stacknet-layer"
upstreams anonymous by design. And big-pickle?
NOT ON THE MENU.

**6/**
Verdict:
❌ big-pickle ≠ stacknet (dead 3 ways)
✅ the relabeling machine is REAL — that IS their product
🕳️ open question: whose brains power preview/magma/pyro?
Free inference costs $2–60K/week. Nobody runs that for free without buying something: users, or training data.
Full case file below 👇

---

## ☕ The Bar Story Version (voice, DMs, Spaces)

Okay so there's this free mystery AI model everyone uses, right? And the rumor
was that two crypto guys secretly built it.

So we checked. Three ways.

One: we watched where the model actually sends your words when you hit enter.
It goes to opencode. Never anywhere near those guys' servers. Case almost closed.

Two: we checked the paperwork. Domains don't lie — you can't backdate them.
Their infra domain is from March 2024, but their product only launched this summer.
So yes — they WERE building something quietly for over two years. That part's true!

Three — and this is the fun part — we read the code their website ships to your browser,
because websites can't hide their own code. And it straight up admits everything:
here's our secret server address, here's the filter that hides the AI's thinking
from you, here's our image generator.

And then their public model list — which anyone can check right now — shows four
AI brains, all labeled the same generic company name, with zero info about what's
actually inside any of them. Like four cans of "SODA" with no flavor listed.

So: did those two guys secretly make the famous mystery model? No. Proven no.
Is their platform literally DESIGNED to relabel other people's AI under generic names?
...yes. That's not the conspiracy. That's the business model.

The real open mystery: whose AI is actually inside their cans? Nobody knows.
Somebody's silicon is in there, unnamed on purpose.

And the free model everyone uses? Costs someone thousands a week minimum.
Free is never charity — you're either the customer or the ingredient. 😄

---

## ❓ Pre-answered FAQ (paste when the replies get loud)

**Q: So geoff is a scam?**
A: No evidence of that. Running open models under your own brand is legal and common. The finding is about *anonymity by design*, not fraud.

**Q: Is big-pickle fake then?**
A: No. It's a real, capable model served by opencode. We proved it does NOT come from geoff/stacknet. Where it comes from upstream remains undisclosed — by opencode, not geoff.

**Q: Why should I trust this audit?**
A: You don't have to. Every claim reproduces with one curl command. Case file Appendix A. Run it yourself in 60 seconds.

**Q: Couldn't they have hidden it better than you can detect?**
A: For client-side traffic? Yes — which is why we didn't stop there. The domain registry, cert logs, and their own shipped code are things nobody can fake retroactively.

**Q: What's the one thing to remember?**
A: Timestamps can't lie, code ships to your browser whether they like it or not, and their own model list doesn't include the rumor's subject. Three locks on the same door.

---

*Deep-dive with full methodology: `STACKNET-CASEFILE.md`*
