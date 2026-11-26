# API guide

- **v1 (implemented):** `scripts/serve.py`, Python standard library HTTP server, `http://127.0.0.1:8765` (port is the first argument).
- **v2 (implemented):** `server/src/index.ts`, Node/TypeScript on Hono, `http://127.0.0.1:8787` (`PORT` env). In development, Vite serves the UI on :5173 and proxies `/api` and `/legacy`.

Conventions: JSON bodies, `Cache-Control: no-store`, errors as `{"error": "message"}`. The server binds to localhost only and has no authentication. Do not expose it publicly.

---

## v1 endpoints (implemented)

### `GET /` (also `/index.html`, `/portfolio-report.html`)
Serves the generated single-page app with all precomputed data embedded. Any other path returns `404` (the `data/` folder and config files are never served).

### `GET /api/ping`
Health check that the UI uses to detect live mode.
```json
200 {"ok": true}
```

### `GET /api/shadow?t={TICKER}[&refresh=1]`
Runs the shadow analysis: every dollar you invested goes into `TICKER` on the same days, in the same amounts. The result is saved to `data/shadows/{TICKER}.json` so later report builds include it.

| Param | Required | Notes |
|---|---|---|
| `t` | yes | Ticker, case-insensitive. Must match `^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$` (e.g. `COST`, `BRK.B`, `^GSPC`) |
| `refresh` | no | `1` ignores the price cache and refetches |

**200 response**
```json
{
  "ticker": "COST", "name": "Costco Wholesale Corporation", "type": "EQUITY",
  "generated": "2026-11-23T20:17:02",
  "start": "2024-01-24", "end": "2026-11-23",
  "first_price": "2024-01-24", "last_price": "2026-11-23",
  "late_start": false, "stale": false,
  "invested": 10739.81, "value": 12732.50, "gain": 1992.69,
  "irr": 0.1312, "twr": 0.62, "twr_ann": 0.186, "dd": -0.207,
  "you_minus": 1083.71,
  "vals": [3.0, 3.01, "…one per portfolio day"],
  "idx":  [1.0, 1.003, "…ticker total-return index, null before first price"]
}
```
| Field | Meaning |
|---|---|
| `invested` | Net dollars invested (same for you and the shadow) |
| `value` / `gain` | Shadow's value / gain on the last day |
| `irr` | Money-weighted yearly return of the shadow |
| `twr`, `twr_ann` | Ticker's total return over the period, total and per year |
| `dd` | Worst peak-to-trough drop of the ticker |
| `you_minus` | Your value − shadow value (positive = you're ahead) |
| `late_start` | Ticker listed after your first deposit (cash waited) |
| `stale` | No prices up to the portfolio's last date (last price carried forward) |

**Errors:** `400` invalid ticker or no prices in range · `502` upstream failure (e.g. `"COSTX: ticker not found"`, Yahoo HTTP errors).

### `POST /api/refresh?mode=full|prices`
Starts the pipeline (`scripts/refresh.py`) in the background.

| | |
|---|---|
| Header | `X-Portfolio-Lab: 1` **required** (CSRF guard) |
| `mode=full` | Webull orders and positions (read-only), then fresh prices, then rebuild everything (7 steps) |
| `mode=prices` | Skip Webull; refetch prices and rebuild from saved orders (5 steps) |

| Status | Body |
|---|---|
| `202` | Job started: status object (below) |
| `409` | A job is already running: its status |
| `403` | Header missing |

### `GET /api/refresh`
Progress of the current or last refresh job. The UI polls it every ~1.2 s.
```json
{
  "status": "running",              // idle | running | done | error
  "mode": "full",
  "step": 4, "steps": 7,
  "label": "Re-running shadow analysis for 50 tickers",
  "log": ["STEP 1/7 Fetching order history from Webull", "  saved 29 pages …"],  // last 40 lines
  "started": 1795493852.09, "finished": null, "elapsed": 63
}
```
When `status` becomes `done`, reload the page to get the new embedded data. On `error`, the previous report is left unchanged.

---

## v2 endpoints (implemented)

| Method & path | Purpose | Cache |
|---|---|---|
| `GET /api/portfolio/summary` | `{value, cash, marketValue, dayChange, dayChangePct, unrealizedPnl, positionsAsOf, pricesAsOf, marketState, count, benchmark{lead, irr, irrSpy, twr, dd, …}}`: positions snapshot marked to live quotes | quotes 30 s |
| `GET /api/positions` | `{positions:[{symbol, name, sector, qty, avgCost, price, prevClose, value, dayChange, dayPct, weight, gain, gainPct, live}], cash, asOf, allocation:[{sector, value, weight}]}` | quotes 30 s |
| `GET /api/portfolio/history?range=1W\|1M\|3M\|YTD\|1Y\|ALL` | `[{d, value, invested, spy, qqq}]` for the main chart | until refresh |
| `GET /api/quotes?symbols=SPY,QQQ,AAPL` | `[{symbol, name, price, prevClose, changePct, spark:[…]}]` (5-minute intraday) | 30–60 s |
| `GET /api/stream` | SSE: `event: portfolio` (summary) and `event: quotes` (SPY, QQQ, watchlist) every `refreshSeconds` | push |
| `GET /api/benchmarks` | Payload for the S&P 500 / Nasdaq page: `{end, stats, spy, qqq, series:[{d, v, inv, twr, spy, qqq, spyVal, qqqVal}], monthly, why:{brokerSimpleReturn, avgAgeMonths, lastYear, last6m, firstYear, quarters[]}}` | file mtime |
| `GET /api/analysis/benchmarks` · `/dips` · `/sectors` | Contents of `analysis.json` · `dips.json` · `sectors.json` (404 until built) | file mtime |
| `GET /api/shadow/:ticker[?refresh=1]` | Same payload as v1 `/api/shadow`; recomputed via `shadow.py` when missing or stale | disk |
| `POST /api/refresh` `{mode:"full"\|"prices"}` | Start job → `202 {jobId, job}` · `409` if busy · `403` without `X-Pecunia: 1` | — |
| `GET /api/refresh` | Current or last job state, or `{status:"idle"}` | — |
| `GET /api/refresh/:jobId/events` | SSE: `progress`, `log`, `done`, `error` | push |
| `GET/PUT /api/settings` | `{theme, watchlist[] (max 8), refreshSeconds (15–300)}`, stored in `data/settings.json`; PUT needs `X-Pecunia: 1` | — |
| `GET /api/health` · `/api/ping` | Liveness (`data` = analysis built?) · v1 compatibility | — |
| `GET /legacy` | The v1 report, embedded by the React app for pages not yet ported | — |

**Conventions**
- Localhost-only binding. State-changing calls (`POST /api/refresh`, `PUT /api/settings`) need the `X-Pecunia: 1` header, which browsers can't add cross-site without a CORS preflight the server never approves.
- Errors: `{"error": {"code": "BAD_SYMBOL", "message": "…"}}` with 4xx/5xx status codes.
- Upstream quote calls time out after 8 s; on failure the last cached quote is served.
- Webull calls stay read-only and go through the Python worker; secrets come from environment variables only.
