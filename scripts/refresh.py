"""One-shot pipeline used by ./run.sh and the app's Refresh button.

  Webull orders + positions (read-only) → rebuild analysis → re-run every saved shadow ticker
  → dip analysis → sector lab → regenerate portfolio-report.html

Usage: uv run python scripts/refresh.py [--prices-only] [EXTRA TICKERS...]
  --prices-only   skip Webull; re-pull prices and rebuild from the orders already on disk
Prints "STEP i/n label" lines (parsed by serve.py for the progress bar).
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
S = ROOT / "scripts"
UV = str(Path.home() / ".local/bin/uv")
DEFAULT = ["SPY", "QQQ", "COST", "AMZN", "GOOGL", "WMT", "MSFT"]


def main() -> int:
    args = sys.argv[1:]
    prices_only = "--prices-only" in args
    extra = [a.upper() for a in args if not a.startswith("--")]
    saved = sorted(p.stem for p in (ROOT / "data" / "shadows").glob("*.json"))  # e.g. BRK.B.json → "BRK.B"
    tickers = list(dict.fromkeys(DEFAULT + saved + extra))

    py = [sys.executable]
    webull = [UV, "run", "--quiet", "--with", "webull-openapi-mcp", "python"]
    steps = []
    if not prices_only:
        steps += [("Fetching order history from Webull", webull + [str(S / "fetch_orders.py")]),
                  ("Fetching positions from Webull", webull + [str(S / "fetch_positions.py")])]
    steps += [("Rebuilding portfolio with fresh prices", py + [str(S / "build_analysis.py")]),
              (f"Re-running shadow analysis for {len(tickers)} tickers", py + [str(S / "shadow.py"), *tickers]),
              ("Analyzing dip buying", py + [str(S / "dip_analysis.py")]),
              ("Scoring sectors and picks", py + [str(S / "sector_lab.py")]),
              ("Building the report", py + [str(S / "build_report.py")])]

    env = {**os.environ, "PRICE_MAX_AGE": "600", "PYTHONUNBUFFERED": "1"}  # prices older than 10 min are refetched
    t0 = time.time()
    for i, (label, cmd) in enumerate(steps, 1):
        print(f"STEP {i}/{len(steps)} {label}", flush=True)
        r = subprocess.run(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        lines = [l for l in r.stdout.splitlines() if l.strip() and l.strip()[0] not in '{}[]"']  # drop JSON dumps
        tail = lines[-6:]
        for line in tail:
            print("  " + line[:300], flush=True)
        if r.returncode != 0 and cmd[-len(tickers):] == tickers:
            print("  WARN: some tickers failed; continuing with the rest", flush=True)
        elif r.returncode != 0:
            print(f"FAILED at step {i}: {label}", flush=True)
            return r.returncode
    print(f"DONE in {time.time() - t0:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
