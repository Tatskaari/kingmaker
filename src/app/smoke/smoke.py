"""
Headless smoke test of the playable game: run the real OpenTUI app under a pseudo-terminal, drive
it with keystrokes and the mouse (xterm's SGR 1006 reports: a click to walk, a right-click menu),
and grep the screen. By default it plays the whole arc offline (an invalid API
key, so the GM can't speak: scenes are ended with the #end testing command), including a save,
quit and Continue, and a full stand-in fight. With --live it plays one real scene turn against
the GM instead.

  python3 src/app/smoke/smoke.py            # offline, the whole story (about a minute)
  python3 src/app/smoke/smoke.py --live     # needs OPENROUTER_API_KEY: one real GM turn, then resume

Screens are dumped to runs/app-smoke/<run>/ for reading afterwards.
"""
import glob
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
from vt import App, KEYS  # noqa: E402

LIVE = "--live" in sys.argv or "--live-fight" in sys.argv
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
    # The input takes nothing while the GM has the floor: wait until it's idle (its placeholder shows).
    app.wait_for(r"Say something or do something", 120)
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
    """plan: 'right*6 down*9' (screen directions: up is up the screen)"""
    for part in plan.split():
        name, _, count = part.partition("*")
        for _ in range(int(count or 1)):
            app.send(KEYS.get(name, name), 0.05)
    app.pump(0.3)


def to_lead(app, what, timeout=40):
    """g: walk to the lead, a step at a time, until its scene opens."""
    keys(app, "g", settle=0.5)
    return expect(app, what, f"g walks to the lead and the scene opens ({what})", timeout=timeout)


# At 130 columns the map's box is everything left of the sidebar.
MAP_COLS = 89


def saved_at():
    """Where the player stands on the map, as the game last saved it: (map, x, y)."""
    for path in glob.glob(os.path.join(ROOT, ENV["KM_RUNS_DIR"], "sessions", "*", "game.json")):
        with open(path) as f:
            ex = json.load(f)["explore"]["ex"]
        return ex["map"], ex["at"]["x"], ex["at"]["y"]
    return None


def on_screen(app, tile):
    """A map tile's cell on screen, from where the player's @ is drawn (the map's projection: column 2(x + y), row y - x)."""
    _, px, py = saved_at()
    mx, my = app.find("@", MAP_COLS)
    dx, dy = tile[0] - px, tile[1] - py
    return mx + 2 * (dx + dy), my + (dy - dx)


def mouse(app):
    """The map by mouse (SGR 1006): point at Kell, click to walk along the lane, right-click for a menu, then talk to Kell from hers."""
    app.point(*app.find("K", MAP_COLS))
    expect(app, r"Sergeant Kell \S+ \d+ +· +click to walk there", "pointing at Kell says who she is and what a click does")
    # A left click on the lane four steps west: the player walks there, a step at a time.
    app.click(*on_screen(app, (38, 8)))
    end = time.time() + 10
    while time.time() < end and saved_at() != ("caerwyn", 38, 8):
        app.pump(0.2)
    dump(app, "left-click-walk")
    if saved_at() != ("caerwyn", 38, 8):
        print(f"FAIL: a left click walks there (the game has the player at {saved_at()})")
        app.close()
        sys.exit(1)
    print("ok: a left click walks there")
    # A right-click on the street: its menu; Esc closes it.
    app.click(*on_screen(app, (36, 8)), button=2)
    expect(app, r"Walk here", "a right-click on the street opens its menu")
    keys(app, "esc")
    if app.wait_for(r"Esc never mind", 0.5):
        print("FAIL: Esc closes the menu")
        app.close()
        sys.exit(1)
    # A right-click on Kell, and a click on what it offers: over to her, and her scene opens.
    app.click(*app.find("K", MAP_COLS), button=2)
    expect(app, r"1 Talk to Sergeant Kell", "a right-click on Kell offers to talk to her")
    app.click(*app.find("Talk to Sergeant Kell"))
    expect(app, r"The Hanged Clerk ·", "choosing it walks over to her and her scene opens", timeout=40)


def fight(app):
    expect(app, r"Initiative", "combat: the initiative tracker", timeout=30)
    expect(app, r"Round \d", "the battlefield is drawn, the round is up")
    for _ in range(200):
        screen = app.text()
        if "Press Enter to see what comes of it" in screen:
            break
        if "Your turn" in screen and "action ready" in screen:
            # Let the dice decide (the fight's own AI plays the player's turn).
            keys(app, "f", settle=0.8)
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
    expect(app, r"Sergeant Kell", "Kell is about")
    expect(app, r"Caerwyn.*The granary lane|The granary lane", "the map: the lane by the granary gate")
    keys(app, "?")
    expect(app, r"How to play", "help overlay")
    keys(app, "esc")
    keys(app, "c")
    expect(app, r"Character sheet.*Skills:", "sheet overlay")
    keys(app, "esc")
    # A step with the arrows: up the screen, then back.
    walk(app, "left right")
    # Then the mouse: a click to walk, a right-click for what to do; Kell's scene opens from hers (g opens the later ones).
    mouse(app)
    expect(app, r"couldn't open the scene", "offline: the GM can't speak (expected)", timeout=40)
    expect(app, r"The yard behind the King", "the scene's place is drawn beside the transcript")
    say(app, "#map")
    expect(app, r"╔═ The yard behind the King's Granary", "#map shows the scene's place")
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
    expect(app, r"The lead:.*Drowned Rat", "resumed on the map, heading for the Rat")

    # Across town, down the river stairs and through the Rat's door, into the Rat: g all the way.
    to_lead(app, r"The Drowned Rat ·", timeout=60)
    app.wait_for(r"couldn't open the scene", 40)
    expect(app, r"The Drowned Rat", "the Rat's place is drawn")
    say(app, "#end hobb-talks")
    expect(app, r"The lead: The Heron Warehouse", "on to the Heron (the wharf interlude skipped)", timeout=60)
    keys(app, "enter")
    expect(app, r"Night", "night on the map")
    to_lead(app, r"The Heron Warehouse ·", timeout=60)
    app.wait_for(r"couldn't open the scene", 40)
    say(app, "#end fight")
    expect(app, r"Roll for initiative!", "Roll for initiative!")
    keys(app, "enter")
    expect(app, r"Initiative", "the fight starts on the Heron's own floor")
    keys(app, "m")
    expect(app, r"Your options", "the fight's options menu")
    keys(app, "esc")
    # Quit mid-fight and Continue: the fight carries on where it was.
    keys(app, "ctrl-c")
    app.pump(2)
    app.close()
    app = launch()
    expect(app, r"Continue.*fighting at The Heron", "Continue offers the fight in progress")
    keys(app, "enter")
    fight(app)
    # The scene picks up from the fight (its aftermath: offline the GM can't tell it), then the
    # King's summons opens the next morning straight away.
    expect(app, r"The Heron Warehouse ·.*The fight:", "after the fight, back to the Heron for its aftermath", timeout=60)
    # The aftermath is a model call (offline it fails): the input takes nothing until it's done.
    expect(app, r"couldn't tell the aftermath", "offline: the GM can't tell the aftermath (expected)", timeout=60)
    say(app, "#end caught-in-the-act")
    expect(app, r"The King's Morning ·", "the King's morning opens straight away (a summons)", timeout=60)
    app.wait_for(r"couldn't move on|Level up|couldn't open", 40)
    # The level-up shows before the opening's call comes back: wait until the input is free again.
    app.wait_for(r"Say something or do something", 40)
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
    to_lead(app, r"The Hanged Clerk ·")
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
    say(app, "#map")
    expect(app, r"╔═ The yard behind the King's Granary", "#map shows the scene's place")
    keys(app, "esc")
    # Across a real scene boundary: the hand-off and the boundary check are real model calls.
    say(app, "#end open-case")
    expect(app, r"The lead: The Drowned Rat", "the story moves on to the Drowned Rat", timeout=120)
    keys(app, "enter")
    to_lead(app, r"The Drowned Rat ·", timeout=60)
    app.wait_for(r"Say something or do something", 150)
    dump(app, "rat-opening")
    keys(app, "ctrl-c")
    app.pump(1)
    app.close()
    print(f"PASS (screens in {OUT})")


def live_fight():
    """A live-built wizard skips through the first two scenes (#end, with real hand-offs), opens the Heron, and casts from the spell picker in the fight."""
    app = launch()
    expect(app, r"Hanged Clerk of Caerwyn", "title screen")
    keys(app, "n")
    expect(app, r"Who are you\?", "character creation")
    app.type("Pell Marrow")
    keys(app, "enter")
    app.type("a Nine Furrows hedge-wizard with a scorched hat, a head full of cantrips and no sense of self-preservation")
    keys(app, "enter")
    expect(app, r"Character sheet.*wizard|Character sheet.*sorcerer|Character sheet.*Spellcasting", "a spellcaster's sheet", timeout=90)
    keys(app, "enter")
    to_lead(app, r"The Hanged Clerk ·")
    app.wait_for(r"Say something or do something", 150)
    say(app, "#end case-made")
    expect(app, r"The lead: The Drowned Rat", "on to the Drowned Rat", timeout=150)
    dump(app, "card-rat")
    keys(app, "enter")
    to_lead(app, r"The Drowned Rat ·", timeout=60)
    app.wait_for(r"Say something or do something", 150)
    say(app, "#end hobb-talks")
    expect(app, r"The lead: The Heron Warehouse", "on to the Heron", timeout=150)
    dump(app, "card-heron")
    keys(app, "enter")
    to_lead(app, r"The Heron Warehouse ·", timeout=60)
    app.wait_for(r"Say something or do something", 150)
    dump(app, "heron-opening")
    say(app, "#end fight")
    expect(app, r"Roll for initiative!", "Roll for initiative!")
    keys(app, "enter")
    expect(app, r"Initiative", "the fight starts")
    expect(app, r"Your turn", "the player's turn", timeout=30)
    keys(app, "c")
    expect(app, r"Cast a spell", "the spell picker")
    dump(app, "spells")
    keys(app, "enter", settle=1.5)
    expect(app, r"You cast ", "a spell is cast at the target", timeout=20)
    dump(app, "cast")
    keys(app, "ctrl-c")
    app.pump(1)
    app.close()
    print(f"PASS (screens in {OUT})")


if __name__ == "__main__":
    live_fight() if "--live-fight" in sys.argv else live() if LIVE else offline()
