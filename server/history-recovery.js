import { normalizeBundle } from "./shared-store.js";
import { restoreVoidHistory } from "./trix-voids.js";

// Recover missing source observations only. Existing sources and their ledgers
// win: concatenating aggregate wallet ledgers can double-credit deposits.
export function recoverMissingHistory(current, backup) {
  const existing = current.latest?.sources || {};
  const recoveredSources = Object.keys(backup.latest?.sources || {}).filter((id) => !Object.hasOwn(existing, id) && !(id === "trix.voids" && current.voidLedger));
  const sources = { ...backup.latest?.sources, ...existing };
  if (!existing["trix.voids"] && current.voidLedger) delete sources["trix.voids"];
  const latest = restoreVoidHistory({ ...(current.latest || backup.latest), sources }, current.voidLedger || backup.voidLedger);
  const bundle = normalizeBundle({
    ...current,
    latest,
    voidLedger: current.voidLedger || backup.voidLedger,
    historicalEvents: [...(current.historicalEvents || []), ...(backup.historicalEvents || []), ...(backup.events || [])],
  });
  return { bundle, recoveredSources };
}
