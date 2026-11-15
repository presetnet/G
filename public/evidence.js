export const EVIDENCE_WINDOW = 24 * 60 * 60 * 1000;

export function evidenceState(source, now = Date.now()) {
  const at = Date.parse(source?.dataUpdatedAt || source?.checkedAt || "");
  const age = now - at;
  if (Number.isFinite(at) && age > EVIDENCE_WINDOW) return "EXPIRED";
  if ([401, 403].includes(source?.status) || source?.skipped) return "ACCESS REQUIRED";
  if (!source || source.ok !== true || source.stale || !Number.isFinite(at) || age < 0) return "UNAVAILABLE";
  const minuteSource = /^(trix\.|dibzi\.|pond0x\.)/.test(source.source || "") || ["stacknet.health", "stacknet.root", "stacknet.models"].includes(source.source);
  return age > (minuteSource ? 3 : 20) * 60 * 1000 ? "DELAYED" : "CURRENT";
}

export function filterEvidence(snapshot, now = Date.now()) {
  if (!snapshot) return null;
  // Separate dated observations from current values. This survives the API and
  // browser filtering passes without resurrecting stale summary metrics.
  const historicalSources = { ...(snapshot.historicalSources || {}) };
  const sources = Object.fromEntries(Object.entries(snapshot.sources || {}).map(([id, source]) => {
    const state = evidenceState(source, now);
    if (["CURRENT", "DELAYED"].includes(state)) {
      delete historicalSources[id];
      return [id, source];
    }
    if (!source.evidenceState && id !== "trix.voids") {
      historicalSources[id] = { ...source, historical: true };
    }
    if (id === "trix.voids" && source.ledger?.version === 1 && Array.isArray(source.ledger.records)) {
      return [id, { ...source, stale: true, evidenceState: state,
        reason: source.reason || `${state}: collection is not current; stored historical receipts are retained.` }];
    }
    return [id, {
      source: id, ok: false, status: source.status, checkedAt: source.checkedAt,
      dataUpdatedAt: source.dataUpdatedAt, sourceUrl: source.sourceUrl,
      evidenceState: state, stale: true,
      reason: source.evidenceState ? source.reason : `${state}: values withheld. ${source.reason || "No usable recent observation."}`,
    }];
  }));
  return { ...snapshot, sources, historicalSources };
}
