"""Local editor for the pixel room: text size, speech bubbles, object contours, leaf window, pixel colours.

    python3 tools/editor.py            # then open the printed URL

Saving writes room/config.json and rebuilds scene.svg (the README picture) with tools/build.py.
Only listens on 127.0.0.1.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import CONFIG, H, ROOT, W, load_config, save_config  # noqa: E402

LAYERS = {"1", "2", "3", "4", "5", "6", "glass"}


def validate(config):
    """Raise ValueError unless config has the shape build.py and room.js expect."""
    scale = config.get("textScale")
    if not isinstance(scale, (int, float)) or not 0.25 <= scale <= 2:
        raise ValueError("textScale must be a number between 0.25 and 2")
    bubbles = config.get("bubbles")
    if not isinstance(bubbles, dict) or set(bubbles) != LAYERS - {"glass"}:
        raise ValueError("bubbles must have entries 1-6")
    for key, b in bubbles.items():
        for field in ("x", "w", "bottom"):
            if not isinstance(b.get(field), int):
                raise ValueError(f"bubble {key}: {field} must be a whole number")
        anchor = b.get("anchor")
        if not (isinstance(anchor, list) and len(anchor) == 2 and all(isinstance(v, int) for v in anchor)):
            raise ValueError(f"bubble {key}: anchor must be [x, y]")
        if b.get("side") not in (None, "right"):
            raise ValueError(f"bubble {key}: side must be 'right' or absent")
    masks = config.get("masks")
    if not isinstance(masks, dict) or set(masks) != LAYERS:
        raise ValueError("masks must have layers 1-6 and glass")
    for key, runs in masks.items():
        for run in runs:
            if not (isinstance(run, list) and len(run) == 3 and all(isinstance(v, int) for v in run)):
                raise ValueError(f"mask {key}: runs must be [y, x0, x1]")
            y, x0, x1 = run
            if not (0 <= y < H and 0 <= x0 <= x1 < W):
                raise ValueError(f"mask {key}: run {run} is outside the room")
    pixels = config.get("pixels", [])
    if not isinstance(pixels, list):
        raise ValueError("pixels must be a list")
    for p in pixels:
        if not (isinstance(p, list) and len(p) == 3 and all(isinstance(v, int) for v in p[:2])
                and isinstance(p[2], str) and re.fullmatch(r"#[0-9a-f]{6}", p[2])):
            raise ValueError(f'pixels: {p} must be [x, y, "#rrggbb"]')
        if not (0 <= p[0] < W and 0 <= p[1] < H):
            raise ValueError(f"pixels: {p} is outside the room")
    return {"textScale": scale, "bubbles": bubbles, "masks": masks, "pixels": pixels}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.command == "POST":
            super().log_message(fmt, *args)

    def reply(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/save":
            return self.reply(404, {"ok": False, "error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            config = validate(json.loads(self.rfile.read(length)))
        except (ValueError, json.JSONDecodeError) as e:
            return self.reply(400, {"ok": False, "error": str(e)})
        save_config(config)
        build = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build.py")],
                               capture_output=True, text=True)
        if build.returncode:
            return self.reply(500, {"ok": False, "error": "saved, but the rebuild failed:\n" + build.stderr[-2000:]})
        self.reply(200, {"ok": True})


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8017)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not os.path.exists(CONFIG):
        load_config()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=ROOT))
    url = f"http://127.0.0.1:{args.port}/tools/editor/"
    print(f"Room editor: {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
