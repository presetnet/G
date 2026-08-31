import { config } from "./config.js";
import { compileBriefing } from "./briefing.js";
import { upsertDailyActivity } from "./daily-activity.js";
import { mergeTrixGeoffHistory, runSniff } from "./sniffer.js";
import {
  loadSharedBundle,
  pruneEvents,
  saveSharedBundle,
  sharedStoreConfig,
} from "./shared-store.js";
import { computeTemperature, inferAgentDesk, translate } from "./translator.js";
import {
  appendEvents,
  loadDailyActivity,
  loadEvents,
  loadLatestSnapshot,
  loadState,
  saveLatestSnapshot,
  saveState,
} from "./store.js";

function isVercel() {
  // Real Vercel runtime only — ignore VERCEL= from a pulled .env.local
  return Boolean(process.env.VERCEL) && Boolean(process.env.VERCEL_ENV || process.env.VERCEL_URL);
}

/** Local + Vercel both use Redis when configured — one desk, no empty local wipe. */
function useSharedDesk() {
  return sharedStoreConfig().redis || isVercel();
}

export function publicConfig() {
  const shared = sharedStoreConfig();
  const sharedDesk = useSharedDesk();
  return {
    // Shared desk reads are cheap and never trigger upstream collection.
    pollIntervalMs: sharedDesk ? Math.min(config.pollIntervalMs, 15_000) : config.pollIntervalMs,
    geoffBaseUrl: config.geoffBaseUrl,
    stacknetBaseUrl: config.stacknetBaseUrl,
    catalogAuthConfigured: Boolean(config.geoffCookie || config.geoffPreviewCode),
    mode: isVercel() ? "vercel" : sharedDesk ? "local-shared" : "local",
    trackWindowHours: config.trackWindowHours,
    heatmapDays: config.heatmapDays,
    sharedStore: sharedDesk,
    sharedStoreWritable: shared.writable,
    sharedStoreBackend: shared.backend,
    sharedStoreUrl: shared.redis ? `redis:${shared.redisKey}` : shared.rawUrl,
    trustMode: sharedDesk ? "universal" : "local-file",
  };
}

function withBriefing(payload) {
  const agentDesk = inferAgentDesk(payload.latest, payload.newEvents || []);
  return {
    ...payload,
    agentDesk,
    briefing: compileBriefing({
      latest: payload.latest,
      temperature: payload.temperature,
      events: payload.events,
      agentDesk,
    }),
    config: payload.config || publicConfig(),
  };
}

export function preserveLastKnownTokenPress(previous, current) {
  const currentSource = current?.sources?.["solana.tokens"];
  if (Array.isArray(currentSource?.mints) && currentSource.mints.length) return current;

  const previousSource = previous?.sources?.["solana.tokens"];
  if (!Array.isArray(previousSource?.mints) || !previousSource.mints.length) return current;

  const owner =
    previousSource.owner ||
    previousSource.authority ||
    previous?.summary?.tokenPressOwner ||
    previous?.summary?.tokenPressAuthority ||
    null;
  const retainedSource = {
    ...previousSource,
    ...currentSource,
    ok: false,
    stale: true,
    owner,
    mints: previousSource.mints,
    fingerprint: previousSource.fingerprint || null,
    reason: currentSource?.reason || "Current token read unavailable; showing last observed values.",
  };

  return {
    ...current,
    sources: {
      ...(current?.sources || {}),
      "solana.tokens": retainedSource,
    },
    summary: {
      ...(current?.summary || {}),
      tokenPress: retainedSource.mints,
      tokenPressOwner: owner,
      tokenPressStale: true,
      tokenPressFingerprint: retainedSource.fingerprint,
    },
  };
}

export function preserveTrixHistory(previous, current) {
  const observed = current?.sources?.["trix.geoff"];
  if (!observed) return current;
  const trix = mergeTrixGeoffHistory(previous?.sources?.["trix.geoff"], observed);
  return {
    ...current,
    sources: { ...(current.sources || {}), "trix.geoff": trix },
    summary: {
      ...(current.summary || {}),
      trixGeoffCount: trix.count,
      trixGeoffPaidSol: trix.paidSol,
      trixGeoffFingerprint: trix.fingerprint,
      trixPacksMinted: trix.packs?.minted ?? null,
      trixPacksFingerprint: trix.packs?.fingerprint ?? null,
    },
  };
}

export async function getStoredPayload() {
  if (useSharedDesk()) {
    return getSharedPayload({ sniffLive: false });
  }

  const [latest, events, state, dailyActivity] = await Promise.all([
    loadLatestSnapshot(),
    loadEvents(),
    loadState(),
    loadDailyActivity(),
  ]);
  return withBriefing({
    latest,
    events,
    dailyActivity,
    state,
    temperature: computeTemperature(events, latest),
    config: publicConfig(),
  });
}

/**
 * Authoritative Vercel path: shared desk history + optional live sniff.
 * Never trusts browser localStorage as the source of truth.
 */
export async function getSharedPayload({ sniffLive = true, forceMiningSurface = false } = {}) {
  const shared = await loadSharedBundle();
  let latest = shared.latest;
  let newEvents = [];
  let events = shared.events || [];
  let dailyActivity = shared.dailyActivity || [];
  let persisted = false;
  let persistError = null;

  if (sniffLive) {
    const snapshot = preserveTrixHistory(
      shared.latest,
      preserveLastKnownTokenPress(
        shared.latest,
        await runSniff({ forceMiningSurface, previous: shared.latest }),
      ),
    );
    newEvents = translate(shared.latest, snapshot);
    events = pruneEvents([...newEvents, ...(shared.events || [])]);
    dailyActivity = upsertDailyActivity(shared.dailyActivity || [], newEvents, {
      heatmapDays: config.heatmapDays,
    });
    latest = snapshot;

    // This live path is reserved for explicit internal callers; public routes use sniffLive=false.
    if (sharedStoreConfig().writable) {
      try {
        const temperature = computeTemperature(events, snapshot);
        await saveSharedBundle({
          latest: snapshot,
          events,
          dailyActivity,
          state: {
            startedAt: shared.state?.startedAt || new Date().toISOString(),
            lastPollAt: snapshot.takenAt,
            lastError: null,
            pollCount: (shared.state?.pollCount || 0) + 1,
            temperature: temperature.value,
          },
        });
        persisted = true;
      } catch (error) {
        persistError = error.message;
      }
    }
  }

  const temperature = computeTemperature(events, latest);
  return withBriefing({
    latest,
    events,
    newEvents,
    dailyActivity,
    state: {
      ...(shared.state || {}),
      lastPollAt: latest?.takenAt || shared.state?.lastPollAt || null,
      temperature: temperature.value,
    },
    temperature,
    sharedMeta: {
      updatedAt: shared.updatedAt,
      persisted,
      persistError,
      source: sharedStoreConfig().rawUrl,
    },
    config: publicConfig(),
  });
}

/**
 * @param {object} options
 * @param {object|null} [options.previous] ignored on Vercel (shared desk is baseline)
 * @param {object[]} [options.knownEvents] ignored on Vercel
 * @param {boolean} [options.forceMiningSurface] force a fresh mining-surface sniff
 * @param {boolean} [options.persist] write to local data/ store
 */
export async function pollAndTranslate({
  previous = null,
  knownEvents = [],
  forceMiningSurface = false,
  persist = !useSharedDesk(),
} = {}) {
  if (useSharedDesk()) {
    // Shared Redis desk is authoritative — browser/local empty files must not replace it.
    return getSharedPayload({ sniffLive: true, forceMiningSurface });
  }

  const startedState = persist ? await loadState() : { startedAt: null, pollCount: 0 };
  if (!startedState.startedAt) startedState.startedAt = new Date().toISOString();

  const baseline = previous ?? (persist ? await loadLatestSnapshot() : null);
  const snapshot = preserveTrixHistory(
    baseline,
    preserveLastKnownTokenPress(
      baseline,
      await runSniff({ forceMiningSurface, previous: baseline }),
    ),
  );
  const newEvents = translate(baseline, snapshot);

  let events;
  if (persist) {
    await saveLatestSnapshot(snapshot);
    events = await appendEvents(newEvents);
  } else {
    events = [...newEvents, ...knownEvents].slice(0, config.maxEvents);
  }

  const temperature = computeTemperature(events, snapshot);
  const state = {
    ...startedState,
    lastPollAt: snapshot.takenAt,
    lastError: null,
    pollCount: (startedState.pollCount || 0) + 1,
    temperature: temperature.value,
  };

  if (persist) await saveState(state);

  const dailyActivity = persist ? await loadDailyActivity() : [];

  return withBriefing({
    latest: snapshot,
    events,
    newEvents,
    dailyActivity,
    state,
    temperature,
    config: publicConfig(),
  });
}
