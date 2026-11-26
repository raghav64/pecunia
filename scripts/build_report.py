"""Inject analysis, positions and all saved shadow results into the HTML template."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("PECUNIA_DATA") or ROOT / "data")
tpl = (ROOT / "scripts" / "report_template.html").read_text()
analysis = (DATA / "analysis.json").read_text()
positions = (DATA / "positions_snapshot.json").read_text()
shadows = {}
for p in sorted((DATA / "shadows").glob("*.json")):
    r = json.loads(p.read_text())
    shadows[r["ticker"]] = r
dips_p = DATA / "dips.json"
dips = dips_p.read_text() if dips_p.exists() else "null"
sect_p = DATA / "sectors.json"
sect = sect_p.read_text() if sect_p.exists() else "null"
def data_uri(p):
    import base64
    return "data:image/png;base64," + base64.b64encode((ROOT / p).read_bytes()).decode()
tpl = (tpl.replace("__LOGO__", data_uri("assets/brand/pecunia-wordmark-dark.png"))
          .replace("__ICON__", data_uri("assets/brand/pecunia-icon-64.png")))
html = (tpl.replace("/*DIPS*/null", dips).replace("/*SECTORS*/null", sect).replace("/*DEMO*/false", "true" if os.environ.get("PECUNIA_DEMO") else "false").replace("/*ANALYSIS*/null", analysis)
           .replace("/*POSITIONS*/null", positions)
           .replace("/*SHADOWS*/null", json.dumps(shadows, separators=(",", ":"))))
out = Path(os.environ.get("PECUNIA_OUT") or ROOT / "portfolio-report.html")
out.write_text(html)
print(f"wrote {out} ({len(html) // 1024} KB, {len(shadows)} shadow tickers: {', '.join(shadows)})")
