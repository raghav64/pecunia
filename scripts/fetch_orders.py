"""Fetch full Webull order history (READ-ONLY) and save raw JSON.

Uses the same credentials/token as the webull MCP server (WEBULL_APP_KEY /
WEBULL_APP_SECRET env vars, token cached in ~/.webull-mcp). Only calls
list_order_history — never places, modifies or cancels anything.

Run:
  ~/.local/bin/uv run --quiet --with webull-openapi-mcp python scripts/fetch_orders.py
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("WEBULL_REGION_ID", "us")
os.environ.setdefault("WEBULL_ENVIRONMENT", "prod")
os.environ.setdefault("WEBULL_TOKEN_DIR", str(Path.home() / ".webull-mcp"))

from webull_openapi_mcp.config import load_config  # noqa: E402
from webull_openapi_mcp.formatters import extract_response_data  # noqa: E402
from webull_openapi_mcp.sdk_client import WebullSDKClient  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "orders_raw.json"
START = datetime(2024, 1, 1, tzinfo=timezone.utc)
_ACCOUNT_ID = os.environ.get("WEBULL_ACCOUNT_ID")  # optional; auto-detected if your login has one account


def account_id(sdk) -> str:
    """WEBULL_ACCOUNT_ID if set, otherwise the only account on this login."""
    global _ACCOUNT_ID
    if _ACCOUNT_ID:
        return _ACCOUNT_ID
    accts = extract_response_data(sdk.trade.account_v2.get_account_list()) or []
    if isinstance(accts, dict):
        accts = accts.get("accounts") or accts.get("data") or [accts]
    ids = [a.get("account_id") for a in accts if isinstance(a, dict) and a.get("account_id")]
    if len(ids) != 1:
        sys.exit(f"Found {len(ids)} Webull accounts; set WEBULL_ACCOUNT_ID to pick one.")
    _ACCOUNT_ID = ids[0]
    return _ACCOUNT_ID


def quiet_sdk_logs() -> None:
    # The SDK dumps full request headers (incl. access token) on errors — silence it.
    for name in list(logging.root.manager.loggerDict) + ["webull", "webull.core", "webull.core.client"]:
        if name.startswith("webull"):
            lg = logging.getLogger(name)
            lg.setLevel(logging.CRITICAL + 1)
            lg.propagate = False
            lg.handlers = [logging.NullHandler()]


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def call(sdk, **kwargs):
    delay = 3.0
    for attempt in range(8):
        try:
            return extract_response_data(
                sdk.trade.order_v3.list_order_history(account_id=account_id(sdk), **kwargs)
            )
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "429" in msg or "TOO_MANY" in msg:
                print(f"  rate limited, waiting {delay:.0f}s", file=sys.stderr)
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            # strip anything that could carry secrets
            raise RuntimeError(msg.split("RequestID")[0][:300]) from None
    raise RuntimeError("gave up after repeated rate limiting")


def fetch_range(sdk, start: datetime, end: datetime) -> list:
    pages, key = [], None
    while True:
        kw = {"start_time": iso(start), "end_time": iso(end)}
        if key:
            kw["pagination_key"] = key
        data = call(sdk, **kw)
        pages.append({"window": [iso(start), iso(end)], "data": data})
        key = data.get("pagination_key") if isinstance(data, dict) else None
        if not key:
            return pages
        time.sleep(1.5)


def main() -> None:
    sdk = WebullSDKClient(load_config())
    sdk.initialize(interactive=False)
    quiet_sdk_logs()
    now = datetime.now(timezone.utc)

    try:
        pages = fetch_range(sdk, START, now)
        print(f"full range OK: {len(pages)} page(s)", file=sys.stderr)
    except RuntimeError as e:
        print(f"full range failed ({e}); falling back to monthly windows", file=sys.stderr)
        pages, ws = [], START
        while ws < now:
            we = min(ws + timedelta(days=31), now)
            p = fetch_range(sdk, ws, we)
            pages += p
            print(f"{ws:%Y-%m-%d} → {we:%Y-%m-%d}: {len(p)} page(s)", file=sys.stderr)
            ws = we
            time.sleep(1.5)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(pages, indent=1, default=str))
    print(f"saved {len(pages)} pages → {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
