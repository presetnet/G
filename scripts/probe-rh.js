async function dig(url) {
  const r = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "GeoffThermometer/1.0", accept: "text/html,application/json" },
  });
  const loc = r.headers.get("location") || "";
  let text = "";
  try {
    text = await r.text();
  } catch {}
  const title = ((text.match(/<title>([^<]+)/i) || [])[1] || "").trim();
  return {
    url,
    status: r.status,
    loc: loc.slice(0, 120) || null,
    title: title.slice(0, 80),
    len: text.length,
    hasRH: /(?:\bRH\b|research.?hub|robinhood)/i.test(text),
  };
}

(async () => {
  const docsHome = await fetch("https://docs.geoff.ai/", {
    headers: { "user-agent": "GeoffThermometer/1.0" },
  }).then((r) => r.text());
  const hrefs = [
    ...new Set(
      [...docsHome.matchAll(/href="(\/[^"#?]{1,140})"/g)]
        .map((m) => m[1])
        .filter((h) => !h.startsWith("/_next") && !h.includes(".")),
    ),
  ].sort();
  console.log(
    "docsNavRH",
    hrefs.filter((h) => /rh|hub|research|robin|hq/i.test(h)),
  );
  console.log("docsNavAll", hrefs);

  const paths = [
    "https://www.geoff.ai/rh",
    "https://www.geoff.ai/RH",
    "https://www.geoff.ai/research-hub",
    "https://www.geoff.ai/research",
    "https://www.geoff.ai/hub",
    "https://docs.geoff.ai/features/rh",
    "https://docs.geoff.ai/features/research-hub",
    "https://docs.geoff.ai/rh",
    "https://docs.geoff.ai/docs/rh",
  ];
  for (const u of paths) console.log(JSON.stringify(await dig(u)));

  // Search docs pages for RH mentions in body
  for (const p of [
    "/geoff-code/use-cases",
    "/geoff-code/skills",
    "/geoff-code/subagents",
    "/geoff-code/mcp",
    "/introduction/models",
    "/api-reference/overview",
  ]) {
    const html = await fetch("https://docs.geoff.ai" + p, {
      headers: { "user-agent": "GeoffThermometer/1.0" },
    }).then((r) => r.text());
    const main = (html.match(/<main[\s\S]*?<\/main>/i) || [])[0] || html;
    const text = main
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    const m = [...text.matchAll(/.{0,40}\bRH\b.{0,60}|.{0,40}research hub.{0,60}|.{0,40}Robinhood.{0,60}/gi)].slice(
      0,
      5,
    );
    if (m.length) {
      console.log("\n==", p);
      for (const x of m) console.log("-", x[0]);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
