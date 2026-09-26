import { inspectSimListings, SIM_CONTRACT, SIM_NAME, SIM_COLLECTION_PAGE, MAX_ADDRESSES, clearSimListingCache } from "../server/sim-listing.js";

// GET /api/sim-listing?wallets=0x…  → "can I see and list my Simulation?"
//
// For each address it reports which SIM tokens are held, whether the holder is
// an EOA or a contract wallet (with Safe owners + threshold), whether tokenURI
// and its image host actually serve, and whether OpenSea has indexed the item.
// It places no orders — OpenSea has no listing API — so the payload always ends
// in a concrete next step rather than a fake one-click sell.
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
    .split(/[,\s;]+/)
    .map((value) => String(value).trim())
    .filter(Boolean);
  if (wallets.length === 0) {
    res.status(400).json({
      error: "Provide ?wallets=0x… (Ethereum address holding a Simulation).",
      collection: { name: SIM_NAME, contract: SIM_CONTRACT, opensea: SIM_COLLECTION_PAGE },
      maxWallets: MAX_ADDRESSES,
    });
    return;
  }

  try {
    // nocache must invalidate BEFORE the read, or it only helps the next
    // caller — the name promises a clean read.
    if (req.query?.nocache === "1") clearSimListingCache();
    const payload = await inspectSimListings(wallets, { fresh: req.query?.refresh === "1" || req.query?.nocache === "1" });
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message, collection: { name: SIM_NAME, contract: SIM_CONTRACT, opensea: SIM_COLLECTION_PAGE } });
  }
}
