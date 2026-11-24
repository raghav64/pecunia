"""Local server for the portfolio app.

Serves portfolio-report.html and runs the shadow analysis for any ticker on demand:
  GET /                      → the report
  GET /api/shadow?t=NVDA     → shadow analysis JSON (also saved to data/shadows/)
  POST /api/refresh?mode=full|prices → run scripts/refresh.py in the background (one at a time)
  GET /api/refresh           → progress of the current / last refresh

Binds to 127.0.0.1 only. Serves nothing else from the project (your raw order
data is not exposed).

Run:  ./serve.sh        (or: ~/.local/bin/uv run --quiet python scripts/serve.py [port])
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shadow  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "portfolio-report.html"
STEP_RE = re.compile(r"^STEP (\d+)/(\d+) (.*)$")


class Refresh:
    """Runs scripts/refresh.py in a background thread and tracks its progress."""
    lock = threading.Lock()
    state = {"status": "idle"}

    @classmethod
    def start(cls, mode: str) -> tuple[int, dict]:
        with cls.lock:
            if cls.state.get("status") == "running":
                return 409, cls.snapshot()
            cls.state = {"status": "running", "mode": mode, "step": 0, "steps": 0, "label": "Starting…",
                         "log": [], "started": time.time(), "finished": None}
        threading.Thread(target=cls._run, args=(mode,), daemon=True).start()
        return 202, cls.snapshot()

    @classmethod
    def _run(cls, mode: str) -> None:
        cmd = [sys.executable, str(ROOT / "scripts" / "refresh.py")] + (["--prices-only"] if mode == "prices" else [])
        try:
            proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            for line in proc.stdout:
                line = line.rstrip()
                with cls.lock:
                    m = STEP_RE.match(line)
                    if m:
                        cls.state.update(step=int(m[1]), steps=int(m[2]), label=m[3])
                    cls.state["log"] = (cls.state["log"] + [line])[-40:]
            rc = proc.wait()
            ok = rc == 0
        except Exception as e:  # noqa: BLE001
            ok = False
            with cls.lock:
                cls.state["log"].append(f"ERROR: {e}")
        with cls.lock:
            cls.state.update(status="done" if ok else "error", finished=time.time())

    @classmethod
    def snapshot(cls) -> dict:
        s = dict(cls.state)
        if s.get("started"):
            s["elapsed"] = round((s.get("finished") or time.time()) - s["started"])
        return s


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        # Require a custom header: browsers can't send it cross-site without a CORS preflight
        # (which this server never approves), so other websites can't trigger a refresh.
        if u.path != "/api/refresh" or self.headers.get("X-Portfolio-Lab") != "1":
            self._send(403 if u.path == "/api/refresh" else 404, b"forbidden", "text/plain")
            return
        mode = (parse_qs(u.query).get("mode") or ["full"])[0]
        code, body = Refresh.start("prices" if mode == "prices" else "full")
        self._send(code, json.dumps(body).encode(), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        if u.path == "/api/refresh":
            self._send(200, json.dumps(Refresh.snapshot()).encode(), "application/json")
            return
        if u.path == "/api/shadow":
            q = parse_qs(u.query)
            t = (q.get("t") or [""])[0]
            refresh = (q.get("refresh") or ["0"])[0] == "1"
            try:
                res = shadow.compute(t, refresh=refresh)
                shadow.save(res)
                code = 200
            except ValueError as e:
                res, code = {"error": str(e)}, 400
            except Exception as e:  # noqa: BLE001
                res, code = {"error": str(e)[:300]}, 502
            self._send(code, json.dumps(res).encode(), "application/json")
            return
        if u.path == "/api/ping":
            self._send(200, b'{"ok":true}', "application/json")
            return
        if u.path in ("/", "/index.html", "/portfolio-report.html"):
            self._send(200, REPORT.read_bytes(), "text/html; charset=utf-8")
            return
        self._send(404, b"not found", "text/plain")

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("  " + (fmt % args) + "\n")


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Portfolio app → http://127.0.0.1:{port}   (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
