"""Build the pixel room from the AI-generated source image.

    python3 tools/build.py

Writes room/scene.png, room/hitmap.png, room/chick.png, room/font.json and scene.svg.
"""
import base64
import io
import json
import os

import numpy as np
from PIL import Image, ImageDraw

from font import GLYPHS, draw_text, text_width

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "github_readme.jpg")
CHICK = os.path.join(ROOT, "Easter egg resized.gif")

# The foreground pixels of the source are ~11.47 px wide: 240x134 cells
W, H = 240, 134
PITCH = 2752 / W
X0, Y0 = -0.83, 4.38 - PITCH  # cell boundaries measured on the foreground

INK = (43, 38, 36)  # matte black for every text

# Clickable objects, as polygons on the grid. Ids match room.js.
OBJECTS = {
    1: [(90, 59), (153, 59), (153, 102), (159, 103), (164, 110), (166, 118), (163, 120),
        (81, 120), (78, 117), (81, 108), (86, 103), (90, 102)],                       # laptop
    2: [(41, 90), (64, 90), (64, 95), (69, 95), (70, 104), (66, 107), (71, 109), (70, 114),
        (60, 116), (36, 116), (31, 112), (33, 108), (41, 106)],                       # coffee
    3: [(226, 41), (235, 41), (236, 47), (240, 50), (240, 108), (215, 108), (215, 96),
        (215, 84), (209, 80), (208, 72), (209, 60), (211, 52), (220, 49), (226, 47)],  # plant
    4: [(21, 76), (38, 76), (38, 103), (21, 103)],                                    # candle
    5: [(165, 108), (173, 103), (186, 103), (195, 107), (205, 104), (212, 105), (222, 112),
        (222, 118), (205, 121), (190, 121), (177, 118), (165, 115), (163, 111)],      # book
    6: [(199, 85), (202, 85), (202, 88), (208, 88), (213, 91), (215, 96), (214, 103),
        (210, 107), (195, 107), (191, 104), (190, 97), (192, 91), (196, 88), (199, 88)],  # pumpkin
}

# Window glass with nothing in front of it: where the falling leaves show
GLASS = [
    [(72, 0), (180, 0), (180, 80), (169, 80), (169, 92), (153, 92), (153, 59), (90, 59),
     (90, 92), (72, 92)],
    [(43, 0), (58, 0), (58, 50), (43, 50)],
]

SCREEN = (92, 62, 151, 101)  # laptop screen interior, x0 y0 x1 y1 (exclusive)


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


def hitmap():
    """R = object id, G = 255 where leaves can show through the glass."""
    r = Image.new("L", (W, H), 0)
    for oid, poly in OBJECTS.items():
        ImageDraw.Draw(r).polygon(poly, fill=oid)
    g = Image.new("L", (W, H), 0)
    for poly in GLASS:
        ImageDraw.Draw(g).polygon(poly, fill=255)
    return Image.merge("RGB", (r, g, Image.new("L", (W, H), 0)))


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


def title_pixels():
    """'Hi, it's' / 'Ashley!' centred on the screen; returns pixels + cursor spot."""
    x0, y0, x1, y1 = SCREEN
    lines = ["Hi, it's", "Ashley!"]
    cursor_w = len(GLYPHS["_"][0]) + 1
    top = y0 + (y1 - y0 - 19) // 2 - 3
    pts = []
    cx = (x0 + x1) // 2
    for n, s in enumerate(lines):
        w = text_width(s) + (cursor_w if n == 1 else 0)
        x = cx - w // 2
        draw_text(lambda px, py: pts.append((px, py)), s, x, top + n * 11)
        if n == 1:
            cursor = (x + text_width(s) + 2, top + 11 + 7)
    return pts, cursor


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


LEAF_COLORS = ["#f6c14b", "#f29a38", "#d8452a", "#fbe08a"]
LEAF_VEIN = "#6e2814"
LEAF_FRAMES = [([".##", "#+#", "+.."], ["##.", "#+#", "..+"]), (["##", "++"], [".#.", "#+#", ".+."])]
# x, fall duration (s), delay (s), colour, frames, sway (px)
SVG_LEAVES = [
    (80, 13, 0, 0, 0, 3), (101, 16, -5, 1, 1, 2), (118, 12, -9, 2, 0, 3), (139, 15, -2, 3, 1, 2),
    (158, 14, -11, 0, 1, 3), (172, 17, -7, 2, 0, 2), (47, 11, -4, 1, 0, 2), (92, 18, -14, 3, 1, 3),
]
SVG_SCALE = 6  # the embedded scene is upscaled so it stays crisp without image-rendering


def leaf_rects(shape, color):
    out = []
    for j, row in enumerate(shape):
        for i, c in enumerate(row):
            if c != ".":
                out.append(f'<rect x="{i}" y="{j}" width="1" height="1" fill="{color if c == "#" else LEAF_VEIN}"/>')
    return "".join(out)


def readme_svg(scene, pts, cursor):
    """Animated SVG for the README: GitHub allows CSS animations, not scripts."""
    titled = scene.copy()
    for p in pts:
        titled.putpixel(p, INK)
    big = titled.resize((W * SVG_SCALE, H * SVG_SCALE), Image.NEAREST)
    b64 = base64.b64encode(png_bytes(big)).decode()
    glass = "".join(
        f'<polygon points="{" ".join(f"{x},{y}" for x, y in poly)}"/>' for poly in GLASS)
    css = [
        ".blink{animation:blink 1.06s step-end infinite}",
        "@keyframes blink{50%{opacity:0}}",
        ".a{animation:flip 1.2s step-end infinite}.b{animation:flip 1.2s step-end infinite reverse}",
        "@keyframes flip{0%{opacity:1}50%{opacity:0}}",
    ]
    leaves = []
    for n, (x, dur, delay, col, frames, sway) in enumerate(SVG_LEAVES):
        fall = 100  # px from above the window to below the sill
        css.append(f"@keyframes f{n}{{from{{transform:translate({x}px,-4px)}}to{{transform:translate({x}px,{fall - 4}px)}}}}")
        css.append(f".f{n}{{animation:f{n} {dur}s steps({fall}) {delay}s infinite}}")
        css.append(f"@keyframes s{n}{{to{{transform:translateX({sway}px)}}}}")
        css.append(f".s{n}{{animation:s{n} {dur / 4:.2f}s steps({sway}) {delay}s infinite alternate}}")
        a, b = LEAF_FRAMES[frames]
        c = LEAF_COLORS[col]
        leaves.append(
            f'<g class="f{n}"><g class="s{n}"><g class="a">{leaf_rects(a, c)}</g>'
            f'<g class="b">{leaf_rects(b, c)}</g></g></g>')
    cx, cy = cursor
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W * 3}" height="{H * 3}" '
        f'shape-rendering="crispEdges">'
        f"<title>Hi, it's Ashley! A cozy pixel desk by an autumn window</title>"
        f"<style>{''.join(css)}</style>"
        f'<defs><clipPath id="glass">{glass}</clipPath></defs>'
        f'<image width="{W}" height="{H}" href="data:image/png;base64,{b64}"/>'
        f'<g clip-path="url(#glass)">{"".join(leaves)}</g>'
        f'<rect class="blink" x="{cx}" y="{cy}" width="4" height="1" fill="rgb{INK}"/>'
        f"</svg>"
    )


def main():
    px = snap_to_grid()
    erase_screen_text(px)
    scene = Image.fromarray(px)
    scene.save(os.path.join(ROOT, "room", "scene.png"), optimize=True)
    hitmap().save(os.path.join(ROOT, "room", "hitmap.png"))
    chick_sheet().save(os.path.join(ROOT, "room", "chick.png"))
    with open(os.path.join(ROOT, "room", "font.json"), "w") as f:
        json.dump(GLYPHS, f, separators=(",", ":"))

    pts, cursor = title_pixels()
    with open(os.path.join(ROOT, "room", "title.json"), "w") as f:
        json.dump({"pixels": pts, "cursor": cursor}, f, separators=(",", ":"))

    with open(os.path.join(ROOT, "scene.svg"), "w") as f:
        f.write(readme_svg(scene, pts, cursor))


if __name__ == "__main__":
    main()
