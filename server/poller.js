import { config } from "./config.js";
import { getStoredPayload, pollAndTranslate } from "./service.js";

let timer = null;
let polling = false;
const listeners = new Set();

export function onUpdate(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(payload) {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // ignore subscriber errors
    }
  }
}

export async function getDashboardPayload() {
  return getStoredPayload();
}

export async function pollOnce({ force = false, previous = null, knownEvents = [], forceMiningSurface = false } = {}) {
  if (polling && !force) return getStoredPayload();
  polling = true;
  try {
    const payload = await pollAndTranslate({
      previous,
      knownEvents,
      forceMiningSurface,
      persist: !process.env.VERCEL,
    });
    emit(payload);
    return payload;
  } catch (error) {
    const payload = await getStoredPayload().catch(() => ({
      latest: null,
      events: [],
      state: { lastError: error.message },
      temperature: { value: 0, label: "cool", recentEventCount: 0 },
    }));
    payload.error = error?.message || String(error);
    if (payload.state) payload.state.lastError = payload.error;
    emit(payload);
    throw error;
  } finally {
    polling = false;
  }
}

export function startPoller() {
  if (timer || process.env.VERCEL || process.env.GT_ENABLE_POLLER !== "1") return;
  pollOnce().catch(() => {});
  timer = setInterval(() => {
    pollOnce().catch(() => {});
  }, config.pollIntervalMs);
}

export function stopPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}
