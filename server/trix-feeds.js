import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export const TRIX_BASE_URL = "https://www.trix.market";
export const TRIX_ARTWORK_ARCHIVE_FILE = "trix-artworks-history.json";

function finiteNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanDate(value) {
  const time = typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function absoluteUrl(value) {
  const text = cleanString(value);
  if (!text) return null;
  try {
    const url = new URL(text, TRIX_BASE_URL);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function normalizeTrixArtwork(row, { fetchedAt = null } = {}) {
  const id = cleanString(row?.id);
  if (!id) return null;
  return {
    id,
    name: cleanString(row?.name),
    description: cleanString(row?.description),
    artworkType: cleanString(row?.artworkType),
    editionType: cleanString(row?.editionType),
    status: cleanString(row?.status),
    userId: cleanString(row?.userId),
    holderWallet: cleanString(row?.holderWallet),
    mintAddress: cleanString(row?.mintAddress),
    collectionId: cleanString(row?.collectionId),
    linkedCoinMint: cleanString(row?.linkedCoinMint),
    linkedCoinSymbol: cleanString(row?.linkedCoinSymbol),
    linkedCoinName: cleanString(row?.linkedCoinName),
    imageUrl: absoluteUrl(row?.imageUrl),
    animationUrl: absoluteUrl(row?.animationUrl),
    metadataUri: absoluteUrl(row?.metadataUri),
    website: absoluteUrl(row?.website),
    maxSupply: finiteNumber(row?.maxSupply),
    printedSupply: finiteNumber(row?.printedSupply),
    royaltyBps: finiteNumber(row?.royaltyBps),
    mintFeeLamports: finiteNumber(row?.mintFeeLamports),
    voidOnly: typeof row?.voidOnly === "boolean" ? row.voidOnly : null,
    createdAt: cleanDate(row?.createdAt),
    fetchedAt: cleanDate(fetchedAt) || new Date().toISOString(),
  };
}

function artworkPageUrl({ baseUrl = TRIX_BASE_URL, pageSize, cursor = null } = {}) {
  const url = new URL("/api/artworks", baseUrl);
  url.searchParams.set("pageSize", String(pageSize));
  if (cursor) url.searchParams.set("cursor", cursor);
  return url;
}

export async function fetchTrixArtworkCursorPage({
  baseUrl = TRIX_BASE_URL,
  pageSize = 100,
  cursor = null,
  fetchImpl = fetch,
  timeoutMs = 6000,
} = {}) {
  const size = Math.max(1, Math.min(100, Math.floor(finiteNumber(pageSize) ?? 100)));
  const url = artworkPageUrl({ baseUrl, pageSize: size, cursor });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(url.href, {
      signal: controller.signal,
      headers: { "User-Agent": "GeoffThermometer/trix-artwork-backfill" },
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!response.ok) {
      throw new Error(`TRIX artworks HTTP ${response.status}`);
    }
    const rawItems = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : null;
    if (!rawItems) throw new Error("TRIX artworks payload missing items array");
    const fetchedAt = new Date().toISOString();
    return {
      ok: true,
      status: response.status,
      sourceUrl: url.href,
      cursor,
      nextCursor: cleanString(json?.nextCursor),
      items: rawItems.map((row) => normalizeTrixArtwork(row, { fetchedAt })).filter(Boolean),
      rawCount: rawItems.length,
      fetchedAt,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectTrixArtworkCursorPages({
  baseUrl = TRIX_BASE_URL,
  pageSize = 100,
  maxPages = 1,
  cursor = null,
  knownIds = [],
  seenCursors = [],
  fetchImpl = fetch,
  timeoutMs = 6000,
} = {}) {
  const pagesMax = Math.max(0, Math.floor(finiteNumber(maxPages) ?? 1));
  const pageItems = [];
  const pageSummaries = [];
  const ids = new Set(knownIds.filter(Boolean));
  const cursors = new Set(seenCursors.filter(Boolean));
  let nextCursor = cursor || null;
  let completed = false;
  let stoppedReason = pagesMax === 0 ? "max-pages-zero" : null;

  for (let pageIndex = 0; pageIndex < pagesMax; pageIndex += 1) {
    if (nextCursor && cursors.has(nextCursor)) {
      stoppedReason = "repeated-cursor";
      break;
    }
    if (nextCursor) cursors.add(nextCursor);
    const page = await fetchTrixArtworkCursorPage({ baseUrl, pageSize, cursor: nextCursor, fetchImpl, timeoutMs });
    const newItems = [];
    for (const item of page.items) {
      if (!ids.has(item.id)) {
        ids.add(item.id);
        pageItems.push(item);
        newItems.push(item.id);
      }
    }
    pageSummaries.push({
      sourceUrl: page.sourceUrl,
      cursor: page.cursor,
      nextCursor: page.nextCursor,
      rawCount: page.rawCount,
      newCount: newItems.length,
      newIds: newItems,
      fetchedAt: page.fetchedAt,
      ms: page.ms,
    });
    if (!page.nextCursor) {
      completed = true;
      nextCursor = null;
      stoppedReason = "terminal-page";
      break;
    }
    if (page.nextCursor === nextCursor || cursors.has(page.nextCursor)) {
      nextCursor = page.nextCursor;
      stoppedReason = "repeated-cursor";
      break;
    }
    nextCursor = page.nextCursor;
  }
  if (!stoppedReason && !completed) stoppedReason = "page-budget-exhausted";
  return {
    ok: stoppedReason !== "repeated-cursor",
    items: pageItems,
    pageSummaries,
    pagesFetched: pageSummaries.length,
    nextCursor,
    completed,
    stoppedReason,
    seenCursors: [...cursors],
  };
}

export function summarizeTrixArtworkArchive(archive = {}) {
  const items = Array.isArray(archive.items) ? archive.items : [];
  const dates = items.map((item) => Date.parse(item?.createdAt || "")).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: items.length,
    oldestCreatedAt: dates.length ? new Date(dates[0]).toISOString() : null,
    newestCreatedAt: dates.length ? new Date(dates.at(-1)).toISOString() : null,
    nextCursor: cleanString(archive.nextCursor),
    completed: archive.completed === true,
    updatedAt: cleanDate(archive.updatedAt),
    pagesFetched: finiteNumber(archive.pagesFetched) ?? 0,
  };
}

function archivePath(file = TRIX_ARTWORK_ARCHIVE_FILE) {
  return path.join(config.dataDir, file);
}

export async function loadTrixArtworkArchive({ file = TRIX_ARTWORK_ARCHIVE_FILE } = {}) {
  try {
    const raw = await fs.readFile(archivePath(file), "utf8");
    const parsed = JSON.parse(raw);
    return {
      schemaVersion: 1,
      dataset: "trix.artworks.cursor",
      startedAt: parsed.startedAt || null,
      updatedAt: parsed.updatedAt || null,
      nextCursor: parsed.nextCursor || null,
      completed: parsed.completed === true,
      pagesFetched: finiteNumber(parsed.pagesFetched) ?? 0,
      seenCursors: Array.isArray(parsed.seenCursors) ? parsed.seenCursors.filter(Boolean) : [],
      items: Array.isArray(parsed.items) ? parsed.items.map((item) => normalizeTrixArtwork(item, { fetchedAt: item?.fetchedAt })).filter(Boolean) : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch {
    return {
      schemaVersion: 1,
      dataset: "trix.artworks.cursor",
      startedAt: null,
      updatedAt: null,
      nextCursor: null,
      completed: false,
      pagesFetched: 0,
      seenCursors: [],
      items: [],
      runs: [],
    };
  }
}

export async function saveTrixArtworkArchive(archive, { file = TRIX_ARTWORK_ARCHIVE_FILE } = {}) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const target = archivePath(file);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(archive, null, 2), "utf8");
  await fs.rename(tmp, target);
  return archive;
}

export function mergeTrixArtworkArchive(archive, collected, { now = new Date().toISOString(), maxRuns = 20 } = {}) {
  const byId = new Map();
  for (const item of [...(archive.items || []), ...(collected.items || [])]) {
    if (!item?.id) continue;
    const previous = byId.get(item.id);
    byId.set(item.id, {
      ...previous,
      ...item,
      createdAt: item.createdAt || previous?.createdAt || null,
      fetchedAt: previous?.fetchedAt || item.fetchedAt || now,
      lastSeenAt: now,
    });
  }
  const items = [...byId.values()].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const run = {
    at: now,
    pagesFetched: collected.pagesFetched,
    newItems: collected.items.length,
    nextCursor: collected.nextCursor,
    completed: collected.completed,
    stoppedReason: collected.stoppedReason,
  };
  return {
    schemaVersion: 1,
    dataset: "trix.artworks.cursor",
    startedAt: archive.startedAt || now,
    updatedAt: now,
    nextCursor: collected.nextCursor,
    completed: archive.completed === true || collected.completed === true,
    pagesFetched: (finiteNumber(archive.pagesFetched) ?? 0) + collected.pagesFetched,
    seenCursors: [...new Set([...(archive.seenCursors || []), ...(collected.seenCursors || [])])],
    items,
    runs: [run, ...(archive.runs || [])].slice(0, maxRuns),
  };
}
