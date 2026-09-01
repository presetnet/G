async function dig(path) {
  const r = await fetch(`https://docs.geoff.ai${path}`, {
    headers: { "user-agent": "GeoffThermometer/1.0" },
  });
  const html = await r.text();
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [])[0] || html;
  const text = main
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const nums = [...text.matchAll(/\b(\d{1,4})\s+(tools?|models?|groups?|nodes?|GPUs?|tokens?|agents?|skills?|widgets?)\b/gi)]
    .slice(0, 12)
    .map((m) => m[0]);
  console.log(`\n== ${path}`);
  console.log("nums:", nums.join(" | ") || "(none)");
  console.log(text.slice(0, 480));
}

(async () => {
  for (const p of [
    "/geoff-code/mcp",
    "/geoff-code/plugins",
    "/geoff-code/hooks",
    "/geoff-code/skills",
    "/geoff-code/subagents",
    "/geoff-code/acp",
    "/introduction/x402-payg",
    "/token-plan/overview",
    "/introduction/models",
    "/api-reference/overview",
  ]) {
    await dig(p);
  }

  const health = await fetch("https://stacknet.magma-rpc.com/health", {
    headers: { "user-agent": "GeoffThermometer/1.0" },
  }).then((r) => r.json());
  const net = await fetch("https://stacknet.magma-rpc.com/network/summary", {
    headers: { "user-agent": "GeoffThermometer/1.0" },
  }).then((r) => r.json());
  console.log("\n== health", {
    status: health.status,
    version: health.version,
    in_flight: health.in_flight,
    max_in_flight: health.max_in_flight,
    mcp: health.remote_mcp?.contract_id,
  });
  console.log("== network", {
    nodes: net.network?.availableNodes,
    gpus: net.network?.totalGpus,
    models: net.network?.totalModels,
    caps: net.network?.capabilities,
    modelIds: net.network?.models,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
