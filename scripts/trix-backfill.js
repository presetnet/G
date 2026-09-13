#!/usr/bin/env node
import {
  collectTrixArtworkCursorPages,
  loadTrixArtworkArchive,
  mergeTrixArtworkArchive,
  saveTrixArtworkArchive,
  summarizeTrixArtworkArchive,
  TRIX_ARTWORK_ARCHIVE_FILE,
} from "../server/trix-feeds.js";

function parseArgs(argv) {
  const args = {
    dataset: "artworks",
    maxPages: 3,
    pageSize: 100,
    file: TRIX_ARTWORK_ARCHIVE_FILE,
    restart: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inline] = arg.startsWith("--") ? arg.slice(2).split("=") : [null, null];
    const value = inline ?? (key && !["restart", "dry-run"].includes(key) ? argv[++index] : true);
    if (key === "dataset") args.dataset = value;
    else if (key === "max-pages") args.maxPages = Number(value);
    else if (key === "page-size") args.pageSize = Number(value);
    else if (key === "file") args.file = value;
    else if (key === "restart") args.restart = true;
    else if (key === "dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg) throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return `Usage: node scripts/trix-backfill.js --dataset artworks [--max-pages 3] [--page-size 100] [--file trix-artworks-history.json] [--restart] [--dry-run]

Datasets:
  artworks    Backfill TRIX public artworks with /api/artworks?pageSize=&cursor=

Notes:
  --restart ignores the saved nextCursor but merges into the existing archive by artwork ID.
  --dry-run fetches pages and reports what would be saved, without writing data/.
`;
}

function report(label, archive) {
  const summary = summarizeTrixArtworkArchive(archive);
  console.log(`${label}: ${JSON.stringify(summary, null, 2)}`);
}

async function runArtworkBackfill(args) {
  if (!Number.isFinite(args.maxPages) || args.maxPages < 0) {
    throw new Error("--max-pages must be a non-negative number");
  }
  if (!Number.isFinite(args.pageSize) || args.pageSize < 1) {
    throw new Error("--page-size must be a positive number");
  }
  const archive = await loadTrixArtworkArchive({ file: args.file });
  report("before", archive);
  if (archive.completed && !args.restart) {
    console.log("archive already completed; pass --restart to sample from the head again");
    return archive;
  }
  const cursor = args.restart ? null : archive.nextCursor || null;
  const collected = await collectTrixArtworkCursorPages({
    pageSize: args.pageSize,
    maxPages: args.maxPages,
    cursor,
    knownIds: archive.items.map((item) => item.id),
    seenCursors: archive.seenCursors,
  });
  console.log(`run: ${JSON.stringify({
    pagesFetched: collected.pagesFetched,
    newItems: collected.items.length,
    nextCursor: collected.nextCursor,
    completed: collected.completed,
    stoppedReason: collected.stoppedReason,
  }, null, 2)}`);
  if (!collected.ok) throw new Error(`backfill stopped on unsafe cursor state: ${collected.stoppedReason}`);
  const next = mergeTrixArtworkArchive(archive, collected);
  report("after", next);
  if (!args.dryRun) await saveTrixArtworkArchive(next, { file: args.file });
  else console.log("dry-run: archive not written");
  return next;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.dataset !== "artworks") throw new Error(`Unsupported dataset: ${args.dataset}`);
  await runArtworkBackfill(args);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
