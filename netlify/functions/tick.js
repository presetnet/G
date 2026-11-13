import tick from "../../api/tick.js";
import { invoke } from "./adapter.js";

// Netlify invokes this on the schedule in netlify.toml. The collector remains
// protected when called over HTTP through /api/tick.
export async function handler(event) {
  const secret = process.env.CRON_SECRET || process.env.GT_TICK_SECRET || "";
  return invoke(tick, {
    ...event,
    httpMethod: "GET",
    headers: { ...(event.headers || {}), authorization: `Bearer ${secret}` },
    queryStringParameters: event.queryStringParameters || {},
  });
}
