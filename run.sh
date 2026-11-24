#!/bin/zsh
# Full refresh: Webull orders + positions (read-only) → analysis → every saved shadow ticker
# → dip analysis → sector lab → portfolio-report.html. Same pipeline as the app's Refresh button.
#
# Usage: ./run.sh                    # full refresh
#        ./run.sh NVDA BRK.B         # + extra shadow tickers
#        ./run.sh --prices-only      # skip Webull, just re-pull prices
set -e
cd "$(dirname "$0")"
~/.local/bin/uv run --quiet python scripts/refresh.py "$@"
echo "\nStatic report: portfolio-report.html  ·  Live app with Refresh button: ./serve.sh"
