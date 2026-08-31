import { config } from "../server/config.js";
import { upsertDailyActivity } from "../server/daily-activity.js";
import {
  acquireSharedLock,
  loadSharedBundle,
  normalizeBundle,
  pruneEvents,
  releaseSharedLock,
  saveSharedBundle,
  sharedStoreConfig,
} from "../server/shared-store.js";
import { runSniff, sniffTrixGeoff } from "../server/sniffer.js";
import { computeTemperature, translate } from "../server/translator.js";
import {
  preserveLastKnownTokenPress,
  preserveTrixHistory,
  publicConfig,
} from "../server/service.js";

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

  const store = sharedStoreConfig();
  if (!store.writable) {
    res.status(503).json({
      error: "Shared store not writable — set GT_GITHUB_TOKEN on Vercel",
      config: publicConfig(),
    });
    return;
  }

  const requestedProfile = typeof req.query?.profile === "string" ? req.query.profile : "";
  const profile = requestedProfile === "full" || requestedProfile === "trix"
    ? requestedProfile
    : new Date().getUTCMinutes() % 15 === 0
      ? "full"
      : "trix";
  if (profile === "trix" && !store.redis) {
    res.status(503).json({
      error: "Minute-level TRIX collection requires the Redis shared store.",
      config: publicConfig(),
    });
    return;
  }

  let lock = null;
  try {
    lock = store.redis ? await acquireSharedLock("collector") : null;
    if (store.redis && !lock) {
      res.status(202).json({ ok: true, skipped: true, reason: "Collector already running." });
      return;
    }
    const previous = await loadSharedBundle();

    let snapshot;
    if (profile === "full") {
      snapshot = preserveTrixHistory(
        previous.latest,
        preserveLastKnownTokenPress(
          previous.latest,
          await runSniff({ previous: previous.latest }),
        ),
      );
    } else {
      const observed = await sniffTrixGeoff({
        previous: previous.latest?.sources?.["trix.geoff"] || null,
      });
      const base = previous.latest || {
        takenAt: new Date().toISOString(),
        durationMs: observed.ms,
        sources: {},
        summary: {},
      };
      snapshot = preserveTrixHistory(previous.latest, {
        ...base,
        sources: { ...(base.sources || {}), "trix.geoff": observed },
        summary: { ...(base.summary || {}) },
      });
    }
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
          lastPollAt: profile === "full" ? snapshot.takenAt : previous.state?.lastPollAt || null,
          lastTrixPollAt: snapshot.sources?.["trix.geoff"]?.checkedAt || new Date().toISOString(),
          lastError: null,
          pollCount: (previous.state?.pollCount || 0) + 1,
          temperature: temperature.value,
        },
      }),
      {
        message: `vercel ${profile} tick · ${newEvents.length} new · temp ${temperature.value}`,
        mirrorGithub: profile === "full",
      },
    );

    res.status(200).json({
      ok: true,
      profile,
      newEvents: newEvents.length,
      events: saved.events.length,
      temperature: temperature.value,
      updatedAt: saved.updatedAt,
      config: publicConfig(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message, config: publicConfig() });
  } finally {
    await releaseSharedLock(lock).catch(() => {});
  }
}
