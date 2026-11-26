<p align="center"><img src="assets/brand/pecunia-logo.png" alt="pecunia: Stock Solutions by RM" width="320"></p>

# Pecunia

**Did my stock picks actually beat the market, or did I just add money in a bull run?**

Pecunia pulls your real trade history from Webull (read-only), rebuilds your portfolio day by day, and answers that question honestly. It "shadows" every deposit into the S&P 500, the Nasdaq-100 or any ticker **on the exact same dates, with the exact same amounts**, then compares time-weighted and money-weighted returns.

**[▶ Live demo](https://raghav64.github.io/pecunia/)**: the full interactive report (all six pages, charts, calculators, 50 precomputed tickers) built from a real account. Dollar amounts and share counts are scaled; percentages and market prices are real. Analyzing new tickers and live refresh need the local server (`./serve.sh`).

![Home](docs/screens/report-home.png)

## Why

Broker apps show "return" as unrealized P&L ÷ cost basis. If you've been adding money steadily, that number says little: dollars added last month haven't had time to grow. Comparing against "the S&P 500 is up 47% since I started" is just as misleading, because most of your money wasn't there at the start.

Pecunia uses three measures that do work:

| Measure | Question it answers |
|---|---|
| **Shadow portfolio** | If every dollar I put in had gone into SPY (or COST, or NVDA…) on the same day, what would I have now? |
| **Time-weighted return** | How good were my *picks*, ignoring when I added money? |
| **Money-weighted return (IRR)** | What yearly return did *my actual dollars* earn? |

## Features

| Page | What it does |
|---|---|
| **Home** | Value, IRR, TWR, drawdown, a "same dollars into…" leaderboard, holdings treemap, concentration and sector breakdown, auto-generated observations |
| **S&P 500 / Nasdaq** | Dollar-for-dollar shadow, who's ahead over time, TWR by period, calendar years, drawdowns |
| **Compare any ticker** | Same shadow analysis for any symbol (run live via the local server) |
| **Dip buying** | Best months for new money, every ≥5% sell-off with the news behind it, and how much buying the dip added (timing edge vs the 3-month average price) |
| **Re-orient** | Sector ETFs and data-scored picks (risk-adjusted return, consistency, drawdown, correlation with *your* portfolio), a "what if I'd put $X in" calculator, and a mix builder that replays your history with a different allocation |
| **Data** | Full trade log, method notes, and a reconciliation of rebuilt share counts against the broker |

<p>
<img src="docs/screens/report-compare.png" width="49%"> <img src="docs/screens/report-dips.png" width="49%">
<img src="docs/screens/report-sectors.png" width="49%"> <img src="docs/screens/report-benchmarks.png" width="49%">
</p>

## Redesign in progress

The next version is a React dashboard: a live home screen (portfolio value, S&P 500 and Nasdaq today, a watchlist, positions) with the analyses behind a menu, in light and dark themes. Figma mocks are in [`assets/figma`](assets/figma):

<p>
<img src="assets/figma/home-light.png" width="49%"> <img src="assets/figma/home-dark.png" width="49%">
</p>

## How it works

```mermaid
flowchart LR
  W[(Webull OpenAPI<br/>read-only)] --> FO[fetch_orders.py<br/>fetch_positions.py]
  Y[(Yahoo Finance<br/>daily prices)] --> BA
  FO --> BA[build_analysis.py<br/>daily holdings · splits · DRIP<br/>TWR · IRR · SPY/QQQ shadow]
  BA --> SH[shadow.py<br/>any ticker]
  BA --> DA[dip_analysis.py]
  SH --> SL[sector_lab.py]
  BA & SH & DA & SL --> BR[build_report.py] --> R[portfolio-report.html]
  R <--> SV[serve.py · 127.0.0.1<br/>/api/shadow · /api/refresh]
```

- **Rebuild**: filled orders → daily share counts, with splits applied to older trades and dividends reinvested on the ex-date. The rebuilt positions are checked against the broker's.
- **Shadow**: each day's net buys go into the benchmark at that day's adjusted close; sells come out.
- **TWR**: daily `V_t / (V_{t-1} + flow_t)`, multiplied together. **IRR**: solved by bisection on the actual cash flows.
- **Read-only**: only `list_order_history`, `get_account_position`, `get_account_balance` and `get_account_list` are called. Trading tools are disabled.

## Quick start

Requirements: [uv](https://docs.astral.sh/uv/) (Python), a Webull OpenAPI app key, macOS/Linux.

```bash
export WEBULL_APP_KEY=...  WEBULL_APP_SECRET=...   # WEBULL_ACCOUNT_ID optional (auto-detected)
./run.sh                    # fetch → analyze → build portfolio-report.html
./serve.sh                  # local app with live "compare any ticker" and a Refresh button
uv run python scripts/shadow.py COST NVDA BRK.B    # shadow analysis from the terminal
uv run python scripts/make_demo.py                 # rebuild the scaled public demo in docs/
```

Your data stays local: `data/`, `build/` and the generated report are git-ignored.

## System design

High-level design, component write-ups, request flows and the API guide are in [`system-design/`](system-design/README.md).

## Project layout

```
scripts/        pipeline (fetch → analyze → report), local server, demo builder
docs/           public demo build (GitHub Pages) + screenshots
assets/figma/   dashboard redesign mocks
system-design/  HLD, components, request flows, API guide
run.sh          full refresh   ·   serve.sh   local app
```

## License

[MIT](LICENSE)

---
For informational and educational purposes only. Not investment advice.
