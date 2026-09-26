import { inspectWallets, MAX_WALLETS } from "../server/wallet-assets.js";

// GET /api/assets?wallets=addr1,addr2  → live on-chain holdings per wallet.
// Public and read-only on purpose: this is the desk's "show me what is real"
// endpoint. It never returns an API key, and a single bad wallet comes back as
// its own row with ok:false instead of failing the batch.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET" });
    return;
  }

  const raw = req.query?.wallets ?? req.query?.address ?? req.query?.a ?? "";
  const wallets = String(raw)
    .split(/[,\s]+/)
    .map((value) => String(value).trim())
    .filter(Boolean);
  if (wallets.length === 0) {
    res.status(400).json({ error: "Provide ?wallets=addr1,addr2 (Solana base58 or 0x… Ethereum).", maxWallets: MAX_WALLETS });
    return;
  }

  try {
    const payload = await inspectWallets(wallets, { fresh: req.query?.refresh === "1" });
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
