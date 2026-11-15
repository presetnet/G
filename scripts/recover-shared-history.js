// Dry-run by default. Uses gh authentication without printing any credentials.
import { execFileSync, spawnSync } from "node:child_process";
import { recoverMissingHistory } from "../server/history-recovery.js";

const args = process.argv.slice(2);
const option = (key) => args[args.indexOf(key) + 1];
for (const key of ["--repo", "--revision"]) {
  if (!args.includes(key) || !option(key) || option(key).startsWith("--")) throw Error(`Required: ${key}`);
}
const repo = option("--repo");
const revision = option("--revision");
const branch = args.includes("--branch") ? option("--branch") : "gt-live";
const path = args.includes("--path") ? option("--path") : "shared.json";
if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f\d]{40}$/i.test(revision)) throw Error("Use owner/repo and a full backup commit SHA");
const endpoint = `repos/${repo}/contents/${path}`;
const read = (ref, raw = false) => JSON.parse(execFileSync("gh", ["api", `${endpoint}?ref=${encodeURIComponent(ref)}`,
  "-H", `Accept: ${raw ? "application/vnd.github.raw" : "application/vnd.github+json"}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const metadata = read(branch);
// Read the exact content blob; PUT below requires the same SHA so a collector
// writing concurrently causes a conflict rather than silently losing its data.
const current = metadata.content ? JSON.parse(Buffer.from(metadata.content, "base64").toString())
  : JSON.parse(execFileSync("gh", ["api", `repos/${repo}/git/blobs/${metadata.sha}`, "-H", "Accept: application/vnd.github.raw"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const backup = read(revision, true);
const { bundle, recoveredSources } = recoverMissingHistory(current, backup);
console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", repo, branch, revision,
  currentAt: current.latest?.takenAt, backupAt: backup.latest?.takenAt,
  currentSources: Object.keys(current.latest?.sources || {}).length, recoveredSources,
  historicalEvents: bundle.historicalEvents.length,
  note: "Existing live sources and ledger win; original observation timestamps remain unchanged." }, null, 2));
if (args.includes("--apply")) {
  const result = spawnSync("gh", ["api", "--method", "PUT", endpoint, "--input", "-", "--silent"], {
    input: JSON.stringify({ branch, sha: metadata.sha, message: `Recover missing dated history from ${revision.slice(0, 12)}`,
      content: Buffer.from(JSON.stringify(bundle)).toString("base64") }), encoding: "utf8", maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw Error(`Recovery refused; concurrent writes must be re-read. ${result.stderr}`);
  console.log("Recovery saved. Previous contents remain in GitHub history.");
}
