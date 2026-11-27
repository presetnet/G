const collection = "AtepVKUtuS7ecWr4GLqGJEzJmBZMFXihqjpoSSfABxTJ";
const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const tiers = ["base", "hype", "viral"];

// The ledger records observed cards, not guaranteed outstanding supply. A
// missing listing is not a sale, burn, or change of ownership.
export async function readCardInventory(cards, previous, detail, rpc, now = Date.now()) {
  const known = new Map(previous?.entries || []);
  const pending = new Map(previous?.pending || []);
  const listed = new Set();
  for (const card of cards) {
    if (!mintPattern.test(card.mint || "")) continue;
    listed.add(card.mint);
    if (!known.has(card.mint)) known.set(card.mint, "unknown");
    if (known.get(card.mint) === "unknown" && card.ripId) pending.set(card.mint, card.ripId);
  }
  let page = previous?.page || 1;
  let scannedAt = previous?.scannedAt || null;
  let indexAvailable = previous?.indexAvailable ?? false;
  if (!scannedAt || now - Date.parse(scannedAt) >= 60000) {
    scannedAt = new Date(now).toISOString();
    try {
      const result = await rpc("getAssetsByGroup", { groupKey: "collection", groupValue: collection, page, limit: 250 });
      if (!Array.isArray(result?.items)) throw Error("Collection index unavailable");
      for (const item of result.items) {
        if (item.burnt || !mintPattern.test(item.id) || known.has(item.id)) continue;
        known.set(item.id, "unknown");
      }
      page = result.items.length === 250 ? page + 1 : 1;
      indexAvailable = true;
    } catch { indexAvailable = false; }
  }
  // Retry unresolved IDs after other queued records, even after delisting.
  await Promise.all([...pending].slice(0, 6).map(async ([mint, id]) => {
    pending.delete(mint);
    try {
      const row = await detail(id);
      if (row?.cardMint === mint && tiers.includes(row.pack?.level)) {
        known.set(mint, row.pack.level);
        return;
      }
    } catch { /* Preserve the unresolved ID for a later tick. */ }
    pending.set(mint, id);
  }));
  const counts = Object.fromEntries([...tiers, "unknown"].map(t => [t, { known: 0, listed: 0 }]));
  for (const [mint, tier] of known) {
    counts[tier].known++;
    if (listed.has(mint)) counts[tier].listed++;
  }
  return { entries: [...known], pending: [...pending], page, scannedAt, indexAvailable, counts, collection };
}
