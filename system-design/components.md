# Components

Each component lists its responsibility, inputs → outputs, and the design decisions behind it. The v1 components exist in `scripts/`; the v2 components are planned.

---

## 1. Broker ingestion: `fetch_orders.py`, `fetch_positions.py`
**Responsibility:** pull the user's raw trading data from Webull, read-only.

| | |
|---|---|
| Inputs | `WEBULL_APP_KEY`, `WEBULL_APP_SECRET` (env), cached token in `~/.webull-mcp`, optional `WEBULL_ACCOUNT_ID` |
| Calls | `account_v2.get_account_list` (auto-detect account), `order_v3.list_order_history`, `account_v2.get_account_position`, `account_v2.get_account_balance` |
| Outputs | `data/orders_raw.json` (raw pages), `data/positions_snapshot.json` (positions + balance) |

**Decisions**
- **Read-only by construction:** only list/get calls exist in the code, and the MCP toolsets exclude trading.
- **Rate limits:** retry on 429/`TOO_MANY` with exponential backoff (3 s → 60 s). If the full date range fails, fall back to monthly windows.
- **Secret hygiene:** the SDK logs request headers (including the access token) on errors, so all `webull*` loggers are silenced.
- **Account selection:** `WEBULL_ACCOUNT_ID` is used if set, otherwise the single account on the login. With several accounts it stops and asks for the env var.

---

## 2. Price service: `yahoo()` in `build_analysis.py`
**Responsibility:** daily OHLC with split- and dividend-adjusted closes, plus split and dividend events and instrument metadata.

| | |
|---|---|
| Source | `query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&events=div,splits` |
| Cache | `data/prices/{SYM}.json`, TTL 6 h (override with `PRICE_MAX_AGE` seconds; refresh uses 600) |
| Output shape | `{close:{date:px}, adj:{date:px}, splits:[{date,ratio}], divs:[{date,amount}], name, type, currency}` |

**Decisions:** dates are normalized to US/Eastern trading days. A 404 surfaces as "ticker not found". A cache file without metadata is refetched. Symbols with dots are mapped to Yahoo's dash form (`BRK.B` → `BRK-B`).

---

## 3. Portfolio rebuild + core metrics: `build_analysis.py`
**Responsibility:** turn raw orders into a daily portfolio and compute the headline metrics.

**Pipeline**
1. **Normalize trades:** filled orders only, ET date, `flow = +qty·price+fees` for buys and `−(proceeds−fees)` for sells.
2. **Split-adjust** older quantities using later split events.
3. **Daily holdings:** replay trades in order. **DRIP**: on each ex-date, the dividend × shares is reinvested at that close.
4. **Legacy sells** (shares never bought in this history, e.g. promo stock) are skipped and reported.
5. **Value series** `V_t = Σ shares × close`.
6. **TWR:** daily `r_t = V_t / (V_{t-1} + flow_t)`, multiplied together.
7. **IRR:** XIRR by bisection on (date, −flow) plus the terminal value.
8. **Benchmark shadows (SPY, QQQ):** each day's net flow buys or sells units at the adjusted close.
9. **Reconciliation:** rebuilt shares vs broker positions (difference in shares and $).

**Output:** `data/analysis.json`, containing `stats`, `series[{d,v,inv,div,shadow,twr,spy,shadow_q,qqq}]`, `per_symbol`, `reconciliation`, `monthly` and `trades`.

**Demo hooks:** `PECUNIA_DATA` (data dir) and `PECUNIA_SCALE` (multiplies quantities and fees on load; every $ output scales linearly while %, TWR, IRR and drawdowns are unchanged).

---

## 4. Shadow engine: `shadow.py`
**Responsibility:** "What if every dollar had gone into TICKER on the same days?"

- **Input validation:** `^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$`.
- **Late listing:** if the ticker started trading after the first deposit, cash waits until its first price (`late_start`).
- **Output** `data/shadows/{T}.json`: `invested, value, gain, irr, twr, twr_ann, dd, you_minus, vals[], idx[]`, aligned to the portfolio's dates.
- **Interfaces:** CLI (`shadow.py COST NVDA`, `--list`, `--refresh`) and library (`compute()`, `save()`), which the server uses.

---

## 5. Dip analysis: `dip_analysis.py`
**Responsibility:** which months' dollars did best, and whether buying sell-offs paid.

- **Per buy:** growth to date (adjusted for splits and dividends), forward 1/3/6-month returns, S&P drawdown from its 52-week high, and the stock's own drawdown.
- **Timing edge:** value today minus value if bought at the stock's trailing 63-day average price.
- **Groups:** months, market-drawdown buckets (<2%, 2–5%, 5–10%, 10%+), stock-drawdown buckets, **episodes** (SPY ≥5% off its high until back within 2%), and days with SPY ≤ −2%.
- **News:** joined from the hand-curated `dip_news.json`, keyed by episode start or date.
- **Output:** `data/dips.json`.

---

## 6. Sector lab: `sector_lab.py`
**Responsibility:** would other sectors have helped, and which picks hold up on more than raw return?

- **Universe:** nine sector ETFs plus about 40 stocks and funds. Each is computed with the shadow engine.
- **Metrics:** annualized return, volatility, return/vol, max drawdown, **correlation and beta vs the user's daily TWR**, calendar-year returns, years beating SPY.
- **Score** (z-scores across the universe): 35% risk-adjusted return, 25% consistency, 20% drawdown, 20% low correlation.
- **20% sleeve:** blend `0.8·V + 0.2·S` (linear in flows), with its drawdown and volatility.
- **Output:** `data/sectors.json`. The UI reruns custom mixes client-side from `vals[]`.

---

## 7. Report builder + SPA: `build_report.py`, `report_template.html`
**Responsibility:** one self-contained HTML app.

- **Build:** placeholders (`/*ANALYSIS*/`, `/*POSITIONS*/`, `/*SHADOWS*/`, `/*DIPS*/`, `/*SECTORS*/`, `/*DEMO*/`) are replaced with JSON.
- **Client:** a hash router (`#/home`, `#/benchmarks`, `#/compare?t=`, `#/dips`, `#/sectors`, `#/data`), Chart.js, and a shared `shadowView()` component.
- **Mode detection:** on boot it calls `GET /api/ping`. Success means **live** mode (any ticker and Refresh enabled); otherwise **static**. The `DEMO` flag switches to the public-demo messaging.

---

## 8. Local server: `serve.py`
**Responsibility:** serve the SPA and the two dynamic features.

- **Bind:** `127.0.0.1` only. Static routes are allow-listed, so `data/` and config are never served.
- **Endpoints:** see [api.md](api.md).
- **Refresh job:** one background thread at a time (lock; a second request gets 409). It parses `STEP i/n` lines from the runner's stdout and keeps the last 40 log lines.
- **CSRF guard:** `POST /api/refresh` requires the `X-Portfolio-Lab: 1` header. A cross-site browser request can't add a custom header without a CORS preflight, which this server never approves.

---

## 9. Pipeline runner: `refresh.py` (also `run.sh`)
**Responsibility:** run the pipeline in order with progress reporting.

- **Full run:** `fetch_orders` → `fetch_positions` → `build_analysis` → `shadow` (all saved tickers) → `dip_analysis` → `sector_lab` → `build_report`. `--prices-only` skips the two Webull steps.
- **Freshness:** sets `PRICE_MAX_AGE=600` so prices refetch.
- **Failure handling:** the report is written last, so a failed run leaves the previous report intact. Failing tickers in the shadow step are tolerated.

---

## 10. Demo builder: `make_demo.py`
**Responsibility:** a publishable copy with private amounts scaled.

- **Steps:** create `build/demo-data/` (symlinked price cache, copied orders, scaled positions), rerun the engine with `PECUNIA_SCALE`, and write `docs/index.html` with `DEMO=true`.
- **Invariant:** only amounts and quantities change. Percentages, prices and dates are real.

---

## 11. v2: Node API, SSE hub, React app (implemented: Home and S&P 500 / Nasdaq in React; other analysis pages embedded from v1)

| Component | Responsibility |
|---|---|
| **Node API** (TypeScript, Fastify/Hono) | Typed REST and the single entry point for the UI. Serves the built React app. |
| **Quote cache** | In-memory cache keyed by symbol (30–60 s TTL), so many widgets cost one upstream call. |
| **SSE hub** | Pushes `quote`, `portfolio` and `job` events. Polls upstream only while a client is connected and the market is open. |
| **Job runner** | Spawns the Python workers as child processes, reports progress, enforces one job at a time. |
| **React app** | Vite, React, shadcn/ui, Tailwind with Flexoki tokens (light/dark), TanStack Query, Recharts and Lightweight Charts. Layout follows `assets/figma`. |
