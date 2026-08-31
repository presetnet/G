import { getStoredPayload, publicConfig } from "../server/service.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    // Public refreshes only read the shared desk. Live sniffing is protected/manual only.
    const payload = await getStoredPayload();
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message, config: publicConfig() });
  }
}
