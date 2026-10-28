import { poolVoidHall } from "../server/poolvoid-hall.js";

export function createHandler(client = poolVoidHall) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "GET only" }); }
    const view = req.query?.view || "hall";
    if (!["hall", "profile"].includes(view)) return res.status(400).json({ error: "Unknown Pool Void view" });
    const address = req.query?.address;
    if (view === "profile" && (typeof address !== "string" || !/^0x[\da-f]{40}$/i.test(address))) return res.status(400).json({ error: "Enter a valid Ethereum/Base wallet address" });
    try {
      const result = view === "hall" ? await client.hall() : await client.profile(address);
      const healthy = view === "hall" ? result.board.ok && result.weekly.ok && result.rules.ok : result.profile.ok && result.identity.ok;
      if (healthy) res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
      return res.status(200).json(result);
    } catch { return res.status(502).json({ error: "Pool Void is currently unavailable" }); }
  };
}
export default createHandler();
