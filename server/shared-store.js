/**
 * Universal live desk — one Redis bundle for every visitor.
 * Hot path: Upstash Redis REST (instant read/write).
 * Cold seed only: optional gt-live GitHub JSON if Redis is empty.
 */

import { config } from "./config.js";
import { pruneDailyActivity } from "./daily-activity.js";
import { emptyPond0x, prunePond0x } from "./pond0x.js";
import { normalizeEvents } from "./translator.js";

const REDIS_KEY = process.env.GT_REDIS_KEY || "gt:live:desk";
const DEFAULT_REPO = "goldennftplatform-svg/gt";
const DEFAULT_BRANCH = "gt-live";
const DEFAULT_PATH = "shared.json";

function redisUrl() {
  return process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
}

function redisToken() {
  return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
}

function githubToken() {
  return process.env.GT_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
}

function repo() {
  return process.env.GT_SHARED_REPO || DEFAULT_REPO;
}

function branch() {
  return process.env.GT_SHARED_BRANCH || DEFAULT_BRANCH;
}

function filePath() {
  return process.env.GT_SHARED_PATH || DEFAULT_PATH;
}

export function sharedStoreConfig() {
  const redis = Boolean(redisUrl() && redisToken());
  return {
    enabled: true,
    backend: redis ? "redis" : githubToken() ? "github" : "none",
    writable: redis || Boolean(githubToken()),
    redis: redis,
    redisKey: REDIS_KEY,
    rawUrl: `https://api.github.com/repos/${repo()}/contents/${filePath()}?ref=${branch()}`,
  };
}

function emptyBundle() {
  return {
    updatedAt: null,
    latest: null,
    events: [],
    dailyActivity: [],
    pond0x: emptyPond0x(),
    state: {
      startedAt: null,
      lastPollAt: null,
      lastError: null,
      pollCount: 0,
      temperature: 0,
    },
  };
}

// Keep a fat queue tape for the 72h pump chart. Surface always reserved first.
const MAX_QUEUE_EVENTS = 1800;

export function pruneEvents(events = []) {
  const cutoff = Date.now() - config.trackWindowHours * 60 * 60 * 1000;
  const normalized = normalizeEvents(events).filter((e) => {
    const t = Date.parse(e?.at || "");
    return Number.isFinite(t) && t >= cutoff;
  });

  // Keep all surface diffs first; cap noisy queue/in-flight edges.
  // Surface MUST come before the maxEvents slice so queue spam can't erase history.
  const surface = [];
  const queue = [];
  for (const e of normalized) {
    if (e?.kind === "agent") queue.push(e);
    else surface.push(e);
  }
  const cappedQueue = queue.slice(0, MAX_QUEUE_EVENTS);
  const room = Math.max(0, config.maxEvents - cappedQueue.length);
  return [...surface.slice(0, room), ...cappedQueue].slice(0, config.maxEvents);
}

export function normalizeBundle(raw) {
  const base = emptyBundle();
  if (!raw || typeof raw !== "object") return base;
  return {
    updatedAt: raw.updatedAt || null,
    latest: raw.latest || null,
    events: pruneEvents(raw.events || []),
    dailyActivity: pruneDailyActivity(raw.dailyActivity || [], config.heatmapDays),
    pond0x: prunePond0x(raw.pond0x || null, config.heatmapDays),
    state: { ...base.state, ...(raw.state || {}) },
  };
}

async function redisCommand(command) {
  const url = redisUrl();
  const token = redisToken();
  if (!url || !token) throw new Error("Redis not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    throw new Error(body.error || `redis HTTP ${res.status}`);
  }
  return body.result;
}

export async function acquireSharedLock(name, ttlSeconds = 70) {
  if (!redisUrl() || !redisToken()) return null;
  const key = `${REDIS_KEY}:lock:${name}`;
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const result = await redisCommand(["SET", key, token, "NX", "EX", ttlSeconds]);
  return result === "OK" ? { key, token } : null;
}

export async function releaseSharedLock(lock) {
  if (!lock) return;
  await redisCommand([
    "EVAL",
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    "1",
    lock.key,
    lock.token,
  ]);
}

async function loadFromRedis() {
  if (!redisUrl() || !redisToken()) return null;
  const raw = await redisCommand(["GET", REDIS_KEY]);
  if (!raw) return null;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return normalizeBundle(parsed);
}

async function saveToRedis(bundle) {
  const normalized = normalizeBundle({
    ...bundle,
    updatedAt: new Date().toISOString(),
  });
  await redisCommand(["SET", REDIS_KEY, JSON.stringify(normalized)]);
  return normalized;
}

async function loadFromGithub() {
  // Contents API (not raw.githubusercontent) so the store survives private repos.
  const token = githubToken();
  const api = `https://api.github.com/repos/${repo()}/contents/${filePath()}?ref=${branch()}`;
  try {
    const res = await fetch(api, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github.raw",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "User-Agent": "GeoffThermometer/shared-store",
      },
    });
    if (res.status === 404) return emptyBundle();
    if (!res.ok) throw new Error(`github contents HTTP ${res.status}`);
    return normalizeBundle(await res.json());
  } catch (error) {
    throw new Error(`Unable to load shared GitHub desk: ${error?.message || error}`);
  }
}

async function saveToGithub(bundle, message) {
  const token = githubToken();
  if (!token) return null;

  const normalized = normalizeBundle({
    ...bundle,
    updatedAt: new Date().toISOString(),
  });
  const content = Buffer.from(JSON.stringify(normalized, null, 2), "utf8").toString("base64");
  const api = `https://api.github.com/repos/${repo()}/contents/${filePath()}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const metaRes = await fetch(`${api}?ref=${branch()}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "GeoffThermometer/shared-store",
      },
    });
    const meta = metaRes.status === 404 ? null : await metaRes.json();
    const sha = meta?.sha || null;
    const res = await fetch(api, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "GeoffThermometer/shared-store",
      },
      body: JSON.stringify({
        message: message || `live tick ${normalized.updatedAt}`,
        content,
        branch: branch(),
        sha: sha || undefined,
      }),
    });
    if (res.ok) return normalized;
    if (res.status === 409 && attempt < 2) continue;
    const text = await res.text();
    throw new Error(`github write HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return normalized;
}

export async function loadSharedBundle() {
  // Instant path
  const redisBundle = await loadFromRedis().catch(() => null);
  if (redisBundle?.latest || redisBundle?.events?.length) return redisBundle;

  // Optional one-time cold seed from GitHub when Redis is empty. A cold-seed
  // outage (e.g. bad/stale token) must NOT kill the whole desk: when Redis is
  // configured it simply gets seeded fresh by the next live sniff, so degrade to
  // an empty bundle instead of throwing. Only re-throw when there is truly no
  // readable desk (neither Redis nor GitHub).
  try {
    const githubBundle = await loadFromGithub();
    if (githubBundle.latest || githubBundle.events?.length) {
      if (redisUrl() && redisToken()) await saveToRedis(githubBundle).catch(() => {});
      return githubBundle;
    }
    return emptyBundle();
  } catch (error) {
    if (!(redisUrl() && redisToken())) throw error;
    return emptyBundle();
  }
}

export async function saveSharedBundle(bundle, { message, mirrorGithub = true } = {}) {
  const cfg = sharedStoreConfig();
  if (!cfg.writable) {
    throw new Error("No Redis/GitHub credentials — cannot write shared desk");
  }

  let saved;
  if (cfg.redis) {
    saved = await saveToRedis(bundle);
    // Best-effort mirror; never block the hot path on GitHub latency
    if (mirrorGithub) saveToGithub(saved, message).catch(() => {});
    return saved;
  }

  return saveToGithub(bundle, message);
}

export { emptyBundle };
