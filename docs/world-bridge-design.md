# The world bridge: spells and blows in a scene, and the place drawn, dropped in

The plan for one PR, `claude/v2-world`, stacked on the full GM (`claude/v2-gm`, `full-gm-design.md`), which stacks on V1 (V0, then V5, then V1 with V5 merged in). After it, a player in a scene casts, strikes, shoves, grapples, jumps, uses a class feature or rests by saying so, at people and at things. The rules resolve it on the scene's world from the game's dice, before the GM says a word; things have an AC and hit points, burn, break, get wet and fall; fire spreads turn by turn; witnesses react; a blow left hanging lands next turn. The scene's place is drawn beside the talk with the prototype's look layer, which plays what changed, and can be pointed at.

This is the plan's V7 with the drawing half of V9. The user's direction: **drop in**. Copy the prototype's files whole wherever possible, each headed by its source at `44c6d4a` and its edits. Adapt only at the seams: `TurnView` on the AI side, rows in and out on the simulation's, rows into the client. Checks are functional: the existing tests, the e2e, and a live scene played beside the prototype on the same lines.

Inputs: `verticals.md` V7 and V9; `full-gm-design.md` (read at the end, and agreed with below); `gm-port.md`, `content-world.md`, `client.md`; the stack as read on 16 Oct (`claude/v2-v0`, `claude/v2-v5` efc9bf3, `claude/v2-v1` c07abc8); the prototype at `44c6d4a`. `file:line` means the prototype unless a v2 path is given.

**Decisions, in short**
- **The rules run in the simulation's commits, on the world rebuilt from rows.** The prototype's `dnd.ts` acts are copied into `shared/rules/acts.ts` with V1's edits (a host's `Rules`, no `await`), and the copied world code (`shared/world`, V0's, whole) does the rest: `damageThing`, `ignite`, `destroy`, `tick`, `spill`, `douse`.
- **Three places a turn touches the rules,** as `playerTurn` does: the turn's start (a timed spell running out, fire's tick, coming round, a blow left hanging); the decide commit (the act, after the route's check); the settle commit (the threat read, conjured things).
- **One new step, `reactions`,** between the decide commit and the full GM's `consider` (or the reply): the decider's `director.reactions` call needs the world after the act, and the prototype asks it before the review. No new phase: the turn stays `deciding`.
- **No new tables.** Columns only: `gm_state` (threat, held, brawl, absent), `rules_state` (npcs, timed, rage), `sheet` (spellFacts).
- **No `rules_event` or `world_event`.** The client's look director parses the dice lines and compares worlds rebuilt from rows, as the prototype's does. Typed events wait for V18.
- **The place is drawn by the look layer copied whole** into `client/look/` (the stage view's closure, about 6,200 lines), fed a world rebuilt from the place's public rows.
- **The scene's menu is included:** it's pure functions on the world, and a deed is a typed line in brackets, sent through `say`, as the prototype sends it.
- **Left for later:** fights on the map (V12, V13), the town map and walking (V2), the map's action menu and a clock between turns (V10), invented looks for new things (V9's `POST /v1/looks`), one coding of fire and walls that stop areas (V18). `left` is the full GM's.

---

## 1. How to try it

### 1.1 From a fresh checkout

```sh
git fetch && git switch claude/v2-world && cd v2 && npm ci
npm run check                 # types, unit tests, the parity test, the screen check
npm run dev -- --fresh        # real models; about $0.06 for the lines below
```

In two more terminals (120x36 or larger shows the place best; 80x24 works, narrow):

```sh
npm run client -- --session wren --new "Wren Ashdown: an absent-minded hedge-wizard of the Invisible College who has read about fire extensively and is keen to try it" --build wizard
npm run client -- --session tam --join <game>       # the game's number is in Wren's side panel
```

The ready-made wizard is level 3: Fire Bolt, Ray of Frost and Light; Burning Hands, Magic Missile, Shield, Sleep and Thunderwave; Scorching Ray; HP 20, slots 1st 4/4, 2nd 2/2.

### 1.2 What to play

| # | Do | See in v2 | The prototype's behaviour it matches |
|---|---|---|---|
| 1 | Watch the opening | "At the scene": Wren's status line, then the granary yard from above: the lane and the old elm at the top, the yard wall with Moll on it, the gate with Kell by it, Prout hanging from the hoist beam, Cob under him, you, in the morning's light. The second terminal draws the same | The scene screen's place (`ui/place.tsx`, `stageView`, `granaryYardDressing`) |
| 2 | Point at Prout's body; click it; right-click it | The bottom line names it ("hanging"). A click leaves a quiet glance note in the talk (no turn, nothing from the GM). A right-click opens its menu (look at it, get it down, cast a spell at it…); the rope's has "Cut it" | `scene-menu.ts`: a glance never shows the GM's description |
| 3 | `(I cast Magic Missile at the hoist rope)` | Before the GM speaks: "Cast Magic Missile (1st-level slot) on the hoist rope", the darts' damage, "The hoist rope takes … and is destroyed", the status line with "1st 3/4". In the place three darts fly from you, the number floats, the rope goes and Prout's body drops. Kell, Cob and Moll react (one may run: gone from the place). Then the GM tells exactly that | `castSpell`, `objectDamage`, `destroy` (what hung from it falls), `decideReactions`, the look director |
| 4 | `(I cast Burning Hands at the yard gate)` | A cone of fire from you; "The yard gate takes … fire damage", "The yard gate catches fire"; another 1st-level slot gone; the gate burns in the place | `areaPlacement`, `caughtIn`, `damageThing` → `ignite` |
| 5 | `(I watch the gate burn)` | Before the reply: "The yard gate takes N fire damage", "The fire spreads to …" for anything that burns within five feet (Prout's satchel), "Smoke rises from the yard gate". A spark leaps across; smoke. The GM lets the fire be felt | `tick` at the turn's start (`engine.ts:523-534`) |
| 6 | `(I tip the water butt over the gate)` | No dice. After the reply a splash and steam; the gate is wet, and burns no more next turn | The stage manager's `douse` (V0's gate, now drawn) |
| 7 | `I take a swing at Sergeant Kell with my staff` | "Your attack on Sergeant Agnes Kell: …", how hurt she is, in words; the others react. If anyone fights, the GM ends on the fight breaking out | `attack`, `violence`, `react`, `brawl` |
| 8 | `(I put my hands up)` | If someone fought: their blow lands before the reply ("Sergeant Agnes Kell's attack on you: …"), and HP drops in the side panel. A grab gets one save; giving in gets none | `landThreat`, `givesIn` (`threats.ts`) |
| 9 | `I cast Fireball at the elm` | A bracketed line from the rules (Wren has no Fireball ready at 3rd level), and the GM tells the gesture fizzling. Nothing is spent | The rules' own no (`castSpell`'s first refusal) |
| 10 | Watch the second terminal throughout | The same lines and the same effects, at the same moment | V0's spectator |

Then try: "I jump onto the water butt", "I shove Cob over", "We sit down for an hour" (a short rest), Ray of Frost at the water butt, a right-click on the gate → "Cast a spell at it…" → Fire Bolt (the same deed, typed for you). A spell aimed at a thing nobody can make out gets "at what?" and spends nothing.

### 1.3 Side by side with the prototype

The repo root of the same checkout runs the prototype, with the same lore and prompts, as `full-gm-design.md` §1.3 does:

```sh
cd .. && npm ci
npm run scene -- start hanged-clerk --approach v2 --session side --as "Wren Ashdown: an absent-minded hedge-wizard of the Invisible College who has read about fire extensively and is keen to try it"
npm run scene -- say side "(I cast Magic Missile at the hoist rope)"
npm run scene -- map side          # the world from above, as text
npm run scene -- sheet side
```

In v2, headless, the same lines: `npm run play -- new --session side --as "<the same>" --build wizard`, then `npm run play -- say --session side "<the line>" --wait settled`, `npm run play -- map --session side` (new: the same `asciiMap`) and `npm run play -- sheet --session side`. For the picture, play the prototype's TUI beside v2's client: `npm run game`, make the same wizard, walk into the granary yard, say the lines. With no key, the prototype's zoo (z on the title: the Rules Room and the Burning Gallery) shows the same effects.

Line by line, these must agree: the kinds of dice lines and their order (the cast, the attack or the save, the damage, each thing's damage and state, the status line); what the world shows after (destroyed, burning, fallen, wet, who left); the slot spent; who reacts and how; the fire on the next turn; a blow landing first; the GM narrating the rules' outcome and nothing more. The numbers differ (the seeds), and so do the words (the models). The prototype's harness lets the model pick the build, so the spells may differ a little: pick lines both have.

### 1.4 Offline, on the fake model

```sh
KM_AI_FAKE='{"choices":{"mechanic":"cast","spell":"magic-missile","aim_thing":"hoist-rope"}}' npm run dev -- --fresh --fake
npm run play -- new --session qa --as "Wren Ashdown: a hedge-wizard" --build wizard
npm run play -- say --session qa "(anything)" --wait settled      # the fake's decider casts Magic Missile at the rope
npm run play -- map --session qa                                  # the rope destroyed, Prout fallen, Cob gone
```

`hosts/dev/fake.json` gains quiet reactions for the yard (Kell intervenes, Cob flees, Moll cowers, Tull is unmoved): the fake's default for a reaction is its first option, "fight". Every later line on that recipe casts again, until the slots run out.

### 1.5 The checks

`npm run check`; `npm run e2e` (the stack's scenarios, then this unit's five, §3.4); `npm run arc` (checks 1 and 5 on); `npm run live -- --script world` (§1.2's lines with real models, recorded beside the prototype's in `v2/docs/live/world-<date>.md`); at the repo root `npm run typecheck && npm test && npm run build:web` (shared code changed).

---

## 2. The copy list

"The usual edits", as V1's `shared/rules/character.ts` made them: `SessionState` → `RulesSession` (shared, simulation) or `TurnView` (AI); each rules function takes the host's `Rules` first and none awaits (`await open(state)` → `opened(rules, state)`, a read → `reading`); imports from `v2/shared`; deciders given the request's `calls`. Every copied file's first line names its source and edits.

### 2.1 The rules, shared (`v2/shared/rules/`)

| Source (`44c6d4a`) | Lines | To | The edits |
|---|---|---|---|
| `src/rules/dnd.ts` | 103-108, 911-1059, 1064-1107 (not `castable`), 1198-1452, 1521-1764, 1773-1869, 1884-1946, 1993-2027 (about 890) | `acts.ts` | The usual. `Outcome` → `RulesOutcome` (the protocol has an `Outcome`). `close`, `refresh`, `sheetOf`, `status`, `gearOf`, `weaponsOf`, `featuresOf`, `endRage` gain an `export` in `character.ts`. Not re-exported by `index.ts`, so the client never loads it |
| `src/app/game.ts` | 1840-1851 (the body of `loadSpellFacts`) | `acts.ts` `spellFactsOf` | Synchronous, on the engine's spell defs; `sheetRows` (`character.ts`) writes its answer as `spellFacts` |
| `src/runtime/threats.ts` | whole (87) | `threats.ts` | The usual; it reads `threat`, `held` and `turn` on the session (§3.2) |
| `src/runtime/engine.ts` | 1301-1327 (`leap`), 1329 (`nameIn`), 1336-1358 (`violence`), 1371-1388 (`react`), 1412-1421 (`moveToAct`) | `scene-acts.ts` | `state` is a `RulesSession` with the `GmState` fields `react` writes (`absent`, `brawl`, `threat`); `sceneById` → the scene passed in |
| `src/runtime/director.ts`, `session.ts` | 409-431, 1136-1142, 1230; session.ts 75-77, 307-308 | `types.ts` | `Mechanic`, `Jumping`, `ActFrom`, `Reaction`, `Act`, `ThreatRead`, `Threat`, `Brawl`, as they are |

### 2.2 The AI service (`v2/ai/gm/`)

| Source | Lines | To | The edits |
|---|---|---|---|
| `src/runtime/director.ts` | 433-623 (`RulesOptions`, the acts' words, `alsoQuestion`, `meansQuestion`, `mechanicDetails`, `aimedPeople`, `aimedThing`, `namedThing`), 1100-1131 (`jumpDetails`), 1133-1190 (reactions) | `mechanics.ts` (new) | The usual; `worldView` from `gm/world-view.ts` |
| `src/runtime/engine.ts` | 1329 (`nameIn`), 1360-1369 (`witnessesOf`), 1391-1409 (`aimable`) | `mechanics.ts` | The scene passed in |
| `src/runtime/director.ts` | 793-809 (the `mechanic` question, after `daft`), 889-893 and 897-901 (the ruling, `actSettles`), 925 (`considered` gated on it), 938 (the held route), 990-1009 (the details call, `means_only` included) | `director.ts`, into V0's split as the full GM leaves it | `beforeQuestions` takes the rules options; `readBefore` returns what the details call needs; the call is `withMechanic()`, run by the decide endpoint. Not `forced` (V10's menu) |
| `src/runtime/director.ts` | 1284-1295, 1343-1349 | `director.ts` `afterQuestions`, `readAfter` | `threat` and `threat_severity` beside the full GM's `left` |
| `src/runtime/engine.ts` | 647 (the brawl's filter) | `directives.ts` `directivesFor` | On `outcome.brawl`, the move's closing lines are dropped; `outcome.acts` go after the move's lines |

### 2.3 The simulation

Blocks of `engine.ts`, each a function with rows in and out (§3.4): 192-201 (between scenes, `betweenScenes` in `simulation/src/rules/play.ts`, V1's `comeToAtOpening` extended); 517-542 (the rules first, `rulesFirst` in `play.ts`, called by `startPlan`); 618-636 but 632 (the act, `takeAct` in `say-commits.ts`; the opening blow is V12's); 637-656 (the reactions applied, the brawl, the review skipped: the reactions commit); 896-897 and 919 (the threat read, conjured things, in the settle commit); 984 (`dispelConjured` in `endScene`). About 80 lines copied, 250 new around them.

### 2.4 The client (`v2/client/`)

| Source | Lines | To | The edits |
|---|---|---|---|
| `src/game/look/`: `stage`, `appearance`, `canvas`, `color`, `effects`, `glyphs`, `light`, `noise`, `roles`, `surfaces`, `door-art`, `lamp-art`, `lamps`, `terrain`, `names`, `people`, `kingmaker`, `kingmaker-glyphs`, `invent`, `dressings`, `director`, `opentui`, `overlay` (23 files) | whole (about 6,200) | `look/` | Imports: `../types.ts` → `../ui/types.ts`; `../../world/*` → `../../shared/world/*`; `Picks` (map/render.ts) and `MapActor` as local types. `invent.ts`: the model half cut (`askLuna`, `lunaInventor`): no inventor, guesses only, as the prototype offline. `director.ts`: `barksFrom` and `barkers` cut (every GM entry carries its speakers since V5), so `runtime/speakers.ts` isn't needed |
| `src/game/map/looks.ts` | whole (119) | `look/cast.ts` | none (`people.ts` reads it) |
| `src/game/views.ts` | `stageView` (about 20) | `look/stage-view.ts` | the world in place of the session |
| `src/game/scene-menu.ts` | whole (527) | `scene/menu.ts` | `Action` (play.ts) as a local type |
| `src/app/ui/place.tsx`, `menu.tsx` | whole (190) | `ui/place.tsx`, `ui/menu.tsx` | `Game` → `PlaceModel`; the map view (`townView`, `Picks`, map doors and lamps) cut |
| `src/app/ui/scene.tsx` | 48 and 100-105 (glance notes), 259-260, 345-432 (pointing, the menu, Tab through the place), the place's keys in `useKeyboard`, 483-500 (`menuKey`), 533-549 (the bottom line), 562-571 (the place in the panel), 600-603 (the menu) | `ui/scene.tsx` (V0's cut) | Reads the `SceneModel` and its `PlaceModel` |
| `src/app/game.ts` | 1817-1868 (`sceneContext`, the menu), 1937-1962 (`lookNote`, `deed`), 2141-2192 (`sceneLook`, `animate`, `animateRolls`, `observeScene`) | `scene/place.ts` (`PlaceModel`) | The world rebuilt from rows; spell facts from the sheet row; aliases from `my_names`; a deed is `say` |
| `src/cli/qa.ts` | 230-234 (`map`) | `headless.ts` `map` | `asciiMap` of the world from rows |

**Tests copied** only where they run on the granary yard with import edits: `scene-menu.test.ts`'s yard cases (a glance never shows a description), `threats.test.ts`, `attack.test.ts`, `systems.test.ts`. The rest build the other scenes' worlds, which v2 doesn't have yet.

### 2.5 Not copied, and why

| Prototype | Why not |
|---|---|
| `src/rules/actions.ts`, `src/game/menu.ts`, `town.ts`, `town-world.ts`; `dnd.ts` `rulesNow`, `castable`, `arcaneRecovery`, `useItem` | The map's action menu and the town's world (V10, V2) |
| `src/game/combat/*`; the opening blow and a cue beside a fight (`engine.ts:963-979`) | Fights on the map (V12, V13), as the full GM also says |
| `look/map.ts`, `vignettes.ts`, `door-sheet.ts`, `lamp-sheet.ts`, `frames.ts`, `dump.ts`; `src/game/map/*` but `looks.ts` | The map's renderer (V2); the zoo's and the dev tools' |
| `invent.ts`'s model half; `POST /v1/looks` | The client calls no model. New things get the rules-based look, as the prototype does offline (V9's job later) |
| `director.ts` `freeformCheck`, `pressureDetails`, `forced`, `rulingOf` | Other approaches, or the full GM's, or V10's |
| The plan's `rules_event`, `world_event` and `deed` | The director reads the dice lines and compares worlds; the menu's deeds are lines (§2.4) |

**Size:** about 8,800 lines copied (client 7,300, shared 1,110, AI 380, simulation 80) and 850 new (types and schema 150, the commits 250, the AI's endpoint and edits 120, the client's models and wiring 200, the e2e and live script 130).

---

## 3. The seams

### 3.1 The AI service

| Endpoint | Request gains | Answer gains | Model calls added |
|---|---|---|---|
| decide | `turn.party[0]` `spells`, `weapons`, `features` (the sheet row's own columns) | `decision.mechanic?: Mechanic`; a route held by the act (`director.ts:938`) comes back only when `also` says yes | `mechanic` in `director.before` (every rules session, as the prototype); then one of `director.mechanic`, `.feature`, `.jump` on a ruled turn |
| **reactions** (new, `POST /v1/turns/reactions`, 20 s) | `{ turn: TurnContext; act: Act }` | `{ reactions: Record<string, Reaction>; directive?: string; usage }` | `director.reactions` (Luna decisions), none when nobody saw it |
| reply | `outcome.acts?: string[]`, `outcome.brawl?: boolean` | none | none |
| settle | none | `after.threat?: ThreatRead`, `after.threatRead?: string` | `threat`, `threat_severity` in `director.after`, beside the full GM's `left` |

- **decide:** `rules = view.rules && view.world ? { spells, weapons, features, ...aimable(scene, view, line) } : undefined`; `beforeQuestions(scene, view, brink, { rules })`; `readBefore` as the full GM leaves it, plus the ruling, `actSettles` and the held route; then `withMechanic(decider, scene, view, line, read, rules)` when the act is cast, attack, grapple, shove, jump or feature (a rest needs no details). The considered read the full GM copied is gated on `actSettles`, and `means_only` rides the details call when the full GM's `wanted` is set, as `director.ts:990-1009` has it.
- **reactions:** `sceneAndView`; `witnesses = witnessesOf(scene, view, act)` (the hurt first, ten at most); none: `{ reactions: {} }` with no call. Else `decideReactions(director(calls), scene, view, line, act, witnesses, nameIn)` and `reactionDirective`. Ids are the world's local ids, which both sides rebuild alike (`keysFor`).
- **settle:** `afterQuestions(scene, view, hold)` adds `threat` and `threat_severity` when `view.rules` is set; `readAfter` returns `threat` (0.6) and `threatRead`, the raw choice, which `holdAfterReply` reads.
- **The view:** `viewOf` puts the sheet's `spells`, `weapons` and `features` on `view.rules`, and `absent` from `gm`.
- **Each new endpoint** is a route in `server.ts`, a check in `requests.ts` and a canned answer in `canned.ts` (no reactions). `keyParts` learns `reactions`, so `KM_AI_FAULTS=exit-after-store:reactions` works.
- **The parity test:** `NOT_ASKED` loses `mechanic`, `threat` and `threat_severity` (the goldens were recorded with a wizard, so they're already in them); its README says so.

### 3.2 Shared types

```ts
// shared/rules/types.ts (copied, §2.1)
export type Mechanic = { kind: "cast"; spell: string; targets: string[]; from?: ActFrom; unclear?: boolean } | { kind: "wrestle"; target: string; how: "grapple" | "prone" | "push"; from?: ActFrom }
  | { kind: "attack"; target: string; weapon?: string; from?: ActFrom } | { kind: "rest"; length: "short" | "long" } | { kind: "feature"; feature: string; target?: string } | Jumping;
export type Reaction = "fight" | "flee" | "raise_alarm" | "cower" | "intervene" | "join_player" | "unmoved";
export interface Act { what: string; victims: string[]; property: string[] }
export type ThreatRead = { kind: "attack"; by: string } | { kind: "hazard"; hazard: string; severity: "glancing" | "serious" };
export type Threat = ThreatRead & { turn: number };
export interface Brawl { turn: number; cause: string; against: string[]; allies: string[]; fled: string[] }
export interface SpellFacts { id: string; name: string; level: number; range?: string; effects?: string[]; area?: boolean }   // scene-menu.ts's
// RulesSession gains turn: number; threat?: Threat; held?: number. (RulesState, copied whole by V1, already has npcs, aliases, timed, rage.)
// shared/gm/state.ts: GmState gains threat?: Threat; held?: number; brawl?: Brawl; absent gets its column (entered stays refused: V3's).
// shared/protocol/ai.ts: SheetRow += spells?, weapons?, features?; Decision += mechanic?; Outcome += acts?, brawl?;
//   After += threat?, threatRead?; ReactionsRequest, ReactionsResponse; Endpoint, STEP_ENDPOINT, STEP_TIMEOUT_MS += reactions.
// shared/protocol/keys.ts: Step += "reactions" (keyParts too).
```

`Outcome.directives` is V0's field ("the rules' lines: [] in V0"), first in the reply: it carries the turn's rules-first directives. `Outcome.acts` carries the act's directive and the reactions', which `directivesFor` puts after the move's lines and before the full GM's ruling, the prototype's order.

### 3.3 The simulation's rows

| Table | Column | Type | Written by |
|---|---|---|---|
| `gm_state` | `threat` | `t.option(Threat)`: `{ kind, by option, hazard option, severity option, turn u32 }` | the settle commit (the read); the reactions commit (a brawl's first fighter); consumed at the turn's start |
| | `held` | `t.option(t.u32())` | the turn's start (a hold that caught them); cleared by the settle's `holdAfterReply` |
| | `brawl` | `t.option(Brawl)`: `{ turn u32, cause, against string[], allies string[], fled string[] }` | the reactions commit |
| | `absent` | `t.array(t.string())` | the reactions commit (the cast who fled or ran for help) |
| `rules_state` | `npcs` | `t.string()`, JSON `Record<castId, { id; weapon }>`, `"{}"` | every act that touched someone: the cast as the engine's NPCs |
| | `timed` | `t.bool()` | an act that started a timed spell; `passTime` |
| | `rage` | `t.option(t.u32())` | a barbarian's Rage; `passTime` |
| `sheet` | `spellFacts` | `t.string()`, JSON `SpellFacts[]`, `"[]"` | `sheetRows`: what the client's menu offers |

Each has a default, so a full-GM database migrates. `job.step` gains `reactions` (a value). No new table, phase or reducer. `sessionOf` (V1's `simulation/src/rules/session.ts`) fills `npcs`, `timed`, `rage`, the sheet's `spells`, `weapons`, `features` and `statusLine`, `aliases` (the cast with a `called` whose name the controller hasn't heard), `turn`, `threat` and `held`; `saveSession` writes back `npcs`, `timed` and `rage`. Without `npcs` an NPC is made afresh, unhurt, every turn; without `timed` no spell runs out.

### 3.4 A turn's steps and commits

| Where | What it does now | Prototype |
|---|---|---|
| `say`'s resolve, through `startPlan` (and a queued line's start) | After the full GM's merge, unless winding down: `rulesFirst`: `passTime(1)` when `timed`; `tick(world, n, seed + 31337 × n)` when anything burns, and the hazard when an area explodes; `comeRound`; `landThreat` when `gm.threat`. Dice rows, the world and the sheet written; `plan.rulesFirst = { directives, down, shielded }` | `engine.ts:517-542` |
| decide commit | V0's route move; then `takeAct` when `decision.mechanic` and not forestalled (knocked down: "(Knocked down before you could act: it doesn't happen)"): `moveToAct`, the rules call on `sessionOf(… world)`, the dice rows, `outcome.acts`, a `rules:<kind>:<what>` path step, the world, rules state, sheet and pockets written; `violence()` → `plan.act` unless a brawl is on. Next step: `reactions` when there's an act (the full GM's choice kept in `plan.then`), else the full GM's `consider` or the reply. The tail (`holdEnding`, `closes`) runs in the last commit before the reply | `engine.ts:593-636` |
| **reactions commit** (new) | `react()`: the fleeing `gone` with a note and in `absent`, the cowering `cowering`, `brawl` and `threat` when anyone fights; a `reactions:…` path step; `outcome.acts` += the directive; `syncStage`. A brawl this turn undoes the move's closing (`outcome.taken` dropped, `closing` and `pendingExit` of this turn cleared, `outcome.brawl`), skips the review, runs the tail and goes to the reply; otherwise on to `plan.then` | `engine.ts:637-656` |
| reply commit | Unchanged | |
| settle commit | In `moveOn`, unless out of character: `gm.threat` from `after.threat` (not while closing), `holdAfterReply(gm, after.threatRead)`. After the stage manager's ops: `markConjured` for a cast. The rest (gear, `left`, `landRuling`) is V1's and the full GM's | `engine.ts:896-897`, `:919` |
| open (resolve) | `betweenScenes`: `passTime(60)`, V1's `comeTo`, `levelUp` on a milestone scene, `rest` on a scene with one; dice and system rows at turn 0 | `engine.ts:192-201` |
| `endScene` | `dispelConjured(world)` | `engine.ts:984` |

**The job loop** is unchanged: `reactions` is a step of the turn's own move, keyed `<uid>:s<scene>:t<n>:reactions`, with V0's claim, retries, reaper and `retry_turn`, and its usage charged to the turn. The engine runs in the decide and reactions commits and in `say`'s reducer, each pinned by V1's `engineCall`.

**The e2e** gains, each with its own fake options over fake.json, on a wizard game:
1. *Before the GM speaks:* `{ mechanic: cast, spell: magic-missile, aim_thing: hoist-rope }`. Both clients see the dice rows before the reply's first draft; the rope destroyed and Prout fallen in the world rows; the sheet's status "1st 3/4"; a `:reactions` job; Cob off the stage.
2. *Fire burns on:* Burning Hands at the yard gate; the gate `burning`; the next line's dice rows say it burns, before its decide.
3. *A blow left hanging:* `{ threat: "attack:kell" }` for one settle; the next line's first dice row is Kell's attack on the player.
4. *A kill:* `KM_AI_FAULTS=exit-after-store:reactions`; the service started again; the turn finishes on the kept answer.
5. *Row for row:* the spectator's world row events equal the controller's (V0's comparison, now over the place's tables).

`npm run arc`'s check 5 is on: the stage view of the world rebuilt from the player's rows, drawn plain at 80x24, has the player's `@`.

### 3.5 The client

- **Rows:** the seat's subscription set adds `entity`, `position`, `area`, `material`, `health`, `stack`, `surface`, `creature`, `player_character`, `gear`, `narrative` and `world_log` where `place_id` is the scene's (`gm_note` stays private). `SceneRows` gains them and the place row; `client/scene/place.ts` makes `PlaceRows` and `rowsToWorld(rows, keysFor(place.key, scene.sceneKey, pcKey(controller)))`.
- **`PlaceModel`** (the prototype's look section): one `Effects` and one `Director` per scene, primed on the first world seen. On each new view: the new roll rows → `spellsFrom`, `rulesLines`, `observe`; a new GM entry → `barksFromSpeech`; otherwise a changed world → `observe`. The menu's context: aliases from `my_names`, spell facts from the sheet row, busy and over from the view.
- **The scene screen:** the place in the side panel where V0 lists "Here" (the list stays when there are no place rows), pointing, the right-click menu, Tab through the marks then the place, the bottom line, glance notes. A deed is `scene.input(line)`, refused like a typed line while the GM has the floor.
- **Headless:** `npm run play -- map`; `say` prints the dice lines as before.
- **The screen check:** the place at 80x24, 100x30 and 130x42 from fixture rows (`worldToRows(buildWorld(granary-yard))`), the menu open on Prout, a glance note. `--demo` gets the yard too.

---

## 4. Work packages

A lands first; R, S, C and D build in parallel from A's commit, each on its own branch (`claude/v2-world-r`, `-s`, `-c`, `-d`); F merges them in that order into `claude/v2-world`. After A, only F edits A's files.

### A · Contracts (one agent, about an hour)
- **Owns:** `shared/rules/types.ts`, `shared/gm/state.ts` (and its round-trip test), `shared/protocol/ai.ts`, `keys.ts`; `simulation/src/schema.ts`; `moves/plans.ts` (`SayPlan.step` += `reactions`; `rulesFirst`, `act`, `then`); stubs that throw "not built" for `shared/rules/acts.ts`, `threats.ts`, `scene-acts.ts` (`HAZARD_KINDS` real); the reactions route, check, stub endpoint and canned answer; `client/module_bindings`; `client/scene/rows.ts`' `SceneRows` and the subscription queries; `hosts/dev/fake.json`'s reactions.
- **Builds against:** this plan; the full GM's tip.
- **Done when:** `npm run check` passes; the bindings are current; `gm_state`'s round trip holds with the new columns set; a scratch stack plays a full-GM game as before.
- **Must not touch:** the moves' bodies, the endpoints' bodies, the director, the screens.

### R · The rules (one agent, about 90 minutes)
- **Owns:** `shared/rules/acts.ts`, `threats.ts`, `scene-acts.ts` (the copies, over A's stubs); the `export`s in `character.ts`; `sheetRows`' `spellFacts`; the copied tests.
- **Builds against:** §2.1, A's types, V1's test loader for the engine.
- **Done when:** on the granary yard with builds.json's wizard: Magic Missile at the hoist rope destroys it, Prout falls and a slot goes; Burning Hands at the gate sets it alight; Fire Bolt at someone makes them an NPC, kept in `npcs`; `tick` spreads the fire; `landThreat` lands an attack; `passTime`, `rest`, `levelUp` and `jump` run; the copied tests pass; ES2021 holds (`tsc -p simulation`).
- **Must not touch:** `simulation/`, `ai/`, `client/`, A's types.

### S · The simulation (one agent, about 90 minutes)
- **Owns:** `simulation/src/rules/play.ts`, `session.ts`; `moves/say.ts` (`startPlan`), `say-commits.ts` (`takeAct`, the reactions commit, the settle's additions, `endScene`); `moves/open-scene.ts`' call; `gm/requests.ts` (the reactions request; the sheet's lists in `partyOf`); `gm/rows.ts`; memory-host tests.
- **Builds against:** §3.3, §3.4; A's types; R's signatures (stubs until R lands); a scripted AI on the memory host.
- **Done when (memory host):** a turn with a scripted `mechanic` writes its dice rows, world rows and sheet in the decide commit, goes through `reactions` (a fled Cob absent and off the stage) to the reply and the settle; a brawl drops a closing the move had set and skips the review; a settle's threat lands first next turn; a burning thing ticks at the turn's start; NPCs and `timed` persist across turns; the stack's tests pass.
- **Must not touch:** `shared/`, `ai/`, `client/`, `hosts/`.

### C · The AI service (one agent, about 75 minutes)
- **Owns:** new `ai/gm/mechanics.ts`; `ai/gm/director.ts`, `directives.ts`, `view.ts`; `ai/service/endpoints/{decide,reactions,settle}.ts`; `ai/gm/parity.test.ts`' `NOT_ASKED` and the golden README.
- **Builds against:** §3.1; A's stubs; `fakeFetch`.
- **Done when:** the parity test passes with `mechanic`, `threat` and `threat_severity` asked, each the prototype's recorded question; on the fake, decide returns a scripted cast with its targets, holds a route behind an act and releases it on `also`, and keeps `considered` off when the act settles it; reactions answers with a directive, and with nothing when no one saw it; settle reads a threat; the reply's directives put the acts after the move's lines and drop the closing lines on a brawl.
- **Must not touch:** `shared/`, `simulation/`, `client/`, `hosts/`, `ai/llm`, `ai/docs`.

### D · The client (one agent, about two and a half hours: the copy is big but mechanical)
- **Owns:** new `client/look/`, `client/scene/menu.ts`, `place.ts`, `ui/place.tsx`, `ui/menu.tsx`; `ui/scene.tsx`, `scene/model.ts`, `net/connection.ts`' queries' use, `headless.ts`' `map`, `hosts/play.ts`' verb line, `demo.ts`, `check/screens.tsx`' cases.
- **Builds against:** §2.4, §3.5; A's bindings and `SceneRows`.
- **Done when:** the screen check passes with the place at 80x24 and up, the menu and a glance; `--demo` shows the yard; a model test feeds roll rows and a changed world, and the director plays a missile and floats the damage; `client/imports.test.ts` holds (no engine, no shim).
- **Must not touch:** `shared/`, `simulation/`, `ai/`.

### F · Integration (A's agent, about 90 minutes)
- **Owns:** the merges; `hosts/e2e.ts` (§3.4's five); `hosts/arc.ts` (check 5); `hosts/live/`' `world` script; `hosts/status.ts`' four new fields; `v2/README.md` ("What you can play"); the READMEs touched (the AI service's reactions endpoint, the simulation's reactions step, the client's look); `v2/docs/world-bridge-design.md` (this plan, with "As built"); `v2/docs/live/world-<date>.md` (the side by side); the PR's description (§1).
- **Done when:** `npm run check`, `npm run e2e` and `npm run arc` pass here and in CI; the root's checks pass; §1.2's lines are recorded on both builds, per line: the dice lines, what the world showed, the reactions, first-text time and cost; every copied file is headed by its source and edits.

---

## 5. Risks, and if the stack differs

| Risk | What's done about it |
|---|---|
| Engine work holds every transaction up: a cold isolate loads a sage wizard's campaign in about 300 ms (V1 measured), and each NPC lengthens the log | `takeAct` and `rulesFirst` log their times, as V1's checks do; the e2e prints them. Over 300 ms warm, `sheetRows`' `data` moves to a follow-up scheduled reducer (V1's deferred idea) |
| State the rules keep between turns is lost at the seam | `npcs`, `timed` and `rage` are columns, and S's test plays three turns against one NPC |
| A commit run twice must write the same | The engine is pinned per call (V1); things' dice and `tick` are seeded from the `dice` row and `n`; the e2e restarts SpacetimeDB mid-think, as V0's does |
| The client's director reads the dice lines by their words | Both are copies from the same commit (`describe`, `damageThing`); a reworded line is a change to both |
| The fake model fights by default (a reaction's first option) | fake.json's quiet reactions; the e2e and `local.test.ts` use them |
| Dice differ from the prototype's for the same seed (`tick` takes the scene's turn, not the session's) | Accepted: the side by side compares outcomes, not numbers |
| A violent turn's first words come later: the reactions call (about 0.3 s) and one more job hop | As in the prototype, whose reactions call also comes before the reply; the e2e prints first-text times |

**If the stack differs from what was read:**

| If | Then |
|---|---|
| The full GM isn't in | The reactions commit goes straight to the reply; the settle's rules block takes `left` too (`director.ts:1280-1283`, `:1350`); `NOT_ASKED` loses `left` |
| The full GM put the review somewhere else than a `consider` step | `reactions` goes before wherever the ruling is applied, and a brawl this turn still skips it (`engine.ts:656`) |
| The tail (`holdEnding`, `closes`) isn't one function | S factors it where the full GM deferred it, and calls it from the reactions commit |
| `gm_state` already has `absent` (or went back to one JSON column) | Reuse the column (or add only the `GmState` fields) |
| V2 lands first with the look layer | Reuse `client/look/` and copy only what's missing (`stage.ts`, `director.ts`, `effects.ts`, `dressings.ts`, the menu) |
| `sheetRows` or the sheet's columns moved | `spellFacts` goes wherever the sheet's spells are written |
| V5's merge changed `say`'s plan or `startPlan` | `rulesFirst` goes wherever a turn starts, after the full GM's merge; the plan's fields wherever `SayPlan` lives |

---

## 6. As built

The world bridge keeps to this plan, but for these departures, each with its reason. The packages' reports (A, R, S, C, D and F, in the author's scratchpad) and the PR give the full account. Every copied file's first line names its source at `44c6d4a` and its edits.

### The contracts

| The plan says | The build does | Why |
|---|---|---|
| `sheet.spellFacts` defaults to `"[]"` (§3.3) | `""` | The menu takes an array as the facts, so `"[]"` would offer no spells at all on a sheet from before the column; `""` keeps the prototype's behaviour before its facts load (the spells by name, each anywhere). The sheet's `data` and `pockets` did the same |
| The scene acts take "a `RulesSession` with the `GmState` fields `react` writes" | `SceneSession`: a `RulesSession` with `beat`, `path`, `entered`, `absent` and `brawl` | `presentCast`, in `violence` and `landThreat`, reads `beat`, `path` and `entered` too |
| `RulesSession` gains `turn` | Required, so every session made gained `turn: 0` (eight places, five in tests) | As the plan has it |
| A owns `SceneRows` and the subscription queries | Package D's (`PlaceTables`, `PLACE_TABLES`, `Watched`) | D built them first, from V1's head; A added none |

### The rules

| The plan says | The build does | Why |
|---|---|---|
| `dnd.ts` 103-108, 911-1059, 1064-1107, 1198-1452, 1521-1764, 1773-1869, 1884-1946, 1993-2027 | 102-108, 911-1059, 1061-1106, 1191-1452, 1454-1459, 1520-1763, 1774-1863, 1885-1946, 1994-2027 | The functions' real bounds at `44c6d4a`; `acts.ts`' header names them |
| `spellFactsOf` in `acts.ts` | In `character.ts`, re-exported by `acts.ts` | `sheetRows` writes it: so the two modules don't import each other, and the client never loads `acts.ts` |
| §1.2 row 7: "Your attack on Sergeant Agnes Kell: …"; row 8: "Sergeant Agnes Kell's attack on you: …" | "Quarterstaff: your attack on Sergeant Agnes Kell: …", "Club: Sergeant Agnes Kell's attack on you: …" | The prototype's words: a blow's line starts with the weapon. The client's director reads them as they are |
| §1.2 row 5: the next line says "The fire spreads to Prout's satchel" | Burning Hands at the gate catches the satchel in its cone, so the next line burns both on ("Prout's satchel takes N fire damage and is destroyed", or "burns down to a smouldering wreck") | The prototype's cone does the same. A fire spreads on the tick when one thing is alight: Fire Bolt at the gate, then any line: "The fire spreads to Prout's satchel" (2.8 ft off) |
| (§1.2's Then try) "I jump onto the water butt" | Falls short | The water butt is about 20 ft off, and the level 3 wizard has Strength 8: the prototype's rule |
| Not copied: `castable`, `spellCard`, `arcaneRecovery`, `useItem`, `rulesNow` | As planned; also not copied, the prototype's fifth threats test and the systems test's gin jar | The fifth plays a whole turn (it's the simulation's, in `world.test.ts`); the yard has no gin jar |

### The simulation

| The plan says | The build does | Why |
|---|---|---|
| `sessionOf` fills `turn`, `threat`, `held` and the aliases (§3.3) | `sceneSessionOf`, beside it, builds the scene's session on top of `sessionOf`; `sceneSessionBack` writes `absent`, `brawl`, `threat` and `held` back to the gm | They're a scene's, and `sessionOf` serves checks and character creation too |
| `rulesFirst`, `takeAct` and the reactions commit each read and write the rows | `inPlay` and `playedOut` do it for all three: the player's session in the place's world in, and the dice, `rules_state`, the sheet (when the campaign changed), the world, the pockets and the bookkeeping back | One reading and one writing |
| V1's `comeToAtOpening` extended | Replaced by `betweenScenes`; `passTime` is given no world there | A place just built holds nothing conjured, which is all the prototype's call read of it there |
| (not in the plan) `gm/bookkeeping.ts` | `wantsReview` counts the rules' act as the turn's answer unless a ruling is still wanted (`mechanic && !considered`) | As the prototype's does: the ruling waits for the reactions |
| The turn's lines | Begin with the rules-first dice lines (`plan.lines`, the outcome's and the settle's) | The prototype's stage manager read every roll line of the turn, these too |
| A brawl undoes the move's closing | `outcome.taken` is dropped before the tail runs, so `closes` can then come only from an older held ending | The prototype's `heldEnding` after a brawl |

### The AI service

| The plan says | The build does | Why |
|---|---|---|
| `worldView` from `gm/world-view.ts` | From `shared/world/scene-world.ts` | There's no `gm/world-view.ts`: the shared world has it, as brief, stage and consider already import it |
| `rules = view.rules && view.world ? …` | The rules' options for any sheet with a build, the world's `aimable` only when there's a world (`engine.ts:559`) | The prototype's condition; every v2 scene has its place, so it's the same in play |
| `readBefore` returns what the details call needs | `BeforeRead`: the `Decision`, plus `details` for `withMechanic`, which strips them | The decide endpoint always goes through `withMechanic` for a rules session, so `details` never goes over the wire |
| The parity test's `NOT_ASKED` loses three questions | It's empty, and the test sends the sheet's spells, weapons and features, so the suggester's and the judge's requests are byte for byte too | The simulation sends them now: the `Spells:` exception is gone |
| (not in the plan) | `director.ts` and `mechanics.ts` import each other | Only functions cross, so it loads under ESM, tsx and plain node alike |

### The client

| The plan says | The build does | Why |
|---|---|---|
| D builds against A's bindings and `SceneRows` | D was built from V1's head, before the full GM; at the merge its stand-ins gave way to the contracts (`LeadSheet` is the bindings' sheet's `spells` and `spellFacts`; the menu's `SpellFacts` is `shared/rules/types.ts`'), and two files met the full GM's client work (the scene model's header, the screen check: both kept) | So the client could be built while the full GM was |
| A spectator's place | Names the lead's character by name ("@ Pell Marrow"), and the lead's own things can't be clicked or right-clicked there | The prototype's words for the world's "player" are the lead's own ("You", "Look at yourself") |
| `scene.tsx`'s pointing, copied | The Tab step emits the model's change before the state update, not inside it | React warned of it under `useSyncExternalStore` |
| The menu's context | `aka` isn't passed | The cast's `aka` isn't in the rows, and nobody in the yard has one |

### The hosts, the e2e and the live run

| The plan says | The build does | Why |
|---|---|---|
| The e2e's five (§3.4) | Steps 26 to 30, after the full GM's 25; each turn's times is 31. The blow comes before the fire (27, 28) | A fire still burning would put its dice lines before Kell's blow on the next line |
| 4. *A kill* | Magic Missile at Prout's spectacles, with `KM_AI_FAULTS=exit-after-store:reactions` | A thing the yard's people see broken is violence, so the reactions are asked; the rope is already down |
| 5. *Row for row* | Over this scene's place's rows alone, for every line since B joined | In the whole run B comes from step 24's game and A from step 25's: either's events may still carry another place's rows coming and going with its subscriptions |
| `hosts/status.ts`' four new fields | In `hosts/dev/gm-status.ts`, where the status is made: `threat` ("3: an attack by kell", "4: fire, serious"), `held`, `brawl` (its cause, against whom, with whom, who fled), `absent` | |
| `npm run live -- --script world` | §1.2's lines as the hedge-wizard keen on fire, eight with five unless told, and a table of the world per line: the dice lines, the act the path names, what the place's rows showed changed after (destroyed, burning, fallen, gone, what appeared), the reactions, first words and cost | The record a reader checks against the prototype's |
| `npm run arc`'s check 5 | Waits up to 10 s for the place's rows before the checks | As the screen does |
| `npm run check`, `npm run e2e` and `npm run arc` pass "here and in CI" | Here; CI wasn't run | Nothing was pushed |

### What the live run showed

[docs/live/world-2026-10-16.md](live/world-2026-10-16.md), with real models: the opening and seven lines, then the prototype's harness on lines 2 to 5 (its model made a wizard without Magic Missile, so it began at the first line both have). In both, the rules resolved each act before the GM spoke, in the same words and order: a blow left hanging first, then what's burning burning on, then the act; Burning Hands' cone caught the gate and the satchel; the next line burned them on, with smoke; the same swing at Kell rolled the same miss (14 + 1 = 15 against her AC 16) in both. The same people reacted the same ways (Kell stepped in, the children ran; here Cob fought first, so a fight was on, Cob's blow landed first on the next line, and nobody reacted again while it was), and in both the stage manager brought a child who had fled back into the world as someone new. The GM narrated the rules' outcome and nothing more: "Three bright darts snap from your hand … it bursts into smashed fibres. Prout drops hard onto the cobbles." Fire Bolt hit the old elm at line 6, which caught fire, and the next line burned it on with smoke (nothing that burns is within five feet of it). First words came 1.1 to 3.3 s after the line here, 1.6 to 3.4 s there.

The side-by-side spent **$0.132**, over the $0.10 asked: this run $0.0896 by the ledger ($0.0594 when the record was written: the last lines' memory reviews came after its budget check), the prototype's $0.0421. The memory reviews' lore agent, which writes the yard's lore after each fire and blow, was the largest single cost in both ($0.0231 here, $0.0167 there). A run that has to stay under $0.10 should take `--budget 0.04` and the prototype's first three lines.

### The checks

- `npm run check`: both type checks clean, 676 tests pass (the parity test among them), screens PASS: 543.
- At the repo root: `npm run typecheck` clean, `npm test` 821 pass, `npm run build:web` built.
- `npm run e2e` on 3710 and 9210, namespace mode: PASS, every step (V0's, V5's, V1's, the full GM's and the world bridge's 26 to 30), in 416.5 s. The first run failed step 30 on its own comparison (another place's rows, from B's earlier game), fixed in the e2e.
- `npm run arc` on 3710 and 9210: PASS, 2 of 16 checks on (1 and 5).
- The rules' times on SpacetimeDB, from the module's log in the e2e: an act 328 to 416 ms, the rules first 13 to 584 ms (the slow ones the first engine work on an isolate). Over the plan's 300 ms warm line for an act; left as the plan says (a follow-up moves `sheetRows`' `data` to a scheduled reducer), not chased.
