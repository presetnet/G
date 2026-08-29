import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { mergeDailyActivity, pruneDailyActivity, upsertDailyActivity } from "./daily-activity.js";
import { normalizeEvents } from "./translator.js";

async function ensureDataDir() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await ensureDataDir();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

const paths = {
  events: () => path.join(config.dataDir, "events.json"),
  snapshots: () => path.join(config.dataDir, "snapshots.json"),
  latest: () => path.join(config.dataDir, "latest.json"),
  state: () => path.join(config.dataDir, "state.json"),
  dailyActivity: () => path.join(config.dataDir, "daily-activity.json"),
  traffic: () => path.join(config.dataDir, "traffic.json"),
  miningSurfaceCache: () => path.join(config.dataDir, "mining-surface-cache.json"),
};

export async function loadState() {
  return readJson(paths.state(), {
    startedAt: null,
    lastPollAt: null,
    lastError: null,
    pollCount: 0,
    temperature: 0,
  });
}

export async function saveState(state) {
  await writeJson(paths.state(), state);
}

function pruneTrackWindow(events = []) {
  const cutoff = Date.now() - config.trackWindowHours * 60 * 60 * 1000;
  return events.filter((e) => {
    const t = Date.parse(e?.at || "");
    return Number.isFinite(t) && t >= cutoff;
  });
}

function needsLegacyCleanup(events = []) {
  return events.some(
    (e) =>
      !e?.rank ||
      e.vibe === "Big deal" ||
      e.vibe === "Notable" ||
      (typeof e.heat === "number" && e.heat >= 7) ||
      (e.severity === "high" && !e.rank),
  );
}

export async function loadEvents() {
  const raw = pruneTrackWindow(await readJson(paths.events(), []));
  const next = normalizeEvents(raw).slice(0, config.maxEvents);
  if (needsLegacyCleanup(raw) || next.length !== raw.length) {
    await writeJson(paths.events(), next);
  }
  return next;
}

export async function appendEvents(newEvents) {
  const events = await loadEvents();
  if (!newEvents.length) return events;
  const next = normalizeEvents(pruneTrackWindow([...newEvents, ...events])).slice(
    0,
    config.maxEvents,
  );
  await writeJson(paths.events(), next);
  await appendDailyActivity(newEvents);
  return next;
}

export async function loadDailyActivity() {
  const raw = await readJson(paths.dailyActivity(), []);
  return pruneDailyActivity(raw, config.heatmapDays);
}

export async function appendDailyActivity(newEvents = []) {
  if (!newEvents.length) return loadDailyActivity();
  const current = await loadDailyActivity();
  const next = upsertDailyActivity(current, newEvents, {
    heatmapDays: config.heatmapDays,
  });
  await writeJson(paths.dailyActivity(), next);
  return next;
}

export async function saveDailyActivity(rows = []) {
  const next = pruneDailyActivity(rows, config.heatmapDays);
  await writeJson(paths.dailyActivity(), next);
  return next;
}

export async function mergeAndSaveDailyActivity(rows = []) {
  const current = await loadDailyActivity();
  const next = mergeDailyActivity(current, rows, config.heatmapDays);
  await writeJson(paths.dailyActivity(), next);
  return next;
}

export async function loadTraffic() {
  return readJson(paths.traffic(), {
    totalViews: 0,
    paths: {},
    lastViewedAt: null,
  });
}

export async function recordTraffic(route = "/") {
  const current = await loadTraffic();
  const key = route || "/";
  const next = {
    totalViews: (Number(current.totalViews) || 0) + 1,
    paths: {
      ...(current.paths || {}),
      [key]: (Number(current.paths?.[key]) || 0) + 1,
    },
    lastViewedAt: new Date().toISOString(),
  };
  await writeJson(paths.traffic(), next);
  return next;
}

export async function loadMiningSurfaceCache() {
  return readJson(paths.miningSurfaceCache(), null);
}

export async function saveMiningSurfaceCache(value) {
  await writeJson(paths.miningSurfaceCache(), value);
  return value;
}

export async function clearMiningSurfaceCache() {
  try {
    await fs.unlink(paths.miningSurfaceCache());
  } catch {}
}

export async function loadSnapshots() {
  return readJson(paths.snapshots(), []);
}

export async function saveLatestSnapshot(snapshot) {
  await writeJson(paths.latest(), snapshot);
  const snaps = await loadSnapshots();
  const next = [snapshot, ...snaps].slice(0, config.maxSnapshots);
  await writeJson(paths.snapshots(), next);
  return next;
}

export async function loadLatestSnapshot() {
  return readJson(paths.latest(), null);
}
