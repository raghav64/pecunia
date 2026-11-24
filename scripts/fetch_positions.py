"""Fetch current positions + balance from Webull (READ-ONLY) → data/positions_snapshot.json.

Only calls account_v2.get_account_position and get_account_balance.
Run: ~/.local/bin/uv run --quiet --with webull-openapi-mcp python scripts/fetch_positions.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_orders import ROOT, account_id, WebullSDKClient, extract_response_data, load_config, quiet_sdk_logs  # noqa: E402

OUT = ROOT / "data" / "positions_snapshot.json"


def f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    quiet_sdk_logs()
    sdk = WebullSDKClient(load_config())
    sdk.initialize(interactive=False)
    quiet_sdk_logs()
    pos = extract_response_data(sdk.trade.account_v2.get_account_position(account_id(sdk))) or []
    bal = extract_response_data(sdk.trade.account_v2.get_account_balance(account_id(sdk))) or {}
    if isinstance(pos, dict):  # some SDK versions wrap the list
        pos = pos.get("holdings") or pos.get("positions") or []
    rows, skipped = {}, []
    for p in pos:
        if p.get("instrument_type", "EQUITY") != "EQUITY":
            skipped.append(p.get("symbol"))
            continue
        rows[p["symbol"]] = [round(f(p.get("quantity")), 5), round(f(p.get("cost_price")), 2),
                             round(f(p.get("last_price")), 2), round(f(p.get("market_value")), 2),
                             round(f(p.get("unrealized_profit_loss")), 2)]
    if not rows:
        sys.exit("no positions returned — keeping the existing snapshot")
    rows = dict(sorted(rows.items(), key=lambda kv: -kv[1][3]))
    snap = {"as_of": datetime.now().strftime("%Y-%m-%d"),
            "cash": round(f(bal.get("total_cash_balance")), 2),
            "net_liquidation": round(f(bal.get("total_net_liquidation_value")), 2),
            "market_value": round(f(bal.get("total_market_value")), 2),
            "unrealized_pnl": round(f(bal.get("total_unrealized_profit_loss")), 2),
            "fields": ["qty", "avg_cost", "last", "market_value", "unrealized_pnl"],
            "positions": rows}
    OUT.write_text(json.dumps(snap, separators=(",", ":")))
    msg = f"saved {len(rows)} positions, net liquidation ${snap['net_liquidation']:,.2f}"
    if skipped:
        msg += f" (skipped non-equity: {', '.join(map(str, skipped))})"
    print(msg)


if __name__ == "__main__":
    main()
