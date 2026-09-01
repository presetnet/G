/**
 * Pond0x mining desk — rolling time-series of on-chain miner activity.
 * Fed by sniffPond0x() in sniffer.js. Aggregate only: no wallet identifiers,
 * no user addresses, nothing that maps back to an individual operator.
 * Mirrors server/daily-activity.js rollup conventions.
 */

import { dayKeyFromIso } from "./daily-activity.js";

export const DEFAULT_HEATMAP_DAYS = 60;
const MAX_RECENT_SAMPLES = 240;

export function emptyPond0x() {
  return {
    latest: null,
    recent: [],
    days: [],
  };
}

function emptyDayBucket(day) {
  return {
    day,
    samples: 0,
    txs: 0,
    rateSum: 0,
    rateSamples: 0,
    peakRate: null,
    minerSamples: 0,
    minerSum: 0,
    peakMiners: null,
    firstAt: null,
    lastAt: null,
  };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function prunePond0xDays(rows = [], heatmapDays = DEFAULT_HEATMAP_DAYS) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (heatmapDays - 1));
  const cutoffKey = dayKeyFromIso(cutoff.toISOString());
  return (rows || [])
    .filter((r) => r?.day && (!cutoffKey || r.day >= cutoffKey))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function prunePond0x(value, heatmapDays = DEFAULT_HEATMAP_DAYS) {
  const base = emptyPond0x();
  if (!value || typeof value !== "object") return base;
  return {
    latest: value.latest || null,
    recent: (Array.isArray(value.recent) ? value.recent : [])
      .filter((r) => r && (r.at || r.t))
      .sort(
        (a, b) => Date.parse(b.at || b.t || 0) - Date.parse(a.at || a.t || 0),
      )
      .slice(0, MAX_RECENT_SAMPLES),
    days: prunePond0xDays(Array.isArray(value.days) ? value.days : [], heatmapDays),
  };
}

/** Fold one pond0x.mining observation into the desk. Never high-fidelity per wallet. */
export function upsertPond0x(existing, observed) {
  const value = prunePond0x(existing);
  if (!observed || typeof observed !== "object") return value;

  const at = observed.checkedAt || new Date().toISOString();
  const day = dayKeyFromIso(at);
  const sample = {
    at,
    txs: finiteNumber(observed.activityCount),
    ratePerMinute: finiteNumber(observed.ratePerMinute),
    sampled: finiteNumber(observed.sampleCount),
    unique: finiteNumber(observed.sampledUnique),
    estActiveMiners: finiteNumber(observed.estActiveMiners),
    treasurySol: finiteNumber(observed.treasurySol),
  };

  value.recent = [sample, ...value.recent].slice(0, MAX_RECENT_SAMPLES);

  if (day) {
    const map = new Map((value.days || []).map((d) => [d.day, d]));
    const prev = map.get(day) || emptyDayBucket(day);
    map.set(day, {
      day,
      samples: prev.samples + 1,
      txs: prev.txs + (sample.txs || 0),
      rateSum: prev.rateSum + (sample.ratePerMinute || 0),
      rateSamples: prev.rateSamples + (sample.ratePerMinute != null ? 1 : 0),
      peakRate: Math.max(prev.peakRate || 0, sample.ratePerMinute || 0),
      minerSamples: prev.minerSamples + (sample.estActiveMiners != null ? 1 : 0),
      minerSum: prev.minerSum + (sample.estActiveMiners || 0),
      peakMiners: Math.max(prev.peakMiners || 0, sample.estActiveMiners || 0),
      firstAt: prev.firstAt || at,
      lastAt: at,
    });
    value.days = prunePond0xDays(Array.from(map.values()));
  }

  value.latest = { ...observed, at };
  return value;
}