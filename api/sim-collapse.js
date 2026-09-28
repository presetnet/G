import { collapseReader } from "../server/sim-collapse.js";

// Public recipes are GET; personal transaction lookups use POST and are not
// retained in the shared dashboard snapshot or a transaction-history cache.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Use GET for recipes or POST for a collapse lookup." });
    return;
  }
  try {
    if (req.method === "GET" && req.query?.view && req.query.view !== "pulse") {
      res.status(400).json({ error: "Use view=pulse for supply and sales, or omit view for recipes." });
      return;
    }
    const payload = req.method === "GET"
      ? await collapseReader[req.query?.view === "pulse" ? "pulse" : "recipes"]({ fresh: req.query?.refresh === "1" })
      : await collapseReader.decodeMany(req.body?.items);
    res.status(200).json(payload);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
}
