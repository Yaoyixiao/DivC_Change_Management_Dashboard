"""PTC Integrity opener — local HTTP server that runs OS-level protocol dispatch.

Listens on 127.0.0.1:8766. dashboard.html's ID links fetch this server, which
hands the URL off to Windows ShellExecute (`cmd /c start "" "<url>"`). The
dispatch happens in the OS, not in the browser, so Mimecast's browser-level
URL rewriting cannot intercept it.

Endpoints
---------
GET /health         → 200 "opener ok"
GET /open?url=<u>   → ShellExecute <u> via cmd; returns 200 on success, 400 on
                      missing url, 500 on shell failure.

This module is imported by both `generate_dashboard.py` (combined launcher)
and `opener_only.py` (standalone `IntegrityOpener.exe`).
"""
from __future__ import annotations

import http.server
import socketserver
import subprocess
from urllib.parse import urlparse, parse_qs


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8766


def shell_open(url: str) -> bool:
    """Invoke the OS-level protocol handler for ``url``.

    Uses ``cmd /c start "" "<url>"`` so the dispatch goes through Windows
    ShellExecute. Returns True if the subprocess was launched, False on error.
    """
    try:
        subprocess.Popen(
            ["cmd", "/c", "start", "", url],
            shell=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return True
    except Exception:
        return False


class _Handler(http.server.BaseHTTPRequestHandler):
    # Silence default per-request access log; the surrounding exe prints status.
    def log_message(self, fmt, *args):
        return

    def _write(self, status: int, body: bytes, ctype: str = "text/plain; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # dashboard.html lives on a different origin (typically :8765), so
        # explicit CORS headers are required for the fetch() call.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._write(200, b"opener ok\n")
            return
        if parsed.path == "/open":
            params = parse_qs(parsed.query)
            url = (params.get("url") or [""])[0]
            if not url:
                self._write(400, b"missing url\n")
                return
            if shell_open(url):
                self._write(200, b"opened\n")
            else:
                self._write(500, b"shell_open failed\n")
            return
        self._write(404, b"not found\n")


def serve(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    """Block forever serving opener requests on 127.0.0.1:port."""
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((host, port), _Handler) as srv:
        # Windows console defaults to cp1252; keep prints ASCII-only so the exe
        # console doesn't crash with UnicodeEncodeError.
        print(f"[opener] listening on http://{host}:{port}/  (Ctrl+C to stop)")
        print("[opener] endpoints:")
        print("           GET /health         -> online check")
        print("           GET /open?url=<URL> -> ShellExecute the URL via cmd")
        print("[opener] dashboard.html will fetch this service when an ID is clicked.")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\n[opener] shutting down")


if __name__ == "__main__":
    serve()
