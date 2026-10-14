# src/app: the playable game

The OpenTUI React terminal app that runs the whole story (docs/design/playable.md): make a character, walk Caerwyn on the isometric map, play the GM-run scenes, fight at the Heron on the map, report to the King, The End.

```sh
npm run game        # node --experimental-ffi --no-warnings --import tsx src/app/main.tsx
```

It needs a real terminal and `OPENROUTER_API_KEY` (or `~/secrets/kingmaker-dev-openrouter.txt`). Saves go under `runs/sessions/<id>/`, and `KM_RUNS_DIR` moves them:

- `game.json`: the game core's save, with the mode, the story, the map (where the player stands, what scenes did to their places) and the fight.
- `state.json`: the runtime's session.
- `app.json`: the app's notebook and messages.

## Playing

The map is mostly played with the mouse. Click somewhere to walk there, a step at a time, round whatever's in the way (through it, if it's a door; as near as you can get, if you can't); any key or click stops you. Right-click someone or something for what you can do with them: talk, look, go through, step in, walk over. The sidebar's Nearby list works the same way, and the tile under the pointer lights up while the bottom line says what's there. Every key still works.

| where | keys |
|---|---|
| title | ↑↓ and Enter; Continue resumes the latest game |
| character | Tab between name and concept; Enter; on the sheet, r makes them again (or click the buttons) |
| the sheet | ←→, Tab or 1–9 turn its pages (or click a tab); ↑↓, PgUp/PgDn or the wheel scroll a long page; Esc, or a click outside it, puts it away |
| explore | arrows or WASD walk (they move with the screen: up is up; the map's north is up-left); e or Enter interact; g walk to the lead (any key stops); c sheet; j notebook; ? help; Esc menu |
| scene | type and press Enter: plain words are said, `*asterisks*` or `(brackets)` are done; 1–9 (or a click) says one of the GM's suggestions, when there are any; `/sheet` `/map` `/journal` `/help` (any time, even with the GM mid-sentence) `/save` `/quit` (typed, or clicked at the bottom; the old `#sheet` still works); PgUp/PgDn or the wheel scroll; a scene that's over waits for Enter or a click; Esc menu |
| combat | arrows move 5 ft; Tab or 1–9 pick a target; a attack; z close in; c cast (Enter at the target, t on yourself); u knock over a lantern or brazier; d dash; g dodge; x disengage; f let the dice decide; m every option; e end turn; s sheet |
| anywhere | Ctrl+C saves and quits |

For testing, in a scene, `/exits` lists the endings and `/end <id>` takes one now.

### A scene, on screen

- Each exchange is a turn in its own box: the player's line under their name, with a bar down its side, then everything that answered it. The latest turn is the brightest.
- The rules' lines keep the dice (🎲) when there's a roll in them. The rest are news, marked ⓘ in their own colour: what you carry ("You no longer have your javelin"), what's burning, what you are now (`isRoll` in `game.ts` tells them apart).
- When a scene ends, its last reply stays up, and the box becomes the way on: Enter or a click. Into a fight, to the next scene (a summons), to The End, or to whoever walks with the player: Kell reads the notebook's new entry back, says how the time went and where the story goes next, and then it's the map. With nobody walking with you, it's the card.
- The core can offer things to say: actions of kind `say` in scene mode. They're listed over the box, to click or pick with 1–9, and go through as if typed.
- The conversation's scrollbar is laid over a column kept for it (`SCROLLBAR` in `ui/common.tsx`). A scrollbar that takes its own room narrows the text when it first appears, and OpenTUI doesn't re-wrap text already laid out: each line lost its last character under it.

## How it fits together

The app is a view over the game core, `src/game/play.ts`, the same one the headless QA console (`npm run qa`) plays. The core owns the story flow:

- exploring, scenes, fights and The End;
- chaining scenes and skipping interludes (walking the map stands in for them);
- a fight's end, then its aftermath back in its scene;
- the King's summons.

Exploration and fights plug into the core, and the app uses the real modules:

- **`src/game/town.ts`:** the map module's exploration (src/game/map) as the core's Explorer. Its state is the map's `ExploreState`, kept in the game.
- **`src/game/fights.ts`:** tactical combat (src/game/combat) on the scene's own place, with everyone where the scene's world has them.
- **`src/game/views.ts`:** every picture the game draws (the town, a scene's place on the map and from above, a fight), through the look layer (src/game/look): things by the rules, living ground, coloured light, effects. The screens draw them as live canvases, about twelve frames a second.

`game.ts` is the app's controller, and the screens in `ui/` subscribe to it. It adds what a terminal needs:

- the GM's reply streaming in;
- a scene that's over staying up until the player goes on, then the moment between scenes (Kell telling the news, or the card) and the notebook (the exit scripts' journal lines);
- the look of each scene and fight: one set of effects and a director, so spells, fires, damage numbers and barks show in the world as they land;
- overlays: the sheet, help, the scene's place on the map (/map), the spell picker, a fight's every option;
- the character sheet: the rules engine's sheet as data (`sheetData` in src/rules/dnd.ts), laid out for the screen by `ui/sheet-layout.ts` (a page at a time on a small screen, all of it in columns on a big one), with a portrait for each class (`ui/portraits.ts`), shown by `ui/sheet.tsx` after character creation and over the game (c, s, /sheet). In a fight it reads the fight's own campaign, so it's as the fight has left you;
- walking a step at a time, to the lead or wherever you clicked, and the map's right-click menu (what's at a tile: the town explorer's `actionsAt`, picked from what the renderer drew where);
- the fight's target, and a beat between the other side's turns.

Every action goes through the core by the same action ids the QA console uses (`walk_northeast`, `interact`, `talk_kell`, `attack_crake-1`, `cast_fire-bolt_sallow`, `end_turn`, `continue`). The screens draw from the core's state: the map module's explore state, the scene's world, and the fight's controller.

## Smoke tests

```sh
python3 src/app/smoke/smoke.py                # the real TUI under a pty, the whole arc offline (about 2 min)
python3 src/app/smoke/smoke.py --live         # real GM turns, quit and resume, /map, a real scene boundary and Kell after it
python3 src/app/smoke/smoke.py --live-fight   # a live-built wizard through to the Heron, casting from the spell picker
KM_RUNS_DIR=runs/check node --experimental-ffi --no-warnings --import tsx src/app/smoke/scene-check.tsx   # the scene screens at 80 to 160 columns: every character drawn
KM_RUNS_DIR=runs/app-test OPENROUTER_API_KEY=offline node --no-warnings src/app/smoke/flow.ts   # the core with the map and fights, no UI
KM_RUNS_DIR=runs/app-test node --no-warnings src/app/smoke/caster.ts                            # casting in a fight, headless
```

The offline run uses an invalid API key, so the GM can't speak, and it ends scenes with `/end`. It covers:

- character creation, walking, overlays, and g walking to the later leads (across town, through the Rat's door, along the wharves);
- the mouse, as xterm reports it (SGR 1006): pointing at Kell, a click that walks, a right-click menu closed with Esc, and Kell's scene opened from hers;
- every scene, its place drawn beside the transcript, the slash commands (and one old `#`), clicks on the way on, a command and outside an overlay;
- each scene staying up once it's over, Kell telling the news between scenes, and the notebook;
- save, quit and Continue (on the map and mid-fight);
- a whole tactical fight on the Heron's floor, the aftermath, the summons, and The End.

Each step's screen is saved under `runs/app-smoke/<run>/`. `smoke/vt.py` is the small VT screen it reads, and sends the keys and the mouse with.

`rules-repair.ts` is a stop-gap for a rules-layer bug, and the report proposes the real fix. A spell attack logs the spell's id as `weaponInstanceId`, and the engine then refuses to reload the campaign. The app repairs the campaign after each turn and on resume.
