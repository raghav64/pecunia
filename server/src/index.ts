/**
 * Pecunia API (v2). Binds to 127.0.0.1 only. Read-only toward Webull: positions come from the
 * last snapshot (scripts/fetch_positions.py) and are marked to live Yahoo quotes.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, relative } from "node:path";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { DATA, IS_PROD, PORT, ROOT, UV, getSettings, readJson, saveSettings } from "./config.js";
import { getQuotes, validSymbol } from "./quotes.js";
import { allocation, history, positions, summary } from "./portfolio.js";
import { bus, currentJob, startRefresh, type JobState } from "./jobs.js";
import { benchmarks } from "./benchmarks.js";
import { shadowList, shadowSeries, tradeData } from "./analysis.js";

const app = new Hono();
if (!IS_PROD) app.use("/api/*", logger());
const fail = (c: Context, e: any) =>
  c.json({ error: { code: e?.code ?? "ERROR", message: String(e?.message ?? e) } }, (e?.status ?? 500) as any);

// Only same-origin requests may change state: browsers can't add this header cross-site without a CORS preflight.
const requireAppHeader = async (c: Context, next: () => Promise<void>) => {
  if (c.req.header("X-Pecunia") !== "1") return c.json({ error: { code: "FORBIDDEN", message: "missing X-Pecunia header" } }, 403);
  await next();
};

app.get("/api/health", (c) => c.json({ ok: true, data: existsSync(join(DATA, "analysis.json")) }));

app.get("/api/portfolio/summary", async (c) => {
  try { return c.json(await summary()); } catch (e) { return fail(c, e); }
});

app.get("/api/positions", async (c) => {
  try {
    const p = await positions();
    return c.json({ positions: p.positions, cash: p.cash, asOf: p.asOf, allocation: allocation(p.positions, p.cash) });
  } catch (e) { return fail(c, e); }
});

app.get("/api/portfolio/history", (c) => c.json(history((c.req.query("range") ?? "ALL").toUpperCase())));

app.get("/api/quotes", async (c) => {
  const syms = (c.req.query("symbols") ?? "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40);
  const bad = syms.filter((s) => !validSymbol(s));
  if (bad.length) return c.json({ error: { code: "BAD_SYMBOL", message: `invalid: ${bad.join(", ")}` } }, 400);
  return c.json(await getQuotes(syms));
});

app.get("/api/benchmarks", (c) => {
  try { return c.json(benchmarks()); } catch (e) { return fail(c, e); }
});

app.get("/api/shadows", (c) => c.json(shadowList()));
app.get("/api/shadows/series", (c) => {
  const syms = (c.req.query("symbols") ?? "").toUpperCase().split(",").filter(validSymbol).slice(0, 80);
  return c.json(shadowSeries(syms));
});
app.get("/api/trades", (c) => {
  try { return c.json(tradeData()); } catch (e) { return fail(c, e); }
});

app.get("/api/analysis/:name{benchmarks|dips|sectors}", (c) => {
  const file = { benchmarks: "analysis.json", dips: "dips.json", sectors: "sectors.json" }[c.req.param("name") as "dips"];
  const j = readJson(join(DATA, file));
  return j ? c.json(j) : c.json({ error: { code: "NOT_BUILT", message: "run ./run.sh first" } }, 404);
});

app.get("/api/shadow/:t", async (c) => {
  const t = c.req.param("t").toUpperCase();
  if (!validSymbol(t)) return c.json({ error: { code: "BAD_SYMBOL", message: "invalid ticker" } }, 400);
  const file = join(DATA, "shadows", `${t.replace("^", "_")}.json`);
  const end = readJson<any>(join(DATA, "analysis.json"))?.stats?.end;
  const cached = readJson<any>(file);
  if (cached && cached.end === end && c.req.query("refresh") !== "1") return c.json(cached);
  const code: number = await new Promise((res) => {
    const p = spawn(UV, ["run", "--quiet", "python", join(ROOT, "scripts", "shadow.py"), t], { cwd: ROOT });
    p.on("close", (k) => res(k ?? 1));
    p.on("error", () => res(1));
  });
  const fresh = readJson<any>(file);
  return code === 0 && fresh ? c.json(fresh) : c.json({ error: { code: "SHADOW_FAILED", message: `couldn't analyze ${t}` } }, 502);
});

app.get("/api/settings", (c) => c.json(getSettings()));
app.put("/api/settings", requireAppHeader, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const patch: any = {};
  if (["light", "dark", "system"].includes(body.theme)) patch.theme = body.theme;
  if (Array.isArray(body.watchlist)) patch.watchlist = body.watchlist.map((s: string) => String(s).toUpperCase()).filter(validSymbol).slice(0, 8);
  if (Number.isFinite(body.refreshSeconds)) patch.refreshSeconds = Math.min(300, Math.max(15, body.refreshSeconds));
  return c.json(saveSettings(patch));
});

app.post("/api/refresh", requireAppHeader, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { job, started } = startRefresh(body.mode === "prices" ? "prices" : "full");
  return c.json({ jobId: job.id, job }, started ? 202 : 409);
});
app.get("/api/refresh", (c) => c.json(currentJob() ?? { status: "idle" }));
app.get("/api/refresh/:id/events", (c) =>
  streamSSE(c, async (s) => {
    const send = (j: JobState) => s.writeSSE({ event: j.status === "running" ? "progress" : j.status, data: JSON.stringify(j) });
    const cur = currentJob();
    if (!cur || cur.id !== c.req.param("id")) { await s.writeSSE({ event: "error", data: JSON.stringify({ message: "unknown job" }) }); return; }
    await send(cur);
    if (cur.status !== "running") return;
    await new Promise<void>((done) => {
      const on = (j: JobState) => { send(j); if (j.status !== "running") { bus.off("job", on); done(); } };
      bus.on("job", on);
      s.onAbort(() => { bus.off("job", on); done(); });
    });
  }),
);

// Live stream: pushes portfolio summary + watchlist quotes while a client is connected.
app.get("/api/stream", (c) =>
  streamSSE(c, async (s) => {
    let alive = true;
    s.onAbort(() => { alive = false; });
    while (alive) {
      try {
        const st = getSettings();
        const [sum, quotes] = await Promise.all([summary(), getQuotes(["SPY", "QQQ", ...st.watchlist])]);
        await s.writeSSE({ event: "portfolio", data: JSON.stringify(sum) });
        await s.writeSSE({ event: "quotes", data: JSON.stringify(quotes) });
      } catch (e: any) {
        await s.writeSSE({ event: "error", data: JSON.stringify({ message: String(e?.message ?? e) }) });
      }
      await s.sleep(getSettings().refreshSeconds * 1000);
    }
  }),
);

app.all("/api/*", (c) => c.json({ error: { code: "NOT_FOUND", message: "no such endpoint" } }, 404));

if (IS_PROD) {
  app.use("/*", serveStatic({ root: relative(process.cwd(), join(ROOT, "web", "dist")) }));
  app.get("*", (c) => c.html(readFileSync(join(ROOT, "web", "dist", "index.html"), "utf8")));
}

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (i) =>
  console.log(`Pecunia API → http://127.0.0.1:${i.port}${IS_PROD ? "" : "  (web dev server: http://127.0.0.1:5173)"}`),
);
