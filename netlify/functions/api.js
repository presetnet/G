import assets from "../../api/assets.js";
import health from "../../api/health.js";
import market from "../../api/market.js";
import poll from "../../api/poll.js";
import poolvoid from "../../api/poolvoid.js";
import simCollapse from "../../api/sim-collapse.js";
import simListing from "../../api/sim-listing.js";
import sniff from "../../api/sniff.js";
import status from "../../api/status.js";
import tick from "../../api/tick.js";
import { invoke } from "./adapter.js";

const handlers = { assets, health, market, poll, poolvoid, "sim-collapse": simCollapse, "sim-listing": simListing, sniff, status, tick };

export async function handler(event) {
  const route = event.path.replace(/^.*\/api\//, "").replace(/\/$/, "");
  const endpoint = handlers[route];
  if (!endpoint) return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Not found" }) };
  return invoke(endpoint, event);
}
