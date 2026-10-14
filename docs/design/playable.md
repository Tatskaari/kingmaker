# The playable PoC: investigate, unmask the villain, fight him

**Goal:** a classic D&D experience in the terminal, end to end. You make a character, walk around Caerwyn on an isometric ASCII map, and talk to people. Interactions open GM-run scenes. You investigate the hanged clerk and work out that Master Sallow is behind it. You corner him at the Heron warehouse, roll for initiative, and fight him and his bruisers on the map. Then you report to the King. Have fun with it: the comic house style applies to the UI too.

## Gameplay principles

From the user's notes ([Kingmaker gameplay.txt](../Kingmaker%20gameplay.txt)):
- **Emergent, not scripted.** Use systemic actions that work everywhere, in and out of combat: jump, throw, shove, ignite, douse, spill. Don't build snowflake mechanics.
- **The world reacts.** An illegal act (Fireball in a crowded tavern) starts a reaction, a hybrid of rules and AI: some people flee, some fight, and the watch is called. If anyone fights, combat starts.
- **Objects interact, BG3-style.**
  - Materials decide what burns: metal burns out, a barrel burns down.
  - Surfaces (water, oil, spirits, blood, smoke, steam) combine: Fireball on an oil slick makes a burning puddle, and water puts fire out.
  - The stage manager's language and the map use the same world services.
- **Narration takes effect in the world.**
  - A brutal kill leaves blood.
  - A bucket of water over a burning table leaves it scorched, wet and standing in a pool of water.
  - Characters stay within what the world can show.

## Stack

- **Terminal UI:** OpenTUI's React renderer (`@opentui/core`, `@opentui/react`; V1's test CLI used it).
  - Run with `node --experimental-ffi --no-warnings --import tsx src/app/main.tsx`.
  - JSX: `"jsx": "react-jsx"`, `"jsxImportSource": "@opentui/react"` (already in tsconfig).
  - OpenTUI needs a real TTY. To smoke-test headlessly, spawn it under a pseudo-terminal (Python `pty.fork()`) and grep the output.
- **Rules:** `src/rules/dnd.ts` over the vendored dnd-srd-engine. It covers the sheet, checks, spells, attacks, rests and levels. NPC stats come from SRD statblocks via `Character.statblock` on cast cards. The engine also has encounters, initiative and movement; see `vendor/dnd-srd-engine/README.md` and https://github.com/greghcarr/dnd-srd-engine (docs/tutorial.md, docs/api-overview.md).
- **Combat turns:** boardgame.io (installed; headless `Client` from `boardgame.io/client`), with the dnd engine resolving every roll inside moves.
- **Scenes:** `src/runtime/engine.ts`.
  - `createSession`, `openScene`, `playerTurn` (streams through `TurnHooks`) and `chainScene`. Each scene boundary writes a hand-off, skips scenes the story has overtaken, and records `state.adjustments`.
  - Scenes live in `scenes/*.ts`. The arc is `hanged-clerk` → (`caerwyn-afternoon`) → `drowned-rat` → (`wharf-night`) → `heron-warehouse` → `kings-morning`. The two in brackets are interludes: in the playable game, walking the map replaces them.
- **Scene world:** `src/world/scene-world.ts` is an entity tree (place > areas > things and people, in feet) with object stats, states, notes and spatial selectors. `src/world/stage.ts` keeps it in step with each GM reply. A scene with a `world` spec gets `state.world` when it opens. Worlds exist for `hanged-clerk` and `drowned-rat`.

## Modules (one owner each)

| module | owner | exports (the contract) |
|---|---|---|
| `src/game/map/` | map agent | Tile maps for the town and the scene interiors (granary yard, Drowned Rat, Heron, palace) with `regions` that name their scene; exploration (move, look, interact, nearby); an **isometric ASCII renderer** returning styled lines; reconciliation between a scene's `SceneWorld` (feet) and the map region it's in (5 ft per tile) |
| `src/game/combat/` | combat agent | `startCombat(setup)` → a controller over a boardgame.io headless game: initiative, movement on the tile grid (walls and cover from the map), attack, cast, dash, dodge, disengage, end turn; NPC AI; hazards (fire in grain dust explodes); `result()` for the story |
| `src/app/` | app agent | `main.tsx`: the OpenTUI app and game loop. Modes: character creation, **explore** (map + sidebar), **scene** (dialogue: streaming GM text, dice lines, input), **combat** (map + initiative + actions + log), sheet overlay; save/load |
| `docs/research/gm-world-interface.md`, `evals/world/` | research agent | How the GM reads and updates the scene world (operations vs tool calls vs code; what to disclose and when); an accuracy eval for the stage manager; concrete recommendations and small patches |
| `src/runtime`, `src/rules`, `src/world`, `scenes/`, `prompts/` | integrator (main session) | Don't edit these from a feature branch except for small, clearly separable additions. Put anything bigger in your report as a proposal. |

## Shared types

The shared types are in `src/game/types.ts`. Extend them if you must, but keep their meaning.

## Story flow in the app

1. **Character creation.** Name and concept, then `createSession({ sceneId: "hanged-clerk", approach: "v2", player, level: 3 })`. The rules engine builds the sheet.
2. **Explore (morning).** The player starts in the lane by the granary gate. Kell waits inside the yard. Interacting with her (or stepping into the yard) opens `hanged-clerk`.
3. **The scene ends.** Call `chainScene`, which sets `state.sceneId` to the next scene that holds. If that is an interlude, the map replaces it: end it and chain again (`forceEnding(state, "onward")`, then `chainScene`). Then return the player to the map with the next scene's location marked as the lead. The scene opens when the player interacts with its trigger there. `openScene` places people and things in its world.
4. **Combat.** A scene ending with `exit.kind === "combat"` (the Heron's "Roll for initiative!") hands over to combat mode. Combatants are the scene's present cast with statblocks, Sallow's group expanded into Sallow and the two Crakes, and Kell as an ally if present. The result string feeds `chainScene(state, combatResult)` and on to `kings-morning`.
5. **The End.** After `kings-morning` closes, show an epilogue screen.

**Times of day:**
- **morning:** granary;
- **evening:** the Rat;
- **night:** the wharves and the Heron;
- **next morning:** the palace.

The map can show the time and who is about. Keep it simple.

## How it's wired (integrate/playable)

One story loop, `src/game/play.ts`, under both the app and the QA console (`npm run qa`):

- **Exploring:** `src/game/town.ts` puts the map module's exploration behind the loop's Explorer. Its state is the map's ExploreState, kept in the game. The loop calls `enterScene` as a scene opens, `leaveScene` before `chainScene` drops the world, and `afterScene` once the story has moved on.
- **Fights:** `src/game/fights.ts` runs tactical combat on the scene's own place. `battlefield()` lays out the scene's world for it: everyone where the world has them, its lights to knock over, its dusty floor and what burns, and its doors as the world has them. After the fight, the world shows where everyone ended up and what burned. A fight's end is its own beat (`continue`), and then the scene's aftermath picks up.
- **Pictures:** `src/game/views.ts` draws the town, a scene's place and a fight through the map's isometric renderer. The look layer plugs in there.
- **The King's morning** is a summons: it opens straight after the Heron, with no walk to the palace.

## Ground rules

- Node 26. No new runtime dependencies without a reason in your report.
- In a worktree, symlink `node_modules` from the main checkout (`ln -s /home/jon/git/kingmaker/node_modules node_modules`).
- Typecheck with `node_modules/.bin/tsc --noEmit -p .`.
- Commit your work on your own branch, `spike/<name>`, with clear messages. Keep the repo's style: small modules, comments that explain why, outcome-oriented prompts.
- LLM calls go through `src/llm/openrouter.ts` (the key is in `OPENROUTER_API_KEY`). The models are Luna (`openai/gpt-6-luna`) with reasoning "none" for speed, and Luna decisions for classification.
- Never print or commit the API key.
