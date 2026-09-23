export const EVIDENCE_WINDOW = 24 * 60 * 60 * 1000;

export function evidenceState(source, now = Date.now()) {
  const at = Date.parse(source?.dataUpdatedAt || source?.checkedAt || "");
  const age = now - at;
  if (Number.isFinite(at) && age > EVIDENCE_WINDOW) return "EXPIRED";
  if ([401, 403].includes(source?.status) || source?.skipped) return "ACCESS REQUIRED";
  if (!source || source.ok !== true || source.stale || !Number.isFinite(at) || age < 0) return "UNAVAILABLE";
  return age > 20 * 60 * 1000 ? "DELAYED" : "CURRENT";
}

export function filterEvidence(snapshot, now = Date.now()) {
  if (!snapshot) return null;
  const sources = Object.fromEntries(Object.entries(snapshot.sources || {}).map(([id, source]) => {
    const state = evidenceState(source, now);
    if (["CURRENT", "DELAYED"].includes(state)) return [id, source];
    return [id, {
      source: id, ok: false, status: source.status, checkedAt: source.checkedAt,
      dataUpdatedAt: source.dataUpdatedAt, sourceUrl: source.sourceUrl,
      evidenceState: state, stale: true,
      reason: `${state}: values withheld. ${source.reason || "No usable recent observation."}`,
    }];
  }));
  return { ...snapshot, sources };
}
