"""
Headless smoke test of the playable game: run the real OpenTUI app under a pseudo-terminal, drive
it with keystrokes, and grep the screen. By default it plays the whole arc offline (an invalid API
key, so the GM can't speak: scenes are ended with the #end testing command), including a save,
quit and Continue, and a full stand-in fight. With --live it plays one real scene turn against
the GM instead.

  python3 src/app/smoke/smoke.py            # offline, the whole story (about a minute)
  python3 src/app/smoke/smoke.py --live     # needs OPENROUTER_API_KEY: one real GM turn, then resume

Screens are dumped to runs/app-smoke/<run>/ for reading afterwards.
"""
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
from vt import App, KEYS  # noqa: E402

LIVE = "--live" in sys.argv
RUN = time.strftime("%Y%m%d-%H%M%S")
OUT = os.path.join(ROOT, "runs", "app-smoke", RUN)
os.makedirs(OUT, exist_ok=True)
ENV = {"KM_RUNS_DIR": os.path.join("runs", "app-smoke", RUN, "runs"), "KM_APP_COMBAT_DELAY_MS": "30"}
if not LIVE:
    ENV["OPENROUTER_API_KEY"] = "offline-smoke-test"
ARGV = ["node", "--experimental-ffi", "--no-warnings", "--import", "tsx", "src/app/main.tsx"]
shots = 0


def launch():
    return App(ARGV, ROOT, env=ENV, cols=130, rows=42)


def dump(app, name):
    global shots
    shots += 1
    path = os.path.join(OUT, f"{shots:02d}-{name}.txt")
    with open(path, "w") as f:
        f.write(app.text())
    return path


def expect(app, pattern, what, timeout=30.0):
    m = app.wait_for(pattern, timeout)
    path = dump(app, re.sub(r"[^a-z0-9]+", "-", what.lower()).strip("-")[:40])
    if not m:
        print(f"FAIL: {what} (no /{pattern}/ within {timeout}s; screen in {path})")
        print(app.text())
        app.close()
        sys.exit(1)
    print(f"ok: {what}")
    return m


def keys(app, *names, settle=0.12):
    for n in names:
        app.send(KEYS.get(n, n), settle)


def say(app, text):
    app.type(text, 0.2)
    app.send(KEYS["enter"], 0.3)


def new_game(app, name, concept):
    expect(app, r"Hanged Clerk of Caerwyn", "title screen")
    keys(app, "n")
    expect(app, r"Who are you\?", "character creation")
    app.type(name)
    keys(app, "enter")
    app.type(concept)
    keys(app, "enter")
    expect(app, r"Character sheet.*AC \d+", "the rules engine made a sheet", timeout=90)
    keys(app, "enter")
    expect(app, r"The lead:.*Hanged Clerk", "exploring Caerwyn, the lead is the hanged clerk")


def walk(app, plan):
    """plan: 'right*6 down*9' """
    for part in plan.split():
        name, _, count = part.partition("*")
        for _ in range(int(count or 1)):
            app.send(KEYS.get(name, name), 0.05)
    app.pump(0.3)


def fight(app):
    expect(app, r"Initiative", "combat: the initiative tracker", timeout=30)
    for _ in range(120):
        screen = app.text()
        if "Press Enter to see what comes of it" in screen:
            break
        if "Your turn" in screen and "action ready" in screen:
            keys(app, "a", settle=0.6)
        elif "Your turn" in screen:
            keys(app, "e", settle=0.6)
        else:
            app.pump(0.4)
    expect(app, r"Press Enter to see what comes of it", "the fight is over", timeout=20)
    dump(app, "fight-over")
    keys(app, "enter")


def offline():
    app = launch()
    new_game(app, "Tamsin Vell", "a disgraced palace auditor with a ledger-keeper's eye and a borrowed rapier")
    expect(app, r"Sergeant Agnes Kell", "Kell is about")
    keys(app, "?")
    expect(app, r"How to play", "help overlay")
    keys(app, "esc")
    keys(app, "c")
    expect(app, r"Character sheet.*Skills:", "sheet overlay")
    keys(app, "esc")
    walk(app, "up*2")
    expect(app, r"e Talk to Sergeant Kell", "Kell is in reach at the gate")
    keys(app, "e")
    expect(app, r"The Hanged Clerk ·", "the scene opens")
    expect(app, r"couldn't open the scene", "offline: the GM can't speak (expected)", timeout=40)
    expect(app, r"The yard behind the King", "the scene's world is drawn in the sidebar")
    say(app, "#map")
    expect(app, r"╔═ The yard behind the King's Granary", "#map shows the scene's world")
    keys(app, "esc")
    say(app, "#exits")
    expect(app, r"case-made", "the scene's exits are listed")
    say(app, "#end case-made")
    expect(app, r"The lead: The Drowned Rat", "the story moves on to the Drowned Rat (afternoon skipped)", timeout=60)
    expect(app, r"Your notebook:.*didn't hang himself", "the card shows the notebook line from the exit script")
    keys(app, "enter")
    expect(app, r"Evening", "back on the map, evening")
    keys(app, "j")
    expect(app, r"The investigator's notebook.*The case is made", "the notebook overlay")
    keys(app, "esc")

    # Save, quit, and Continue.
    keys(app, "esc")
    expect(app, r"Save and quit", "menu")
    keys(app, "down", "down", "enter")
    app.pump(2)
    print("ok: quit" if not app.alive else "FAIL: still running after quit")
    app.close()
    app = launch()
    expect(app, r"Continue.*Tamsin Vell", "Continue is offered on the title screen")
    keys(app, "enter")
    expect(app, r"Evening.*The lead:.*Drowned Rat|The lead:.*Drowned Rat", "resumed on the map, heading for the Rat")

    walk(app, "right*6 down*9 right")
    expect(app, r"e Go down into the Drowned Rat", "at the Rat's door")
    keys(app, "e")
    expect(app, r"The Drowned Rat ·", "the Rat opens")
    app.wait_for(r"couldn't open the scene", 40)
    say(app, "#end hobb-talks")
    expect(app, r"The lead: The Heron Warehouse", "on to the Heron (the wharf interlude skipped)", timeout=60)
    keys(app, "enter")
    walk(app, "down*2 right*45 up*2 right")
    expect(app, r"e Try the Heron's land door", "at the Heron's land door")
    keys(app, "e")
    expect(app, r"The Heron Warehouse ·", "the Heron opens")
    app.wait_for(r"couldn't open the scene", 40)
    say(app, "#end fight")
    expect(app, r"Roll for initiative!", "Roll for initiative!")
    keys(app, "enter")
    expect(app, r"Initiative", "the fight starts")
    # Quit mid-fight and Continue: the fight starts again from its setup.
    keys(app, "ctrl-c")
    app.pump(2)
    app.close()
    app = launch()
    expect(app, r"Continue.*fighting at The Heron", "Continue offers the fight in progress")
    keys(app, "enter")
    fight(app)
    expect(app, r"The lead: The King's Morning", "after the fight, on to the King's morning", timeout=60)
    keys(app, "enter")
    expect(app, r"morning of the Assembly", "the next morning")
    walk(app, "left*2 up*11")
    expect(app, r"e Follow the palace page", "the palace page is in reach")
    keys(app, "e")
    expect(app, r"The King's Morning ·", "the King's morning opens")
    app.wait_for(r"couldn't open the scene", 40)
    say(app, "#end justice")
    expect(app, r"How it went", "The End", timeout=60)
    expect(app, r"Hanged Clerk: The case is made", "the epilogue lists the chapters")
    keys(app, "enter")
    expect(app, r"Hanged Clerk of Caerwyn", "back to the title")
    keys(app, "q")
    app.pump(1)
    app.close()
    print(f"PASS (screens in {OUT})")


def live():
    app = launch()
    new_game(app, "Tamsin Vell", "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier")
    walk(app, "up*2")
    expect(app, r"e Talk to Sergeant Kell", "Kell is in reach at the gate")
    keys(app, "e")
    expect(app, r"The Hanged Clerk ·", "the scene opens")
    # The opening narration streams in; when it's done the input is ready again.
    expect(app, r"Kell", "the GM's opening mentions Kell", timeout=90)
    app.wait_for(r"Say something or do something", 120)
    dump(app, "opening")
    say(app, "\"Morning, Sergeant. What have we got?\" I look up at the body, then at the boy with the stones.")
    expect(app, r"The GM", "the turn is under way", timeout=20)
    app.wait_for(r"Say something or do something", 180)
    dump(app, "after-turn")
    text = app.text()
    print("ok: a real GM turn came back" if "Morning, Sergeant" in text else "WARN: the player's line isn't on screen")
    # Quit mid-scene and resume: the transcript comes back.
    keys(app, "ctrl-c")
    app.pump(2)
    app.close()
    app = launch()
    expect(app, r"Continue.*Tamsin Vell", "Continue is offered")
    keys(app, "enter")
    expect(app, r"Morning, Sergeant", "the scene resumes with its transcript", timeout=30)
    dump(app, "resumed")
    keys(app, "ctrl-c")
    app.pump(1)
    app.close()
    print(f"PASS (screens in {OUT})")


if __name__ == "__main__":
    live() if LIVE else offline()
