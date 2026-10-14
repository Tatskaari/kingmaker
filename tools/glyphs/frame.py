"""
Draw the look layer's frames as a terminal would: every cell of a dump (dump.ts --json) through
Pango and cairo in "Adwaita Mono 11" at 96 dpi, the stack and the font Ptyxis and other VTE
terminals use, in VTE's 9 x 20 cells, so fontconfig's fallback finds Kingmaker Glyphs for the
sprites exactly as the terminal does. One PNG per frame, and a 2x copy for reading.

  node --no-warnings src/game/look/dump.ts yard --glyphs kingmaker --json runs/glyphs/yard.json --t 2400
  python3 tools/glyphs/frame.py runs/glyphs/yard.json            # runs/glyphs/yard-0.png (and -2x)
  python3 tools/glyphs/frame.py frames.json --font "Adwaita Mono 14" --cell 11x25
"""
import argparse
import json
import os

import cairo
import gi

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Pango, PangoCairo  # noqa: E402


def rgb(hexstr):
    v = int(hexstr.lstrip("#"), 16)
    return ((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255


def draw(frame, font, cell_w, cell_h, baseline):
    w, h = frame["w"], frame["h"]
    surf = cairo.ImageSurface(cairo.FORMAT_RGB24, w * cell_w, h * cell_h)
    cr = cairo.Context(surf)
    layout = PangoCairo.create_layout(cr)
    ctx = layout.get_context()
    PangoCairo.context_set_resolution(ctx, 96)
    opts = cairo.FontOptions()
    opts.set_antialias(cairo.ANTIALIAS_GRAY)
    opts.set_hint_style(cairo.HINT_STYLE_SLIGHT)
    opts.set_hint_metrics(cairo.HINT_METRICS_ON)
    PangoCairo.context_set_font_options(ctx, opts)
    layout.context_changed()
    regular = Pango.FontDescription.from_string(font)
    bold = regular.copy()
    bold.set_weight(Pango.Weight.BOLD)
    for i, (glyph, fg, bg, is_bold) in enumerate(frame["cells"]):
        x, y = (i % w) * cell_w, (i // w) * cell_h
        cr.set_source_rgb(*rgb(bg))
        cr.rectangle(x, y, cell_w, cell_h)
        cr.fill()
        if glyph.strip():
            layout.set_font_description(bold if is_bold else regular)
            layout.set_text(glyph, -1)
            cr.set_source_rgb(*rgb(fg))
            # Each cell on its own, its baseline where VTE puts it: as a terminal's grid, not as text flow.
            cr.move_to(x, y + baseline - layout.get_baseline() / Pango.SCALE)
            PangoCairo.show_layout(cr, layout)
    return surf


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("json")
    ap.add_argument("--font", default="Adwaita Mono 11")
    ap.add_argument("--cell", default="9x20", help="VTE's cell for the font (9x20 for Adwaita Mono 11)")
    ap.add_argument("--baseline", type=int, default=15, help="pixels from the cell's top to the baseline (15 for Adwaita Mono 11)")
    args = ap.parse_args()
    cell_w, cell_h = (int(v) for v in args.cell.split("x"))
    frames = json.load(open(args.json))
    stem = os.path.splitext(args.json)[0]
    for k, frame in enumerate(frames):
        surf = draw(frame, args.font, cell_w, cell_h, args.baseline)
        path = f"{stem}-{k}.png"
        surf.write_to_png(path)
        big = cairo.ImageSurface(cairo.FORMAT_RGB24, surf.get_width() * 2, surf.get_height() * 2)
        cr = cairo.Context(big)
        cr.scale(2, 2)
        cr.set_source_surface(surf)
        cr.get_source().set_filter(cairo.FILTER_NEAREST)
        cr.paint()
        big.write_to_png(f"{stem}-{k}-2x.png")
        print(f"{path} ({frame.get('id', '')} @ {frame.get('t', '')} ms)")


if __name__ == "__main__":
    main()
