import { config } from "../server/config.js";
import { upsertDailyActivity } from "../server/daily-activity.js";
import {
  loadSharedBundle,
  normalizeBundle,
  pruneEvents,
  saveSharedBundle,
  sharedStoreConfig,
} from "../server/shared-store.js";
import { runSniff } from "../server/sniffer.js";
import { computeTemperature, translate } from "../server/translator.js";
import { preserveLastKnownTokenPress, publicConfig } from "../server/service.js";

function authorized(req) {
  const secret = process.env.CRON_SECRET || process.env.GT_TICK_SECRET || "";
  if (!secret) return false;
  const header = req.headers["authorization"] || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = typeof req.query?.secret === "string" ? req.query.secret : "";
  return bearer === secret || query === secret;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized tick", config: publicConfig() });
    return;
  }

  if (!sharedStoreConfig().writable) {
    res.status(503).json({
      error: "Shared store not writable — set GT_GITHUB_TOKEN on Vercel",
      config: publicConfig(),
    });
    return;
  }

  try {
    const previous = await loadSharedBundle();
    const snapshot = preserveLastKnownTokenPress(previous.latest, await runSniff());
    const newEvents = translate(previous.latest, snapshot);
    const events = pruneEvents([...newEvents, ...(previous.events || [])]);
    const dailyActivity = upsertDailyActivity(previous.dailyActivity || [], newEvents, {
      heatmapDays: config.heatmapDays,
    });
    const temperature = computeTemperature(events, snapshot);
    const saved = await saveSharedBundle(
      normalizeBundle({
        latest: snapshot,
        events,
        dailyActivity,
        state: {
          startedAt: previous.state?.startedAt || new Date().toISOString(),
          lastPollAt: snapshot.takenAt,
          lastError: null,
          pollCount: (previous.state?.pollCount || 0) + 1,
          temperature: temperature.value,
        },
      }),
      {
        message: `vercel tick · ${newEvents.length} new · temp ${temperature.value}`,
      },
    );

    res.status(200).json({
      ok: true,
      newEvents: newEvents.length,
      events: saved.events.length,
      temperature: temperature.value,
      updatedAt: saved.updatedAt,
      config: publicConfig(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message, config: publicConfig() });
  }
}
