"""Pixelify Sans, rasterised onto the room's pixel grid (one font pixel = one grid pixel).

Each glyph is 9 rows: 0-6 above the baseline, 7-8 for descenders.
"""
import os

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

FONT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts", "PixelifySans-VariableFont_wght.ttf")
PIXEL = 643 / 7      # cap height (-12..631 units) is 7 font pixels
BASE = -12           # the bottom of the pixel grid in font units
CHARS = "".join(chr(c) for c in range(33, 127)) + "’"


def _contours(glyph_set, name):
    pen = RecordingPen()
    glyph_set[name].draw(pen)
    out, cur = [], []
    for op, args in pen.value:
        if op == "moveTo":
            cur = [args[0]]
        elif op in ("lineTo", "qCurveTo", "curveTo"):
            cur.extend(args)  # pixel fonts only have straight edges
        elif op in ("closePath", "endPath"):
            out.append(cur)
            cur = []
    return out


def _inside(x, y, contours):
    """Non-zero winding test."""
    wind = 0
    for c in contours:
        for (x0, y0), (x1, y1) in zip(c, c[1:] + c[:1]):
            if y0 <= y < y1 and (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0:
                wind += 1
            elif y1 <= y < y0 and (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0:
                wind -= 1
    return wind != 0


def _glyphs():
    font = TTFont(FONT)
    gs, cmap = font.getGlyphSet(), font.getBestCmap()
    out = {}
    for ch in CHARS:
        name = cmap.get(ord(ch))
        if name is None:
            continue
        contours = _contours(gs, name)
        xs = [x for c in contours for x, _ in c]
        if not xs:
            continue
        x0, x1 = min(xs), max(xs)
        cols = max(1, round((x1 - x0) / PIXEL))
        rows = []
        for j in range(9):
            cy = BASE + (6.5 - j) * PIXEL
            rows.append("".join(
                "#" if _inside(x0 + (i + .5) * PIXEL, cy, contours) else "." for i in range(cols)))
        out[ch] = rows
    out[" "] = ["..."] * 9
    return out


GLYPHS = _glyphs()


def text_width(s):
    return sum(len(GLYPHS[c][0]) + 1 for c in s) - 1 if s else 0


def draw_text(put, s, x, y):
    """Calls put(px, py) for every lit pixel; y is the top of the cap height."""
    for c in s:
        g = GLYPHS[c]
        for j, row in enumerate(g):
            for i, ch in enumerate(row):
                if ch == "#":
                    put(x + i, y + j)
        x += len(g[0]) + 1
