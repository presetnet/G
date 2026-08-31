export default async function handler(_req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(410).json({ error: "Public live sniffing is disabled." });
}
