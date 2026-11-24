"""Sector lab: would adding other sectors have helped, and which picks hold up on more than raw return?

For each ticker in UNIVERSE (shadow results in data/shadows/, created on demand) computes:
  ann return, volatility, return/vol, max drawdown, correlation & beta of daily returns vs YOUR portfolio,
  calendar-year returns vs SPY, and what a 20% sleeve (20% of every buy) would have done to your
  final value, max drawdown and volatility. Then scores tickers within each sector.
Writes data/sectors.json. Usage: uv run python scripts/sector_lab.py [--refresh]
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shadow import OUT, compute, load_base, save  # noqa: E402

UNIVERSE = {
    "Consumer Staples": {"etf": "XLP", "stocks": ["WMT", "COST", "PG", "KO", "PEP", "PM"]},
    "Consumer Discretionary": {"etf": "XLY", "stocks": ["AMZN", "HD", "MCD", "TJX"]},
    "Financials": {"etf": "XLF", "stocks": ["JPM", "BAC", "GS", "BRK.B", "V", "MA", "AXP"]},
    "Health Care": {"etf": "XLV", "stocks": ["LLY", "JNJ", "ABBV", "MRK", "UNH", "ISRG", "ABT"]},
    "Industrials": {"etf": "XLI", "stocks": ["GE", "RTX", "CAT"]},
    "Energy": {"etf": "XLE", "stocks": ["XOM", "CVX"]},
    "Utilities": {"etf": "XLU", "stocks": ["NEE"]},
    "Technology": {"etf": "XLK", "stocks": ["AAPL", "MSFT", "NVDA", "GOOGL"]},
    "Broad & diversifiers": {"etf": "VTI", "stocks": ["SPY", "RSP", "SCHD", "VXUS", "GLD"]},
}
SLEEVE = 0.20
# score weights: risk-adjusted return, consistency vs SPY by year, shallow drawdown, low correlation to you
W = {"sharpe": 0.35, "consist": 0.25, "dd": 0.20, "div": 0.20}


def rets(series):
    out = []
    for a, b in zip(series, series[1:]):
        out.append(None if a is None or b is None or a == 0 else b / a - 1)
    return out


def stats_of(r):
    xs = [x for x in r if x is not None]
    m = sum(xs) / len(xs)
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))
    return m, sd


def corr_beta(a, b):
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    ma = sum(p[0] for p in pairs) / len(pairs)
    mb = sum(p[1] for p in pairs) / len(pairs)
    cov = sum((x - ma) * (y - mb) for x, y in pairs)
    va = sum((x - ma) ** 2 for x, _ in pairs)
    vb = sum((y - mb) ** 2 for _, y in pairs)
    return cov / math.sqrt(va * vb), cov / vb  # corr, beta of a on b


def twr_path(vals, inv):
    """Daily TWR index for a value series with external flows (inv = cumulative net invested)."""
    idx, prev_v, prev_i = [1.0], vals[0], inv[0]
    for v, i in zip(vals[1:], inv[1:]):
        f = i - prev_i
        base = prev_v + f
        idx.append(idx[-1] * (v / base if base > 1 else 1.0))
        prev_v, prev_i = v, i
    return idx


def max_dd(idx):
    pk, dd = 0, 0
    for x in idx:
        if x is None:
            continue
        pk = max(pk, x)
        dd = min(dd, x / pk - 1)
    return dd


def main():
    refresh = "--refresh" in sys.argv
    base = load_base()
    ser = base["series"]
    dates = [r["d"] for r in ser]
    V = [r["v"] for r in ser]
    INV = [r["inv"] for r in ser]
    you_idx = [r["twr"] for r in ser]
    you_r = rets(you_idx)
    years = (len(ser) - 1) / 252

    def load(t):
        p = OUT / f"{t}.json"
        if refresh or not p.exists():
            res = compute(t, base, refresh=refresh)
            save(res)
            return res
        r = json.loads(p.read_text())
        if r["end"] != dates[-1]:
            r = compute(t, base)
            save(r)
        return r

    # year-end indices (last trading date of each year in the series)
    ye = {}
    for i, d in enumerate(dates):
        ye[d[:4]] = i
    yrs = sorted(ye)

    def yearly(idx):
        out, prev = {}, 0
        for y in yrs:
            i = ye[y]
            a = next((idx[k] for k in range(prev, i + 1) if idx[k] is not None), None)
            # chain from previous year-end
            start = idx[prev] if prev and idx[prev] is not None else a
            out[y] = idx[i] / start - 1 if start else None
            prev = i
        return out

    spy = load("SPY")
    spy_y = yearly(spy["idx"])
    you_y = yearly(you_idx)
    you_m, you_sd = stats_of(you_r)
    you_dd = max_dd(you_idx)

    rows = {}
    every = {t for s in UNIVERSE.values() for t in [s["etf"], *s["stocks"]]}
    for t in sorted(every):
        try:
            s = load(t)
        except Exception as e:  # noqa: BLE001
            print(f"skip {t}: {e}")
            continue
        r = rets(s["idx"])
        m, sd = stats_of(r)
        corr, beta = corr_beta(r, you_r)
        tot = s["idx"][-1] / next(x for x in s["idx"] if x is not None)
        ann = tot ** (1 / years) - 1
        vol = sd * math.sqrt(252)
        y = yearly(s["idx"])
        beat = sum(1 for k in yrs if y[k] is not None and y[k] > spy_y[k])
        blend = [(1 - SLEEVE) * a + SLEEVE * b for a, b in zip(V, s["vals"])]
        bidx = twr_path(blend, INV)
        bm, bsd = stats_of(rets(bidx))
        rows[t] = {"t": t, "name": s["name"], "value": s["value"], "gain": s["gain"], "irr": s["irr"],
                   "ann": ann, "vol": vol, "sharpe": ann / vol if vol else 0, "dd": s["dd"],
                   "corr": corr, "beta": beta, "years": y, "beat": beat,
                   "sleeve": {"value": blend[-1], "delta": blend[-1] - V[-1], "dd": max_dd(bidx),
                              "vol": bsd * math.sqrt(252)}}

    # score within the whole universe (z-scores), so sectors are comparable
    def z(key, sign=1):
        xs = [sign * r[key] for r in rows.values()]
        m = sum(xs) / len(xs)
        sd = math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs)) or 1
        return {t: (sign * r[key] - m) / sd for t, r in rows.items()}
    zs = {"sharpe": z("sharpe"), "consist": z("beat"), "dd": z("dd"), "div": z("corr", -1)}
    for t, r in rows.items():
        r["score"] = sum(W[k] * zs[k][t] for k in W)

    sectors = []
    for name, cfg in UNIVERSE.items():
        members = [t for t in [cfg["etf"], *cfg["stocks"]] if t in rows]
        ranked = sorted([t for t in cfg["stocks"] if t in rows], key=lambda t: -rows[t]["score"])
        sectors.append({"name": name, "etf": cfg["etf"], "members": members, "ranked": ranked})

    out = {"end": dates[-1], "sleeve": SLEEVE, "weights": W, "year_keys": yrs,
           "you": {"ann": you_idx[-1] ** (1 / years) - 1, "vol": you_sd * math.sqrt(252), "dd": you_dd,
                   "years": you_y, "value": V[-1]},
           "spy_years": spy_y, "sectors": sectors, "rows": rows}
    (base_dir := OUT.parent).joinpath("sectors.json").write_text(json.dumps(out, separators=(",", ":")))

    pc = lambda x: "  n/a" if x is None else f"{x * 100:+5.1f}%"
    print(f"You: ann {pc(out['you']['ann'])} vol {out['you']['vol'] * 100:.1f}% maxDD {you_dd * 100:.1f}%  "
          f"years " + " ".join(f"{k}:{pc(v)}" for k, v in you_y.items()))
    print("SPY years " + " ".join(f"{k}:{pc(v)}" for k, v in spy_y.items()))
    for s in sectors:
        e = rows[s["etf"]]
        print(f"\n== {s['name']} ({s['etf']}: ann {pc(e['ann'])}, vol {e['vol'] * 100:.0f}%, corr {e['corr']:.2f}, "
              f"20% sleeve {e['sleeve']['delta']:+,.0f}$ dd {e['sleeve']['dd'] * 100:.1f}%)")
        for t in s["ranked"]:
            r = rows[t]
            print(f"  {t:<6} score {r['score']:+.2f}  ann {pc(r['ann'])} vol {r['vol'] * 100:3.0f}% dd {r['dd'] * 100:5.1f}% "
                  f"corr {r['corr']:.2f} beatSPY {r['beat']}/{len(yrs)}  yrs " +
                  " ".join(pc(r['years'][k]) for k in yrs) + f"  sleeve {r['sleeve']['delta']:+,.0f}$")


if __name__ == "__main__":
    main()
