"""
Headless smoke test of the look gallery: run the real OpenTUI app under a pseudo-terminal (the
app's VT harness, src/app/smoke/vt.py), check that it draws, that it animates on its own, that the
scripted barks show over the speakers, that keys switch vignettes and glyph sets, and that it quits.
Offline (KM_LOOK_MODEL=off). Screens go to runs/look-smoke/<run>/.

  python3 src/game/look/smoke.py
"""
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "src", "app", "smoke"))
from vt import App  # noqa: E402

RUN = time.strftime("%Y%m%d-%H%M%S")
OUT = os.path.join(ROOT, "runs", "look-smoke", RUN)
os.makedirs(OUT, exist_ok=True)
ARGV = ["node", "--experimental-ffi", "--no-warnings", "--import", "tsx", "src/game/look/gallery.tsx"]
shots = 0


def dump(app, name):
    global shots
    shots += 1
    path = os.path.join(OUT, f"{shots:02d}-{name}.txt")
    with open(path, "w") as f:
        f.write(app.text())
    return path


def expect(app, pattern, what, timeout=20.0):
    m = app.wait_for(pattern, timeout)
    path = dump(app, re.sub(r"[^a-z0-9]+", "-", what.lower()).strip("-")[:40])
    if not m:
        print(f"FAIL: {what} (no /{pattern}/ within {timeout}s; screen in {path})")
        print(app.text())
        app.close()
        sys.exit(1)
    print(f"ok: {what}")


def main():
    app = App(ARGV, ROOT, env={"KM_LOOK_MODEL": "off", "KM_GLYPHS": "ascii"}, cols=140, rows=44)
    expect(app, r"Kingmaker · the look", "the gallery starts")
    expect(app, r"The Drowned Rat, night", "on the Drowned Rat")
    # It animates by itself: two snapshots a moment apart differ (fire, water, smoke).
    a = app.text()
    app.pump(0.7)
    b = app.text()
    changed = sum(1 for x, y in zip(a.splitlines(), b.splitlines()) if x != y)
    if changed < 3:
        print(f"FAIL: the frame didn't animate ({changed} rows changed)")
        sys.exit(1)
    print(f"ok: it animates on its own ({changed} rows changed in 0.7s)")
    expect(app, r"No credit\.", "Nan's bark shows over her")
    app.send("2", 0.5)
    expect(app, r"The granary yard, morning", "key 2: the granary yard")
    expect(app, r"Cob\. Stop that\.", "Kell's bark in the yard")
    app.send("g", 0.5)
    expect(app, r"glyphs: nerd", "g: the nerd glyph set")
    app.send("g", 0.5)
    expect(app, r"glyphs: plain", "g: the plain glyph set")
    app.send("g", 0.3)
    app.send("4", 0.5)
    expect(app, r"Douse and burn", "key 4: douse and burn")
    expect(app, r"Don't step in that", "Kell's warning in the stable yard")
    app.send("5", 0.5)
    expect(app, r"a flock of pigeons.*the rules: pigeon", "key 5: the GM's inventions and how they were decided")
    app.send("t", 0.3)
    expect(app, r"time: morning", "t: time of day override")
    app.send("q", 0.5)
    app.pump(1.0)
    if app.alive:
        print("FAIL: q didn't quit")
        app.close()
        sys.exit(1)
    print(f"ok: q quits. Screens in {OUT}")


if __name__ == "__main__":
    main()
