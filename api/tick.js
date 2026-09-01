import { config } from "../server/config.js";
import { upsertDailyActivity } from "../server/daily-activity.js";
import { upsertPond0x } from "../server/pond0x.js";
import {
  acquireSharedLock,
  loadSharedBundle,
  normalizeBundle,
  pruneEvents,
  releaseSharedLock,
  saveSharedBundle,
  sharedStoreConfig,
} from "../server/shared-store.js";
import {
  runSniff,
  sniffPond0x,
  sniffStacknetMinute,
  sniffTrixGeoff,
  summarizePond0x,
} from "../server/sniffer.js";
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
      const [observed, stacknet, pond0x] = await Promise.all([
        sniffTrixGeoff({
          previous: previous.latest?.sources?.["trix.geoff"] || null,
        }),
        sniffStacknetMinute(),
        sniffPond0x({
          previous: previous.latest?.sources?.["pond0x.mining"] || null,
        }),
      ]);
      const base = previous.latest || {
        takenAt: stacknet.takenAt,
        durationMs: Math.max(observed.ms || 0, stacknet.durationMs || 0),
        sources: {},
        summary: {},
      };
      snapshot = preserveTrixHistory(previous.latest, {
        ...base,
        id: `snap_${Date.now().toString(36)}`,
        takenAt: stacknet.takenAt,
        durationMs: Math.max(observed.ms || 0, stacknet.durationMs || 0),
        sources: {
          ...(base.sources || {}),
          ...stacknet.sources,
          "trix.geoff": observed,
          "pond0x.mining": pond0x,
        },
        summary: {
          ...(base.summary || {}),
          ...stacknet.summary,
          ...summarizePond0x(pond0x),
        },
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
        pond0x: upsertPond0x(
          previous.pond0x || null,
          snapshot.sources?.["pond0x.mining"],
        ),
        state: {
          startedAt: previous.state?.startedAt || new Date().toISOString(),
          lastPollAt: profile === "full" ? snapshot.takenAt : previous.state?.lastPollAt || null,
          lastTrixPollAt: snapshot.sources?.["trix.geoff"]?.checkedAt || new Date().toISOString(),
          lastStacknetPollAt: snapshot.summary?.stacknetCheckedAt || null,
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
      changed: true,
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
