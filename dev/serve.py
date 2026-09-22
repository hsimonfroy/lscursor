#!/usr/bin/env python3
"""Local dev server: `python3 dev/serve.py [port]`, then open http://127.0.0.1:8777/.

Same as `python3 -m http.server`, plus `Cache-Control: no-cache`. The stock
server sends no caching headers, so a browser (VS Code's built-in one in
particular) may keep reusing an ES module it already has, and an edit under
src/ does not show up on reload. no-cache makes every request revalidate, which
costs a 304 when nothing changed.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    root = Path(__file__).resolve().parent.parent
    handler = partial(NoCacheHandler, directory=str(root))
    print(f"serving {root} at http://127.0.0.1:{port}/ (no-cache)")
    ThreadingHTTPServer(("", port), handler).serve_forever()
