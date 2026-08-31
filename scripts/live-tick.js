/**
 * Persist one authoritative sniff into the shared gt-live desk.
 * Used by GitHub Actions (GITHUB_TOKEN) so Vercel visitors share one history.
 */

import { upsertDailyActivity } from "../server/daily-activity.js";
import { config } from "../server/config.js";
import {
  loadSharedBundle,
  normalizeBundle,
  pruneEvents,
  saveSharedBundle,
} from "../server/shared-store.js";
import { runSniff } from "../server/sniffer.js";
import { preserveLastKnownTokenPress } from "../server/service.js";
import { computeTemperature, translate } from "../server/translator.js";

async function main() {
  const previous = await loadSharedBundle();
  const snapshot = preserveLastKnownTokenPress(previous.latest, await runSniff());
  const newEvents = translate(previous.latest, snapshot);
  const events = pruneEvents([...newEvents, ...(previous.events || [])]);
  const dailyActivity = upsertDailyActivity(previous.dailyActivity || [], newEvents, {
    heatmapDays: config.heatmapDays,
  });
  const temperature = computeTemperature(events, snapshot);
  const startedAt = previous.state?.startedAt || new Date().toISOString();
  const bundle = normalizeBundle({
    latest: snapshot,
    events,
    dailyActivity,
    state: {
      startedAt,
      lastPollAt: snapshot.takenAt,
      lastError: null,
      pollCount: (previous.state?.pollCount || 0) + 1,
      temperature: temperature.value,
    },
  });

  const saved = await saveSharedBundle(bundle, {
    message: `live tick · ${newEvents.length} new · temp ${temperature.value} · ${snapshot.takenAt}`,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        newEvents: newEvents.length,
        events: saved.events.length,
        temperature: temperature.value,
        updatedAt: saved.updatedAt,
        stacknet: snapshot.summary?.stacknetVersion || null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
