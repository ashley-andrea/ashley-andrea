"""Build the pixel room from the AI-generated source image.

    python3 tools/build.py

Writes room/scene.png, room/chick.png, room/font.json, room/anim.json and scene.svg.
Object contours, the leaf window, bubble boxes and the text size live in room/config.json:
edit them with `python3 tools/editor.py` (it is created from the defaults below if missing).
"""
import base64
import io
import json
import math
import os
import random

import numpy as np
from PIL import Image

from font import GLYPHS, draw_text, text_width

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "github_readme.jpg")
CHICK = os.path.join(ROOT, "Easter egg resized.gif")

# The foreground pixels of the source are ~11.47 px wide: 240x134 cells
W, H = 240, 134
PITCH = 2752 / W
X0, Y0 = -0.83, 4.38 - PITCH  # cell boundaries measured on the foreground

INK = (43, 38, 36)  # matte black for every text

CONFIG = os.path.join(ROOT, "room", "config.json")

# Default contours of the clickable objects, traced row by row: y -> (first x, last x).
# Ids match room.js.
def _rows(*spans):
    out = {}
    for y0, y1, x0, x1 in spans:
        for y in range(y0, y1 + 1):
            out[y] = (x0, x1)
    return out


DEFAULT_MASKS = {
    1: _rows((59, 59, 90, 150), (60, 60, 89, 151), (61, 104, 89, 152),            # laptop
             (105, 105, 87, 153), (106, 106, 87, 154), (107, 107, 86, 154), (108, 108, 85, 155),
             (109, 109, 84, 156), (110, 110, 83, 158), (111, 111, 82, 159), (112, 112, 81, 160),
             (113, 113, 80, 161), (114, 114, 80, 162), (115, 115, 80, 163), (116, 117, 80, 164),
             (118, 118, 81, 162)),
    2: _rows((91, 91, 44, 63), (92, 92, 43, 64), (93, 104, 43, 70), (105, 105, 43, 68),  # coffee
             (106, 106, 44, 66), (107, 107, 44, 65), (108, 108, 37, 71), (109, 110, 36, 71),
             (111, 112, 35, 71), (113, 113, 34, 71), (114, 114, 34, 70), (115, 115, 34, 67),
             (116, 116, 33, 64), (117, 117, 34, 62), (118, 118, 36, 58)),
    3: _rows((42, 43, 229, 232), (44, 47, 227, 234), (48, 49, 224, 236), (50, 50, 219, 239),  # plant
             (51, 52, 216, 239), (53, 54, 212, 239), (55, 57, 213, 239), (58, 60, 211, 239),
             (61, 64, 213, 239), (65, 67, 210, 239), (68, 69, 208, 239), (70, 73, 211, 239),
             (74, 78, 207, 239), (79, 81, 209, 239), (82, 84, 211, 239), (85, 106, 214, 239)),
    4: _rows((76, 104, 21, 37)),                                                     # candle
    5: _rows((106, 106, 184, 197), (107, 107, 176, 201), (108, 108, 171, 205),        # book
             (109, 109, 168, 209), (110, 110, 165, 213), (111, 111, 165, 216), (112, 112, 165, 219), (113, 113, 165, 220),
             (114, 114, 165, 221), (115, 116, 166, 221), (117, 117, 168, 220), (118, 118, 171, 219),
             (119, 119, 175, 205), (120, 120, 178, 201), (121, 121, 182, 197)),
    6: _rows((84, 84, 200, 201), (85, 88, 200, 202), (89, 89, 197, 205), (90, 90, 194, 209),  # pumpkin
             (91, 91, 192, 211), (92, 92, 191, 212), (93, 101, 190, 212), (102, 102, 191, 212),
             (103, 103, 192, 211), (104, 104, 193, 210), (105, 105, 196, 208)),
}

# Window panes (x0, x1 inclusive, down to the sill); leaves only show here,
# minus whatever stands in front of the glass
PANES = [(45, 64), (68, 176), (186, 191)]
SILL = 92                       # last row of glass above the window sill
CANDLE_RIGHT = (169, 81, 186, 102)  # x0 y0 x1 y1, the jar in front of the glass

SCREEN = (92, 62, 151, 101)  # laptop screen interior, x0 y0 x1 y1 (exclusive)

# Speech bubbles: box left edge, width and bottom edge; the tail points at `anchor`
# (from the bottom, or from the right side for side: "right").
DEFAULT_BUBBLES = {
    "1": {"anchor": [121, 59], "x": 26, "w": 190, "bottom": 54},
    "2": {"anchor": [50, 89], "x": 4, "w": 150, "bottom": 84},
    "3": {"anchor": [209, 64], "x": 54, "w": 150, "bottom": 92, "side": "right"},
    "4": {"anchor": [29, 75], "x": 3, "w": 160, "bottom": 70},
    "5": {"anchor": [184, 105], "x": 24, "w": 172, "bottom": 100},
    "6": {"anchor": [202, 86], "x": 80, "w": 156, "bottom": 81},
}


def snap_to_grid():
    im = np.asarray(Image.open(SRC).convert("RGB")).astype(float)
    out = np.zeros((H, W, 3), np.uint8)
    for j in range(H):
        for i in range(W):
            x0, y0 = X0 + i * PITCH, Y0 + j * PITCH
            # sample the cell interior so neighbouring cells don't bleed in
            xa, xb = int(max(0, x0 + PITCH * .25)), int(min(im.shape[1], x0 + PITCH * .75))
            ya, yb = int(max(0, y0 + PITCH * .25)), int(min(im.shape[0], y0 + PITCH * .75))
            if yb <= ya:
                ya, yb = 0, 4
            out[j, i] = np.median(im[ya:yb, xa:xb].reshape(-1, 3), axis=0)
    return out


def erase_screen_text(px):
    """Paint over the yellow 'Hi, it's Ashley!' by interpolating each column."""
    x0, y0, x1, y1 = SCREEN
    region = px[y0:y1, x0:x1].astype(int)
    r, g, b = region[..., 0], region[..., 1], region[..., 2]
    text = (r > 150) & (g > 130) & (g - b > 60) & (g > .62 * r)
    # grow by one cell: the glyph edges are blended into the background
    grown = text.copy()
    grown[1:] |= text[:-1]; grown[:-1] |= text[1:]
    grown[:, 1:] |= text[:, :-1]; grown[:, :-1] |= text[:, 1:]
    for i in range(grown.shape[1]):
        col = grown[:, i]
        if not col.any():
            continue
        ys = np.where(~col)[0]
        for c in range(3):
            region[col, i, c] = np.interp(np.where(col)[0], ys, region[ys, i, c])
    px[y0:y1, x0:x1] = region.astype(np.uint8)


def erase_steam(px):
    """Remove the painted coffee steam: it is redrawn animated by the page/SVG."""
    x0, y0, x1, y1 = 47, 50, 72, 92
    reg = px[y0:y1, x0:x1].astype(int)
    steam = np.zeros(px.shape[:2], bool)
    steam[y0:y1, x0:x1] = (reg[..., 0] > 165) & (reg[..., 1] > 95) & (reg[..., 2] > 55)
    src = px.copy()
    for y in range(y0, y1):
        for x in range(x0, x1):
            if not steam[y, x]:
                continue
            if x > 66:  # the house: continue it from the right
                xx = x
                while steam[y, xx]:
                    xx += 1
                px[y, x] = src[y, xx]
                continue
            # the bushes in the left pane: copy their texture sideways
            alt = [xx for xx in (x - 6, x - 12, x - 18) if xx >= 45 and not steam[y, xx]] if x < 64 else []
            if alt:
                px[y, x] = src[y, alt[0]]
            else:  # the window frame: continue it from above
                yy = y
                while steam[yy, x]:
                    yy -= 1
                px[y, x] = src[yy, x]


def default_glass():
    g = np.zeros((H, W), bool)
    for x0, x1 in PANES:
        g[:SILL + 1, x0:x1 + 1] = True
    for rows in DEFAULT_MASKS.values():  # nothing standing in front of the window
        for y, (x0, x1) in rows.items():
            g[y, x0:x1 + 1] = False
    cx0, cy0, cx1, cy1 = CANDLE_RIGHT
    g[cy0:cy1 + 1, cx0:cx1 + 1] = False
    return g


def to_runs(mask):
    """Boolean grid -> [[y, x0, x1], ...] with inclusive ends."""
    runs = []
    for y in range(H):
        x = 0
        while x < W:
            if mask[y, x]:
                x0 = x
                while x < W and mask[y, x]:
                    x += 1
                runs.append([y, x0, x - 1])
            x += 1
    return runs


def from_runs(runs):
    mask = np.zeros((H, W), bool)
    for y, x0, x1 in runs:
        mask[y, x0:x1 + 1] = True
    return mask


def load_config():
    """room/config.json, created from the defaults the first time."""
    if os.path.exists(CONFIG):
        with open(CONFIG) as f:
            return json.load(f)
    masks = {}
    for oid, rows in DEFAULT_MASKS.items():
        m = np.zeros((H, W), bool)
        for y, (x0, x1) in rows.items():
            m[y, x0:x1 + 1] = True
        masks[str(oid)] = to_runs(m)
    masks["glass"] = to_runs(default_glass())
    config = {"textScale": 1, "bubbles": DEFAULT_BUBBLES, "masks": masks}
    save_config(config)
    return config


def save_config(config):
    """One run per line keeps the file readable in diffs."""
    lines = ["{", f'  "textScale": {json.dumps(config["textScale"])},',
             f'  "bubbles": {json.dumps(config["bubbles"])},', '  "masks": {']
    keys = list(config["masks"])
    for n, key in enumerate(keys):
        runs = ",\n      ".join(json.dumps(r) for r in config["masks"][key])
        lines.append(f'    "{key}": [\n      {runs}\n    ]' + ("," if n < len(keys) - 1 else ""))
    lines += ["  }", "}"]
    with open(CONFIG, "w") as f:
        f.write("\n".join(lines) + "\n")


def chick_sheet():
    """The easter egg chick is 16px pixel art: sample one cell per pixel."""
    gif = Image.open(CHICK)
    cw, ch = 26, 32
    sheet = Image.new("RGBA", (cw * gif.n_frames, ch), (0, 0, 0, 0))
    for f in range(gif.n_frames):
        gif.seek(f)
        a = np.asarray(gif.convert("RGBA"))
        frame = np.zeros((ch, cw, 4), np.uint8)
        for j in range(ch):
            for i in range(cw):
                y, x = 8 + j * 16, int(6.5 + i * 16)
                if y < a.shape[0] and x < a.shape[1]:
                    frame[j, i] = a[y, x]
        frame[..., 3] = np.where(frame[..., 3] > 127, 255, 0)
        sheet.paste(Image.fromarray(frame), (f * cw, 0))
    return sheet


def title_layout(p):
    """'Hi, it's' / 'Ashley!_' centred on the laptop screen, for text pixel size p.
    Returns the lit pixels' top-left corners and the cursor rectangle. Mirrors room.js."""
    x0, y0, x1, y1 = SCREEN
    snap = lambda v: math.floor(v / p + 1e-9) * p
    top = snap(y0 + (y1 - y0 - 19 * p) / 2 - 3 * p)
    cx = (x0 + x1) / 2
    pts, cursor = [], None
    for n, line in enumerate(["Hi, it's", "Ashley!"]):
        w = (text_width(line) + (6 if n else 0)) * p
        x = snap(cx - w / 2)
        y = top + n * 11 * p
        draw_text(lambda i, j: pts.append((x + i * p, y + j * p)), line, 0, 0)
        if n:
            cursor = (x + (text_width(line) + 2) * p, y + 7 * p, 4 * p, p)
    return pts, cursor


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


# ---- animations, shared with room.js through room/anim.json ----
# Both the page and the SVG step them at 10 ticks per second, so they look the same.
TPS = 10
LEAF_COLORS = ["#f6c14b", "#f29a38", "#d8452a", "#fbe08a"]
LEAF_VEIN = "#6e2814"
# tumble frames, 4 ticks each; "#" = leaf colour, "+" = vein
LEAF_SHAPES = [[".##", "#+#", "+.."], ["...", "###", "++."], ["##.", "#+#", "..+"], [".#.", "#+#", ".+."]]
LEAF_SPIN = 4
# where leaves let go of the trees
LEAF_SPAWNS = [(74, 24), (84, 12), (97, 33), (112, 42), (128, 38), (146, 16), (158, 30),
               (170, 10), (176, 40), (50, 20), (58, 36), (189, 22)]
STEAM = {"wisps": [[50, 0.0], [56, 2.4]], "top": 48, "bottom": 90, "ticks": 40,
         "color": "#fff0de", "alphas": [0.85, 0.6, 0.35]}


def make_leaves():
    rnd = random.Random(7)
    leaves = []
    cycle = LEAF_SPIN * len(LEAF_SHAPES)
    for x, y in LEAF_SPAWNS:
        vy = rnd.uniform(5, 7.5)
        fall = (SILL + 1 - y) / vy * TPS
        period = math.ceil((fall + rnd.uniform(20, 90)) / cycle) * cycle  # ticks, whole tumbles
        leaves.append({
            "x": x, "y": y, "vy": round(vy, 2), "amp": round(rnd.uniform(1.5, 3), 2),
            "freq": round(rnd.uniform(0.9, 1.4), 2), "phase": round(rnd.uniform(0, 6.28), 2),
            "drift": round(rnd.uniform(-0.15, 0.3), 2), "period": period,
            "offset": rnd.randrange(period), "color": LEAF_COLORS[rnd.randrange(len(LEAF_COLORS))],
        })
    return leaves


ANIM = {"tps": TPS, "leaves": make_leaves(), "leafShapes": LEAF_SHAPES, "leafSpin": LEAF_SPIN,
        "leafVein": LEAF_VEIN, "sill": SILL, "steam": STEAM}


def leaf_at(leaf, k):
    """Top-left pixel of the leaf sprite and its tumble frame at local tick k, or None."""
    tau = k / TPS
    y = leaf["y"] + leaf["vy"] * tau
    if y > SILL + 0.5:
        return None
    x = leaf["x"] + leaf["drift"] * tau + leaf["amp"] * math.sin(leaf["freq"] * tau + leaf["phase"])
    return math.floor(x + 0.5) - 1, math.floor(y + 0.5) - 1, (k // LEAF_SPIN) % len(LEAF_SHAPES)


def steam_at(k):
    """Steam pixels at tick k: {(x, y): alpha index}. Puffs rise and sway up each wisp."""
    st = STEAM
    s = 2 * math.pi * (k % st["ticks"]) / st["ticks"]
    out = {}
    for wx, ph in st["wisps"]:
        for y in range(st["top"], st["bottom"] + 1):
            h = (st["bottom"] - y) / (st["bottom"] - st["top"])  # 0 at the cup, 1 at the top
            env = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(0.33 * y + 2 * s + ph * 1.7))
            env *= 1 - 0.75 * h ** 1.5
            if env < 0.2:
                continue
            cx = wx + 5 * h + (0.6 + 2.4 * h) * math.sin(0.19 * y + s + ph)
            half = 0.6 + 1.6 * env
            for x in range(math.floor(cx - half + 0.5), math.floor(cx + half + 0.5) + 1):
                a = env * (1 - 0.45 * abs(x - cx) / half)
                level = 0 if a > 0.62 else 1 if a > 0.4 else 2 if a > 0.18 else None
                if level is not None and level < out.get((x, y), 3):
                    out[(x, y)] = level
    return out


SVG_SCALE = 7  # shown at 3.5 css px per pixel = 7 device px on retina screens
SVG_WIDTH = 840


def _run_path(cells):
    """Pixels -> one path of 1-px-tall rectangles."""
    return "".join(f"M{x} {y}h{w}v1h-{w}z" for x, y, w in cells)


def _runs(pixels):
    """Merge pixels into horizontal runs (x, y, width)."""
    out = []
    for x, y in sorted(pixels, key=lambda p: (p[1], p[0])):
        if out and out[-1][1] == y and out[-1][0] + out[-1][2] == x:
            out[-1] = (out[-1][0], y, out[-1][2] + 1)
        else:
            out.append((x, y, 1))
    return out


def _shape_path(shape, kind):
    return _run_path([(i, j, 1) for j, row in enumerate(shape) for i, c in enumerate(row) if c == kind])


def readme_svg(scene, config):
    """Animated SVG for the README: GitHub allows CSS animations, not scripts."""
    big = scene.resize((W * SVG_SCALE, H * SVG_SCALE), Image.NEAREST)
    b64 = base64.b64encode(png_bytes(big)).decode()
    runs = [(x0, y, x1 - x0 + 1) for y, x0, x1 in config["masks"]["glass"]]
    p = config["textScale"]
    pts, cursor = title_layout(p)
    title = "".join(f"M{x:g} {y:g}h{p:g}v{p:g}h-{p:g}z" for x, y in pts)

    css = [
        ".blink{animation:blink 1.06s step-end infinite}@keyframes blink{50%{opacity:0}}",
        "g,path{animation-timing-function:step-end;animation-iteration-count:infinite}",
    ]
    n = len(LEAF_SHAPES)
    for s in range(n):  # tumble frame s is visible for a quarter of the cycle
        lo, hi = 100 * s / n, 100 * (s + 1) / n
        frames = [f"0%{{opacity:{1 if s == 0 else 0}}}"]
        if s:
            frames.append(f"{lo:g}%{{opacity:1}}")
        frames.append(f"{hi:g}%{{opacity:0}}")
        css.append(f"@keyframes t{s}{{{''.join(frames)}}}")
        css.append(f".t{s}{{animation-name:t{s};animation-duration:{LEAF_SPIN * n / TPS}s}}")

    leaves = []
    for i, leaf in enumerate(ANIM["leaves"]):
        period = leaf["period"]
        keys, last = [], object()
        for k in range(period):
            pos = leaf_at(leaf, k)
            xy = pos[:2] if pos else (-9, -9)
            if xy != last:
                keys.append(f"{100 * k / period:.3f}%{{transform:translate({xy[0]}px,{xy[1]}px)}}")
                last = xy
        css.append(f"@keyframes l{i}{{{''.join(keys)}}}")
        delay = f"-{leaf['offset'] / TPS}s"
        shapes = "".join(
            f'<g class="t{s}" style="animation-delay:{delay}">'
            f'<path fill="{leaf["color"]}" d="{_shape_path(sh, "#")}"/>'
            f'<path fill="{LEAF_VEIN}" d="{_shape_path(sh, "+")}"/></g>'
            for s, sh in enumerate(LEAF_SHAPES))
        leaves.append(
            f'<g style="animation-name:l{i};animation-duration:{period / TPS}s;animation-delay:{delay}">'
            f"{shapes}</g>")

    ticks = STEAM["ticks"]
    css.append(f"@keyframes fr{{0%{{opacity:1}}{100 / ticks:g}%{{opacity:0}}}}")
    css.append(f".fr{{opacity:0;animation-name:fr;animation-duration:{ticks / TPS}s}}")
    steam = []
    for k in range(ticks):
        cells = steam_at(k)
        paths = "".join(
            f'<path fill="{STEAM["color"]}" fill-opacity="{a}" '
            f'd="{_run_path(_runs([xy for xy, lv in cells.items() if lv == level]))}"/>'
            for level, a in enumerate(STEAM["alphas"]))
        steam.append(f'<g class="fr" style="animation-delay:{(k - ticks) / TPS:g}s">{paths}</g>')

    cx, cy, cw, ch = cursor
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{SVG_WIDTH}" '
        f'height="{round(SVG_WIDTH * H / W)}" shape-rendering="crispEdges">'
        f"<title>Hi, it's Ashley! A cozy pixel desk by an autumn window</title>"
        f"<style>{''.join(css)}</style>"
        f'<defs><clipPath id="glass"><path d="{_run_path(runs)}"/></clipPath></defs>'
        f'<image width="{W}" height="{H}" href="data:image/png;base64,{b64}"/>'
        f'<g clip-path="url(#glass)">{"".join(leaves)}</g>'
        f'{"".join(steam)}'
        f'<path fill="rgb{INK}" d="{title}"/>'
        f'<rect class="blink" x="{cx:g}" y="{cy:g}" width="{cw:g}" height="{ch:g}" fill="rgb{INK}"/>'
        f"</svg>"
    )


def main():
    px = snap_to_grid()
    erase_screen_text(px)
    erase_steam(px)
    scene = Image.fromarray(px)
    scene.save(os.path.join(ROOT, "room", "scene.png"), optimize=True)
    chick_sheet().save(os.path.join(ROOT, "room", "chick.png"))
    with open(os.path.join(ROOT, "room", "font.json"), "w") as f:
        json.dump(GLYPHS, f, separators=(",", ":"))

    with open(os.path.join(ROOT, "room", "anim.json"), "w") as f:
        json.dump(ANIM, f, separators=(",", ":"))

    with open(os.path.join(ROOT, "scene.svg"), "w") as f:
        f.write(readme_svg(scene, load_config()))


if __name__ == "__main__":
    main()
