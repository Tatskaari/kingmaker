# src/app: the playable game

The OpenTUI React terminal app that runs the whole story (docs/design/playable.md): make a character, walk Caerwyn, play the GM-run scenes, fight at the Heron, report to the King, The End.

```sh
npm run game        # node --experimental-ffi --no-warnings --import tsx src/app/main.tsx
```

It needs a real terminal and `OPENROUTER_API_KEY` (or `~/secrets/kingmaker-dev-openrouter.txt`). Saves go under `runs/sessions/<id>/`, and `KM_RUNS_DIR` moves them:

- `game.json`: the game core's save, with the mode, the story, where the player stands and the fight.
- `state.json`: the runtime's session.
- `app.json`: the app's notebook and messages.

## Playing

| where | keys |
|---|---|
| title | ↑↓ and Enter; Continue resumes the latest game |
| character | Tab between name and concept; Enter; on the sheet, r makes them again |
| explore | arrows or WASD walk; e or Enter interact; c sheet; j notebook; ? help; Esc menu |
| scene | type and press Enter; `#sheet` `#map` `#journal` `#help` `#save` `#quit`; PgUp/PgDn scroll; Esc menu |
| combat | arrows move 5 ft; a attack; c cast; d dash; g dodge; x disengage; e end turn; Tab or 1–9 pick a target; s sheet |
| anywhere | Ctrl+C saves and quits |

For testing, in a scene, `#exits` lists the endings and `#end <id>` takes one now.

## How it fits together

The app is a view over the game core, `src/game/play.ts`. The core owns the story flow:

- exploring, scenes, fights and The End;
- chaining scenes and skipping interludes;
- a fight's aftermath back in its scene;
- the King's summons.

`game.ts` is the app's controller, and the screens in `ui/` subscribe to it. It adds what a terminal needs: the GM's reply streaming in, the cards between scenes, the notebook (the exit scripts' journal lines), overlays, and pacing for the fight.

Exploration and fights plug into the core:

- **`explorer.ts`:** `mapExplorer(maps)`, an `Explorer` over a `MapAdapter`.
- **`fights.ts`:** `tacticalFights(combat, maps)`, a `FightFactory` over a `CombatAdapter`.

Both speak action ids (`go_north`, `talk_kell`, `enter_rat_door`, `attack_crake-1`, `cast_fire-bolt@crake-1`, `end_turn`), so the headless QA console can play the same map and fights through `observe()`.

`adapters.ts` is the seam with the modules being built alongside: `MapAdapter` for src/game/map, and `CombatAdapter` / `CombatController` for src/game/combat. The stand-ins in `standins/` implement them for now:

- **Map stand-in:** one top-down town map with the four places as regions, who's about at each time of day, and the scene's world drawn small.
- **Combat stand-in:** initiative, walking on the grid, and blows from the rules engine. The player's attacks and spells go through `src/rules/dnd.ts`; NPC blows use the same engine.

Swapping a real module in is its line at the bottom of `adapters.ts`. `story.ts` builds the fight's line-up from the scene's present cast:

- a group's `members` stand with its leader (the Crakes with Sallow);
- children keep out of it;
- Kell is an ally.

## Smoke tests

```sh
python3 src/app/smoke/smoke.py                # the real TUI under a pty, the whole arc offline (about 90 s)
python3 src/app/smoke/smoke.py --live         # a real GM turn, quit and resume, #map, a real scene boundary
python3 src/app/smoke/smoke.py --live-fight   # a live-built wizard through to the Heron, casting from the spell picker
KM_RUNS_DIR=runs/app-test OPENROUTER_API_KEY=offline node --no-warnings src/app/smoke/flow.ts   # explorer + fights under the core, no UI
KM_RUNS_DIR=runs/app-test node --no-warnings src/app/smoke/caster.ts                            # casting in a fight, headless
```

The offline run uses an invalid API key, so the GM can't speak, and it ends scenes with `#end`. The run covers character creation, walking, overlays, every scene, the notebook, save, quit and Continue (on the map and mid-fight), a full stand-in fight, the aftermath, the summons, and The End. Each step's screen is saved under `runs/app-smoke/<run>/`. `smoke/vt.py` is the small VT screen it reads.

`rules-repair.ts` is a stop-gap for a rules-layer bug, and the report proposes the real fix. A spell attack logs the spell's id as `weaponInstanceId`, and the engine then refuses to reload the campaign. The app repairs the campaign after each turn, after each spell in a fight, and on resume.
