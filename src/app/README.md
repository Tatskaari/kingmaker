# src/app: the playable game

The OpenTUI React terminal app that runs the whole story (docs/design/playable.md): make a character, walk Caerwyn on the isometric map, play the GM-run scenes, fight at the Heron on the map, report to the King, The End.

```sh
npm run game        # node --experimental-ffi --no-warnings --import tsx src/app/main.tsx
```

It needs a real terminal and `OPENROUTER_API_KEY` (or `~/secrets/kingmaker-dev-openrouter.txt`). The world is lit in 24-bit colour: where `COLORTERM` isn't set (macOS Terminal, and ssh doesn't pass it on), OpenTUI falls back to 256 colours and the lamplight goes grey, so set `COLORTERM=truecolor` if the terminal can take it. Saves go under `runs/sessions/<id>/`, and `KM_RUNS_DIR` moves them:

- `game.json`: the game core's save, with the mode, the story, the map (where the player stands, what scenes did to their places) and the fight.
- `state.json`: the runtime's session.
- `app.json`: the app's notebook and messages.

## Playing

| where | keys |
|---|---|
| title | ↑↓ and Enter; Continue resumes the latest game |
| character | Tab between name and concept; Enter; on the sheet, r makes them again |
| explore | arrows or WASD walk (they move with the screen: up is up; the map's north is up-left); e or Enter interact; g walk to the lead (any key stops); c sheet; j notebook; ? help; Esc menu |
| scene | type and press Enter; `#sheet` `#map` `#journal` `#help` `#save` `#quit`; PgUp/PgDn scroll; Esc menu |
| combat | arrows move 5 ft; Tab or 1–9 pick a target; a attack; z close in; c cast (Enter at the target, t on yourself); u knock over a lantern or brazier; d dash; g dodge; x disengage; f let the dice decide; m every option; e end turn; s sheet |
| anywhere | Ctrl+C saves and quits |

For testing, in a scene, `#exits` lists the endings and `#end <id>` takes one now.

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
- the cards between scenes and the notebook (the exit scripts' journal lines);
- the look of each scene and fight: one set of effects and a director, so spells, fires, damage numbers and barks show in the world as they land;
- overlays: the sheet, help, the scene's place on the map (#map), the spell picker, a fight's every option;
- walking to the lead a step at a time;
- the fight's target, and a beat between the other side's turns.

Every action goes through the core by the same action ids the QA console uses (`walk_northeast`, `interact`, `talk_kell`, `attack_crake-1`, `cast_fire-bolt_sallow`, `end_turn`, `continue`). The screens draw from the core's state: the map module's explore state, the scene's world, and the fight's controller.

## Smoke tests

```sh
python3 src/app/smoke/smoke.py                # the real TUI under a pty, the whole arc offline (about 2 min)
python3 src/app/smoke/smoke.py --live         # a real GM turn, quit and resume, #map, a real scene boundary
python3 src/app/smoke/smoke.py --live-fight   # a live-built wizard through to the Heron, casting from the spell picker
KM_RUNS_DIR=runs/app-test OPENROUTER_API_KEY=offline node --no-warnings src/app/smoke/flow.ts   # the core with the map and fights, no UI
KM_RUNS_DIR=runs/app-test node --no-warnings src/app/smoke/caster.ts                            # casting in a fight, headless
```

The offline run uses an invalid API key, so the GM can't speak, and it ends scenes with `#end`. It covers:

- character creation, walking, overlays, and g walking to each lead (across town, through the Rat's door, along the wharves);
- every scene, its place drawn beside the transcript, and the notebook;
- save, quit and Continue (on the map and mid-fight);
- a whole tactical fight on the Heron's floor, the aftermath, the summons, and The End.

Each step's screen is saved under `runs/app-smoke/<run>/`. `smoke/vt.py` is the small VT screen it reads.

`rules-repair.ts` is a stop-gap for a rules-layer bug, and the report proposes the real fix. A spell attack logs the spell's id as `weaponInstanceId`, and the engine then refuses to reload the campaign. The app repairs the campaign after each turn and on resume.
