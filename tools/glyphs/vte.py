"""
Draw every sprite through a real VTE terminal (GTK 4's Vte, the widget Ptyxis is built on) and check
that each lands on whole pixels exactly as drawn: no soft edges, nothing out of place.

  python3 tools/glyphs/vte.py                  # Adwaita Mono 11 and 22: runs/glyphs/vte-11.png, vte-22.png
  python3 tools/glyphs/vte.py --sizes 11,12    # other sizes (multiples of 11 are pixel-exact, the rest soft)

It runs the terminal inside a private headless mutter with its own D-Bus session, so nothing touches
the desktop, and uses the installed font (npm run glyphs) through fontconfig, as the terminal does.
Needs mutter and PyGObject with Gtk 4.0 and Vte 3.91 (on Fedora: mutter, python3-gobject,
vte291-gtk4). Exits 1 if a sprite is soft or misplaced at a size that's a multiple of 11 point.
"""
import argparse
import json
import os
import signal
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "runs", "glyphs")
PER_LINE = 16
INK = (232, 225, 205)


def sheet(glyphs):
    """The vocabulary, PER_LINE sprites a line with a space between, a blank line between lines, white on black."""
    lines = []
    for i in range(0, len(glyphs), PER_LINE):
        lines.append("\x1b[38;2;232;225;205m" + " ".join(chr(g.code) for g in glyphs[i:i + PER_LINE]) + "\x1b[0m")
        lines.append("")
    return "\r\n".join(lines), PER_LINE * 2, len(lines)


def inside(job_path):
    """In the headless compositor: one terminal per size, fed the sheet, snapshotted to a PNG."""
    import gi
    gi.require_version("Gtk", "4.0")
    gi.require_version("Gdk", "4.0")
    gi.require_version("Vte", "3.91")
    gi.require_version("Graphene", "1.0")
    from gi.repository import Gdk, GLib, Graphene, Gtk, Pango, Vte
    jobs = json.load(open(job_path))
    done = []

    def run(i):
        if i == len(jobs):
            json.dump(done, open(job_path, "w"))
            os.kill(os.getppid(), signal.SIGTERM)  # mutter, which would otherwise outlive us
            return False
        job = jobs[i]
        win = Gtk.Window(decorated=False)
        term = Vte.Terminal()
        term.set_font(Pango.FontDescription.from_string(job["font"]))
        term.set_size(job["cols"], job["rows"])
        black, white = Gdk.RGBA(), Gdk.RGBA()
        black.parse("#000000")
        white.parse("#ffffff")
        term.set_colors(white, black, None)
        term.set_cursor_blink_mode(Vte.CursorBlinkMode.OFF)
        win.set_child(term)
        win.present()
        term.feed(b"\x1b[?25l\x1b[H\x1b[2J" + job["text"].encode())

        def snap():
            paintable = Gtk.WidgetPaintable.new(term)
            w, h = paintable.get_intrinsic_width(), paintable.get_intrinsic_height()
            snapshot = Gtk.Snapshot.new()
            paintable.snapshot(snapshot, w, h)
            texture = term.get_native().get_renderer().render_texture(snapshot.to_node(), Graphene.Rect().init(0, 0, w, h))
            texture.save_to_png(job["out"])
            cw, ch = term.get_char_width(), term.get_char_height()
            done.append({**job, "cell": [cw, ch], "pad": [(w - job["cols"] * cw) // 2, (h - job["rows"] * ch) // 2]})
            win.destroy()
            GLib.timeout_add(50, run, i + 1)
            return False

        GLib.timeout_add(700, snap)
        return False

    loop = GLib.MainLoop()
    GLib.timeout_add(200, run, 0)
    loop.run()


def check(job, glyphs):
    """Each sprite's cell against its bitmap: pixels between 12% and 88% of the ink are soft; ink where none is drawn, or none where it is, misplaced."""
    from PIL import Image
    img = Image.open(job["out"]).convert("L")
    (cw, ch), (px, py) = job["cell"], job["pad"]
    k = max(1, round(job["size"] / 11))  # screen pixels a design pixel (whole only at multiples of 11 point)
    full = sum(INK) / 3
    best = None
    for top in range(0, 4):  # pixel rows above the grid's first row (the baseline's place in the cell varies with the size)
        soft = wrong = ink = 0
        for n, g in enumerate(glyphs):
            x0, y0 = px + (n % PER_LINE) * 2 * cw, py + (n // PER_LINE) * 2 * ch
            for y in range(ch):
                for x in range(cw):
                    v = img.getpixel((x0 + x, y0 + y)) / full
                    r, c = (y - top) // k if y >= top else -1, x // k
                    want = 0 <= r < len(g.rows) and c < len(g.rows[0]) and g.rows[r][c] == "#"
                    ink += want
                    if 0.12 < v < 0.88:
                        soft += 1
                    elif (v >= 0.88) != want:
                        wrong += 1
        if best is None or soft + wrong < best[0] + best[1]:
            best = (soft, wrong, ink, top)
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--sizes", default="11,22")
    ap.add_argument("--inside", help=argparse.SUPPRESS)
    args = ap.parse_args()
    if args.inside:
        inside(args.inside)
        return
    sys.path.insert(0, HERE)
    from build import read
    grid, glyphs, errors = read()
    if errors:
        sys.exit("\n".join(errors))
    os.makedirs(OUT, exist_ok=True)
    text, cols, rows = sheet(glyphs)
    jobs = [{"font": f"Adwaita Mono {s}", "size": int(s), "cols": cols, "rows": rows, "text": text, "out": os.path.join(OUT, f"vte-{s}.png")} for s in args.sizes.split(",")]
    job_path = os.path.join(OUT, "vte-jobs.json")
    json.dump(jobs, open(job_path, "w"))
    env = {k: v for k, v in os.environ.items() if k != "DISPLAY"}
    env["GDK_BACKEND"] = "wayland"
    cmd = ["dbus-run-session", "--", "mutter", "--headless", "--wayland", "--no-x11", "--wayland-display", f"km-glyphs-{os.getpid()}",
           "--virtual-monitor", "2560x1440", "--", sys.executable, os.path.abspath(__file__), "--inside", job_path]
    try:
        subprocess.run(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    except FileNotFoundError as e:
        sys.exit(f"can't run the terminal: {e.filename} isn't installed (needs mutter and dbus-run-session)")
    except subprocess.TimeoutExpired:
        sys.exit("the headless terminal didn't finish in 180 s")
    done = json.load(open(job_path))
    os.remove(job_path)
    if not done or "cell" not in done[0]:
        sys.exit("the terminal drew nothing (needs PyGObject with Gtk 4.0 and Vte 3.91)")
    exact = []
    for job in done:
        soft, wrong, ink, top = check(job, glyphs)
        cw, ch = job["cell"]
        print(f"{job['font']}: cells {cw} x {ch}, {len(glyphs)} sprites, {ink} pixels of ink: {soft} soft, {wrong} misplaced -> {os.path.relpath(job['out'], ROOT)}")
        if job["size"] % 11 == 0:
            exact.append(soft == 0 and wrong == 0)
    if exact:
        print("every sprite lands on whole pixels, as drawn" if all(exact) else "soft or misplaced pixels at a multiple of 11 point: see the PNGs")
    sys.exit(0 if all(exact) else 1)


if __name__ == "__main__":
    main()
