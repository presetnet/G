/** Probe the live docs.geoff.ai nav + watched surface pages. */
const WATCHED = [
  "/introduction/overview",
  "/introduction/quickstart",
  "/introduction/authentication",
  "/introduction/x402-payg",
  "/introduction/models",
  "/geoff-code/getting-started",
  "/geoff-code/use-cases",
  "/geoff-code/mcp",
  "/geoff-code/plugins",
  "/geoff-code/hooks",
  "/geoff-code/skills",
  "/geoff-code/subagents",
  "/geoff-code/acp",
  "/api-reference/overview",
  "/api-reference/text/openai-api",
  "/api-reference/speech/t2a-http",
  "/api-reference/training/image-lora",
  "/api-reference/video/text-to-video",
  "/api-reference/image/text-to-image",
  "/api-reference/music/generate",
  "/api-reference/code/execute",
  "/api-reference/file/upload",
  "/token-plan/overview",
  "/token-plan/usage",
];

async function probe(path) {
  const url = `https://docs.geoff.ai${path}`;
  const res = await fetch(url, {
    headers: { "user-agent": "GeoffThermometer/1.0", accept: "text/html" },
    redirect: "follow",
  });
  const text = await res.text();
  const title = (text.match(/<title>([^<]+)/i) || [])[1] || "";
  const main = (text.match(/<main[\s\S]*?<\/main>/i) || [])[0] || "";
  const bodyLen = main
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
  const ok = res.status === 200 && !/page could not be found|NOT_FOUND/i.test(text.slice(0, 200));
  return {
    path,
    status: res.status,
    title: title.replace(/\s+/g, " ").slice(0, 80),
    bodyLen,
    ok,
  };
}

async function main() {
  const home = await fetch("https://docs.geoff.ai/", {
    headers: { "user-agent": "GeoffThermometer/1.0" },
  }).then((r) => r.text());

  const hrefs = [
    ...new Set(
      [...home.matchAll(/href="(\/[^"#?]{1,120})"/g)]
        .map((m) => m[1])
        .filter((h) => !h.startsWith("/_next") && !h.includes(".") && !h.includes("_props")),
    ),
  ].sort();
  console.log("homeNav", hrefs);
  const missingFromWatch = hrefs.filter((h) => !WATCHED.includes(h));
  console.log("navNotWatched", missingFromWatch);

  const results = [];
  for (const p of WATCHED) {
    results.push(await probe(p));
  }
  console.log(
    "live",
    results.filter((r) => r.ok).map((r) => `${r.path} body=${r.bodyLen} :: ${r.title}`),
  );
  console.log(
    "dead",
    results.filter((r) => !r.ok).map((r) => `${r.path} ${r.status}`),
  );
  console.log(`score ${results.filter((r) => r.ok).length}/${WATCHED.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
