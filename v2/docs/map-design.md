# Walk Caerwyn: the town map between scenes, dropped in

The brief for one PR, `claude/v2-map`, stacked on V1 (`claude/v2-v1` at 7080e94: V0, then V5, then V1 with V5 merged in). It is the plan's V2 ([verticals.md](verticals.md) §3, "Walk Caerwyn"). After it, a game begins in the granary lane in the morning, on the prototype's isometric map. The player walks the town with the keys, the mouse or "go to the lead", among the people about at that hour, and walks or talks their way into the hanged clerk. The yard is a place on the map, and stays as play left it.

The user's direction: **drop in**. Copy the prototype's files whole wherever possible, each headed by its source at `44c6d4a` and its edits. Adapt only at the seams: rows in and out of the copied map code, on both sides. Checks are functional: the existing tests, the copied map tests, one e2e run and a short playthrough.

**Decisions, in short**
- **The map code is shared.** The prototype's walking code (`tiles`, `places`, `presence`, `explore`, `quips`, `looks`, `reconcile` and the town's explorer) goes to `v2/shared/map`, so the simulation and the client run the same code on the same rows: the simulation to make the moves, the client to offer and draw them. The renderer, x-ray and the look layer are the client's.
- **The prototype's `ExploreState` is made from rows** on both sides (`exploreOf`), and what a move changed is written back. Its action ids (`talk_kell`, `go_to_lead`, `walk@30,22`) are the prototype's, end to end.
- **The town is a place** (`map:caerwyn`); the player's spot on the maps is an `explore` row. A scene's place is built on its map when its scene becomes the lead, with its people waiting, and persists. The overlay of what scenes left is no longer kept: it's made from the places' rows.
- **One way into a scene.** Walking into the yard, talking to Kell and the whole story's "Go on" all call `openLead`, which opens the lead's waiting scene through V0's `openScene`.
- **Three moves, typed:** `walk`, `interact`, `travel`, each a reducer whose arguments map one to one onto the prototype's ids.
- **Nothing new in the AI service.** The opening's request is V0's, byte for byte.

---

## 1. How to try it

```sh
git fetch && git switch claude/v2-map && cd v2 && npm ci
npm run check
KM_AI_FAKE='{"choices":{"attempt":"walk-away"}}' npm run dev -- --fresh --fake   # or real models: npm run dev -- --fresh
npm run client -- --session wren --new "Wren Ashdown: a quick-witted investigator lent to the case by the King" --build ranger
npm run client -- --session tam --join <game>        # the game's number is in Wren's side panel
```

| # | Do | See in v2 | The prototype it matches |
|---|---|---|---|
| 1 | Start (or New game, a character, Set off) | The map, framed on Wren's `@` in the granary lane, the yard wall and its gate below. The side panel: the granary lane, the morning's words, Wren's line, "The lead: The Hanged Clerk" and the way ("just south"), Nearby (Sergeant Kell, Moll and Cob in the yard, a porter), and what `e` does | `npm run game`, New: `newExploration` at (42,9), `ui/explore.tsx` |
| 2 | Walk: arrows or WASD (up is up the screen, steered along the streets), a click (a step at a time; any key stops it); walk into a wall | The `@` walks; "You come into Granary Street."; a wall: "You walk into the wall. The wall wins." (never the same line twice running); the pointer's line names what it's over | `move`, `steer`, `walkPlan`, `bumpLine`, `tileName` |
| 3 | Right-click the pie-seller in the market square, then Talk | "Assembly pies! Commemorative! Mostly pork!" and the rest. The goose, the sweeper and the man up a ladder are about too: it's morning | `presence.ts` `town()` by the hour |
| 4 | `g` (or right-click Kell: "Talk to Sergeant Kell"; or walk into her) | The `@` walks through the gate into the yard, and The Hanged Clerk opens: the scene screen, the opening streaming in | `go_to_lead`, `triggerAt`, `sceneTrigger`; the core's `beginScene` |
| 5 | Before that, try doors: the Drowned Rat's (down the river stairs), the palace gate | "The Drowned Rat's door is shut. A board nailed to it says: OPENS AT DUSK…"; the palace's guards cross their halberds | `regionOpen`, `shut`, `bumpLine` |
| 6 | Watch the second terminal | The same map and the same walk, then the same scene | V0's spectator, on the map too |
| 7 | End the scene (on the fake above, any line walks away; with real models, "I'll write it up as suicide and go"), then Enter | Back on the map where the scene left Wren, in the yard, Kell beside her. Walk out through the gate and try to go back: "The yard's been locked up for the Assembly…" Over its wall it's as play left it (with real models, cut Prout down first: he lies on the cobbles). `g`: "Nowhere to walk to: the story comes to you from here." | `leaveScene`, `syncFollowers`, `lockedFrom`, the overlay (`captureScene`) |
| 8 | `/quit`, then Continue | Back on the map where Wren stood | the save |

Headless, as the prototype's QA console:

```sh
npm run play -- new --session qa --as "Wren Ashdown: a hedge wizard" --build wizard   # MODE: explore, the map as text, ACTIONS
npm run play -- act --session qa --id talk_kell                                   # the scene opens; waits for the opening
```

Side by side: at the repo root, `npm run game` (New) and `npm run qa -- new --session p --as "…" --build 1`, `npm run qa -- observe --session p`, `npm run qa -- act --session p --id go_to_lead`.

The checks: `npm run check`; `npm run e2e`; `npm run arc` (checks 1 to 4 on); `npm run campaign -- check campaigns/caerwyn`; at the root, `npm run typecheck && npm test` (v2/shared changed).

---

## 2. The copy list

Every copied file's first line names its source at `44c6d4a` and its edits. "ES2021" means `.at(-1)` and `structuredClone` replaced, as the module's lib needs.

| Source | To | Who | The edits |
|---|---|---|---|
| `src/game/types.ts:1-81` | `shared/map/types.ts` | K | none (`Span`, `StyledLine` stay `client/ui/types.ts`'s) |
| `src/game/map/tiles.ts` | `shared/map/tiles.ts` | K | + `MapFile`, `LegendEntry`, `mapOf` (a map file through `buildMap`) |
| `src/game/map/maps/index.ts` | `shared/map/maps.ts` | K | `MAPS` filled from `map_def` (`useMaps`), not from four imports |
| `src/game/map/maps/{caerwyn,drowned-rat,heron,palace}.ts` | `campaigns/caerwyn/maps/<key>.json` | M | the `MapSpec` as data: the grid as rows, each legend entry as `T()`'s arguments, the exits written out |
| `src/game/map/looks.ts` | `shared/map/looks.ts` | M | `km` cut: the sprites are the look layer's (`client/look/cast.ts`) |
| `src/game/map/quips.ts` | `shared/map/quips.ts` | K | none (`QuipMemory` is the `explore` row's) |
| `src/game/map/reconcile.ts` | `shared/map/reconcile.ts` | M, over K's stub | ES2021; the overlay's functions kept (§3.4) |
| `src/game/map/places.ts` | `shared/map/places.ts` | M | each place names its place file (`place: "granary-yard"`) in place of its world: the specs come from `place_def` (`usePlaces`, the simulation's only: the client never needs one); `storyFromSession` goes (the story is rows) |
| `src/game/map/presence.ts` | `shared/map/presence.ts` | M | `places()` draws a waiting place from its rows (`ExploreState.waiting`), not a fresh `buildWorld` |
| `src/game/map/explore.ts` but 645-754 | `shared/map/explore.ts` | M, over K's stub | ES2021; `ExploreState.waiting` |
| `src/game/town.ts` but 465-490 | `shared/map/town.ts` | M, over K's stub | `GameState`, `SessionState` → `ExploreState` and the unheard names; `talkable` false (V11), no action menu (V10), no fights (V12); `pickUp` asks the simulation to move the thing (`Done.take`); `observe` is the client's (it draws) |
| `src/runtime/brief.ts:118-129, 146-151` | `shared/scene/names.ts` | M | `asHeard` and `strangers` beside the rest of `:108-162` |
| `src/game/map/{render,xray,palette,ansi}.ts` | `client/map/` | C | imports: the look layer and `shared/map` |
| `src/game/map/explore.ts:645-754`, `setup.ts:196-215` | `client/map/frame.ts` | C | `renderExplore`, `exploreFrame`, `exploreCamera`, `areaHazards` |
| `src/game/look/map.ts` | `client/look/map.ts` | C | none (the world bridge's D left it for V2) |
| `src/game/views.ts:59-77` | `client/map/views.ts` | C | `townView`, `townText` from an `ExploreState`, not the game and session |
| `src/app/story.ts:19-60` | `client/explore/words.ts` | C | `TIME_WORDS`, `ARROW`, `leadWay` |
| `src/app/game.ts:901-1046, 1176-1260` | `client/explore/model.ts` | C | `ExploreModel` over rows: each act a move (§3.2), its words from the `explore` row; no zoo, action menu or fights |
| `src/app/ui/explore.tsx` | `client/ui/explore.tsx` | C | `Game` → `ExploreModel`; the action menu, aiming, the zoo's keys and the report cut |
| `src/game/town.ts:524-540` (`observe`) | `client/headless.ts` | C | `MODE: explore`, the map as text, `ACTIONS:` |
| `src/game/map/{walk,steer,map}.test.ts`; `{pick,xray}.test.ts`, `view-check.tsx` | beside the copies | M; C | the walking and the map's well-formedness (M); picks, x-ray and the drawn map (C) |

**Not copied:** `generate/`, the demos and audits (the zoo's and dev tools'); `setup.ts`'s battlefield (V12); `town-world.ts`, `menu.ts` (V10); `talk.ts` (V11). `ExploreState.roam` stays in the copy, never set (V19). The look layer is `claude/v2-world-d`'s (39abd6b): C merges it, and copies nothing of it again.

---

## 3. The seams

### 3.1 Rows (K, in `schema.ts`; regenerated bindings)

| Table | Change |
|---|---|
| `map_def` (new, public) | `id` pk (`caerwyn@0.1.0/caerwyn`), `campaignId` ix, `key`, `json` (the map file whole). Written by `install_campaign`, which gains `maps` (a JSON `MapFile[]`) |
| `explore` (new, public) | `playerId` pk, `gameId` ix; the prototype's `ExploreState` but the story: `map`, `at`, `facing` (`Tile2`), `steps`, `hidden`, `scene` (option: the scene opened from here, while it's played), `followers` (`Follower[]`), the quips' memory (`quips`, `lastQuip`, `styles`); and what the last move said: `acts` (bumped by every move), `said`, `log` (the last five, as `town.log`) |
| `place` | + `mapKey` (option), `region` (option: the map region it fills), `origin` (option `Tile2`: its world's (0, 0) feet, 5 ft a tile), `active` (bool: on its map now) |
| `game` | + `leadScene`, `leadText` (options, V3's names) |
| `scene` | `status` gains `waiting`: built, not yet opened |

Product types: `Tile2 { x i32, y i32 }`, `Follower { id, name, glyph, color, map, at: Tile2 }`. Each new column has a default, so a V1 database migrates.

### 3.2 The moves (K's stubs refuse `not_built`; S makes them)

| Reducer | Args | Maps onto the prototype's ids |
|---|---|---|
| `walk` | `to` option `Tile2`, `toward` option string | `to`: `walk@x,y`. `toward`: a compass word `walk_<dir>` (one step); `lead` `go_to_lead`; `out` back to the map from an ended scene (§3.3); anything else `go_to_<toward>` |
| `interact` | `verb`, `target` option, `at` option `Tile2` | `use`: `interact` (the `e` key); `look`: `look`, or `look@x,y`; `talk`, `examine`, `enter`, `take` + `target`: `<verb>_<target>`; `open` + a compass word: `open_door_<dir>`; `talk`, `enter` + `at`: `<verb>@x,y`; `open` + `at`: `door@x,y` |
| `travel` | `way` option, `at` option `Tile2` | `travel_<way>`, `travel@x,y` |

`shared/map/moves.ts` (K) has both directions: `actionId(move, args)` and `moveOf(id)`. Each move is the controller's: the simulation builds the `ExploreState` from rows, runs the copied `act(ex, unheard, id)`, writes the `explore` row back (`said` and `log` from the act's text, `acts` + 1), moves the seats when the map changed, and on a scene trigger calls `openLead` in the same transaction. Refusals: `not_in_game`, `not_controller` (V0's); new: `scene_on` (in a scene not yet ended), `no_way` (not on a map), `unavailable` (an id the code doesn't offer from here), and `not_in_scene` for `say` on the map. A bump, a shut door or "nothing there" is the prototype's said line, not a refusal.

### 3.3 The town and the places on it (S)

- **The game starts on its campaign's start map** when `campaign.json`'s `start` names one (`map`, `at`); with none, the first scene opens at once, as V1. `begin` and `new_game` then make: the map's place (`map:caerwyn`, `mapKey` caerwyn, `origin` (0,0), active), the seat in it, the `explore` row at (42,9) facing south, the lead (`leadScene` the first scene), and the lead's place and scene.
- **The lead's place is built on its map** (its region by `sceneId`, its origin the region's `worldOrigin`), from its place file with the cast present at the scene's start, and no player; its scene row is `waiting`, with `initialGm`, `placeId` that place. The map draws it from rows: its people waiting (talking to them opens the scene), its things seen from afar. V3's boundary does the same for the next lead.
- **The town's people and things hold no state yet**, so the copied `presence.ts` and the map's legend make them on both sides from the time of day. V10 gives the town its own rows when the rules can change it.
- **Back to the map:** `walk({ toward: "out" })` from an ended scene runs the copied `leaveScene` on the scene's world (where it left the player, or the place's `after` when they can't walk out), clears `explore.scene`, and moves the seats to the map's place. The scene's place keeps its rows: the map draws it as the prototype's overlay did, and once you're out, `lockedAfter` keeps you out.
- **Seats follow the controller:** every spectator's `player` row moves with the host's (into a scene, back to the map, to another map). A game on the map can be joined.
- `my_names` also covers the people in the places on the seat's map; `my_games` says "heading for The Hanged Clerk" while it waits.

### 3.4 Rows to the map, and back (M, in `shared/map/rows.ts`)

`exploreOf(rows: MapRows): ExploreState` is the seam both sides call. `MapRows` is the campaign's maps, the walker's `explore` row (the controller's), the story (`game.time`, `leadScene`, the ended scenes' keys in order), the game's places on maps with their rows, and the unheard names (asHeard's pairs). It fills `MAPS` (`useMaps`), sets the waiting places' worlds on `ExploreState.waiting`, and makes the overlay from the played places' worlds with the copied `captureScene` (what was burning has burned out by a later hour). **No `gm_note` on either side:** the map is drawn and walked from the rows a client sees, so both sides offer the same ids. `exploreRowOf(ex, prev, said)` is what to write back.

### 3.5 One way into a scene (S)

`openLead(tx, actor, game)` in `simulation/src/map/lead.ts` opens `game.leadScene`'s waiting scene through V0's `openScene`, with the start things on the game's first scene. `openScene.resolve` opens a waiting row when there is one (its `gm_state` and its place kept: the player's character joins it, the entities' order made `buildWorld`'s again, so the opening's request is V0's), else V0's insert. It moves every seat of the game into the scene, and sets `explore.scene` and the spot (`enterScene`). The map's triggers call it; so does the whole story's "Go on" (V3's `walk({ toward: "lead" })` where there's no map). The opening, its job, key and stream are V0's.

### 3.6 The client (C)

- **Rows:** + `map_def` (the game's campaign version), `explore` and `place` (by game), and for each place on the seat's map: `entity`, `position`, `area`, `material`, `health`, `stack`, `surface`, `creature`, `player_character`, `narrative`, `look` (by place; never `gm_note`). `Backend` gains `walk`, `interact`, `travel`.
- **Screens:** `explore` when the seat has no scene and the game has an `explore` row; the scene otherwise. An ended scene stays up until Enter ("back to the map": `walk out`).
- **A walk a step at a time:** keys, clicks and `g` take one `walk({ toward: <compass> })` a step, 45 ms apart (`KM_APP_STEP_MS`), so any key stops it, as `stepAlong` does. A whole walk in one move (`toward: "lead"`, `to`) is the headless verbs' and the e2e's.
- **Headless:** `observe` on the map is the QA console's (`MODE: explore`, the whereabouts line, `townText` at 80x24, `look`, further off, the lead, "Recently" from `explore.log`, `ACTIONS:` from `town.actions`); `act --id` takes any map id; `new` and `begin` print the map.

---

## 4. The packages

K lands first; M, S and C build from K's commit on `claude/v2-map-m`, `-s` and `-c`; the integrator merges M, S, C in that order into `claude/v2-map`. K's stubs are their package's to fill (M's in `shared/map`, S's in `simulation/src/map`); K's other files change only through the integrator (a package that needs a contract changed says so in its report). M commits its plain copies first, so S and C can merge `claude/v2-map-m` early and work against real code.

**K · Contracts.** Owns this brief; `schema.ts` (§3.1), the stubs (`simulation/src/map/`: the three moves and `openLead`), their registration in `index.ts` and the memory host, `tables.ts`, the delete lines; `shared/map/{types,tiles,quips,maps,moves,rows}.ts` and the stubs `explore.ts`, `town.ts` and `reconcile.ts` (the names M fills: `stub.ts` goes with the last); `shared/scene/files.ts` (`MapFile`, `CampaignFile.maps`, `start.map`/`at`, `CampaignPack.maps`, `InstallArgs.maps`); the install's `maps`; the refusal codes; `client/module_bindings`. **Done when:** `npm run check` passes, the bindings are current, a scratch stack plays a V1 game as before.

**M · The map, shared, and the campaign.** Owns `shared/map/*` (the copies over K's stubs, `exploreOf`, `exploreRowOf`), `asHeard`/`strangers`, `campaigns/caerwyn/maps/*.json` and `campaign.json`'s `maps` and `start`, the campaign check's map lines (`hosts/dev/campaign.ts`), the converter and its check in `tools/v2/` (outside v2, durable), the copied walking tests. **Builds against:** §2, §3.4; K's types. **Done when:** each converted map builds (`mapOf`) deep-equal to the prototype's `MapDef`; on rows for the lane in the morning, `targets` has `talk_kell` and `go_to_lead` walks into the yard with a scene trigger; the Rat's door says it's shut; the copied walk and steer tests pass; `tsc -p simulation` passes (ES2021); the campaign check passes. **Must not touch:** `simulation/`, `client/`, `ai/`.

**S · The simulation.** Owns `simulation/src/map/*` (the moves over K's stubs, `openLead`, the start on the map), `moves/open-scene.ts` and `world/place.ts` (a waiting scene and its place), `say`'s `not_in_scene`, `join-game.ts`, the seats following, `views.ts` (`my_names`, `my_games`), the memory host's moves, `host/testing.ts` (`caerwynPack()` keeps the start off the map, so the stack's tests open at once; `caerwynPack({ map: true })` for the map's), `hosts/local.ts` and its test. **Builds against:** §3.2, §3.3, §3.5; M's code (merge `claude/v2-map-m` when it lands; until then the stubs). **Done when (memory host):** a new game starts in the lane with the yard built and its scene waiting; `walk({ toward: "lead" })` and `interact({ verb: "talk", target: "kell" })` each open it, and the opening's request equals V1's direct opening; a step into a wall says a bump line and moves nothing; a spectator follows into the scene and back; `walk out` after an ending puts the player where the scene left them, free to leave the yard and locked out of it once they have, the yard as left; the stack's tests pass. **Must not touch:** `shared/`, `client/`, `ai/`.

**C · The client.** Owns: merging `claude/v2-world-d` at 39abd6b first (then `client/ui/types.ts`'s map types re-export `shared/map/types.ts`); `client/map/*`, `client/look/map.ts`, `client/explore/*`, `ui/explore.tsx`, the app's screen switch, `net/connection.ts`' rows and moves, `backend.ts`, `headless.ts` and `hosts/play.ts`' usage, `demo.ts`, the screen check. **Builds against:** §2, §3.6; K's bindings; M's code. **Done when:** the screen check draws the lane in the morning and the map after the scene at 80x24, 100x30 and 130x42; `--demo` starts on the map and `g` opens its canned scene; a model test steps a walk and stops it with a key; the copied pick and x-ray tests pass; `client/imports.test.ts` holds. **Must not touch:** `shared/`, `simulation/`, `ai/`.

**Integration.** Owns the merges; `hosts/e2e.ts` (the stack's scenarios walk in first; new: a walk from the lane opens the yard's scene with two clients' `explore` events equal, talking to Kell opens it, the Rat says it's shut and nothing moves, `walk out` after an ending); `hosts/arc.ts` checks 2 to 4; the live run (an opening started by talking to Kell, real models, beside the prototype, under $0.10); `v2/README.md`, the READMEs touched, this brief's "As built"; the PR's description (§1). **Done when:** `npm run check`, `npm run e2e` (one run) and `npm run arc` pass; the root's checks pass; §1 played once.

---

## 5. Departures, and risks

| The plan says | V2 does | Why |
|---|---|---|
| The town's people, doors and things are entity rows | The copied `presence.ts` and the map's legend make them from the time of day, on both sides | They hold no state until the rules can change the town (V10); drop in |
| `world_event`, an event table: `walked`, `bark` | What a move said is on the `explore` row (`said`, `log`); a walk is a move a step | The QA console's "Recently" needs the lines kept, and any key stops a walk, as in the prototype |
| A place's things looked at from the map show their description | They don't: the map is built without `gm_note` | Both sides must offer the same ids; the GM's notes stay behind its screen |
| Places to come are shown before they're the lead | Only the lead's place is built (V3 builds the next) | The client may not read the place files |

**Risks.** A move runs the prototype's searches in a reducer (`targets` runs one per thing in sight): the e2e prints the moves' times, and over 100 ms the search is cached per state. The map's copies run in the module: `tsc -p simulation` catches ES2021, and nothing in them reads a clock or `Math.random`. Ids must agree on both sides: both build from the same rows by the same code, and an id that's gone is `unavailable` ("observe again"). V2 and V3 meet at `leadScene`, the waiting scene and `openLead`; whichever lands second adapts.

---

## 6. As built

The map keeps to this brief, but for these departures, each with its reason. The packages' reports (K, M, S, C and I, in the author's scratchpad) and the PR give the full account. Every copied file's first line names its source at `44c6d4a` and its edits. The plan's section is [verticals.md](verticals.md) §3, V2.

### The shared map and the campaign (K, M)

| The brief says | The build does | Why |
|---|---|---|
| `maps/caerwyn.txt` and `caerwyn.json` (the plan) | One file a map, `campaigns/caerwyn/maps/<key>.json`: K's `MapFile`, the grid as rows inside it | Each map is one `map_def` row, read whole |
| The town's people in `presence.ts`'s code (§3.3) | In the map's file: `MapFile.people` (who, where, at which hours: 30 on Caerwyn's), which `presence()` reads through `peopleOf` | Who's about and when is data (the plan's `places/caerwyn.json` line). At every hour of the arc, on every map, the copy's `presence()` deep-equals the prototype's |
| `town.ts` copied but 465-490 | And one fix: a way out that's shut at this hour (the Rat's door before dusk, the palace gate) says so to `travel_<way>`, `travel@x,y` and the `e` key, as it does to a step into it | At `44c6d4a` those three went through: `travel_drowned_rats_door` in the morning took you into the Rat |
| The places of the scenes to come | `PLACES` keys them by their regions' ids (`drowned-rat`, `heron`, `dressing-room`) | V3's and V4's place files should take those keys, or change `places.ts` |
| The converter in `tools/v2/` | `tools/v2/map-files.mts`, whose check (on every write, or `--check`) builds each map from its file (`mapOf`) and deep-equals it with the prototype's `MapDef`, map and decor | Outside v2: it imports the prototype |

### The simulation (S)

| The brief says | The build does | Why |
|---|---|---|
| `openLead(tx, actor, game)` | A fourth argument, `walked`: the state the move walked, which the move then writes | One write of the explore row a move. V3's Go on calls it with three, and the row is read and written for it |
| The lead's place built with its cast and no player (§3.3) | Built as `openPlace` builds it, with the character, so every spot is where the opening will find it, then the character taken out (`waitingPlace`). At the opening `joinPlace` puts the character, the purse and the kit back and numbers the entities in V1's order | The opening's request is V1's: a test opens a V1 game beside a walked one and finds the two requests deep-equal |
| The map's own place, `map:caerwyn` | Has no world (`rootId` 0, no entities) | The town's people and things come from `presence.ts` and the map's legend, on both sides |
| `walk out` from an ended scene | Any map move from an ended scene walks out first. Walk out on the map is `unavailable`, from a scene still being played `scene_on`. The log is cleared, as the prototype's `afterScene` cleared the town's | So headless `act --id go_to_lead` after an ending works without Enter |
| (not in the brief) | Every move logs `[map] game <id> <action id> <ms> ms` | The e2e prints them (§5's risk) |
| (for V3) | The character's entity stays in the yard after the scene (`pc:<player id>`, with its kit and pockets) | An entity key is unique in a game: V3's next opening must move or remove it before it adds the character to the next place |

### The client (C)

| The brief says | The build does | Why |
|---|---|---|
| Merge `claude/v2-world-d` at 39abd6b | At `c8273bf`, its head | D rewrote the branch: 39abd6b is `83782a9` now |
| `setup.ts:196-215` (`areaHazards`) | Its dust from the battlefield's dust lines (`setup.ts:91-103`), run on the place's own map | The battlefield is the fights' (V12) |
| `view-check.tsx` and `view.tsx` (MapView) | Not copied | The explore screen paints on the look layer's canvas, as the prototype's does, and the screen check draws it |
| `g` | With no lead to walk to, it sends `go_to_lead`, so the simulation's "Nowhere to walk to: the story comes to you from here." is said | The prototype's app said "The story will come to you from here." itself |
| The copied pick and x-ray tests | The Rat's world becomes the yard's, and the yard's frames are compared with `renderExplore` only outside whoever's hidden | The Rat comes with V3; the yard isn't an open room |
| (not in the brief) | `act --id out` walks out of a scene that's over | Walk out has no prototype id |
| The map's rows (§3.6) | Read as the simulation reads them, with two differences, both the same in V2: a place's scene time is the game's time of day (the simulation reads the scene file's), and an entity on another map counts as unheard | The client has no scene files, and nobody is on another map yet |
| (not in the brief) | Talking to Kell after the scene is offered ("e Talk to Sergeant Kell"), the copied code's label | Talks are V11's; the town code keeps the label |

### The integration (I)

| The brief says | The build does | Why |
|---|---|---|
| The client's subscriptions (§3.6) | The map waits for its places' rows: `Connection.explore()` gives the map as it was, or none yet, until the set naming the places is in | Set off from a character just made, the lane was drawn before the yard's world came: nobody in the yard, and no `talk_kell` (the arc's check 3 failed on it) |
| The e2e's new scenarios (§4) | In the steps where they happen. Step 2 talks to Kell (a line on the map refused first). 14a, after the ending: back to the map where the scene left A, both seats on the town's place, the lead nowhere, the yard locked once you're out, the Rat shut in the morning with nothing moving, and B's explore events the same as A's. Step 17: B joins on the map and watches A's walk from the lane into the yard, both clients' explore events the same, move by move. C walks in at 19. Step 22 prints the map moves' times, and the delete check counts `explore` | The steps before stay as they were, and V1's numbering with them |
| The live run (§4) | Every script's game opens its scene by talking to Kell, and the record says how it came in. `--script map` plays V0's first three lines after it, and V1's creation run walks to the lead after `begin` | The campaign starts on its map now |

### What the live run showed

[docs/live/map-2026-10-16.md](live/map-2026-10-16.md), with real models: a game in the lane, `talk_kell` ("You walk 1 step south-east. You go over to Sergeant Kell.", the scene open 85 ms after the move), the opening and three lines, $0.0175. The prototype's QA console then played the same character and lines ($0.0143; $0.0318 in all). In the lane, observe drew the same map as text, byte for byte, with the same words under it and the same 26 ids (the prototype's action menu after them is V10's). Talking to Kell said the same words and opened the same scene, with the same prompt: 17,606 tokens in both. The three lines took the same routes and rolled the same checks: Medicine against DC 12 (19 and 18, both successes), then Insight against Moll's DC 13 (8 and 5, both failures). The replies told the same facts in different words: the porters at first light; a thin, level cord mark under the noose's burn, a swelling at the back of the skull, clean palms; Moll holding to her midnight story. First words came in 1.6 to 2.6 s (the prototype's 1.4 to 1.8 s). The costs differ mostly by the provider's cache: the prototype asked second.

### The checks

`npm run check`: the type checks (v2's, and the module's ES2021 one), 645 tests and the screen check (PASS: 583). `npm run campaign -- check campaigns/caerwyn`: 4 maps, no problems. `npm run e2e` on 3910 and 9410, namespace mode: PASS, every step, in 292.9 s; the map's moves took 1 to 55 ms in the module, but for the creation game's first opening (`go_to_lead`, 373 ms with the scene opening). `npm run arc`: PASS, 4 of 16 checks on. At the repo root, `npm run typecheck` and `npm test` (789). A playthrough of §1 on the fake model with two TUIs at 100x30 and the headless verbs, and the live run above.

### Left for later

- **V3, the story carries on:** the next lead (the Rat at dusk). `buildLead` builds a lead's place waiting, and `openLead` opens it; the character's entity in the yard must move first. Until then the lead stays the hanged clerk, played: "Nowhere to walk to".
- **The world bridge:** its look layer and the scene's place beside the talk are in (`claude/v2-world-d`, merged with the client); its own unit turns on the arc's check 5.
- **V10:** the action menu on the map (spells, blows, leaps, hiding, throwing), and the town's people and things as rows.
- **V11:** a talk with Kell between scenes.
- **V12:** fights in the street.
