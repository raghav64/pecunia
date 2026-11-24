"""Which months' dollars did best, and did buying market dips help?

For every buy in data/analysis.json:
  growth to date  = (shares bought) × today's price incl. reinvested dividends ÷ cost
  fwd 1m/3m/6m    = the stock's total return 21/63/126 trading days after the fill
  market dip      = SPY's drawdown from its 52-week high on the trade date
  timing edge $   = value today − value if the same dollars had bought the same stock
                    at its average price of the previous 63 trading days (~3 months)
Writes data/dips.json and prints a summary.
"""
import json
import os
from bisect import bisect_right
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("PECUNIA_DATA") or ROOT / "data")
PRICES = DATA / "prices"
BUCKETS = [(0, 0.02, "Near high (<2% off)"), (0.02, 0.05, "Small pullback (2–5%)"),
           (0.05, 0.10, "Dip (5–10%)"), (0.10, 1.0, "Correction (10%+)")]


def load(sym):
    p = json.loads((PRICES / f"{sym}.json").read_text())
    days = sorted(p["close"])
    return {"days": days, "close": p["close"], "adj": p["adj"], "splits": p["splits"],
            "idx": {d: i for i, d in enumerate(days)}}


def on_or_before(px, d):
    i = bisect_right(px["days"], d) - 1
    return px["days"][max(i, 0)]


def main():
    a = json.loads((DATA / "analysis.json").read_text())
    end = a["stats"]["end"]
    spy = load("SPY")
    cache = {}
    sd = spy["days"]
    # SPY 52-week (252d) rolling high → drawdown, and 5-day move
    spy_dd, spy_5d = {}, {}
    for i, d in enumerate(sd):
        hi = max(spy["close"][x] for x in sd[max(0, i - 251):i + 1])
        spy_dd[d] = 1 - spy["close"][d] / hi
        spy_5d[d] = spy["close"][d] / spy["close"][sd[max(0, i - 5)]] - 1

    rows = []
    for t in a["trades"]:
        if t["side"] != "BUY" or t["flow"] <= 0:
            continue
        sym = t["symbol"]
        if sym not in cache:
            cache[sym] = load(sym)
        px = cache[sym]
        d = on_or_before(px, t["date"])
        i = px["idx"][d]
        split = 1.0
        for s in px["splits"]:
            if s["date"] > t["date"]:
                split *= s["ratio"]
        fill = t["price"] / split                         # in today's share terms (Yahoo close basis)
        fill_adj = fill * px["adj"][d] / px["close"][d]   # in dividend-adjusted terms
        adj_end = px["adj"][px["days"][-1]]
        cost = t["flow"]
        value = cost * adj_end / fill_adj
        win = [px["adj"][x] for x in px["days"][max(0, i - 63):i]] or [fill_adj]
        avg63 = sum(win) / len(win)
        fwd = {}
        for k, n in (("f1", 21), ("f3", 63), ("f6", 126)):
            if i + n < len(px["days"]):
                fwd[k] = px["adj"][px["days"][i + n]] / fill_adj - 1
        hi_s = max(px["close"][x] for x in px["days"][max(0, i - 251):i + 1])
        sdd = on_or_before(spy, t["date"])
        rows.append({
            "date": t["date"], "sym": sym, "cost": cost, "value": value,
            "spy_value": cost * spy["adj"][sd[-1]] / spy["adj"][sdd],
            "edge": value - cost * adj_end / avg63,
            "mkt_dd": spy_dd[sdd], "mkt_5d": spy_5d[sdd],
            "stk_dd": 1 - min(fill, px["close"][d]) / hi_s, **fwd})

    # ---- by month
    months = defaultdict(lambda: defaultdict(float))
    for r in rows:
        m = months[r["date"][:7]]
        m["cost"] += r["cost"]; m["value"] += r["value"]; m["spy_value"] += r["spy_value"]
        m["edge"] += r["edge"]; m["dd_w"] += r["mkt_dd"] * r["cost"]
        m["n"] += 1
    month_rows = []
    for k in sorted(months):
        m = months[k]
        yrs = max((_days(k + "-15", end)) / 365.25, 0.08)
        g = m["value"] / m["cost"]
        month_rows.append({"m": k, "cost": round(m["cost"], 2), "value": round(m["value"], 2),
                           "gain": round(m["value"] - m["cost"], 2), "ret": g - 1,
                           "ann": g ** (1 / yrs) - 1 if yrs > 0.5 else None,
                           "spy_ret": m["spy_value"] / m["cost"] - 1,
                           "edge": round(m["edge"], 2), "mkt_dd": m["dd_w"] / m["cost"], "n": int(m["n"])})

    # ---- by market-dip bucket
    def agg(sel):
        c = sum(r["cost"] for r in sel) or 1e-9
        out = {"cost": round(c, 2), "n": len(sel), "ret": sum(r["value"] for r in sel) / c - 1,
               "spy_ret": sum(r["spy_value"] for r in sel) / c - 1, "edge": round(sum(r["edge"] for r in sel), 2),
               "edge_pct": sum(r["edge"] for r in sel) / c}
        for k in ("f1", "f3", "f6"):
            s = [r for r in sel if k in r]
            cs = sum(r["cost"] for r in s)
            out[k] = sum(r[k] * r["cost"] for r in s) / cs if cs else None
        return out

    buckets = [{"label": lab, "lo": lo, "hi": hi, **agg([r for r in rows if lo <= r["mkt_dd"] < hi])}
               for lo, hi, lab in BUCKETS]
    stock_buckets = [{"label": lab.replace("Correction", "Stock down"), "lo": lo, "hi": hi,
                      **agg([r for r in rows if lo <= r["stk_dd"] < hi])}
                     for lo, hi, lab in [(0, .05, "Stock <5% off its high"), (.05, .15, "Stock 5–15% off"),
                                         (.15, .30, "Stock 15–30% off"), (.30, 1, "Stock 30%+ off")]]

    # ---- dip episodes: SPY ≥5% below 52w high, until back within 2%
    episodes, cur = [], None
    for d in sd:
        if d < rows[0]["date"]:
            continue
        if cur is None and spy_dd[d] >= 0.05:
            # start the episode at the day the slide began (last day within 2% of the high)
            j = sd.index(d)
            while j > 0 and spy_dd[sd[j - 1]] >= 0.02:
                j -= 1
            cur = {"start": sd[j], "trough": d, "depth": spy_dd[d]}
        elif cur is not None:
            if spy_dd[d] > cur["depth"]:
                cur.update(trough=d, depth=spy_dd[d])
            if spy_dd[d] < 0.02:
                cur["end"] = d; episodes.append(cur); cur = None
    if cur:
        cur["end"] = None; episodes.append(cur)
    for e in episodes:
        sel = [r for r in rows if e["start"] <= r["date"] <= (e["end"] or end)]
        e.update(agg(sel))
        e["spy_trough_px"] = spy["close"][e["trough"]]

    # ---- big down days (SPY ≤ −2%) and what you bought within 3 trading days
    big = []
    for i, d in enumerate(sd[1:], 1):
        ch = spy["close"][d] / spy["close"][sd[i - 1]] - 1
        if ch <= -0.02 and d >= rows[0]["date"]:
            window = sd[i:i + 4]
            sel = [r for r in rows if window[0] <= r["date"] <= window[-1]]
            big.append({"d": d, "chg": ch, **agg(sel)})

    news_p = DATA / "dip_news.json"
    news = json.loads(news_p.read_text()) if news_p.exists() else {"episodes": {}, "days": {}}
    for e in episodes:
        e["news"] = news["episodes"].get(e["start"])
    for b in big:
        b["news"] = news["days"].get(b["d"])

    total = agg(rows)
    dip = agg([r for r in rows if r["mkt_dd"] >= 0.05])
    calm = agg([r for r in rows if r["mkt_dd"] < 0.02])
    out = {"end": end, "total": total, "dip": dip, "calm": calm, "months": month_rows,
           "buckets": buckets, "stock_buckets": stock_buckets, "episodes": episodes, "big_days": big,
           "spy_dd": [[d, round(spy_dd[d], 4)] for d in sd if d >= rows[0]["date"]]}
    (DATA / "dips.json").write_text(json.dumps(out, separators=(",", ":"), default=float))

    # ---- print
    pct = lambda x: "  n/a " if x is None else f"{x * 100:+6.1f}%"
    print("Top months by return on the dollars invested that month:")
    for m in sorted(month_rows, key=lambda m: -m["ret"])[:8]:
        print(f"  {m['m']}  in ${m['cost']:>9,.0f}  now ${m['value']:>9,.0f}  {pct(m['ret'])}  "
              f"(same $ in SPY {pct(m['spy_ret'])})  SPY off-high {m['mkt_dd'] * 100:4.1f}%")
    print("\nBiggest dollar gains by month:")
    for m in sorted(month_rows, key=lambda m: -m["gain"])[:6]:
        print(f"  {m['m']}  gain ${m['gain']:>8,.0f}  {pct(m['ret'])}")
    print("\nBy market state when you bought:")
    for b in buckets:
        print(f"  {b['label']:<24} ${b['cost']:>9,.0f}  to-date {pct(b['ret'])}  fwd3m {pct(b['f3'])}  "
              f"fwd6m {pct(b['f6'])}  edge ${b['edge']:>8,.0f} ({pct(b['edge_pct'])})")
    print("\nBy the stock's own drawdown when you bought:")
    for b in stock_buckets:
        print(f"  {b['label']:<24} ${b['cost']:>9,.0f}  to-date {pct(b['ret'])}  fwd3m {pct(b['f3'])}  "
              f"fwd6m {pct(b['f6'])}  edge ${b['edge']:>8,.0f}")
    print("\nDip episodes (SPY ≥5% off high):")
    for e in episodes:
        print(f"  {e['start']} → trough {e['trough']} ({e['depth'] * 100:.1f}%) → {e['end']}  "
              f"you bought ${e['cost']:,.0f}  to-date {pct(e['ret'])}  fwd6m {pct(e['f6'])}  edge ${e['edge']:,.0f}")
    print("\nSPY ≤ −2% days:")
    for b in big:
        print(f"  {b['d']} {b['chg'] * 100:+.1f}%  you bought ${b['cost']:,.0f} next 3d  fwd3m {pct(b['f3'])}")
    print(f"\nTotal timing edge vs trailing-3m-avg price: ${total['edge']:,.0f} ({pct(total['edge_pct'])} of cost)")
    print(f"Dip dollars (SPY ≥5% off): ${dip['cost']:,.0f}, edge ${dip['edge']:,.0f}; "
          f"fwd6m {pct(dip['f6'])} vs calm {pct(calm['f6'])}")


def _days(a, b):
    from datetime import date
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


if __name__ == "__main__":
    main()
