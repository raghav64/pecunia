#!/bin/zsh
# Start the local app (any-ticker shadow analysis on the Compare page).
cd "$(dirname "$0")"
PORT=${1:-8765}
(sleep 1 && open "http://127.0.0.1:$PORT/#/home") &
exec ~/.local/bin/uv run --quiet python scripts/serve.py $PORT
