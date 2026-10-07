"""Standalone PTC Integrity opener — just the HTTP server, no dashboard rendering.

Useful when:
  · Dashboard.html is already generated and served elsewhere (e.g. shared drive,
    intranet web server, file:// open)
  · User only needs the local opener service running so ID clicks can dispatch
    PTC RV&S via OS-level ShellExecute (bypassing browser-level Mimecast
    URL rewriting)

Endpoints (see `dashboard_opener.py`):
  · GET /health         → 200 "opener ok"
  · GET /open?url=<URL> → ShellExecute the URL via cmd

Run as a console process; Ctrl+C to stop.
"""
from __future__ import annotations

import sys

# PyInstaller onefile: __file__ points into the temp extract dir; frozen uses
# the executable's directory instead.
if getattr(sys, "frozen", False):
    sys.path.insert(0, getattr(sys, "_MEIPASS", sys.executable))

from dashboard_opener import serve  # noqa: E402

if __name__ == "__main__":
    serve()
