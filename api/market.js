import { buildStoredMarketPayload } from "../server/market.js";
import { getStoredPayload } from "../server/service.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  try {
    const stored = await getStoredPayload();
    const payload = buildStoredMarketPayload(stored.latest);
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
