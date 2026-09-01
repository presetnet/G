async function tryUrl(u) {
  try {
    const r = await fetch(u, {
      headers: { "user-agent": "GeoffThermometer/1.0", accept: "text/plain,*/*" },
    });
    const t = await r.text();
    console.log(r.status, u, "len", t.length, "head", JSON.stringify(t.slice(0, 140)));
  } catch (e) {
    console.log("ERR", u, e.message);
  }
}

async function digHtml(path) {
  const r = await fetch(`https://docs.geoff.ai${path}`, {
    headers: { "user-agent": "GeoffThermometer/1.0" },
  });
  const html = await r.text();
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [])[0] || "";
  const article = (html.match(/<article[\s\S]*?<\/article>/i) || [])[0] || "";
  const hasNext = html.includes("__NEXT_DATA__");
  const mintlify = /mintlify/i.test(html);
  console.log("\n==", path, "html", html.length, "main", main.length, "article", article.length, {
    hasNext,
    mintlify,
  });

  const next = (html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
  if (next) {
    const j = JSON.parse(next);
    console.log("pageProps keys", Object.keys(j.props?.pageProps || {}).slice(0, 30));
  }

  // Mintlify often embeds MDX in a script or prose div
  const prose = (html.match(/class="[^"]*prose[^"]*"[\s\S]{0,12000}/i) || [])[0] || "";
  const stripped = (main || article || prose || html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  console.log("bodySnip", stripped.slice(0, 500));
}

(async () => {
  for (const u of [
    "https://docs.geoff.ai/llms.txt",
    "https://docs.geoff.ai/llms-full.txt",
    "https://www.geoff.ai/llms.txt",
    "https://docs.geoff.ai/sitemap.xml",
    "https://docs.geoff.ai/robots.txt",
  ]) {
    await tryUrl(u);
  }
  for (const p of ["/geoff-code/skills", "/geoff-code/mcp", "/api-reference/overview"]) {
    await digHtml(p);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
