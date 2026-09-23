import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvFile() {
  for (const name of [".env", ".env.local"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Never let a pulled Vercel env pretend this process is on Vercel.
      if (key === "VERCEL" || key.startsWith("VERCEL_")) continue;
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  }
}

loadEnvFile();

export const config = {
  port: Number(process.env.PORT || 3847),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 30_000),
  geoffBaseUrl: (process.env.GEOFF_BASE_URL || "https://geoff.ai").replace(/\/$/, ""),
  stacknetBaseUrl: (process.env.STACKNET_BASE_URL || "https://stacknet.magma-rpc.com").replace(
    /\/$/,
    "",
  ),
  geoffCookie: process.env.GEOFF_COOKIE || "",
  geoffPreviewCode: process.env.GEOFF_PREVIEW_CODE || "",
  dataDir: path.join(root, "data"),
  publicDir: path.join(root, "public"),
  maxEvents: 2000,
  maxSnapshots: 2880, // bounded local retention; load/save also enforce the 24h age limit
  trackWindowHours: 24,
  heatmapDays: 1,
};
