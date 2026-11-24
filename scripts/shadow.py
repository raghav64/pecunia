#!/usr/bin/env python3
"""Shadow analysis for any ticker.

"What if every dollar I put into my portfolio had gone into TICKER instead,
on exactly the same days, in exactly the same amounts?"

Uses the daily net cash flows rebuilt from your Webull order history
(data/analysis.json, produced by build_analysis.py) and Yahoo Finance
adjusted closes (dividends reinvested) for the ticker.

Usage:
  ~/.local/bin/uv run --quiet python scripts/shadow.py COST AMZN GOOGL WMT
  ~/.local/bin/uv run --quiet python scripts/shadow.py NVDA --refresh   # bypass 6h price cache
  ~/.local/bin/uv run --quiet python scripts/shadow.py --list           # show saved results

Writes data/shadows/<TICKER>.json (picked up by build_report.py) and prints a summary.
If a ticker started trading after your first deposit, dollars wait in cash until
its first trading day (flagged in the output).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_analysis import DATA, xirr, yahoo  # noqa: E402

OUT = DATA / "shadows"
TICKER_RE = re.compile(r"^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$")


def normalize(ticker: str) -> str:
    t = (ticker or "").strip().upper()
    if not TICKER_RE.match(t):
        raise ValueError(f"invalid ticker: {ticker!r}")
    return t


def load_base() -> dict:
    p = DATA / "analysis.json"
    if not p.exists():
        raise FileNotFoundError("data/analysis.json missing — run scripts/build_analysis.py first")
    return json.loads(p.read_text())


def compute(ticker: str, base: dict | None = None, refresh: bool = False) -> dict:
    t = normalize(ticker)
    base = base or load_base()
    ser = base["series"]
    start_epoch = int(datetime.fromisoformat(ser[0]["d"]).replace(tzinfo=timezone.utc).timestamp()) - 20 * 86400
    px = yahoo(t.replace(".", "-"), start_epoch, refresh=refresh)  # Yahoo uses BRK-B style
    adj = px["adj"]
    if not adj:
        raise ValueError(f"no price data for {t}")

    units = cash = prev_inv = 0.0
    last = None
    first = None  # (date, adj) of first usable price
    vals, idx, flows = [], [], []
    for r in ser:
        d = r["d"]
        flow = r["inv"] - prev_inv
        prev_inv = r["inv"]
        if abs(flow) > 1e-9:
            flows.append((d, flow))
        p = adj.get(d)
        if p is not None:
            last = p
            if first is None:
                first = (d, p)
        cash += flow
        if last is not None and abs(cash) > 1e-9:
            units += cash / last
            cash = 0.0
        vals.append(round(units * (last or 0) + cash, 2))
        idx.append(round(last / first[1], 6) if first else None)

    if first is None:
        raise ValueError(f"{t} has no prices in {ser[0]['d']} … {ser[-1]['d']}")

    end = ser[-1]["d"]
    value, invested = vals[-1], ser[-1]["inv"]
    irr = xirr([(d, -f) for d, f in flows] + [(end, value)])
    yrs = (datetime.fromisoformat(end) - datetime.fromisoformat(first[0])).days / 365.25
    pk, dd = 0.0, 0.0
    for x in idx:
        if x is not None:
            pk = max(pk, x)
            dd = min(dd, x / pk - 1)
    last_px_date = max(adj)
    you_value = ser[-1]["v"]
    return {
        "ticker": t, "name": px.get("name", t), "type": px.get("type", ""),
        "generated": datetime.now().isoformat(timespec="seconds"),
        "start": ser[0]["d"], "end": end, "first_price": first[0], "last_price": last_px_date,
        "late_start": first[0] > ser[0]["d"], "stale": last_px_date < end,
        "invested": round(invested, 2), "value": round(value, 2), "gain": round(value - invested, 2),
        "irr": round(irr, 5) if irr == irr else None,
        "twr": round(idx[-1] - 1, 5), "twr_ann": round(idx[-1] ** (1 / yrs) - 1, 5) if yrs > 0.25 else None,
        "dd": round(dd, 4), "you_minus": round(you_value - value, 2),
        "vals": vals, "idx": idx,
    }


def save(res: dict) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"{res['ticker'].replace('^', '_')}.json"
    p.write_text(json.dumps(res, separators=(",", ":")))
    return p


def fmt_row(r: dict) -> str:
    irr = f"{r['irr'] * 100:6.1f}%" if r.get("irr") is not None else "   n/a"
    flag = " (late start)" if r.get("late_start") else ""
    return (f"{r['ticker']:<8} {r['name'][:28]:<28} ${r['value']:>11,.0f} {r['gain']:>+11,.0f} "
            f"{irr} {r['twr'] * 100:>+8.1f}% {r['dd'] * 100:>7.1f}% {r['you_minus']:>+11,.0f}{flag}")


HEADER = (f"{'TICKER':<8} {'NAME':<28} {'VALUE':>12} {'GAIN':>11} {'IRR':>7} {'TWR':>9} {'MAXDD':>8} {'YOU − IT':>11}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tickers", nargs="*", help="e.g. COST AMZN GOOGL WMT")
    ap.add_argument("--refresh", action="store_true", help="re-download prices (ignore 6h cache)")
    ap.add_argument("--list", action="store_true", help="list saved shadow results")
    a = ap.parse_args()

    base = load_base()
    s = base["stats"]
    print(f"Your portfolio: ${s['actual_value']:,.0f} from ${s['net_invested']:,.0f} invested "
          f"({s['first_trade']} → {s['end']}), IRR {s['irr_you'] * 100:.1f}%, TWR {s['twr_you'] * 100:+.1f}%\n")

    if a.list or not a.tickers:
        rows = [json.loads(p.read_text()) for p in sorted(OUT.glob("*.json"))]
        if not rows:
            print("no saved results — pass tickers, e.g.: shadow.py COST AMZN GOOGL WMT")
            return
        print(HEADER)
        for r in sorted(rows, key=lambda r: -r["value"]):
            print(fmt_row(r))
        return

    print(HEADER)
    failed = 0
    for tk in a.tickers:
        try:
            r = compute(tk, base, refresh=a.refresh)
            save(r)
            print(fmt_row(r))
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"{tk.upper():<8} ERROR: {e}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
