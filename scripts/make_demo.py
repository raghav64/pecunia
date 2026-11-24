"""Build the public demo report (docs/index.html) from your real data, with every
share count and dollar amount scaled down so the published numbers aren't your own.

Percent returns, IRR, TWR, drawdowns and market prices are unchanged (scaling every
cash flow by the same factor doesn't change them); only amounts and quantities shrink.

Usage: uv run python scripts/make_demo.py [--scale 0.1]
Writes: build/demo-data/ (git-ignored working copy) and docs/index.html (committed, GitHub Pages).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REAL = ROOT / "data"
DEMO = ROOT / "build" / "demo-data"
OUT = ROOT / "docs" / "index.html"


def main() -> int:
    scale = float(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 0.1
    if DEMO.exists():
        shutil.rmtree(DEMO)
    (DEMO / "shadows").mkdir(parents=True)
    (DEMO / "prices").symlink_to(REAL / "prices")            # market prices are public, share them
    shutil.copy(REAL / "orders_raw.json", DEMO)                # scaled on load via PECUNIA_SCALE
    if (REAL / "dip_news.json").exists():
        shutil.copy(REAL / "dip_news.json", DEMO)

    pos = json.loads((REAL / "positions_snapshot.json").read_text())
    for k in ("cash", "net_liquidation", "market_value", "unrealized_pnl"):
        pos[k] = round(pos[k] * scale, 2)
    for s, (q, cost, last, mv, pnl) in pos["positions"].items():
        pos["positions"][s] = [round(q * scale, 5), cost, last, round(mv * scale, 2), round(pnl * scale, 2)]
    (DEMO / "positions_snapshot.json").write_text(json.dumps(pos))

    tickers = sorted(p.stem for p in (REAL / "shadows").glob("*.json"))
    env = {**os.environ, "PECUNIA_DATA": str(DEMO), "PECUNIA_SCALE": str(scale),
           "PECUNIA_OUT": str(OUT), "PECUNIA_DEMO": "1", "PRICE_MAX_AGE": str(10 ** 9)}  # reuse cached prices, no refetch
    py = [sys.executable]
    steps = [["build_analysis.py"], ["shadow.py", *tickers], ["dip_analysis.py"], ["sector_lab.py"], ["build_report.py"]]
    OUT.parent.mkdir(exist_ok=True)
    for st in steps:
        r = subprocess.run(py + [str(ROOT / "scripts" / st[0]), *st[1:]], cwd=ROOT, env=env,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if r.returncode != 0 and st[0] != "shadow.py":
            print(r.stdout[-2000:])
            return r.returncode
        print(f"✓ {st[0]}")
    a = json.loads((DEMO / "analysis.json").read_text())["stats"]
    print(f"demo: value ${a['actual_value']:,.0f} from ${a['net_invested']:,.0f} invested "
          f"(scale {scale}); IRR {a['irr_you'] * 100:.1f}% unchanged → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
