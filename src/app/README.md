# src/app: the playable game

The OpenTUI React terminal app that runs the whole story (docs/design/playable.md): make a character, walk Caerwyn, play the GM-run scenes, fight at the Heron, report to the King, The End.

```sh
npm run game        # node --experimental-ffi --no-warnings --import tsx src/app/main.tsx
```

It needs a real terminal and `OPENROUTER_API_KEY` (or `~/secrets/kingmaker-dev-openrouter.txt`). Saves go under `runs/sessions/<id>/`: the runtime's `state.json`, plus the app's `app.json` (mode, position, story, notebook). `KM_RUNS_DIR` moves them, and `KM_APPROACH` picks the runtime approach (default `v2`).

## Playing

| where | keys |
|---|---|
| title | ↑↓ and Enter; Continue resumes the latest save |
| explore | arrows or WASD walk; e or Enter interact; c sheet; j notebook; ? help; Esc menu |
| scene | type and press Enter; `#sheet` `#map` `#journal` `#help` `#save` `#quit`; PgUp/PgDn scroll; Esc menu |
| combat | arrows move 5 ft; a attack; c cast; d dash; g dodge; x disengage; e end turn; Tab or 1–9 pick a target; s sheet |
| anywhere | Ctrl+C saves and quits |

For testing, in a scene, `#exits` lists the endings and `#end <id>` takes one now (`forceEnding`).

## The story flow

`story.ts` holds it, with no UI: `newGame` (`createSession` at level 3), `beginScene` (`openScene`), `takeTurn` (`playerTurn`, then the background co-GM and memory review, as the scene CLI spawns them), and `moveOn`. When a scene ends, `moveOn` either hands over to combat, or chains on (`chainScene`), ending interludes at once (`forceEnding(state, "onward")` and chain again), or reports The End. The lead is `state.sceneId`, and the time of day follows from it. `combatSetup` builds the fight from the present cast: Sallow's group becomes Sallow and the two Crakes, Hep's becomes her porters, Kell is an ally, and everyone else is neutral.

`game.ts` is the controller the screens subscribe to. It holds the screen, the session, the position, the transcript and the streaming reply, the fight, the cards between scenes, the notebook, and the saves. The screens are in `ui/`.

## The seam with the map and combat modules

The app talks to the map and combat modules only through `adapters.ts`. These are `MapAdapter` (start, maps, who's about, step, nearby, reachable, regions, scene locations, after-scene position, render, `sceneView` for a scene's world, the battlefield) and `CombatAdapter` / `CombatController` (start, view, options, act, advance, result, actors). The stand-ins in `standins/` implement them:

- **Map stand-in:** one top-down town map with the four places as regions, and who's about at each time of day.
- **Combat stand-in:** initiative, walking on the grid, and blows from the rules engine. The player's attacks and spells go through `src/rules/dnd.ts`; NPC blows use the same engine.

To swap a real module in, change its line at the bottom of `adapters.ts`.

## Smoke tests

```sh
python3 src/app/smoke/smoke.py            # the real TUI under a pty, the whole arc offline (about 70 s)
python3 src/app/smoke/smoke.py --live     # one real GM turn, quit and resume, a real scene boundary
KM_RUNS_DIR=runs/app-test node --no-warnings src/app/smoke/flow.ts   # the story flow and stand-ins, no UI
```

The offline run uses an invalid API key, so the GM can't speak, and it ends scenes with `#end`. The run covers character creation, walking, overlays, every scene, the notebook, save, quit and Continue (on the map and mid-fight), a full stand-in fight, and The End. Each step's screen is saved under `runs/app-smoke/<run>/`. `smoke/vt.py` is the small VT screen that reads it.
