# Request flows

## 1. Page load and mode detection (v1)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant S as serve.py (127.0.0.1)
  B->>S: GET /
  S-->>B: portfolio-report.html (data embedded)
  B->>B: parse embedded JSON (analysis, positions, shadows, dips, sectors)
  B->>S: GET /api/ping
  alt server reachable
    S-->>B: 200 {"ok":true} → LIVE mode
  else opened as file / GitHub Pages
    B-->>B: fetch fails → STATIC mode (DEMO flag shows demo notes)
  end
  B->>B: route(#/home…) and render charts
  B->>S: GET /api/refresh (LIVE only)
  S-->>B: job status (resume progress UI if a refresh is running)
```

Nothing on a page needs a round trip except the ping. Navigation between pages is client-side.

## 2. Compare any ticker (v1)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant S as serve.py
  participant E as shadow.compute()
  participant Y as Yahoo Finance
  participant D as data/
  B->>B: user enters "COST"
  alt already in embedded SHADOWS and not stale
    B->>B: render from memory (no request)
  else LIVE
    B->>S: GET /api/shadow?t=COST
    S->>E: compute("COST")
    E->>E: validate ticker (regex) → 400 if invalid
    E->>D: read analysis.json (daily net flows)
    E->>D: prices/COST.json fresh? (TTL)
    opt cache miss or stale
      E->>Y: GET chart?interval=1d&events=div,splits
      Y-->>E: bars + events (404 → "ticker not found")
      E->>D: write prices/COST.json
    end
    E->>E: replay flows into units at adj close · IRR · TWR · drawdown
    E->>D: write shadows/COST.json
    S-->>B: 200 shadow JSON (400 bad input · 502 upstream error)
    B->>B: SH["COST"] = result → render, add to leaderboard
  else STATIC
    B->>B: show "run locally" (or demo) message
  end
```

## 3. Refresh (v1)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant S as serve.py
  participant R as refresh.py
  participant W as Webull
  participant Y as Yahoo
  B->>S: POST /api/refresh?mode=full (X-Portfolio-Lab: 1)
  alt header missing
    S-->>B: 403
  else job already running
    S-->>B: 409 + current status
  else
    S->>R: spawn (background thread)
    S-->>B: 202 {status:"running"}
  end
  loop every 1.2 s
    B->>S: GET /api/refresh
    S-->>B: {status, step, steps, label, log[], elapsed}
  end
  R->>W: order history, positions, balance (read-only, 429 backoff)
  R->>Y: prices (PRICE_MAX_AGE=600)
  R->>R: build_analysis → shadow ×N → dip_analysis → sector_lab
  R->>R: build_report (written last, so a failure keeps the old report)
  R-->>S: exit 0 / non-zero
  B->>S: GET /api/refresh → {status:"done"}
  B->>B: location.reload() → new embedded data
```

## 4. Demo publish (v1)

```mermaid
sequenceDiagram
  autonumber
  participant M as make_demo.py
  participant E as Engine (PECUNIA_DATA=build/demo-data, PECUNIA_SCALE=0.1)
  participant G as docs/ → GitHub Pages
  M->>M: copy orders, scale positions, symlink price cache
  M->>E: build_analysis · shadow ×N · dip_analysis · sector_lab
  E->>G: build_report (PECUNIA_DEMO=1) → docs/index.html
  Note over G: Static. Any-ticker and Refresh show demo guidance.
```

## 5. Live home dashboard (v2)

```mermaid
sequenceDiagram
  autonumber
  participant B as React app
  participant N as Node API
  participant C as Quote cache (30–60 s)
  participant P as Python worker
  participant W as Webull
  participant Y as Yahoo
  B->>N: GET /api/portfolio/summary · /api/positions · /api/quotes?symbols=SPY,QQQ,AAPL,MSFT,COST,WMT
  N->>C: lookup
  alt miss
    N->>P: positions/balance
    P->>W: get_account_position / get_account_balance
    N->>Y: quotes + intraday 5m bars
    N->>C: store (TTL)
  end
  N-->>B: JSON
  B->>N: GET /api/stream (EventSource)
  loop market open, client connected
    N->>C: refresh expired keys
    N-->>B: event: quote {SPY,…}
    N-->>B: event: portfolio {value, dayChange}
  end
```

## 6. Refresh job with streaming progress (v2)

```mermaid
sequenceDiagram
  participant B as React app
  participant N as Node API
  participant J as Job runner
  B->>N: POST /api/refresh {mode} (CSRF token)
  N->>J: start (single-flight)
  N-->>B: 202 {jobId}
  B->>N: GET /api/refresh/{jobId}/events (SSE)
  J-->>N: STEP i/n · log lines
  N-->>B: event: progress / log / done
  B->>B: invalidate TanStack Query caches → refetch
```
