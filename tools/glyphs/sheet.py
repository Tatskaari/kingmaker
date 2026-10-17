"""
Contact sheets of Kingmaker Glyphs, for drawing them and checking them (PNGs in runs/glyphs/):

  python3 tools/glyphs/sheet.py            # all of them
  python3 tools/glyphs/sheet.py bitmaps    # just one (bitmaps, sheet, pango)

- bitmaps.png: the bitmaps exactly as drawn, big, for drawing (no font involved).
- sheet-1x.png, sheet-3x.png: each glyph drawn with the built font (web/fonts/) at the real cell
  size (Adwaita Mono 11 at 96 dpi: a 9 x 20 cell, the baseline 15 pixels down, as VTE lays it out)
  and at three times that, with its name beside it in Adwaita Mono, so glyphs and letters compare.
- pango-1x.png, pango-3x.png: lines of text in "Adwaita Mono 11" rendered by Pango and cairo, the
  stack Ptyxis and every VTE terminal draw with, so fontconfig's fallback picks the installed font
  for the glyphs exactly as the terminal will, with GTK 4's font rendering (grayscale, no hinting:
  it doesn't snap outlines to pixels, so a sheet that hints would look crisper than the terminal).
  Needs the font installed (npm run glyphs), and PyGObject with Pango and pycairo.
"""
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from build import FONTS, read  # noqa: E402

OUT = os.path.join(ROOT, "runs", "glyphs")
INK, PAPER, DIM, GRID = (232, 225, 205), (14, 13, 18), (138, 130, 115), (40, 37, 48)
# Adwaita Mono 11 at 96 dpi, as VTE measures it: a 14.67 px em; cells 9 x 20, the baseline 15 down.
EM, CELL_W, CELL_H, BASELINE = 11 * 96 / 72, 9, 20, 15
COLOURS = [(109, 158, 235), (240, 138, 93), (242, 209, 107), (232, 177, 90), (224, 122, 176), (155, 227, 107), (199, 155, 242), (217, 194, 126)]


def mono():
    return subprocess.run(["fc-match", "-f", "%{file}", "Adwaita Mono"], capture_output=True, text=True).stdout.strip()


def bitmaps(grid, glyphs, scale=6, cols=10):
    """The bitmaps as drawn, each pixel a scale x scale block on a faint grid, named underneath."""
    w, h = grid
    label = ImageFont.truetype(mono(), 11)
    cw, ch = w * scale + 14, h * scale + 26
    rows = (len(glyphs) + cols - 1) // cols
    img = Image.new("RGB", (cols * cw + 10, rows * ch + 10), PAPER)
    d = ImageDraw.Draw(img)
    for k, g in enumerate(glyphs):
        x0, y0 = 10 + (k % cols) * cw, 10 + (k // cols) * ch
        for r in range(h):
            for c in range(w):
                on = g.rows[r][c] == "#"
                d.rectangle([x0 + c * scale, y0 + r * scale, x0 + (c + 1) * scale - 2, y0 + (r + 1) * scale - 2], fill=COLOURS[k % len(COLOURS)] if on else GRID)
        d.text((x0, y0 + h * scale + 4), g.name[:12], font=label, fill=DIM)
    return img


def sheet(grid, glyphs, k=1, cols=4):
    """Each glyph with the font at k times the real cell size, its name beside it in Adwaita Mono."""
    ours = ImageFont.truetype(os.path.join(FONTS, "KingmakerGlyphs-Regular.ttf"), EM * k)
    letters = ImageFont.truetype(mono(), EM * k)
    cw, chh, base = CELL_W * k, CELL_H * k, BASELINE * k
    name_cells = 15
    entry = cw * (name_cells + 3)
    rows = (len(glyphs) + cols - 1) // cols
    top = chh * 3
    img = Image.new("RGB", (cols * entry + cw, top + rows * chh + chh), PAPER)
    d = ImageDraw.Draw(img)
    # A line of letters and glyphs together, the way a map row mixes them.
    line = "".join(chr(g.code) for g in glyphs)
    x = cw
    for i, ch in enumerate(line):
        d.rectangle([x, chh, x + cw - 1, chh * 2 - 1], fill=GRID if i % 2 else PAPER)
        d.text((x, chh + base), ch, font=ours, fill=COLOURS[i % len(COLOURS)], anchor="ls")
        x += cw
        if x > img.width - 2 * cw:
            break
    d.text((cw, base), "K H N c m T A D S G s $ C @ ☻ ☺ d r v f u g", font=letters, fill=DIM, anchor="ls")
    for i, g in enumerate(glyphs):
        x0, y0 = cw + (i % cols) * entry, top + (i // cols) * chh
        d.rectangle([x0, y0, x0 + cw - 1, y0 + chh - 1], fill=GRID)
        d.text((x0, y0 + base), chr(g.code), font=ours, fill=COLOURS[i % len(COLOURS)], anchor="ls")
        d.text((x0 + cw * 2, y0 + base), g.name[:name_cells], font=letters, fill=INK, anchor="ls")
    return img


def pango(glyphs, k=1, size=11):
    """Text through Pango and cairo with fontconfig's fallback, as a VTE terminal draws it."""
    import cairo
    import gi
    gi.require_version("Pango", "1.0")
    gi.require_version("PangoCairo", "1.0")
    from gi.repository import Pango, PangoCairo
    lines = []
    per = 6
    for i in range(0, len(glyphs), per):
        lines.append("  ".join(f"{chr(g.code)} {g.name[:14]:<14}" for g in glyphs[i:i + per]))
    lines.append("")
    lines.append("On the cobbles: ,.,'" + "".join(chr(g.code) for g in glyphs[:24]) + ".,'.,")
    lines.append("Letters, then glyphs: K H N c m T A D S G s $ C ♔ M @ ☻ ☺")
    lines.append("                      " + " ".join(chr(g.code) for g in glyphs[:16]))
    width, height = 1400, (len(lines) + 2) * 20
    surf = cairo.ImageSurface(cairo.FORMAT_RGB24, width, height)
    cr = cairo.Context(surf)
    cr.set_source_rgb(*(v / 255 for v in PAPER))
    cr.paint()
    layout = PangoCairo.create_layout(cr)
    ctx = layout.get_context()
    PangoCairo.context_set_resolution(ctx, 96)
    # As GTK 4 draws text (font rendering "automatic"): grayscale, and no hinting to snap outlines to pixels.
    opts = cairo.FontOptions()
    opts.set_antialias(cairo.ANTIALIAS_GRAY)
    opts.set_hint_style(cairo.HINT_STYLE_NONE)
    opts.set_hint_metrics(cairo.HINT_METRICS_OFF)
    PangoCairo.context_set_font_options(ctx, opts)
    layout.context_changed()
    layout.set_font_description(Pango.FontDescription.from_string(f"Adwaita Mono {size}"))
    cr.set_source_rgb(*(v / 255 for v in INK))
    for i, text in enumerate(lines):
        layout.set_text(text, -1)
        cr.move_to(10, 10 + i * CELL_H)
        PangoCairo.show_layout(cr, layout)
    # Which font Pango picked for the first glyph: the proof of the fallback.
    layout.set_text(chr(glyphs[0].code), -1)
    run = layout.get_line(0).runs[0]
    picked = run.item.analysis.font.describe().to_string()
    img = Image.frombuffer("RGBA", (width, height), bytes(surf.get_data()), "raw", "BGRA", 0, 1).convert("RGB")
    used = max(x for x in range(width) if any(img.getpixel((x, y)) != PAPER for y in range(0, height, 3))) + 12
    img = img.crop((0, 0, min(width, used), height))
    if k > 1:
        img = img.resize((img.width * k, img.height * k), Image.NEAREST)
    return img, picked


def main():
    which = set(sys.argv[1:]) or {"bitmaps", "sheet", "pango"}
    grid, glyphs, errors = read()
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    os.makedirs(OUT, exist_ok=True)
    out = []
    if "bitmaps" in which:
        bitmaps(grid, glyphs).save(p := os.path.join(OUT, "bitmaps.png"))
        out.append(p)
    if "sheet" in which:
        for k in (1, 3):
            sheet(grid, glyphs, k).save(p := os.path.join(OUT, f"sheet-{k}x.png"))
            out.append(p)
    if "pango" in which:
        img, picked = pango(glyphs)
        img.save(p := os.path.join(OUT, "pango-1x.png"))
        out.append(p)
        img.resize((img.width * 3, img.height * 3), Image.NEAREST).save(p := os.path.join(OUT, "pango-3x.png"))
        out.append(p)
        print(f"Pango drew U+{glyphs[0].code:X} with: {picked}")
    for p in out:
        print(os.path.relpath(p, ROOT))


if __name__ == "__main__":
    main()
