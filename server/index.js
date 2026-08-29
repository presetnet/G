import express from "express";
import { config } from "./config.js";
import {
  getDashboardPayload,
  onUpdate,
  pollOnce,
  startPoller,
} from "./poller.js";
import { prettyCapability } from "./translator.js";
import { loadSnapshots, loadTraffic, recordTraffic } from "./store.js";
import { publicConfig } from "./service.js";
import { buildMarketPayload } from "./market.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  const shouldCount =
    req.method === "GET" &&
    !req.path.startsWith("/api/") &&
    !req.path.startsWith("/_vercel/") &&
    (req.path === "/" || req.path.endsWith(".html"));
  if (!shouldCount) {
    next();
    return;
  }
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      recordTraffic(req.path).catch(() => {});
    }
  });
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "geoff-thermometer", mode: "local" });
});

app.get("/api/status", async (_req, res) => {
  try {
    const payload = await getDashboardPayload();
    res.json({ ...payload, config: publicConfig() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/status", async (req, res) => {
  try {
    const payload = await pollOnce({
      force: true,
      previous: req.body?.previous ?? null,
      knownEvents: Array.isArray(req.body?.events) ? req.body.events : [],
      forceMiningSurface: Boolean(req.body?.forceMiningSurface),
    });
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/events", async (req, res) => {
  try {
    const payload = await getDashboardPayload();
    const limit = Math.min(200, Number(req.query.limit) || 50);
    res.json({ events: payload.events.slice(0, limit), temperature: payload.temperature });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/snapshot", async (_req, res) => {
  try {
    const payload = await getDashboardPayload();
    res.json({ latest: payload.latest, temperature: payload.temperature });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sniff", async (_req, res) => {
  try {
    const payload = await pollOnce({ force: true });
    res.json({ latest: payload.latest });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/poll", async (req, res) => {
  try {
    const payload = await pollOnce({
      force: true,
      previous: req.body?.previous ?? null,
      knownEvents: Array.isArray(req.body?.events) ? req.body.events : [],
      forceMiningSurface: Boolean(req.body?.forceMiningSurface),
    });
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = async () => {
    try {
      const payload = await getDashboardPayload();
      res.write(`event: status\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    }
  };

  await send();
  const unsubscribe = onUpdate((payload) => {
    res.write(`event: status\ndata: ${JSON.stringify(payload)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 15_000);
  heartbeat.unref?.();

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.get("/api/paperwork-history", async (_req, res) => {
  try {
    const snaps = await loadSnapshots();
    const series = snaps
      .map((s) => ({ at: s.takenAt, v: Number(s.summary?.metaproofsPaperworkUsd ?? NaN) }))
      .filter((p) => p.at && Number.isFinite(p.v));
    res.json({ count: series.length, series });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/traffic", async (_req, res) => {
  try {
    const traffic = await loadTraffic();
    const entries = Object.entries(traffic.paths || {}).sort((a, b) => b[1] - a[1]);
    const [topPath = null, topPathViews = 0] = entries[0] || [];
    res.json({
      ...traffic,
      topPath,
      topPathViews,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/market", async (_req, res) => {
  try {
    const payload = await buildMarketPayload();
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/meta/capabilities", async (_req, res) => {
  try {
    const payload = await getDashboardPayload();
    const caps = payload.latest?.sources?.["stacknet.network"]?.capabilities ?? [];
    res.json({
      capabilities: caps.map((c) => ({ id: c, label: prettyCapability(c) })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use(express.static(config.publicDir));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendFile("index.html", { root: config.publicDir });
});

startPoller();

const server = app.listen(config.port, () => {
  console.log(`Geoff Thermometer listening on http://localhost:${config.port}`);
  console.log(`Polling every ${config.pollIntervalMs}ms`);
  console.log(`Geoff: ${config.geoffBaseUrl}`);
  console.log(`Stacknet: ${config.stacknetBaseUrl}`);
});

server.on("error", (error) => {
  console.error("Server error:", error);
  process.exitCode = 1;
});
