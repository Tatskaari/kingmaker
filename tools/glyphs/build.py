"""
Build Kingmaker Glyphs: the game's pixel-art people and creatures, drawn by hand as text bitmaps in
assets/glyphs/kingmaker.txt, as a TrueType font a terminal uses like any other.

  python3 tools/glyphs/build.py               # the fonts (assets/fonts/) and the code points (src/game/look/kingmaker-glyphs.ts)
  python3 tools/glyphs/build.py --install     # ... and install the fonts for this user, then fc-cache -f
  python3 tools/glyphs/build.py --uninstall   # remove them again
  python3 tools/glyphs/build.py --check       # read and check the bitmaps, build nothing
  python3 tools/glyphs/build.py --metrics     # compare our cell with the terminal font's (fc-match 'Adwaita Mono')

Building needs fontTools (pip install fonttools, or the python3-fonttools package). Installing doesn't:
without it, --install installs the committed fonts as they are.

How it works. A terminal can't change fonts mid-line, but it falls back, per character, to any
installed font that has a character its own font lacks. So the glyphs live in Unicode's
Supplementary Private Use Area-B, at U+10E000 up, where no Nerd Font (v2 or v3), Font Awesome,
Material Icons, Apple's SF Symbols or any font on a stock Fedora desktop has anything. The game
prints them like letters and colours them like letters; the terminal finds this font for them.

Each glyph sits in one cell: the font has Adwaita Mono's metrics (every advance 600 units of 1000,
the typo ascender 965 and descender -285 with USE_TYPO_METRICS), and every sprite's ink stays
inside them, so nothing is clipped or overhangs. A design pixel is exactly one screen pixel at the
size the game is drawn, Adwaita Mono 11 at 96 dpi (a 14.67-pixel em, so 1000 / 14.67 = 68.18 units),
and the grid is anchored to the baseline, 14 rows above it and 4 below. VTE lays that size out in
9 x 20 cells with the baseline 15 pixels down, so each row and column lands on a whole pixel and no
edge is smeared across two, whatever the renderer's hinting (GTK 4 doesn't snap these). The grid is
9 x 18, and its last column is always blank: the advance is 8.8 pixels, so 8 columns of ink fit
inside it, and the ninth pixel of the cell is the gap that keeps neighbours apart.

Outlines: the ink's boundary is traced into closed contours (clockwise, holes anticlockwise, the
TrueType way) and collinear points merged, so a glyph is a few clean polygons rather than a
rectangle per pixel, and a hinter has no internal seams to snap apart. There's a Bold face with
the same outlines: the game draws beings bold, and without one the terminal would embolden the
Regular face synthetically and smear the pixels.
"""
import argparse
import datetime
import glob
import hashlib
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BITMAPS = os.path.join(ROOT, "assets", "glyphs", "kingmaker.txt")
FONTS = os.path.join(ROOT, "assets", "fonts")
TS = os.path.join(ROOT, "src", "game", "look", "kingmaker-glyphs.ts")
INSTALL = os.path.expanduser(os.path.join(os.environ.get("XDG_DATA_HOME") or "~/.local/share", "fonts", "kingmaker"))

FAMILY = "Kingmaker Glyphs"
VERSION = "1.000"
# Adwaita Mono, Version 34.1.0 (fc-match 'Adwaita Mono'; check with --metrics): one cell is 600 x 1250 units.
UPM, ADVANCE, ASCENT, DESCENT = 1000, 600, 965, -285
HHEA = (965, -215, 70)  # its hhea ascender, descender and line gap, kept for renderers that read those
# One design pixel: one screen pixel at Adwaita Mono 11 and 96 dpi (an em of 11 * 96 / 72 pixels),
# with the grid's row ABOVE at the baseline: 14 rows above it (top at 955 units), 4 below (-273).
PIXEL = UPM / (11 * 96 / 72)
ABOVE = 14
FIRST, LAST = 0x10E000, 0x10EFFF  # our block of Supplementary Private Use Area-B
BUILT = datetime.datetime(2026, 10, 14, tzinfo=datetime.timezone.utc)  # fixed, so builds are reproducible

NAME = re.compile(r"^[a-z][a-z0-9-]*$")


class Glyph:
    def __init__(self, name, code, about, rows, line):
        self.name, self.code, self.about, self.rows, self.line = name, code, about, rows, line

    @property
    def glyph_name(self):
        return "km_" + self.name.replace("-", "_")


def read(path=BITMAPS):
    """The bitmaps file: `grid WxH`, then per glyph a line `name U+10E000 what it is` and H rows of W ('#' ink, '.' blank)."""
    grid, glyphs, errors = None, [], []
    lines = open(path, encoding="utf-8").read().split("\n")
    i = 0
    while i < len(lines):
        raw = lines[i]
        text = raw.split(";", 1)[0].rstrip()
        i += 1
        if not text.strip():
            continue
        m = re.match(r"^grid\s+(\d+)\s*x\s*(\d+)$", text.strip())
        if m:
            grid = (int(m.group(1)), int(m.group(2)))
            continue
        m = re.match(r"^(\S+)\s+U\+([0-9A-Fa-f]{4,6})\s*(.*)$", text.strip())
        if not m:
            errors.append(f"line {i}: expected a glyph header (name U+XXXXXX what it is), got {raw!r}")
            continue
        if not grid:
            errors.append(f"line {i}: the grid (grid WxH) must come before the first glyph")
            break
        name, code, about = m.group(1), int(m.group(2), 16), m.group(3).strip()
        w, h = grid
        rows = [lines[i + k].rstrip() if i + k < len(lines) else "" for k in range(h)]
        for k, row in enumerate(rows):
            if len(row) != w or set(row) - {"#", "."}:
                errors.append(f"line {i + k + 1}: {name}'s row {k} should be {w} of '#' and '.', got {row!r}")
        i += h
        if not NAME.match(name):
            errors.append(f"line {i - h}: name {name!r}: lowercase letters, digits and hyphens")
        if not FIRST <= code <= LAST:
            errors.append(f"line {i - h}: {name} at U+{code:X} is outside U+{FIRST:X}-U+{LAST:X}")
        if not about:
            errors.append(f"line {i - h}: {name} needs a description")
        glyphs.append(Glyph(name, code, about, rows, i - h))
    seen_names, seen_codes = {}, {}
    for g in glyphs:
        if g.name in seen_names:
            errors.append(f"line {g.line}: {g.name} is already drawn at line {seen_names[g.name]}")
        if g.code in seen_codes:
            errors.append(f"line {g.line}: U+{g.code:X} is already {seen_codes[g.code]}")
        if not any("#" in row for row in g.rows):
            errors.append(f"line {g.line}: {g.name} is blank")
        if any(row.endswith("#") for row in g.rows):
            errors.append(f"line {g.line}: {g.name} has ink in the last column, the gap between neighbours: keep it blank")
        seen_names.setdefault(g.name, g.line)
        seen_codes.setdefault(g.code, g.name)
    if not grid:
        errors.append("no grid line (grid WxH)")
    elif (grid[0] - 1) * PIXEL > ADVANCE or ABOVE * PIXEL > ASCENT or (grid[1] - ABOVE) * PIXEL > -DESCENT:
        errors.append(f"a {grid[0]} x {grid[1]} grid doesn't fit the cell at one screen pixel a design pixel (9 x 18 does)")
    return grid, glyphs, errors


def source(glyphs):
    """A fingerprint of what's drawn (not the comments), stamped on the fonts and the code points so tests can tell they match."""
    text = "".join(f"{g.name} {g.code:X} {g.about}\n" + "\n".join(g.rows) + "\n" for g in glyphs)
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def trace(rows):
    """The ink's boundary as closed contours on the pixel lattice (x right, y down from the top-left), ink on the right."""
    h, w = len(rows), len(rows[0])
    ink = lambda r, c: 0 <= r < h and 0 <= c < w and rows[r][c] == "#"
    out = {}
    for r in range(h):
        for c in range(w):
            if not ink(r, c):
                continue
            # Clockwise round the pixel as it's seen (upright): top, right, bottom, left.
            if not ink(r - 1, c):
                out.setdefault((c, r), []).append((c + 1, r))
            if not ink(r, c + 1):
                out.setdefault((c + 1, r), []).append((c + 1, r + 1))
            if not ink(r + 1, c):
                out.setdefault((c + 1, r + 1), []).append((c, r + 1))
            if not ink(r, c - 1):
                out.setdefault((c, r + 1), []).append((c, r))
    contours = []
    while out:
        start = min(out)
        loop, at, heading = [start], start, None
        while True:
            nexts = out[at]
            if len(nexts) > 1 and heading:
                # Pixels touching at a corner: turn right, which keeps to this pixel's own ink.
                right = (-heading[1], heading[0])
                nexts.sort(key=lambda p: (p[0] - at[0], p[1] - at[1]) != right)
            to = nexts.pop(0)
            if not nexts:
                del out[at]
            heading = (to[0] - at[0], to[1] - at[1])
            at = to
            if at == start:
                break
            loop.append(at)
        # Merge straight runs: keep only the corners.
        corners = [p for k, p in enumerate(loop)
                   if (p[0] - loop[k - 1][0], p[1] - loop[k - 1][1]) != (loop[(k + 1) % len(loop)][0] - p[0], loop[(k + 1) % len(loop)][1] - p[1])]
        contours.append(corners)
    return contours


def to_units(point, grid):
    """A lattice point in font units: a design pixel is PIXEL units square, the grid's row ABOVE on the baseline."""
    c, r = point
    return min(round(c * PIXEL), ADVANCE), round((ABOVE - r) * PIXEL)


def outline(rows, grid):
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    pen = TTGlyphPen(None)
    for contour in trace(rows):
        pts = [to_units(p, grid) for p in contour]
        pen.moveTo(pts[0])
        for p in pts[1:]:
            pen.lineTo(p)
        pen.closePath()
    return pen.glyph()


def notdef():
    """The missing-glyph box, a pixel thick, on the sprites' grid (columns 1-6, rows 1-16)."""
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    pen = TTGlyphPen(None)
    x0, x1, y0, y1, t = round(PIXEL), round(7 * PIXEL), round((ABOVE - 17) * PIXEL), round((ABOVE - 1) * PIXEL), round(PIXEL)
    for box in ([(x0, y0), (x0, y1), (x1, y1), (x1, y0)], [(x0 + t, y0 + t), (x1 - t, y0 + t), (x1 - t, y1 - t), (x0 + t, y1 - t)]):
        pen.moveTo(box[0])
        for p in box[1:]:
            pen.lineTo(p)
        pen.closePath()
    return pen.glyph()


def font(grid, glyphs, bold):
    from fontTools.fontBuilder import FontBuilder
    style = "Bold" if bold else "Regular"
    order = [".notdef"] + [g.glyph_name for g in glyphs]
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({g.code: g.glyph_name for g in glyphs})
    fb.setupGlyf({".notdef": notdef(), **{g.glyph_name: outline(g.rows, grid) for g in glyphs}})
    glyf = fb.font["glyf"]
    fb.setupHorizontalMetrics({n: (ADVANCE, getattr(glyf[n], "xMin", 0)) for n in order})
    fb.setupHorizontalHeader(ascent=HHEA[0], descent=HHEA[1], lineGap=HHEA[2])
    fb.setupNameTable({
        "copyright": "Kingmaker Glyphs: drawn for the Kingmaker game",
        "familyName": FAMILY,
        "styleName": style,
        "uniqueFontIdentifier": f"{FAMILY} {style} {VERSION} {source(glyphs)}",
        "fullName": FAMILY if not bold else f"{FAMILY} Bold",
        "version": f"Version {VERSION}",
        "psName": f"KingmakerGlyphs-{style}",
        "description": f"Pixel-art people and creatures for the Kingmaker terminal game, at U+{FIRST:X} up (Supplementary Private Use Area-B). "
                       f"Each fills one terminal cell, with Adwaita Mono's metrics ({ADVANCE} x {ASCENT - DESCENT} of {UPM} units).",
    })
    fb.setupOS2(
        version=4, usWeightClass=700 if bold else 400, usWidthClass=5, fsType=0, achVendID="KMGM",
        fsSelection=(1 << 5 if bold else 1 << 6) | (1 << 7),  # BOLD or REGULAR, and USE_TYPO_METRICS
        sTypoAscender=ASCENT, sTypoDescender=DESCENT, sTypoLineGap=0, usWinAscent=ASCENT, usWinDescent=-DESCENT,
        xAvgCharWidth=ADVANCE, sxHeight=520, sCapHeight=735, usDefaultChar=0, usBreakChar=32, usMaxContext=0,
        panose={"bFamilyType": 2, "bSerifStyle": 0, "bWeight": 8 if bold else 5, "bProportion": 9, "bContrast": 0,
                "bStrokeVariation": 0, "bArmStyle": 0, "bLetterForm": 0, "bMidline": 0, "bXHeight": 0},
    )
    fb.setupPost(isFixedPitch=1, underlinePosition=-50, underlineThickness=50)
    stamp = int((BUILT - datetime.datetime(1904, 1, 1, tzinfo=datetime.timezone.utc)).total_seconds())
    head = fb.font["head"]
    head.created = head.modified = stamp
    head.fontRevision = float(VERSION)
    head.macStyle = 1 if bold else 0
    return fb.font


def write_ts(grid, glyphs, path=TS):
    keys = {g.name: (ts_string(g.name) if "-" in g.name else g.name) + ":" for g in glyphs}
    width = max(len(k) for k in keys.values())
    body = "\n".join(f"  {keys[g.name]:<{width}} [0x{g.code:x}, {ts_string(g.about)}]," for g in glyphs)
    pixels = "\n".join(f"  {keys[g.name]:<{width}} \"{'/'.join(g.rows)}\"," for g in glyphs)
    text = f"""// Generated by tools/glyphs/build.py from assets/glyphs/kingmaker.txt: draw there, then `npm run glyphs:build`.

/**
 * The Kingmaker Glyphs font's vocabulary: pixel-art people and creatures, one terminal cell each, in
 * Unicode's Supplementary Private Use Area-B (U+{FIRST:X} up), which no Nerd Font or other common font
 * uses. A name's code point, and what it is.
 */
export const KINGMAKER_GLYPHS = {{
{body}
}} as const satisfies Record<string, readonly [number, string]>;

export type KingmakerGlyph = keyof typeof KINGMAKER_GLYPHS;

/** The font's family name, for fc-match and checks. */
export const KINGMAKER_FAMILY = "{FAMILY}";

/** A fingerprint of the bitmaps this was built from; the fonts carry it too (in their unique name). */
export const KINGMAKER_SOURCE = "{source(glyphs)}";

/** The bitmaps' grid (columns, rows): one terminal cell. */
export const KINGMAKER_GRID = [{grid[0]}, {grid[1]}] as const;

/** Each sprite's pixels as drawn, rows top to bottom with "/" between ('#' ink): for showing them big without the font. */
export const KINGMAKER_PIXELS: Record<KingmakerGlyph, string> = {{
{pixels}
}};
"""
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != text:
        open(path, "w", encoding="utf-8").write(text)
    return old != text


def ts_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def install(paths):
    os.makedirs(INSTALL, exist_ok=True)
    for p in paths:
        shutil.copy2(p, INSTALL)
    subprocess.run(["fc-cache", "-f"], check=True)
    print(f"installed {len(paths)} fonts in {INSTALL} and refreshed fontconfig (fc-cache -f)")
    found = subprocess.run(["fc-list", f":family={FAMILY}", "family", "style", "file"], capture_output=True, text=True).stdout.strip()
    print(found or "fc-list doesn't see them yet")
    probe = subprocess.run(["fc-match", "-f", "%{family}\n", f"Adwaita Mono:charset={FIRST:x}"], capture_output=True, text=True).stdout.strip()
    print(f"fc-match 'Adwaita Mono:charset={FIRST:x}' -> {probe}")


def uninstall():
    gone = sorted(glob.glob(os.path.join(INSTALL, "KingmakerGlyphs-*.ttf")))
    for p in gone:
        os.remove(p)
    if os.path.isdir(INSTALL) and not os.listdir(INSTALL):
        os.rmdir(INSTALL)
    subprocess.run(["fc-cache", "-f"], check=True)
    print(f"removed {len(gone)} fonts from {INSTALL} and refreshed fontconfig")


def metrics(family="Adwaita Mono"):
    from fontTools.ttLib import TTFont
    path = subprocess.run(["fc-match", "-f", "%{file}", family], capture_output=True, text=True).stdout.strip()
    f = TTFont(path)
    os2, hhea, cmap = f["OS/2"], f["hhea"], f.getBestCmap()
    advances = sorted({f["hmtx"][g][0] for g in f.getGlyphOrder() if f["hmtx"][g][0]})
    theirs = (f["head"].unitsPerEm, advances, os2.sTypoAscender, os2.sTypoDescender, bool(os2.fsSelection & (1 << 7)),
              (hhea.ascent, hhea.descent, hhea.lineGap), (os2.usWinAscent, os2.usWinDescent))
    ours = (UPM, [ADVANCE], ASCENT, DESCENT, True, HHEA, (ASCENT, -DESCENT))
    print(f"{family}: {path}\n  unitsPerEm, advances, typo ascender/descender, USE_TYPO_METRICS, hhea, win:\n  theirs {theirs}\n  ours   {ours}")
    print("  the same cell" if theirs == ours else "  DIFFERENT: update the metrics at the top of build.py and rebuild")
    if 0x2588 in cmap:
        print(f"  their full block's advance: {f['hmtx'][cmap[0x2588]][0]}")
    # Our ink, glyph by glyph, against the cell: on whole pixels at 11 point, and inside the advance and the ascent and descent.
    built = TTFont(os.path.join(FONTS, "KingmakerGlyphs-Regular.ttf"))
    glyf = built["glyf"]
    boxes = [glyf[n] for n in built.getGlyphOrder() if n != ".notdef" and getattr(glyf[n], "numberOfContours", 0)]
    x1, y0, y1 = max(g.xMax for g in boxes), min(g.yMin for g in boxes), max(g.yMax for g in boxes)
    inside = min(g.xMin for g in boxes) >= 0 and x1 <= ADVANCE and y1 <= ASCENT and y0 >= DESCENT
    print(f"  our sprites: a design pixel is {PIXEL:.2f} units, one screen pixel at 11 point and 96 dpi; their ink spans x 0..{x1}, y {y0}..{y1}"
          + (" (inside the cell)" if inside else f" (OUTSIDE the cell: x 0..{ADVANCE}, y {DESCENT}..{ASCENT})"))
    return theirs == ours and inside


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--install", action="store_true", help="install the fonts for this user and refresh fontconfig")
    ap.add_argument("--uninstall", action="store_true", help="remove the installed fonts and refresh fontconfig")
    ap.add_argument("--check", action="store_true", help="read and check the bitmaps only")
    ap.add_argument("--metrics", action="store_true", help="compare our cell with Adwaita Mono's")
    args = ap.parse_args()
    if args.uninstall:
        uninstall()
        return
    if args.metrics:
        sys.exit(0 if metrics() else 1)
    grid, glyphs, errors = read()
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    print(f"{len(glyphs)} glyphs on a {grid[0]} x {grid[1]} grid, U+{min(g.code for g in glyphs):X}-U+{max(g.code for g in glyphs):X}")
    if args.check:
        return
    try:
        import fontTools  # noqa: F401
    except ImportError:
        if not args.install:
            sys.exit("building needs fontTools: pip install fonttools (or the python3-fonttools package)")
        # A machine that only needs the fonts (where the terminal runs): install the committed ones.
        committed = [os.path.join(FONTS, f"KingmakerGlyphs-{style}.ttf") for style in ("Regular", "Bold")]
        stale = [p for p in committed if source(glyphs).encode() not in open(p, "rb").read()]
        print("fontTools isn't installed, so nothing is built: installing the committed fonts as they are"
              + (f" (built from other bitmaps than {os.path.relpath(BITMAPS, ROOT)}: rebuild them where fontTools is)" if stale else ""))
        install(committed)
        return
    os.makedirs(FONTS, exist_ok=True)
    paths = []
    for bold in (False, True):
        path = os.path.join(FONTS, f"KingmakerGlyphs-{'Bold' if bold else 'Regular'}.ttf")
        font(grid, glyphs, bold).save(path)
        paths.append(path)
        print(f"  {os.path.relpath(path, ROOT)} ({os.path.getsize(path)} bytes)")
    print(f"  {os.path.relpath(TS, ROOT)}{' (updated)' if write_ts(grid, glyphs) else ' (unchanged)'}")
    if args.install:
        install(paths)


if __name__ == "__main__":
    main()
