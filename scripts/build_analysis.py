"""Rebuild the portfolio from order history and compare against an S&P 500 shadow.

Inputs:
  data/orders_raw.json         (from scripts/fetch_orders.py)
  data/positions_snapshot.json (current positions, for reconciliation)
Prices: Yahoo Finance daily chart API (close, adjclose, splits, dividends), cached in data/prices/.

Outputs data/analysis.json with:
  - every filled trade (ET date, symbol, side, split-adjusted qty, amount)
  - daily series: actual portfolio value, cumulative net invested, S&P shadow value,
    true time-weighted index for the portfolio and for SPY
  - stats: TWR, IRR, dollar comparison, per-symbol P&L, reconciliation vs Webull

Shadow rule: every BUY of $X on day D buys $X of SPY at D's close; every SELL of $X
sells $X of SPY. So the S&P version gets exactly your money on exactly your dates.

Run:
  ~/.local/bin/uv run --quiet python scripts/build_analysis.py
"""
from __future__ import annotations

import json
import os
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("PECUNIA_DATA") or ROOT / "data")  # demo builds point this elsewhere
SCALE = float(os.environ.get("PECUNIA_SCALE") or 1)  # demo builds scale every quantity / dollar amount
PRICES = DATA / "prices"
ET = ZoneInfo("America/New_York")
BENCH = "SPY"
BENCH2 = "QQQ"  # tougher, tech-heavy benchmark


# ---------------------------------------------------------------- orders
def load_trades() -> list[dict]:
    pages = json.loads((DATA / "orders_raw.json").read_text())
    seen, trades = set(), []
    for p in pages:
        for grp in (p.get("data") or {}).get("data", []):
            for o in grp.get("orders", []):
                oid = o.get("order_id")
                qty = float(o.get("filled_quantity") or 0)
                px = o.get("filled_price")
                if oid in seen or qty <= 0 or not px:
                    continue
                seen.add(oid)
                ts = o.get("filled_time") or o.get("place_time")
                dt = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).astimezone(ET)
                fees = sum(float(f.get("actual_value") or 0) for f in o.get("fees") or [])
                px = float(px)
                qty, fees = qty * SCALE, fees * SCALE
                trades.append({
                    "date": dt.strftime("%Y-%m-%d"), "ts": dt.isoformat(), "symbol": o["symbol"],
                    "side": o["side"], "qty": qty, "price": px, "fees": round(fees, 2),
                    # cash out of pocket (+) for buys, cash received (−) for sells
                    "flow": round(qty * px + fees, 4) if o["side"] == "BUY" else round(-(qty * px - fees), 4),
                })
    trades.sort(key=lambda t: t["ts"])
    return trades


# ---------------------------------------------------------------- prices
def yahoo(sym: str, start: int, refresh: bool = False) -> dict:
    PRICES.mkdir(parents=True, exist_ok=True)
    cache = PRICES / f"{sym}.json"
    max_age = int(os.environ.get("PRICE_MAX_AGE", 6 * 3600))  # refresh.py lowers this to force fresh prices
    if not refresh and cache.exists() and time.time() - cache.stat().st_mtime < max_age:
        cached = json.loads(cache.read_text())
        if "name" in cached:  # older cache files lack metadata → refetch
            return cached
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?period1={start}"
           f"&period2={int(time.time()) + 86400}&interval=1d&events=div%2Csplits")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise RuntimeError(f"{sym}: ticker not found") from None
            if attempt == 3:
                raise RuntimeError(f"{sym}: HTTP {e.code}") from None
            time.sleep(2 + attempt * 2)
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise RuntimeError(f"{sym}: {e}")
            time.sleep(2 + attempt * 2)
    if not (raw.get("chart") or {}).get("result"):
        err = ((raw.get("chart") or {}).get("error") or {}).get("description", "no data")
        raise RuntimeError(f"{sym}: {err}")
    res = raw["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose") or q["close"]
    d = lambda t: datetime.fromtimestamp(t, tz=timezone.utc).astimezone(ET).strftime("%Y-%m-%d")
    meta = res.get("meta", {})
    out = {"close": {}, "adj": {}, "splits": [], "divs": [],
           "name": meta.get("longName") or meta.get("shortName") or sym,
           "type": meta.get("instrumentType", ""), "currency": meta.get("currency", "")}
    for i, t in enumerate(res.get("timestamp", [])):
        if q["close"][i] is not None:
            out["close"][d(t)] = q["close"][i]
            out["adj"][d(t)] = adj[i]
    ev = res.get("events", {})
    for s in (ev.get("splits") or {}).values():
        out["splits"].append({"date": d(s["date"]), "ratio": s["numerator"] / s["denominator"]})
    for v in (ev.get("dividends") or {}).values():
        out["divs"].append({"date": d(v["date"]), "amount": v["amount"]})
    cache.write_text(json.dumps(out))
    time.sleep(0.4)
    return out


# ---------------------------------------------------------------- math
def xirr(flows: list[tuple[str, float]]) -> float:
    """flows: (date, amount) with investor perspective (deposit negative, value positive)."""
    t0 = datetime.fromisoformat(flows[0][0])
    yrs = [(datetime.fromisoformat(d) - t0).days / 365.25 for d, _ in flows]
    f = lambda r: sum(a / (1 + r) ** y for (_, a), y in zip(flows, yrs))
    lo, hi = -0.99, 10.0
    if f(lo) * f(hi) > 0:
        return float("nan")
    for _ in range(300):
        mid = (lo + hi) / 2
        if f(lo) * f(mid) <= 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def main() -> None:
    trades = load_trades()
    if not trades:
        sys.exit("no trades")
    symbols = sorted({t["symbol"] for t in trades})
    first_day = trades[0]["date"]
    start_epoch = int(datetime.fromisoformat(first_day).replace(tzinfo=timezone.utc).timestamp()) - 20 * 86400

    px, missing = {}, []
    for s in sorted(set(symbols) | {BENCH, BENCH2}):
        try:
            px[s] = yahoo(s, start_epoch)
        except Exception as e:  # noqa: BLE001
            missing.append(s)
            print(f"WARN price fetch failed for {s}: {e}", file=sys.stderr)

    # split-adjust trade quantities so they line up with Yahoo's split-adjusted closes
    for t in trades:
        f = 1.0
        for sp in px.get(t["symbol"], {}).get("splits", []):
            if sp["date"] > t["date"]:
                f *= sp["ratio"]
        t["adj_qty"] = t["qty"] * f

    cal = sorted(d for d in px[BENCH]["close"] if d >= first_day)
    by_day = defaultdict(list)
    for t in trades:
        # a trade on a non-trading day (shouldn't happen) rolls to next session
        d = next((c for c in cal if c >= t["date"]), cal[-1])
        by_day[d].append(t)

    divs = {s: {v["date"]: v["amount"] for v in px[s]["divs"]} for s in px}
    last_close = {s: None for s in symbols}
    shares = defaultdict(float)
    spy_units = 0.0
    cum_flow = cum_div = 0.0
    twr_idx = spy_idx = 1.0
    prev_v = 0.0
    spy0 = None
    qqq_units = 0.0
    qqq0 = None
    series = []
    sym_buy = defaultdict(float); sym_sell = defaultdict(float); sym_div = defaultdict(float)
    day_flows = []  # (date, net flow) for IRR
    legacy = []

    for d in cal:
        # dividends: paid on shares held going into the ex-date
        # Webull DRIP: dividends are reinvested into the same stock (modelled at ex-date close),
        # so they are part of return, not new money.
        div_cash = 0.0
        for s, sh in list(shares.items()):
            if sh > 1e-9 and d in divs.get(s, {}):
                amt = sh * divs[s][d]
                c = px[s]["close"].get(d) or last_close[s]
                div_cash += amt
                sym_div[s] += amt
                if c:
                    shares[s] += amt / c
        flow = 0.0
        for t in by_day.get(d, []):
            q = t["adj_qty"]
            if t["side"] == "SELL" and shares[t["symbol"]] - q < -1e-6:
                # selling shares that never appear as buys (e.g. Webull free promo stock held
                # before this history) — treat as outside the portfolio and skip
                legacy.append(t)
                continue
            shares[t["symbol"]] += q if t["side"] == "BUY" else -q
            flow += t["flow"]
            (sym_buy if t["side"] == "BUY" else sym_sell)[t["symbol"]] += abs(t["flow"])
        # mark to market
        v = 0.0
        for s, sh in shares.items():
            if abs(sh) < 1e-9:
                continue
            c = px.get(s, {}).get("close", {}).get(d)
            if c is not None:
                last_close[s] = c
            c = last_close[s]
            if c is not None:
                v += sh * c
        # time-weighted: flow assumed at start of day, dividends count as return
        denom = prev_v + flow
        if denom > 1e-6:
            twr_idx *= v / denom
        # shadow SPY: same dollars, same day, at SPY adjusted close
        spy_adj = px[BENCH]["adj"][d]
        if spy0 is None:
            spy0 = spy_adj
        spy_units += flow / spy_adj
        spy_idx = spy_adj / spy0
        qqq_adj = px[BENCH2]["adj"][d]
        if qqq0 is None:
            qqq0 = qqq_adj
        qqq_units += flow / qqq_adj
        cum_flow += flow
        cum_div += div_cash
        if flow:
            day_flows.append((d, flow))
        series.append({"d": d, "v": round(v, 2), "inv": round(cum_flow, 2), "div": round(cum_div, 2),
                       "shadow": round(spy_units * spy_adj, 2), "twr": round(twr_idx, 6), "spy": round(spy_idx, 6),
                       "shadow_q": round(qqq_units * qqq_adj, 2), "qqq": round(qqq_adj / qqq0, 6)})
        prev_v = v

    end = series[-1]
    actual_value = end["v"]  # holdings incl. reinvested dividends
    shadow_value = end["shadow"]
    irr_you = xirr([(d, -f) for d, f in day_flows] + [(end["d"], actual_value)])
    irr_spy = xirr([(d, -f) for d, f in day_flows] + [(end["d"], shadow_value)])
    irr_qqq = xirr([(d, -f) for d, f in day_flows] + [(end["d"], end["shadow_q"])])
    yrs = (datetime.fromisoformat(end["d"]) - datetime.fromisoformat(series[0]["d"])).days / 365.25

    # reconciliation vs Webull
    snap = json.loads((DATA / "positions_snapshot.json").read_text())
    recon = []
    for s in sorted(set(symbols) | set(snap["positions"])):
        rebuilt = shares.get(s, 0.0)
        actual = snap["positions"].get(s, [0])[0]
        pos = snap["positions"].get(s)
        lastpx = (pos[3] / pos[0]) if pos and pos[0] else 0
        recon.append({"symbol": s, "rebuilt": round(rebuilt, 5), "webull": actual, "diff": round(rebuilt - actual, 5), "px": round(lastpx, 4)})

    per_sym = []
    for s in symbols:
        mv = shares[s] * (last_close[s] or 0) if abs(shares[s]) > 1e-9 else 0.0
        pnl = mv + sym_sell[s] - sym_buy[s]  # mv already includes DRIP shares
        per_sym.append({"symbol": s, "bought": round(sym_buy[s], 2), "sold": round(sym_sell[s], 2),
                        "divs": round(sym_div[s], 2), "mv": round(mv, 2), "pnl": round(pnl, 2),
                        "ret": round(pnl / sym_buy[s] * 100, 2) if sym_buy[s] else 0,
                        "first": next(t["date"] for t in trades if t["symbol"] == s),
                        "n": sum(1 for t in trades if t["symbol"] == s), "open": abs(shares[s]) > 1e-6})
    per_sym.sort(key=lambda r: -r["pnl"])

    monthly = defaultdict(lambda: {"buy": 0.0, "sell": 0.0, "n": 0})
    for t in trades:
        m = monthly[t["date"][:7]]
        m["n"] += 1
        m["buy" if t["side"] == "BUY" else "sell"] += abs(t["flow"])

    stats = {
        "first_trade": trades[0]["date"], "last_trade": trades[-1]["date"], "end": end["d"], "years": round(yrs, 3),
        "n_trades": len(trades), "n_buys": sum(t["side"] == "BUY" for t in trades),
        "n_sells": sum(t["side"] == "SELL" for t in trades),
        "total_bought": round(sum(sym_buy.values()), 2), "total_sold": round(sum(sym_sell.values()), 2),
        "net_invested": round(end["inv"], 2), "dividends": round(end["div"], 2),
        "holdings_value": end["v"], "actual_value": round(actual_value, 2), "shadow_value": shadow_value,
        "gain_you": round(actual_value - end["inv"], 2), "gain_spy": round(shadow_value - end["inv"], 2),
        "twr_you": round(end["twr"] - 1, 5), "twr_spy": round(end["spy"] - 1, 5),
        "twr_you_ann": round(end["twr"] ** (1 / yrs) - 1, 5), "twr_spy_ann": round(end["spy"] ** (1 / yrs) - 1, 5),
        "irr_you": round(irr_you, 5), "irr_spy": round(irr_spy, 5), "irr_qqq": round(irr_qqq, 5),
        "shadow_q_value": end["shadow_q"], "gain_qqq": round(end["shadow_q"] - end["inv"], 2),
        "twr_qqq": round(end["qqq"] - 1, 5), "twr_qqq_ann": round(end["qqq"] ** (1 / yrs) - 1, 5),
        "missing_prices": missing,
        "max_abs_recon_diff": max(abs(r["diff"]) for r in recon),
        "legacy_sells": [{k: t[k] for k in ("date", "symbol", "qty", "price", "flow")} for t in legacy],
        "recon_value_gap": round(sum(r["diff"] * r["px"] for r in recon), 2),
    }
    # drawdowns of each TWR index
    for key, name in (("twr", "dd_you"), ("spy", "dd_spy"), ("qqq", "dd_qqq")):
        pk, dd = 0, 0
        for r in series:
            pk = max(pk, r[key]); dd = min(dd, r[key] / pk - 1)
        stats[name] = round(dd, 4)

    out = {"stats": stats, "series": series, "per_symbol": per_sym, "reconciliation": recon,
           "monthly": [{"m": k, **{kk: round(vv, 2) for kk, vv in v.items()}} for k, v in sorted(monthly.items())],
           "trades": [{k: t[k] for k in ("date", "symbol", "side", "qty", "price", "flow")} for t in trades]}
    (DATA / "analysis.json").write_text(json.dumps(out, separators=(",", ":")))
    print(json.dumps(stats, indent=1))
    bad = [r for r in recon if abs(r["diff"]) > 0.01]
    print("reconciliation mismatches (>0.01 sh):", json.dumps(bad, indent=1) if bad else "none")


if __name__ == "__main__":
    main()
