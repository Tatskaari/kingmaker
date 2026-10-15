# src/game/combat: tactical fights

Part of the [architecture overview](../../../ARCHITECTURE.md). Where fights are going (on the same world and interaction rules as scenes; boardgame.io kept for fights only) is in [docs/design/productionise.md](../../../docs/design/productionise.md#the-order-of-work).

## What it is

Roll for initiative and fight it out on the map, a turn at a time. A fight is a [boardgame.io](https://boardgame.io) game run headless in the same process: one player per combatant, in the order the rules engine rolled, with a move for everything a combatant can do on their turn. Every roll and every rule the engine keeps (initiative, whose turn it is, movement, attacks, spells, saves, damage, conditions, death saves, opportunity attacks) is the vendored engine's. This module adds the board around them: 5 ft tiles, paths, line of sight and cover, spell areas on tiles and range checks, the hazards (grain dust, fire, lanterns and the brazier), the AI that plays everyone else, the flavour, and the hand-back to the story.

The rules decisions (what a diagonal costs, who rolls death saves, when Sallow yields, what the dust does) are written down in the header of [index.ts](index.ts): read it first.

## What it owns

| file | what's in it |
|---|---|
| [`fights.ts`](fights.ts) | [`tacticalFights()`](fights.ts#L49), the play loop's `FightFactory` (`start`, `load`, `startWith`); [`TacticalFight`](fights.ts#L102), the play loop's `Fight` (its text, its action ids, `act`, `save`); [`encounterFor`](fights.ts#L76): the Heron's fight, or the arena room for any other scene |
| [`controller.ts`](controller.ts) | [`startCombat`](controller.ts#L54) and `resumeCombat`: a `CombatController` over the boardgame.io client (`view`, `options`, `act`, `advance`, `result`); writing the end back ([`writeBack`](controller.ts#L240), [`placeInWorld`](controller.ts#L279)); [`summarise`](controller.ts#L342), the story's version of how it went |
| [`game.ts`](game.ts) | [`combatGame`](game.ts#L23), the boardgame.io game: turn order from the engine's encounter, and the moves |
| [`skirmish.ts`](skirmish.ts) | [`Skirmish`](skirmish.ts#L38), the rules of the board, one per move: moving a step at a time, attacks (and Sallow's parry), spells laid on tiles, props, fire and dust, falling, nerve, surrender, arrest, and how it ends; and the player's `options` |
| [`rules.ts`](rules.ts) | The bridge to the engine: `Kit` (one engine and one dice stream a fight), [`Table`](rules.ts#L28) (the live campaign during a move), [`Rules`](rules.ts#L108) (the campaign kept in memory between moves); statblocks ([`STATBLOCKS`](rules.ts#L155), `statblockFor`, `createNpc`); [`diceLines`](rules.ts#L220) |
| [`setup.ts`](setup.ts) | [`initialState`](setup.ts#L34): the session's campaign, the people as engine characters, the engine's encounter and initiative, the props, the dust and the fuel |
| [`model.ts`](model.ts) | The types: [`CombatG`](model.ts#L75), `Unit`, `Prop`, `LogLine`, `PlayerAction`, `PlayerOptions`, `CombatView` |
| [`grid.ts`](grid.ts) | Pure tile geometry: paths (`findPath`, `explore`), lines (`line`, `clearShot`), [`areaTiles`](grid.ts#L157), `rangeFeet` |
| [`ai.ts`](ai.ts) | [`decide`](ai.ts#L39): the next step for everyone else, as the cast's notes in lore/Cast have them; and for the player, for the demo and "let the dice decide" |
| [`heron.ts`](heron.ts), [`heron-grid.ts`](heron-grid.ts) | The Heron's fight as a `CombatSetup` ([`heronEncounter`](heron.ts#L40): Sallow and his Crakes, or Hep's gang before midnight; Kell on your side), and a grid of its own for when the map module has none |
| [`flavour.ts`](flavour.ts) | What a fight looks like in words, in the house style, picked by a hash of the moment |
| [`render.ts`](render.ts) | The fight as text (the QA console, the demo) and as styled lines |
| [`pregen.ts`](pregen.ts) | Ready-made characters, built by the engine without the model, for the demo and the tests |
| [`demo.ts`](demo.ts) | The Heron played headless by the AI on both sides |

### State

`CombatG`, boardgame.io's G, is plain JSON. The play loop saves it in game.json's `combat`, as `{ combat: SavedCombat, unseen }`.

- **The rules:** `campaign` (the engine's serialised campaign: the truth about hit points, slots, conditions and the encounter) and `rng` (the engine's dice state between moves), so a fight carries on and replays exactly.
- **The board:** `map`, `units` (a projection of the engine's characters, for drawing and the AI), `order` and `active`, `round`, `props`, and the tiles of `dust`, `fire` and `fuel`; `exits`.
- **The story:** `log`, `flags` (`dust_exploded`, `fire`, `lit_by`, `walked:<id>`...), `outcome`, `place`.

## How it fits

- [src/game/fights.ts](../fights.ts) makes the story's factory, `mapFights()`, which lays the fight on the scene's own place: the [map module](../map/README.md)'s `battlefield(sceneId, world)` gives the map, where everyone stands, the lit lights, the dusty tiles and what burns.
- [src/game/play.ts](../play.ts) calls `start` when a scene ends in a fight, `startWith` for a fight that breaks out on the map (a `CombatSetup` from `townFight` in src/game/menu.ts), and `load` when a saved game is in a fight. It acts by id through `TacticalFight.act`, and when the fight is over, `result()` gives the `CombatResult` the story goes on from.
- The app draws `TacticalFight.controller` (`view`, `options`, `area`) through `fightView` in src/game/views.ts, plays the log as effects with `fightEffects`, and sets `pace` to give each of the other side's turns its moment.
- The zoo's arena sets out its own rings (src/game/zoo/fights.ts).
- It calls [src/rules](../../rules/README.md) (`dnd()` for the engine, `damageLine`, `inFights` and `RAYS`), boardgame.io's CommonJS client, the scene cards (scenes/), and writes into the session's rules state and the scene's world ([src/world](../../world/README.md)).

## How it works

### From a scene to a fight and back

```mermaid
flowchart TD
  world["the scene's world"] --> field["battlefield() in src/game/map:<br/>people, lights, dust, fuel, doors"]
  field --> setup["encounterFor: heronEncounter,<br/>or the arena room"]
  town["the town's world"] --> tsetup["townFight in src/game/menu.ts"]
  setup --> init["initialState: the campaign, engine NPCs,<br/>the encounter, initiative"]
  tsetup --> init
  init --> fight["the boardgame.io client:<br/>moves, Skirmish, the engine"]
  fight --> result["result(): summarise, writeBack, placeInWorld"]
  result --> back["session.rules: HP, slots, npcs;<br/>the scene's world: who's where and how,<br/>lights fallen, what's burning"]
  back --> after["play.ts: the scene's aftermath,<br/>or back on the map"]
```

- **Who's in it.** `heronEncounter` reads the scene's cast cards, the session (is it the midnight beat, is Kell absent) and the exit script's `startCombat` operation: Sallow with the talking and the silent Crake and the lantern-boy, or Hep and her porters; Kell on the player's side unless she's absent. Any other scene gets `arenaEncounter`: a plain 20 by 9 room, its leader and their people from `startCombat`, mapped to SRD statblocks (`ASSET_STATBLOCK`).
- **The same people.** Someone the scene's rules already made in the engine (a blow in the scene) is the same engine character in the fight. Someone the fight builds afresh, with a statblock of its own (Sallow's `sword-cane-duellist`, the Crakes' `river-bruiser`), carries their hurt over.
- **Writing back,** once, the first time `result()` is called: the encounter closed; the player's hit points (never below 0, and stable if down), slots and conditions in `session.rules.campaign`; the people the fight made kept in `rules.npcs`; in the scene's world, how everyone is (hurt, down, gone, arrested), and on a map lined up with it, where everyone ended up, the lanterns fallen or broken, the areas on fire, the dust gone up, and what stood within a tile of the fire alight.

### A move

```mermaid
sequenceDiagram
  participant T as TacticalFight
  participant C as Controller
  participant B as boardgame.io
  participant S as Skirmish
  participant E as engine
  T->>C: act(parse(id))
  C->>B: moves.attack(target)
  B->>S: new Skirmish(G)
  S->>E: plan("attack")
  E-->>S: events, committed
  S->>S: dice lines, settle()
  S->>B: done(): G updated
  T->>C: advance(): the others' turns
```

Each operation on a `Skirmish` returns an error message, or nothing when it happened; a refusal is put on `G.error` for the controller to report. boardgame.io's `turn.onBegin` starts a turn (its header, a death save rolled as it began, dodging ending, the heat of the fire), and `turn.onEnd` advances the engine's encounter past anyone who can't take a turn.

### The board's hazards

- **Grain dust.** Fire reaching a dust tile (a fire spell's tiles, a broken lantern, the brazier kicked over, burning sacks beside it) explodes the whole cloud: 5d6 fire to everyone in it, a Dexterity save at DC 13 for half, through the engine's trap rules so resistances and dropping to 0 work as they do for a spell.
- **Fire.** Burning tiles spread along the `fuel` (sacks, a heap of empties) at the end of each round, and starting a turn on or beside them costs 1d6 fire (DC 10 for half). The fight's summary says so, and the story's flags get `heron_burned`.
- **Props.** Lanterns and braziers have a fixed AC and hit points; a hit, or using one, brings it down, and a lit one sets fire where it lands. The lantern-boy's lantern falls when he's hurt.

### The fight's action ids

`attack_<target>[_with_<weapon>]`, `cast_<spell>` (on yourself), `cast_<spell>_<target>`, `cast_<spell>_at_<target>` or `_at_<x>_<y>` (an area), `use_<prop>`, `close_<id>`, `make_for_the_door`, `step_<direction>`, `move_<x>_<y>`, `leave`, `dash`, `dodge`, `disengage`, `auto` (the AI plays your turn) and `end_turn`. When a turn has nothing left worth doing, it ends by itself.

## Where to look first

- **G stays JSON.** Everything a fight needs is in G; the live campaign in `Rules` is a cache keyed by G's serialised campaign, and a loaded fight rebuilds it. Something kept outside G is lost on a save.
- **Determinism.** The engine's dice state rides in `G.rng`, and flavour lines are picked by a hash of the moment, never by the dice. `combat.test.ts` checks that a seed replays the same fight; anything in a move that decides an outcome by `Math.random` or the clock breaks it.
- **`result()` throws until the fight is over,** and writes back the first time it's called after that (the `written` flag is saved with the fight).
- **The Heron is in the code.** Sallow's statblock and parry, the Crakes' and the lantern-boy's roles, Kell's arrests, the `heron_burned` flag (set by any fight with fire in it), the AI's tactics (from lore/Cast/Master Josiah Sallow/gm.md and lore/Cast/The Crake Brothers/gm.md) and the flavour pools. A change to the Heron's cast or their notes may need one here.
- **Twins in src/rules.** `wellFormed`, `missesMiss` and the statblock weapon table are copies of src/rules/dnd.ts's (the first two keyed a little differently), and `diceLines` is a second version of its `describe`. A fix to one usually wants the other.
- **The fight's log is parsed for drawing.** `fightEffects` in src/game/views.ts matches "You cast ...", "attack on ...: hit" and "takes N damage" lines: reword them and check the effects still play.

## How to test it

```sh
node --no-warnings --test src/game/combat/combat.test.ts   # the grid, the Heron, a fight, saves, determinism, the cast's notes: 21 tests, offline
node --no-warnings --test src/game/fights.test.ts          # the battlefield from the scene's world, and a fight through the play loop
node --no-warnings src/game/combat/demo.ts                 # the Heron, played by the AI on both sides, the grid and the log each round
node --no-warnings src/game/combat/demo.ts --pregen wizard --level 5 --seed 4                 # Fireball meets the grain dust
node --no-warnings src/game/combat/demo.ts --runs 40 --pregens fighter,wizard,rogue,cleric   # outcomes over many seeds
node --no-warnings src/game/zoo/tour.ts --only arena       # the arena's rings: the Heron rehearsed, brawlers, archers, wolves, running for the gate
```

`--hep` plays the fight before midnight (Hep's gang, no Sallow), and `--kell wharf` brings Kell in at the land door. The app's smoke test (src/app/smoke/smoke.py) fights the Heron by mouse in the real terminal UI.

## Known gaps and sharp edges

- **The fight's world is its own.** Tiles on fire, dust and fuel, and props with a fixed AC and hit points (brazier 19 and 10, lantern 12 and 1). It doesn't read the scene world's materials or physics, and writes back only who's where and how they are, fallen and broken lights, burning areas, the dust gone up and what stood within a tile of the fire. So a lit lantern brought down in a fight sets the floor alight, where in a scene a fallen lantern just lies there lit. The full comparison is in [src/game/README.md](../README.md#the-same-rule-coded-more-than-once).
- **Spell areas differ from scenes'.** `areaTiles` lays an area on tiles and walls stop it; a scene's `caughtIn` works in feet through walls.
- **Spells:** only those `inFights` allows (an action or a bonus action, every effect of a kind the board plays: attack, save, auto-hit, heal, a hit-point pool like Sleep's, a buff). No reactions, summons, zones or teleports. Thrown weapons can't be thrown beyond 5 ft yet: the engine's reach check refuses them.
- **Only the Heron has a real setup.** Any other scene's fight is the arena room, set out from the exit script's `startCombat`; the zoo's rings set out their own.
- **The player can't die** in a fight: three failed death saves (or massive damage) leave them "nearly died", written back at 0 HP and stable; the play loop brings them round as the story picks up (`comeTo`). Everyone else is out cold rather than dying, except that massive damage kills a grown combatant.
- **boardgame.io** has had no release since November 2022 and has no exports map: [game.ts](game.ts#L19) loads its CommonJS build with `createRequire`.
- **fights.ts awaits the engine at import,** because a saved fight's `load` must be synchronous.
- **New casts fight generically.** The AI's tactics and the flavour are the Heron's cast's; anyone else falls back to a role by side and statblock (bruiser, brawler, archer, coward, ally).
