const HOUR = 3600000;

// A census-growth rate, not transaction-block-time throughput. Late-discovered
// receipts may increase this counter; never call the result confirmed sales.
export function packPace(chain, previous = [], now = Date.now()) {
  const at = Date.parse(chain?.updatedAt);
  const count = chain?.receipts;
  const identity = `${chain?.program || ""}:${chain?.packConfig || ""}`;
  let samples = previous.filter((s) => s.identity === identity && Number.isSafeInteger(s.count) && s.count >= 0 &&
    Number.isFinite(s.at) && s.at >= now - 2 * HOUR && s.at <= now).sort((a, b) => a.at - b.at);
  const result = { samples, perHour: null, delta: null, minutes: null, from: null, to: null, reason: "Waiting for receipt-census observations." };
  if (chain?.engine !== "receipts" || !chain?.program || !Number.isSafeInteger(count) || count < 0 || !Number.isFinite(at) || at > now || now - at > 20 * 60000) {
    return { ...result, reason: "Fresh receipt census unavailable." };
  }
  const last = samples.at(-1);
  if (last && (at < last.at || (at === last.at && count !== last.count))) return { ...result, reason: "Out-of-order or corrected census; waiting for a new observation." };
  if (last && count < last.count) return { ...result, samples: [{ at, count, identity }], reason: "Census decreased; rate baseline reset." };
  if (!last || at > last.at) samples.push({ at, count, identity });
  samples = samples.slice(-180);
  // Choose the oldest sample within the last hour. Never extrapolate a tiny
  // interval or bridge an outage longer than twenty minutes.
  const window = samples.filter((s) => s.at >= at - HOUR);
  const first = window[0];
  const minutes = (at - first.at) / 60000;
  const base = { ...result, samples, minutes, from: new Date(first.at).toISOString(), to: new Date(at).toISOString() };
  if (minutes < 15) return { ...base, reason: "Warming up · needs at least 15 minutes of census history." };
  if (window.some((s, i) => i > 0 && s.at - window[i - 1].at > 20 * 60000)) return { ...base, reason: "Collection gap in window; rate withheld." };
  const delta = count - first.count;
  return { ...base, delta, perHour: delta * 60 / minutes, reason: "Estimated receipt-census growth, normalized to one hour; late indexing may contribute." };
}

export function packLabel(value) {
  return String(value ?? "").replace(/boxes/gi, "Packs").replace(/box\b/gi, "Pack");
}
