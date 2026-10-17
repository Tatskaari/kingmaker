# The town between scenes, complete: the action menu, talks with Kell, invented looks

The brief for one PR, `claude/v2-town`, stacked on the browser unit's contracts (`claude/v2-browser` at ad736b8, which stacks on the map, #659). It is the plan's V10, V11 and the rest of V9 ([verticals.md](verticals.md) §3), as one unit. After it, on the map the player casts, strikes, shoves, grapples, leaps, hides, rests and uses what they carry, aimed from the prototype's action menu; the town keeps what the rules did to it, its fire burns on the clock, and its people react. An act at a waiting scene's people opens that scene, the act its first turn. Between scenes the player stops for a word with Kell. Things the story makes up get a look of their own.

The user's direction: **drop in**. Copy the prototype's files whole wherever possible, each headed by its source at `44c6d4a` and its edits. Adapt only at the seams. Checks are functional: the existing tests, the copied tests, one e2e run and a playthrough of §1.

**Decisions, in short**
- **The menu runs on both sides.** Its geometry, aiming and view (`shared/map/menu.ts`) need no engine: the client offers and greys out by the same check the simulation refuses by. Doing it (`shared/map/menu-acts.ts`) is the simulation's, on the rules it already runs.
- **The catalogue is the simulation's.** It needs the engine, so `sheetRows` writes it to the sheet row (`sheet.actions`, JSON), as it writes `spellFacts` for the scene's menu.
- **The town's changes are the prototype's own overlay** (`TownChanges`), kept as JSON on the map's place row (`place.town`). `exploreOf` puts it back in `ExploreState.overlay.town`, so the copied `townWorld`, `keepTown` and renderer run unchanged.
- **Seven typed moves** (`cast`, `attack`, `use_feature`, `leap`, `hide`, `rest`, `use_item`), one to one with the prototype's menu ids, as the map unit's three are.
- **One way into a scene.** An act at a waiting scene goes through `openLead`; the open commit queues the act as turn 1, a line with its mechanic (`turn.mechanic`), which decide takes as `forced`.
- **A talk is a scene of kind `talk`,** with its own row, its own `gm_state` and the town's place. The waiting scene is never touched, so it is exactly as it was. The talk's prep comes with its opening.
- **`tick_place`** ticks a map's own place every 6 s while its host is in it: the scenes' own `tick`.
- **An `inventLook` job** asks `POST /v1/looks` for what the stage manager makes, and writes look rows.

---

## 1. How to try it

### 1.1 On the fake model

```sh
git fetch && git switch claude/v2-town && cd v2 && npm ci
npm run check
KM_AI_FAKE='{"choices":{"attempt":"walk-away"}}' npm run dev -- --fresh --fake    # real models: npm run dev -- --fresh
npm run client -- --session wren --new "Wren Ashdown: a hedge wizard who has read about fire extensively" --build wizard
```

The ready-made wizard is level 3: Fire Bolt, Ray of Frost, Light; Burning Hands, Magic Missile, Shield, Sleep, Thunderwave; Scorching Ray.

| # | Do | See in v2 | The prototype it matches |
|---|---|---|---|
| 1 | In the lane, `m` | The action menu: Cantrips; 1st level (4/4 slots), Shield dimmed ("a reaction: only in a fight"); 2nd level; Class features (Arcane Recovery dimmed: no slots spent); Actions (Attack, Leap, Hide, Lift a purse, Throw, Shove, Grab; Help, Dash, Dodge, Disengage dimmed: only in a fight; both rests dimmed: nothing to rest off) | `menuOf`, `catalogue`, `ui/actions.tsx` |
| 2 | Fire Bolt; aim with Tab, the arrows or the mouse at the watch house door, up the street (25,6); Enter | The hint line: "Fire Bolt (cantrip) on the watch house door", the reach ring; out of reach, or no clear line, it says why in red. Then the dice line, the damage, "catches fire", and the door burns on the map | `aimView`, `checkAim`, `doMenuAct` → `castSpell` on the town's world, `keepTown` |
| 3 | Watch who's about | They run for it, cower or run for the watch; a guard shouts at you to stop it | `townReactions` |
| 4 | Wait a minute on the map | The fire burns on the clock: the door burns down, fire spreads to what burns beside it, smoke | `tick_place` (new: the prototype's town only aged by the hour) |
| 5 | Walk west to the palace gate; Burning Hands at a palace guard | The guards come on: "Roll for initiative!" The fight card's "Fight it out" tells it as won, as at the Heron | `townFight`, recorded for V12 |
| 6 | `m`, Hide; then a step | A Stealth check against the sharpest eyes about; out of sight until you move | `hideNow` |
| 7 | Right-click Sergeant Kell inside the granary gate, "Do something…", Ray of Frost | The hanged clerk opens; after the opening, "(I cast Ray of Frost at Sergeant Agnes Kell)" is your first turn, resolved by the scene's rules from as far off as you stood | `storyRoute`, `storyAct`, `play.ts:256` |
| 8 | End the scene (any line, on the fake above), back on the map; `e` beside Kell (or `t` on the card) | "A word with Sergeant Agnes Kell": her greeting, two to four lines to choose (1 to 4), "I'll leave you to it.", and walking on | `startTalk`, `openTalk`, `scene.tsx:189-200` |
| 9 | Choose a line; then walk on | Her reply and new choices; walking on, back to the map: the lead (the Drowned Rat) waits as it was | `talkTurn`, `talk.suggest`, `leaveTalk` |
| 10 | A second terminal (`--join`) throughout | The same map, fire, menu acts' words and talk | V0's spectator |

On real models, the same, and the talk is Kell's own: she opens up about one thing at most, a step at a time, and never tells it twice; the deepest of her story waits for a third talk. Something the GM makes up in a scene ("a disgruntled swan") gets a glyph and colour of its own in the place panel, a moment after (`look.invent`).

### 1.2 Headless, and beside the prototype

```sh
npm run play -- new --session qa --as "Wren Ashdown: a hedge wizard" --build wizard   # observe lists the menu after ACTIONS:
npm run play -- act --session qa --id cast_fire-bolt@25,6
npm run play -- act --session qa --id hide
npm run play -- act --session qa --id rest_short         # refused while you're whole, in the prototype's words
npm run play -- act --session qa --id cast_ray-of-frost@<Kell's tile, from observe>   # the scene opens, the act its first turn
npm run play -- act --session qa --id talk_kell           # after the scene: say_1…, say_goodbye, walk_on
```

The ids are the prototype's (menu.ts's header): `cast_<spell>`, `cast_<spell>_self`, `cast_<spell>@x,y`, the same for `feature_<id>`, `attack@x,y`, `throw@x,y`, `shove@x,y`, `grapple@x,y`, `lift@x,y`, `jump@x,y`, `hide`, `rest_short`, `rest_short_recover`, `rest_long`, `use_<item>`; and a talk's `say_<n>`, `say_goodbye`, `walk_on`. Side by side: at the repo root, `npm run qa -- new --session p --as "…" --build 1`, `observe`, `act --id cast_fire-bolt@25,6`.

The checks: `npm run check`; `npm run e2e`; `npm run arc`; at the root `npm run typecheck && npm test` (v2/ai and v2/shared change).

---

## 2. The copy list

Every copied file's first line names its source at `44c6d4a` and its edits. "The usual" is the world bridge's (world-bridge-design §2): `SessionState` becomes `RulesSession` (or `TurnView` on the AI side), each rules function takes the host's `Rules` first and none awaits, imports from v2/shared.

| Source | To | Who | The edits |
|---|---|---|---|
| `src/rules/actions.ts` 23-98, 596-599; `dnd.ts` 1357-1366 | `shared/rules/aim.ts` | K | The catalogue's types, `rangeFeet`, `entryLabel` and `areaPlacement` (moved from `acts.ts`, which re-exports it), so the client loads no rules code. `Catalogue.you`: hurt and conditions, which the menu read from the engine |
| `src/rules/actions.ts` (601) | `shared/rules/actions.ts` | S | The usual: `rulesNow(state)` is `reading(rules, state)`; `catalogue` fills `you` |
| `dnd.ts` `castable` (1067), `arcaneRecovery` (2034), `useItem` (2059) | `shared/rules/acts.ts` | S | The usual. `rulesNow` is v2's `reading` |
| `src/game/menu.ts` 1-476, 891-896 | `shared/map/menu.ts` | S | Its context is the ExploreState, the sheet's catalogue and the explore row's keep (`MenuCtx`): no session, no engine. `youHurt`, `cureFor` read `Catalogue.you` |
| `src/game/menu.ts` 477-928 | `shared/map/menu-acts.ts` | S | The usual; `townFight` makes a `TownFight` (its map by key); `liftNow`'s pennies through the world's inventory. The client never loads it |
| `src/game/town-world.ts` (318) | `shared/map/town-world.ts` | S | ES2021 (JSON copies); `talkable` is "walks with the player"; `sceneThings` reads the waiting places' worlds (`ExploreState.waiting`), not place specs |
| `src/game/town.ts` 465-490, 316-318 | `shared/map/town.ts` | S | The menu's entry points; a word with a follower comes back as `Done.talk` |
| `src/game/menu.test.ts`, `src/rules/actions.test.ts` | beside the copies | S | On Caerwyn from rows; the zoo's cases dropped |
| `src/app/ui/actions.tsx` (213) | `client/ui/actions.tsx` | C | none |
| `src/app/game.ts` 1048-1321 | `client/explore/model.ts` | C | Each act a move (`moveOf` its id); the menu from the rows |
| `src/app/ui/explore.tsx` (what the map unit cut: `m`, "Do something…", aiming, the town's effects) | `client/ui/explore.tsx` | C | As the map unit's seams |
| `src/runtime/talk.ts` (446) | `ai/gm/talk.ts` | A | The usual for the AI side; `startTalk`, `endTalk`, `leaveTalk` are the simulation's rows (§3.6); `prepare` returns a `TalkPrep` |
| `scenes/talk.ts` (123) | `campaigns/caerwyn/scenes/talk/` (scene.json, its Markdown); `shared/scene/talk.ts` | A; K | The scene as data, `{name}` for the companion; K's has the ids, `FAREWELL`, `TOLD` and `talkSceneFile` |
| `src/runtime/talk.test.ts` (184) | `ai/gm/talk.test.ts` | A | The waiting scene put back is the simulation's test |
| `director.ts` 1263-1275 and its reading; `brief.ts` 395-406 | `ai/gm/director.ts`, `ai/gm/brief.ts` | A | Staged secrets, from `gm.guard` |
| `director.ts` `forced` (718, 793, 889-901, 915, 993) | `ai/gm/director.ts` | A | The decide request's `forced` |
| `src/app/ui/scene.tsx` 189-200; `play.ts` 351-361 (`choices`) | `client/ui/scene.tsx`, `client/scene/model.ts`, `client/headless.ts` | C | The lines from `scene_suggestion` rows |
| `src/game/look/invent.ts` (the model half: `INSTRUCTIONS`, `prompt`, `SCHEMA`, `LOOK_MODEL`, `askLuna`, `GLYPH_BY_NAME`, `MOTIONS`, `MATERIALS`) | `ai/look/invent.ts` | A | Through the request's calls; no cache (the simulation's `look_invention` rows are it) |

`game.ts`'s `talkBetween` is V3's and already in (the card's talk); the card gains a key to talk with Kell. Not copied: the zoo's wings (`ExploreState.roam` stays, never set), `townFight`'s battlefield (V12), the map's ageing by the hour (`reconcile.ts:297`, as the plan says).

---

## 3. The seams

### 3.1 Rows (K, in `schema.ts`; bindings regenerated)

| Table | Change |
|---|---|
| `place` | + `town` (JSON `TownChanges`, "" for none: a map's own place's), `tickedAt` (option: its clock's last round) |
| `explore` | + `rested`, `spotted`, `lifted` (the menu's keep: `Rested { time, short, long }`, `Spotted { time, at, by }`, `Lifted { time, who }`), `fight` (option `TownFight { map, seed, place, combatants }`: a fight on the map, for V12) |
| `sheet` | + `actions` (JSON `Catalogue`, "" before the menu) |
| `turn` | + `mechanic` (option, JSON `Mechanic`: the act a menu move made this turn) |
| `gm_state` | + `guard` (`{ cast, stage, turn }[]`: staged secrets), `withheld` (notes disclosure keeps out), `talk` (option `{ companion, where, confide }`: a talk's own) |
| `look` | + `invention` (option `LookInvention { glyph, nerd, color, motion, light, being, group, material }`) |
| `talk_record` (new, private) | `id`, `gameId`, `castKey`, `count`, `told` (`{ note, topic, turn }[]`), `stages` (`{ note, stage }[]`): talk.ts's `TalkRecord` |
| `look_invention` (new, private) | `key` (the name, lower case), `name`, `kind`, `look`, `at`: an invented look costs once per name |
| `place_tick` (new, schedule) | `scheduledId`, `scheduledAt` (6 s interval), `placeId`: runs `tick_place` |

Each new column has a default, so a database from the base keeps its rows across the publish.

### 3.2 The moves (K's stand-ins refuse `not_built`; S makes them)

| Reducer | Args | The prototype's ids |
|---|---|---|
| `cast` | `spell`, `at` option `Tile2`, `self` option bool | `cast_<spell>`, `cast_<spell>_self`, `cast_<spell>@x,y` |
| `attack` | `how` (attack, throw, shove, grapple, lift), `at` | `attack@x,y`, `throw@x,y`, `shove@x,y`, `grapple@x,y`, `lift@x,y` |
| `use_feature` | `feature`, `at` option, `self` option | `feature_<id>`, `feature_<id>_self`, `feature_<id>@x,y` |
| `leap` | `at` | `jump@x,y` |
| `hide` | none | `hide` |
| `rest` | `length` (short, long), `recover` option bool | `rest_short`, `rest_short_recover`, `rest_long` |
| `use_item` | `item` | `use_<item>` |
| `tick_place` | scheduled (`place_tick`) | |

`shared/map/moves.ts` (K) maps both ways: `MapMove` has the seven, `actionId` and `moveOf` know their ids, and `walk_on` is `walk { toward: "out" }`. A talk needs no new move: `interact` talk with a follower opens it (`talk_kell`), `say` says a line (`say_goodbye` says `FAREWELL`), and walking out of a live talk walks on.

Each menu move is the walker's (the map's own checks: `not_in_game`, `not_controller`, `scene_on`, `no_way`). S builds the ExploreState from rows (with `place.town`), the menu's keep from the explore row, the session from the rules rows (with the explore row's `rested` for this time of day), tries `storyRoute`, else `doMenuAct`. It writes what it said to the explore row (`said`, `log`), the town to `place.town` (and a played place's leftovers back to that place's rows, as `take_<x>` does), the sheet (with `actions`), `rules_state` and `dice`. `exploreRowOf` carries the keep and the fight unless the move changed them.

**Refusals** (`shared/protocol/refusals.ts`, K): the text is the prototype's sentence, `(${label}: ${why}.)`, passed as `refusal(code, { text })`. `not_ready` and `not_now` keep their old words when no text is given. A refused act writes nothing. What the rules themselves turn down (castSpell's "(…)" lines) is the act's said line, not a refusal, as in the prototype.

| Code | When | For example |
|---|---|---|
| `no_line` | no clear line or way to where it's aimed | "(Fire Bolt (cantrip): no clear line to there.)" |
| `out_of_reach` | past its reach, or nothing there it can be aimed at | "(Fire Bolt (cantrip): out of reach: 130 ft (it reaches 120 ft).)" |
| `too_far` | a leap or a step past its most, or nowhere to land | "(Leap: too far: 25 ft (15 ft at most).)" |
| `no_slot` | no slot left for the spell | "(Sleep: not now, no 1st-level slots left (a long rest).)" |
| `not_ready` | a feature's or an item's uses spent | "(Second Wind: not now, no uses left (short rest).)" |
| `not_now` | any other why: out cold, only in a fight, rested already, seen trying to hide here | "(Short rest: not now, nothing to rest off: you're whole and fresh.)" |
| `shut` | aimed at, or landing in, a place shut at this hour | "(Leap: nowhere to land: the Drowned Rat's door.)" |

An id that names nothing on the menu (no such spell or item) is `unavailable`, as on the map.

### 3.3 The menu on both sides (S; the client reads it)

- **Context.** `MenuCtx { ex, catalogue, keep }`: the ExploreState from rows, the sheet's `actions` parsed, the explore row's `rested`, `spotted`, `lifted`. The client and the simulation build it alike, so they offer the same ids and agree on every why.
- **Checks.** `checkAim(c, tw, entry, at, { area })` and `areaReach(tw, ex, aim, at, where, tiles)` (K's signatures) are the prototype's, on `townWorld(ex)`. `areaPlacement` is `shared/rules/aim.ts`'s.
- **The town reacts by its table** (`townReactions`): seeded by the game's dice row. If anyone fights, `townFight` is recorded on the explore row (`fight`), and `fight_it_out` tells it as won (the stand-in, its words new), the fighters left down until the clock moves on.

### 3.4 An act at a waiting scene, or at Kell

`storyRoute` sends an act aimed at a waiting scene's person or thing (`tw.waiting`) through `openLead`, the walk's own way in, with the act (`{ text, mechanic }`) for the open's plan. An act that would hurt Kell, or work on her mind, opens a talk the same way (§3.6). Once the opening is in, the open commit queues the act as turn 1: the player's entry ("(I cast Ray of Frost at Sergeant Agnes Kell)"), `turn.mechanic`, and the turn started at once. Its decide request carries `forced`, so the decider asks no mechanic question (`director.ts:793`) and the scene's rules resolve it from as far off as the player stood (`mechanicFor`'s `from.backOff`).

### 3.5 `tick_place` (S)

- A `place_tick` row (a 6 s interval) for each map's own place whose game's host is seated there, not in a scene: put in as a seat comes onto the map (a new game, walking out, travel, a talk's end), taken out by the tick that finds nobody there.
- A tick runs the rounds due since `tickedAt` (one each 6 s, ten at most): when anything in `place.town` burns, `tick(world, n, seed)` (shared/world, the scenes' own) on `townWorld(ex)`, then `keepTown` into `place.town`. Its dice from the game's dice row.
- The memory host's `tickPlaces()` (K) runs it for every row at the clock's time: a real-time host calls it every 6 s, a test when it likes.
- A scene's place burns by its turns, as before (`rulesFirst`).

### 3.6 A talk as a kind of scene (S rows, A words)

- **Opening.** A word with a follower (`Done.talk { with, where }`) makes: the companion's `talk_record` counted; a scene row of kind `talk`, key `talk-<companion>-<n>` (`talkSceneId`), titled "A word with <name>", on the town's own place (a talk has no world, as the prototype's has none); its `gm_state` with `talk { with, where }`; every seat moved into it; turn 0, and the open think with `talk: TalkOpen` (where, the record, the waiting scene's lead, the earlier talks' entries, whether lines are suggested).
- **The waiting scene is never touched:** the story's lead, its scene, its `gm_state` and its place stay as they were. S's test compares them before and after a talk.
- **Its graph** is the campaign's talk template (`CampaignFile.talk` names its folder, installed as the scene def `talk`), filled by `talkSceneFile` for the companion (K).
- **The open commit** keeps the `TalkPrep`: the facts as `established`, the prep's `patches` (the one thing they might tell, on their card, and the route by which it comes out, to `TOLD`), the companion's `guard` stage, `withheld`, `talk.confide`; the choices as `scene_suggestion` rows for turn 0.
- **Turns** are `say`, as in any scene; the AI service plays a talk with staging on and no considered rolls, freeform checks or co-GM. The settle answers `after.guard` (one step at most, never back; out is out) and the next choices (`SettleResponse.talk`), which the commit writes as that turn's `scene_suggestion` rows; V5's suggest job isn't queued for a talk. When the settle judges it told, the AI service writes the companion's memory of telling it, once by its key.
- **The end.** The goodbye (`FAREWELL` said: the anytime route to its one exit, and a closing reply), or walking on (no reply: "Wren walks on"), ends the talk with no chapter, effects, boundary or lead. The record keeps what was told, or how far it came. The ended talk stays up until Enter (walk out), as a scene does, with no card. Walking on while a turn is in flight is `turn_in_flight`.

### 3.7 Invented looks (S job, A endpoint, C draws)

- A thing the stage manager adds (in a settle, or an aftermath) that has no look gets one: S writes it at once from `look_invention` when the name is there, else queues `inventLook` beside the turn (background; step `look`, key `<game>:s<scene>:t<n>:look`). Its commit writes `look_invention` by name and a look row per thing: role `invented`, its glyph, `fg` its colour's name, `invention`.
- `POST /v1/looks`: `{ things: [{ key, name, kind }] }` → `{ looks: { [key]: Invention } }`, one `look.invent` call a batch. The canned GM invents nothing.
- The client puts each invention in the look layer's cache by `parseName(entity name).key`, so the copied `appearance.ts` draws it.

### 3.8 The AI protocol (K, `shared/protocol/ai.ts`)

| Change | Shape |
|---|---|
| `OpenRequest.scene.kind`, `TurnContext.scene.kind` | `"scene" \| "talk"` |
| `OpenRequest.talk?` → `OpenResponse.talk?` | `TalkOpen { with, where, record, lead?, earlier, suggest }` → `TalkPrep { established, patches, guard?, confide?, withheld, suggestions }` |
| `Story.talks?` | `Record<companion, TalkRecord>` in every request: the notes' knowledge cards read it (`knowledge.ts:55`) |
| `DecideRequest.forced?` | `Mechanic` |
| `After.guard?`; `SettleRequest.talk?` → `SettleResponse.talk?` | `Record<cast, GuardStage>`; `{ suggest }` → `{ suggestions }` |
| `POST /v1/looks` | `LooksRequest`, `LooksResponse`, `Invention`; step `look`, 30 s |
| `GmState` | `guard?`, `withheld?`, `talk?`, each a column |

A talk whose companion has no lore entry, or a looks request with no things, is 400 `bad_request`.

### 3.9 The client (C)

- **Rows:** `place.town`, the explore row's keep and fight, `sheet.actions`, `look.invention`, `scene.kind`: all in tables the client already reads. `MoveName` gains the seven; `mapMove` sends them through `act`; `Backend` gains no method.
- **The map:** `m` and "Do something…" open the menu; aiming draws the ring, the area and who it catches; a refusal shows on the status line; what an act said plays on the town (the look director, from the explore row's `said`), as `animateTown` does. A recorded fight shows the fight card.
- **A talk:** the scene screen with its choices (lines, then the goodbye, then walking on); `e` beside Kell, or a key on the card.
- **Headless:** `observe` on the map adds `menuText`; `act --id` takes every id in §1.2.

---

## 4. The packages

K lands first; S, A and C build from K's commit on `claude/v2-town-s`, `-a` and `-c`; the integrator merges S, A, C into `claude/v2-town`. A package that needs a contract changed says so in its report.

**K · Contracts.** Owns this brief; `schema.ts` (§3.1), `tables.ts`; the stand-ins (`simulation/src/map/acts.ts`, `tick.ts`) and their registration in `index.ts` and the memory host's `MOVES`, `tickPlaces()`; `shared/protocol/{ai,keys,refusals,port}.ts`; `shared/gm/state.ts` and its row mapping; `shared/rules/aim.ts`; the stubs `shared/rules/actions.ts`, `shared/map/{menu,menu-acts,town-world}.ts`; `shared/map/moves.ts`'s seven; `shared/map/types.ts`' fight setup; `shared/scene/talk.ts`; `CampaignFile.talk`; the AI service's route, check and stand-in for `/v1/looks`; the client's `MoveName` and `mapMove`; `client/module_bindings`. **Done when:** `npm run check` and the root's checks pass; the module builds; a publish over a database holding a game from the base keeps it, the new columns at their defaults.

**S · The simulation and shared.** Owns the copies in `shared/rules` and `shared/map` (over K's stubs) with their tests, `exploreOf`'s `place.town`, `sheetRows`' `actions`; `simulation/src/map/*` (the seven moves, `storyRoute`'s way in, `tick_place`, the town fight's record and stand-in); `moves/open-scene.ts` (the act as turn 1, a talk's open), the talk's rows and its end, `say-commits.ts`' settle for a talk (guard, choices), `inventLook`; `host/testing.ts`; `hosts/local.ts`. **Builds against:** §3.1-3.7; A's answers scripted on the memory host. **Done when (memory host):** a Fire Bolt at the watch house door from the lane burns it in `place.town`, says the prototype's lines and draws a guard's shout; an aim with no clear line is `no_line` and writes nothing; hide hides; a short rest while whole is `not_now`; two ticks 12 s apart burn it on, and the ticks stop when the host leaves the map; Ray of Frost at Kell opens the hanged clerk with V1's opening request, then turn 1 with `forced` in its decide request; hurting a guard records a fight that `fight_it_out` ends; after the yard, a talk with Kell opens with a scripted `TalkPrep`, takes a line, and walking on leaves the waiting Rat's rows as they were and the record counted; a thing the stage manager adds gets look rows. **Headless, on the fake** (SpacetimeDB 3970, AI 9470): a new wizard's `observe` lists the menu; `act --id cast_fire-bolt@25,6` says its lines, and an `observe` a minute on shows the fire on; `act --id cast_ray-of-frost@<Kell>` opens the scene with the act after the opening. **Must not touch:** `ai/`, `client/`.

**A · The AI service.** Owns `ai/gm/talk.ts` (`talk.sift`, `talk.plan`, `talk.suggest`, the told memory), the open's and the settle's talk branches, staged secrets in `director.ts` and `brief.ts`, `forced` in decide, `Story.talks` into the view, `ai/look/invent.ts` and its endpoint, the talk template (`campaigns/caerwyn/scenes/talk/`, `campaign.json`'s `talk`, the pack and the campaign check), `hosts/dev/fake.json`'s answers for the new operations. **Builds against:** §2, §3.6-3.8; `fakeFetch`. **Done when:** on the fake, a talk's open streams a greeting and answers a `TalkPrep` (the facts, a confide patch and stage, two to four lines, the deepest withheld before the third talk); a talk's settle asks the guard questions, answers stages and lines, and writes the told memory once; decide with `forced` asks no mechanic question and answers it; `/v1/looks` answers an `Invention` per key, the canned none; the parity test passes; the root's checks pass (the prototype imports v2/ai's docs, llm and prompts). **Must not touch:** `simulation/`, `client/`, `shared/` but the talk template's loader.

**C · The client.** Owns `client/ui/actions.tsx`, the menu and aiming in `client/explore/model.ts` and `ui/explore.tsx` (small and additive there: the browser unit changes them too), the fight card on the map, a talk's choices in `ui/scene.tsx` and `scene/model.ts`, the card's talk key in `ui/between.tsx`, invented looks from rows into the look cache, `headless.ts` and `hosts/play.ts`' ids, `demo.ts`, the screen check. **Builds against:** §3.9; K's bindings and stubs, with fixture menus until S lands. **Done when:** the client tests pass; the screen check draws, at 80x24 and 130x42, the action menu, an aim with an area, a greyed-out entry and a talk's choices; the demo where it applies; `client/imports.test.ts` holds (no rules acts, no engine). **Must not touch:** `simulation/`, `ai/`, `shared/` but reading it.

**Integration.** Owns the merges; `hosts/e2e.ts` (the menu's Fire Bolt and its fire on the clock, a `no_line` refusal that writes nothing, an act at Kell opening the scene, a talk with Kell between the yard and the Rat, an invented look); `hosts/arc.ts`; the live run (a talk with Kell, a Fire Bolt at the door, an invented look, beside the prototype); the page host's move list (`web/server/connections.ts`) once the browser unit lands; `v2/README.md`, this brief's As built, the PR's description (§1). **Done when:** `npm run check`, `npm run e2e` and `npm run arc` pass; the root's checks pass; §1 played once.

---

## 5. Departures, and risks

| The plan says | This unit does | Why |
|---|---|---|
| The town's people, doors and things are entity rows | The prototype's overlay (`TownChanges`) as JSON on the map's place | Drop in: `townWorld` and `keepTown` run unchanged, and the renderer already draws the overlay |
| A `deed` reducer (V9) | The act is a queued line with its mechanic (`turn.mechanic` → `forced`) | The world bridge made deeds lines; `forced` was left for V10 |
| AI service: nothing new for V10 | `forced` in decide | v2's director left it out |
| `talk.suggest` in reply | In settle | As the prototype runs it: beside the after-reply decision, so the reply's stream isn't held up |
| Refusal codes, new | `not_ready` and `not_now` were taken | They keep their words, and take the prototype's sentence when a menu act gives one |
| `tick_place` for an active place with a player in it | A map's own place only | A scene's place burns by its turns; ticking it too would burn it twice |

**Risks.** The menu's searches and the town's world are built per act and per tick: `tick_place` builds the world only when something burns, and every move logs its time. The catalogue costs a sheet read each `sheetRows`; over 100 ms it moves to a follow-up. Both sides must build the same menu from the same rows: the catalogue is the sheet's, the keep the explore row's, the town the place's. A talk's scene is built on both sides from the template (the simulation's graph, the AI service's words and lore). Restoring the waiting scene is free, since nothing touches it: S's test holds that.
