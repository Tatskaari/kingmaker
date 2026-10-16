# Building v2, a vertical at a time

The plan for the production build: the client, the simulation (a SpacetimeDB module) and a stateless AI service, built as a stack of vertical slices until v2 plays everything the prototype does, and then on to the design's target.

- **Where it starts:** V0, a line in a scene, whose blueprint is [v0-design.md](v0-design.md). This plan agrees with it and says what comes after.
- **The prototype** is read at `44c6d4a` ([ARCHITECTURE.md](../../ARCHITECTURE.md) is its map). It stays playable throughout; v2 copies from it and never imports it.
- **The shared AI code** is [v2/ai](../ai/README.md) (the model client, the prompts and the docs service, from `claude/v2-ai-shared`), which the prototype already runs.
- **The design** is the roadmap ([src/web/site/roadmap](../../src/web/site/roadmap/index.html)) and its long form, `content-server.md` (CS below). It sets the patterns, not the order.
- **The research** behind this plan: `spacetime.md` (SpacetimeDB 2.12, measured), `gm-port.md` (the GM pipeline as endpoints), `content-world.md` (the campaign format and the world as rows), `client.md` (the client as a client of rows).
- **Not in the repo:** `content-server.md` and the four research notes live in the author's scratchpad, so the references to them name a section rather than link.

The shape is settled, and every vertical keeps to it:
- **The client talks only to SpacetimeDB.** Moves are reducers; it subscribes to tables and per-caller views; it never rolls a die or calls a model.
- **SpacetimeDB calls the AI service.** A move that needs the AI writes a `job` row and schedules `run_job`, a scheduled procedure that POSTs the request and commits the answer; a reaper re-dispatches a job stuck past its deadline.
- **The AI service is stateless.** Every request carries its working set and its idempotency key; every answer is data. Its stores (each game's documents, call logs, the ledger, answers by key) sit behind interfaces, a folder for now. It holds the prompts, the campaign's words and the only OpenRouter key, and it streams the GM's words back through the service-only `stream_reply` reducer over SpacetimeDB's HTTP API.

Written 16 Oct 2026. Sizes and hours are estimates.

---

## 1. Why verticals, and how one is built

**Why.** The design's own plan is horizontal: a baseline, the AI boundary in one process, rows and moves, one world, the campaign as data, then the services, then multiplayer. Nothing would run on SpacetimeDB until the fifth phase, so the risks the split adds (procedures, local networking, streaming, prompt parity) would surface last, and nothing would be playable on the split until then. Verticals turn that round. V0 runs the whole split for one line in one scene. Every later vertical adds something a player can do, built through every part it touches, following the design's patterns but not its order. They cut where the prototype already cuts: its app's controller (`src/app/game.ts`) is written in sections by screen (title and creation, explore, the action menu, scene, the scene's place, marks, combat, the look, reports, the End). So a vertical ports one slice you can point at: a screen and its controller section, its moves, its model calls and its content. Wherever the stack stops, it's the real game, cut short.

### How a vertical is built

A team of four to six agents, in about two to three hours, in three steps: V0's way of working (v0-design §11), at a smaller scale.

1. **Contracts first** (one agent, under an hour): the tables, the reducers' and views' signatures, the AI API's request and answer types in `v2/shared/protocol`, the refusal codes, and the regenerated bindings. Stubs refuse with `not_built`.
2. **Lanes in parallel**, an agent or two each:
   - the simulation: moves, commits and jobs, with unit tests on the memory host;
   - the AI service: endpoints, the copied GM code and golden prompts;
   - the client: screens, view models, the screen check and the headless client's verbs;
   - the campaign: conversions and data.
3. **Integration** (one agent): the end-to-end scenarios, the arc's checks, the live run, the docs and CI.

### Done means

- [ ] `npm run check` passes: the typecheck, the unit tests (every move on the memory host) and the screen check.
- [ ] `npm run e2e` passes: the vertical's scenarios on a local SpacetimeDB, with the AI service on the fake model, driven through the client's `Connection` (two clients, with their row events compared, wherever someone else watches). Where the vertical adds a think, the scenario kills each service mid-think and the move still finishes, with each model call made once when its answer was kept.
- [ ] `npm run arc` passes with the vertical's flow checks turned on (§2).
- [ ] Golden prompts: every model call the vertical adds or changes matches the prototype's recorded request byte for byte, or the difference is listed with its reason.
- [ ] A short live run with real models, where models matter: `npm run live`, recorded in `v2/docs/live/`, with each turn's first-text time and cost.
- [ ] Docs: a line in `v2/README.md`'s "What you can play"; the READMEs it touches; every copied file headed by its source path at `44c6d4a` and the edits made.
- [ ] CI is green: `v2.yml`'s check, e2e and container jobs, and the prototype's `check.yml` when `v2/ai` or `v2/shared` changed.
- [ ] One PR, stacked, whose description shows the demo. (V0 is the exception: its blueprint splits it into six package PRs, A to F.)

### Rules every vertical keeps

- **v2 never imports the prototype.** It copies, and says what it copied. `v2/ai` imports only itself and `v2/shared`. The prototype may import `v2/ai`.
- **Moves are plain functions over `TxCtx`** (v0-design §4). SpacetimeDB-specific code stays in `simulation/src/index.ts` and its adapters, so every move also runs on the memory host.
- **Simulation code is deterministic.** Time is `tx.now`. Randomness is the game's `dice` row. Commits are pure functions of the rows, the plan and the answer, since `withTx` may run one twice.
- **Every think has an idempotency key,** and the AI service answers a repeated key from its store.
- **A move is written for an actor and a seat, never for "the player".** Refusals name the scene's controller, and rows are keyed by player. Two players then add rules, not rewrites.
- **End-to-end scenarios reach the simulation only through `client/net/connection.ts`,** so the same scenarios can later run on the local host.
- **Registries are append-only, one line per entry:** the module's exports, `MOVES`, the AI service's router, the client's screen switch, the e2e scenarios and the arc's checks. From V1, tables live in a file per area, gathered in `schema.ts`. Generated bindings are regenerated after a rebase, never merged by hand.
- **Tools that import the prototype** (the scene converter, the golden-prompt recorder, the characterization script) live outside v2, somewhere durable: the prototype's `tools/` will do, since the prototype may reach into `v2/`. Not a scratchpad: a reboot lost one on 16 Oct. Only their output is committed to v2.
- **No new runtime dependency** without a reason in the PR.

---

## 2. The verticals at a glance

| # | Vertical | After it, a player can… | Needs | Size (new + copied lines) | Team · hours |
|---|---|---|---|---|---|
| V0 | A line in a scene | play the hanged clerk as a ready-made character, while a second terminal watches the reply grow; a turn survives either service being killed | `claude/v2-ai-shared` | ≈3.5k + 6k | 6 · 4 |
| V1 | Who you are | make a character from a sentence, read the sheet, begin as them; continue a saved game | V0 | ≈1.4k + 3.5k | 5 · 2.5 |
| V2 | Walk Caerwyn | start in the granary lane, walk the town, walk or talk their way into the scene | V0 | ≈2k + 6k | 6 · 3 |
| V3 | The story carries on | end the scene through any exit, read the card and the notebook, go on to the Drowned Rat and play it | V0 (walked, once V2 is in) | ≈1.8k + 1.5k | 6 · 3 |
| V4 | The Heron, the King and The End | go on to the Heron, be summoned by the King, and reach The End (fights skipped) | V3 | ≈0.6k + 0.4k | 4 · 2 |
| V5 | The reply as drawn | see each speaker in their colour, open notes on marked words, pick suggested lines | V0 | ≈0.8k + 2.2k | 5 · 2.5 |
| V6 | People remember, the GM steers | meet people who remember what they did; have a drifting scene steered back | V0 | ≈0.9k + 0.6k | 4 · 2 |
| V7 | A spell or a blow in a scene | cast, strike, shove or jump in a scene, and see the dice, the reactions and the fire spreading | V1 | ≈1.5k + 3.5k | 6 · 3 |
| V8 | The GM rules on it | get a considered ruling and a roll for a risky act no route covers | V7 | ≈0.6k + 1k | 4 · 2 |
| V9 | The scene's place, and deeds | see the place beside the talk, point at things, and act from its menu | V2, V7 | ≈0.8k + 2.5k | 5 · 2.5 |
| V10 | The rules on the map | aim spells and blows from the action menu, Fireball a door, hide and rest | V9 (so V2, V7) | ≈1.2k + 1.9k | 5 · 2.5 |
| V11 | A talk with Kell | stop and talk with a companion between scenes | V3 | ≈0.7k + 0.9k | 4 · 2 |
| V12 | Roll for initiative | fight Sallow and the Crakes on the map, then play the aftermath | V2, V4, V7 | ≈1.5k + 3.3k | 6 · 3 |
| V13 | Words in a fight | type what they do in a fight and have it read onto their turn | V12 | ≈0.5k + 1.5k | 4 · 2 |
| | **Parity with the prototype on the demo arc (§4)** | | | | |
| V14 | Play in a browser, and without a server | play in a browser tab; open a PR's preview with no server | parity | ≈3k + 2k | two PRs |
| V15 | Two players | share a game BG3-style: watch, ask for the lead, hand it over | parity | ≈2.5k | 5 · 3 |
| V16 | Playtesters | play on an allowlist within daily caps, and report a problem | parity | ≈2k | 5 · 2.5 |
| V17 | Hosted | play on a hosted machine, the AI service on Cloud Run or Lambda | V16 | ≈1.5k | 4 · 3 |
| V18 | One world | see fire, water and breaking behave the same in scenes, in town and in fights | parity | ≈3.5k | 6 · 3+ |
| V19 | Campaigns as packs, and the zoo | install a campaign by version, tour the zoo, add a skep of bees as data | V18 | ≈3k + the zoo's data | 6 · 3 |

"New" is code written for v2; "copied" is code copied from the prototype and adapted, reviewed by diff. Content (scenes, places, maps, lore) isn't counted.

### The arc check

`npm run arc` ports the prototype's whole-arc check (`src/app/smoke/flow.ts`): the headless client plays a new game against a local SpacetimeDB with the fake model, walks to each lead, and ends each scene through `end_scene`, an owner-only move (the QA console's `end --exit`). It arrives with the first vertical that turns a check on. Until V12, it ends the Heron through `caught-in-the-act` instead of the fight.

| # | The check (flow.ts's words) | On with |
|---|---|---|
| 1 | the character is built by the rules engine | V1 |
| 2 | the story starts in the morning, heading for the granary | V2 |
| 3 | observe: the lane by the granary gate, Kell to talk to | V2 |
| 4 | the granary yard opens the hanged clerk | V2 |
| 5 | the scene's place is drawn with the player in it | V9 |
| 6 | on to the Drowned Rat at dusk | V3 |
| 7 | Kell walks with the investigator | V3 |
| 8 | down the river stairs and into the Rat | V3 |
| 9 | on to the Heron at night | V4 |
| 10 | along the wharf to the Heron | V4 |
| 11 | Roll for initiative! | V12 |
| 12 | Sallow and the Crakes are in the fight | V12 |
| 13 | after the fight, back to the Heron for its aftermath | V12 |
| 14 | the King's morning opens straight away | V4 |
| 15 | The End | V4 |
| 16 | observe says The End | V4 |

After V0 to V4, 12 of the 16 checks pass: the story plays from the title to The End on the split, with only the scene's place and the fight to come.

---

## 3. The verticals

Each section gives what the player gets, then each part's slice, the prototype code it ports from, the patterns it brings in, how it's proved, what it leaves for later, and its risks.

### V0 · A line in a scene

The blueprint is [v0-design.md](v0-design.md): contracts, packages A to F, tests and risks. In short:

- **After it:**
  - A player starts a game as a ready-made level-3 character (ranger, rogue or wizard) and watches the hanged clerk's opening stream in.
  - They talk with Kell, Cob and Moll. Routes, checks, cues and endings work, and every die comes from the game's `dice` row. The scene ends through its wind-down turn.
  - A second terminal (`--join`) watches the same scene row for row, and sees the reply grow.
  - Kill either service mid-turn, start it again, and the turn finishes.
- **Client:** the scene screen cut from `src/app/ui/scene.tsx` (364 of 628 lines), its `SceneModel` and `sceneViewOf(rows)`, as the client research verified them; a connection that follows `my_seat`; spectators; `npm run play` (new, join, observe, say, retry, transcript) with the QA console's `MODE:` and `PHASE:` lines; the screen check.
- **Simulation:**
  - The tables in v0-design §3.1, with `markup` on `transcript` and `reply_draft`, `title` and `hook` on `scene`, and `look` rows from the campaign.
  - Moves `newGame`, `joinGame`, `say` and `retryTurn`; the GM's `openScene`.
  - `run_job`, the scheduled procedure (one think per dispatch); `reap_jobs`; `stream_reply` and `service_ping` for the AI service only; `install_campaign` and `ping_ai` for the owner only.
  - The bookkeeping copied from `src/runtime/engine.ts`, and the world store (`scene-world`, `inventory`, `systems`) in `v2/shared/world`, with rows↔world.
  - The memory host, which runs every move in the tests.
- **AI service:**
  - `v2/ai/gm`, copied behind `TurnView`: brief, knowledge, markup, voice, the director trimmed to V0's questions, the directives' words, the stage manager.
  - `POST /v1/scenes/open`, `/v1/turns/decide`, `/reply` and `/settle`; `PUT /v1/campaigns/{c}/{v}`; `GET /v1/health`.
  - Stores behind interfaces, folders for now: answers by key (with a concurrent duplicate joining the request in flight), call logs, the ledger, campaigns. The stream sink. Usage in every answer. A canned GM for bring-up. The Containerfile.
- **Campaign:** `v2/campaigns/caerwyn` (the hanged clerk, the granary yard, 154 lore docs), `builds.json` and `looks.json`; `npm run campaign -- check` and `npm run install-campaign`.
- **Infrastructure:** v2's package, tsconfigs and `v2.yml` (check, e2e, container); `npm run dev` in host or namespace mode (§6), the doctor and the live run.
- **Patterns:** the four phases of a move on a `TxCtx` seam with two hosts; a job row, a scheduled procedure, a reaper and an idempotency key; the request built in the transaction that queues it; a service-only reducer streaming into a draft row; turn phases as rows; refusals as `SenderError` JSON; subscriptions that follow `my_seat`; the world as rows with its words in `narrative`; the campaign split into structure and words; the AI service's stores behind interfaces; golden prompts.
- **Proof:** v0-design §10: unit tests on the memory host; prompt parity against recorded prototype calls; the endings scenarios on the local host; the e2e with the kills; a recorded live run of four lines at about $0.004 a turn, first words within 0.3 s of the prototype's 1.4 s.
- **Leaves out:** the map, the rules engine, character creation, colours and notes, mechanics, the co-GM and memory reviews, exits' effects and boundaries, talks, fights, caps and the browser.
- **Risks:** v0-design §12. Procedures are labelled unstable in 2.12, so the CLI and package are pinned at 2.12.0, with the worker design (spacetime.md §9.2) as the documented fallback behind the same job rows. Namespace mode rests on one evening's runs. The `v2/ai/llm` seam is shared code.

### V1 · Who you are

- **After it:**
  - The game opens on the title: New, Continue, Quit.
  - A character is made from a sentence: three builds that fit it, or the player's own. A backstory is typed or drafted, then checked against Caerwyn's lore.
  - The player reads the sheet, then begins as that character. `/sheet` works in a scene.
  - Continue lists the player's games, and a game can be deleted.
- **Client:** `ui/title.tsx`, `create.tsx`, `creation-layout.ts`, `sheet.tsx`, `sheet-layout.ts` and `portraits.ts`, copied; the title and creation section of `game.ts` (lines 466-900) as a `CreationModel` over rows; one identity token per profile; `npm run play -- new` takes a concept and the QA console's `--build 1|2|3|own:…`.
- **Simulation:**
  - **The rules engine in the module:** the module-ready copy of `vendor/dnd-srd-engine` with the spike's three workarounds (no `node:module` banner, `NODE_ENV` inlined, a `crypto` and `process` shim that draws on the dice), cached per isolate, seeded from the `dice` row.
  - **Tables:** `creation` (a draft per identity: the concept, the offered builds, the choice, the backstory and its check), read through a `my_creation` view; `rules_state` (the engine's campaign snapshot) and `rules_log` (its events since, with a new snapshot every 50); `sheet` gains hit points, armour class, slots, conditions and what the character can do.
  - **Moves:** `newGame({ campaign, name, concept })` writes the draft and schedules `makeCharacter`; `chooseBuild`; `setBackstory`; `draftBackstory` and `checkBackstory` (jobs); `begin`, which makes the character (`createCharacter` and `refresh`, `dnd.ts:390-447` and `:116-125`) and opens the first scene; `deleteGame`. A ready-made build still needs no AI. A `my_games` view.
  - Route checks now roll through the engine's skill check (`rollFor`, `dnd.ts:905`), as the prototype does with a sheet, still from the `dice` row.
- **AI service:**
  - `POST /v1/characters`: the model half of `src/rules/builds.ts` (`rules.build`).
  - `POST /v1/backstories`, with `draft` or `check`: `v2/ai/docs/backstory.ts`, already shared.
  - The player's doc is written into the game's docs at `begin`, not on the first read (a sharp edge in gm-port §17).
  - A daily spending ceiling in the service (`KM_AI_DAILY_USD`, read from the ledger): over it, model endpoints answer `402 over_budget` and the move fails in the game's words. Agents run live checks unattended from here on.
- **Campaign:** `campaign.json` gains the story's premise for creation (`PREMISE` in `v2/ai/docs/backstory.ts`, hard-coded today), the world docs the backstory reads, the starting level and the rules pack's id.
- **Patterns:** jobs that aren't turns; a flow of several steps as rows, moves and jobs, before a game has a scene; the rules engine inside a reducer; a player's games found by identity.
- **Proof:**
  - Offline: the builds and backstory tests, copied; `createCharacter` on the memory host gives the prototype's sheet for the same build and seed; the screen check covers the title, creation and the sheet.
  - Measured: the server's own reducer times (`spacetime-execution-duration-micros`) for `begin` and a route check stay under 100 ms.
  - End to end: a concept to three builds to the opening; stream posts keep their latency while checks run.
  - Arc: check 1. Live: three concepts get fitting builds, and a backstory that contradicts the lore is flagged.
- **Defers:** levelling and resting between scenes (V7); the zoo on the title (V19).
- **Risks:** an engine reducer takes 50 to 90 ms and holds up every other reducer, stream posts included: cache the engine, snapshot the log, keep engine work off `stream_reply`'s path. The engine's ids read the clock and its randomness: the shim pins both. The sheet's layout is the biggest client copy.

### V2 · Walk Caerwyn

- **After it:**
  - A new game begins in the granary lane in the morning, on the isometric map.
  - The player walks the town with the keys, the mouse, or "go to the lead". People about change with the hour and talk; they go by what the player would call them.
  - Talking to Kell, or stepping into the yard, opens the hanged clerk.
  - The yard is a place on the map, and stays as play left it.
- **Client:**
  - `ui/explore.tsx` and its side panel (Nearby, the lead); the explore section of `game.ts` (901-1046) as an `ExploreModel` over rows.
  - Copied verbatim behind an adapter from rows: the renderer and x-ray (`src/game/map`: `render`, `xray`, `tiles`, `palette`) and the drawing parts of the look layer (`appearance`, `terrain`, `roles`, `light`, `color`, `glyphs`, `names`, `people`, `canvas`, `map`, `opentui`); the town's view from `src/game/views.ts`.
  - A walk is animated from its `walked` event. Subscriptions swap when `my_seat`'s place changes.
- **Simulation:**
  - `map_def` (the tile map, its legend and regions); `place` gains `map_key`, `origin` (5 ft to a tile) and `active`.
  - **The town as a place that persists:** its people, doors and things are entity rows, from `presence.ts` by the hour and the map half of `town.ts`. Nothing is rebuilt per act, and there's no overlay of what scenes left: the yard is its own place, with an origin on the map.
  - `walk({ to } | { toward } | "lead")` walks a step at a time, on the path code in `v2/shared` (from `src/game/map/explore.ts`), so the client offers only tiles it can reach. A waiting scene's place, a locked door or someone in the way stops it. Followers come too.
  - `interact({ verb, target })`: talk, enter, open, close, examine, take. Talking to a waiting scene's cast, or entering its place, schedules `openScene`, in the same transaction. `travel({ way })`: the river stairs, and the Rat's door, `shut` until dusk.
  - **The lead:** `game.lead_scene` and `lead_text`; a new game's first scene starts `waiting`.
  - `world_event`, an event table: `walked` with its path, and `bark` (`src/game/map/quips.ts`).
- **AI service:** nothing new: walking in opens the scene as V0 does.
- **Campaign:** `maps/caerwyn.txt` and `caerwyn.json` from `src/game/map/maps/caerwyn.ts`, and the Rat's, the Heron's and the palace's maps; `places/caerwyn.json` (regions, doors, who's about at each hour, their barks); each scene's place gets its origin on the map; `campaign.json` starts the game in the lane.
- **Patterns:** places that persist on a map; a reducer move that schedules a GM move; an event the client plays; a check shared by the client and the simulation (the path).
- **Proof:**
  - Offline: the walk, steer, pick, x-ray and map tests, adapted; the renderer's view check from rows at 80x24 and up.
  - End to end: a walk from the lane into the yard opens the scene; the Rat refuses entry in the morning (`shut`); two clients see the same walk.
  - Arc: checks 2 to 4. Live: an opening started by talking to Kell.
- **Defers:** the action menu (V10); the scene's place beside the talk (V9); fights in the street (V12).
- **Risks:**
  - The renderer and the look layer expect the live `ExploreState` and `SceneWorld`. Adapt their inputs (`rowsToWorld`); don't edit the copies.
  - The look layer imports from `src/game`, the map module and `runtime/speakers.ts`: cut those edges in the copy. The map's tables are filled at import in the prototype: fill them from `map_def` rows.
  - A town that persists is a change of behaviour: the tests should show it.
  - If it runs long, land V2a (the map drawn and walked) before V2b (walking into the scene).

### V3 · The story carries on

- **After it:**
  - The player ends the hanged clerk through any of its five exits and reads the closing, the card and the news. The notebook, the quests and the ledger page are in their pack, and Kell walks with them.
  - The lead goes to the Drowned Rat at dusk. With V2 the player walks there; without it, the card's "Go on" takes them.
  - The Rat opens with an opening rewritten for where the story is, and plays through to its ending. Places already played stay as play left them.
- **Client:** the scene's end and the way on (`scene.tsx:230-256`); `ui/between.tsx`; the notebook and quests overlays (`ui/overlay.tsx`, `src/app/story.ts`); the lead in the side panel; the time of day in the frame, and in the light once V2 is in. Kell's lines between scenes (`KELL_ON` and `talkBetween`, `game.ts:2405-2440`) become campaign data.
- **Simulation:**
  - **Tables:** `quest`, `flag`, `journal`, `attitude`; the `follower` component; `gm_state.handed_on`.
  - **The scene's end applies its exit's effects** through one gate, then the scene's `afterwards`. The interpreter covers the story operations: `quest`, `flag`, `attitude`, `give`, `remove`, `journal`, `lead`, and a new `follow` (Kell walks with the investigator: story code in the map module today, `src/game/map/explore.ts:104`). `remember` goes to the AI service with the boundary, since the simulation keeps no documents. `if` and `unless` test established facts. `startFight` is recorded (see V4).
  - **`crossBoundary`**, a job the end schedules, keyed once per ending. Its commit sets the next scene `waiting` with `handed_on` (the hand-off, the adjustments, the rewritten opening), and sets the lead and the time of day. Interludes are skipped, as the prototype's game skips them. What's owed is carried into the next place.
  - **The opening after a boundary:** presence is settled in the open commit, which removes absent cast (gm-port §17). Names heard carry across scenes in the `heard` rows.
  - **The way on without a map:** `walk({ toward: "lead" })`, when the campaign has no map for the player's place, moves them into the lead's place at once, which opens its scene. V2 gives it a path.
  - `end_scene({ exit })`, owner only, for the QA console's verb and the arc check.
- **AI service:**
  - `POST /v1/scenes/boundary`: `handoff`, `boundary` and `fronts` at once, from the boundary code in `engine.ts:981-1286`, `owed.ts`, and `v2/ai/docs/fronts.ts`. Under the request's key it writes the game's documents: the scene as played, the ending as a memory for everyone present and the exit's `remember`s (`remember.ts`), and the fronts.
  - `open` after a boundary: `director.presence`, the rewritten opening, the adjustments and the story so far.
- **Campaign:** `scenes/drowned-rat` and its place; the interludes, as graph only; every exit's effects. The converter is run per scene with its `FACT_IDS` and `EFFECTS` tables, written by hand. The campaign check gains the checks for effects and `afterwards`.
- **Patterns:** the scripting API's story operations, applied for real; a GM move run as a job from a commit; the AI service writing a game's documents; a waiting scene with its prep handed on; the way on by the lead.
- **Proof:**
  - Offline: every exit's effects equal the prototype script's recorded operations for every combination of facts (32 for the hanged clerk); the boundary, crossing and owed tests, adapted; golden prompts for `handoff`, `boundary`, `fronts`, `director.presence` and the opening after a boundary.
  - End to end: the hanged clerk ended → `crossBoundary` → the Rat waiting, with the lead → "Go on" or the walk → the Rat's rewritten opening. SpacetimeDB restarted mid-boundary, and the reaper finishes it on the stored answer.
  - Arc: checks 6 to 8. Live: a real ending gives the Rat a rewritten opening, a line for the lead, and the fronts moved on.
- **Defers:** talks with Kell (V11); the Heron, the King and The End (V4).
- **Risks:**
  - The world is built before presence is known: remove absent cast in the open commit.
  - Two more scenes' effects are translated by hand. Choosing among the boundary's candidates when play has overtaken a scene.
  - **V2 and V3 meet at the lead.** Whichever lands second adapts to the first. Their shared contract: `game.lead_scene` and `lead_text`, a scene's `waiting` status, and `walk({ toward: "lead" })`.

### V4 · The Heron, the King and The End

- **After it:**
  - From the Rat, the story goes on to the Heron at night, and the Heron plays through any of its exits.
  - The King's morning opens at once, as a summons. When it closes, The End shows the epilogue: each scene's ending, the notebook, the closing and the GM's bar tab.
  - The whole arc plays on the split, from the title to The End.
  - Until V12, the Heron's combat exit goes straight on to the King's morning, with a journal line saying the fight wasn't played. The Heron's other five exits all lead there anyway.
- **Client:** `ui/end.tsx` and the epilogue (`story.ts:60-77`), from rows; back to the title.
- **Simulation:** a summons (a boundary whose next scene opens at once instead of waiting); `game.status` ended when the King's morning ends; `startFight` recorded on the combat exit. The epilogue reads the ended scenes' exits, the journal and the turns' costs.
- **AI service:** nothing new: the summons is an opening after a boundary.
- **Campaign:** `scenes/heron-warehouse` and `kings-morning`, with their places. The Heron's encounter (`src/game/combat/heron.ts`, `heron-grid.ts`) goes on its combat exit as data, for V12.
- **Patterns:** a summons; the end of a game.
- **Proof:** offline, the effects equal the scripts; end to end, the Rat ended → the Heron → `caught-in-the-act` → the King → The End; arc checks 9, 10 and 14 to 16; live, the King's morning opened by a real Heron ending.
- **Defers:** the fight and the aftermath (V12).
- **Risks:** small. The Heron's six exits' effects are translated by hand.

### V5 · The reply as drawn

- **After it:** each speaker's lines are in their colour. The words a moment turns on are marked, and open a note written only from what the player knows, with a knowledge card. Three suggested lines sit under the box, and picking one says it.
- **Client:** speech coloured from the markup's speakers and the cast's `look` rows (V0's cut screen already draws them, given speakers); the popover's knowledge card (`popover.tsx`); suggested lines (`scene.tsx:202-228`, whose rows the cut screen already has) and `/suggestions`; the marks section of `game.ts` (1869-1962).
- **Simulation:** the reply commit stores the markup with speakers. It also queues two jobs that nothing waits for: `notes`, which lands on the entry's `transcript.markup`, and `suggest`, which writes `scene_suggestion` rows (turn, kind, text). Suggestions for a turn that's been overtaken are dropped.
- **AI service:** `withSpeakers` in `reply` and `open` (`markup.ts:507-634`, `speakers.ts`); `POST /v1/turns/notes` (`notes.ts`, the cards from `knowledge.ts`, `prompts/notes.md`); `POST /v1/turns/suggest` (`suggest.ts`, with its judge).
- **Campaign:** nothing new: the cast's colours are in `looks.json` since V0.
- **Patterns:** jobs nobody waits for, landing on rows the client redraws; markup end to end.
- **Proof:**
  - Offline: the markup, notes, suggest and speakers tests, copied; golden prompts for `notes`, `scene.suggest` and its judge; the screen check with notes and suggestions from rows.
  - End to end: both watchers get the speakers and the notes after the reply; a picked suggestion is said.
  - Live: 20 replies' notes, none from behind the GM's screen (the prototype's check of 15 Oct: 32 notes, none leaked); suggestions about 2.8 s after the reply.
- **Defers:** a talk's choices (V11).
- **Risks:** `suggest.ts`'s leak screens are subtle: copy it whole, with its tests. A notes job can land after the next turn has started. A misread speaker is drawn in the wrong colour.

### V6 · People remember, the GM steers

- **After it:** the people present remember what the player did, and disclosure brings it back on later turns, beside the memories of the scene's ending (V3). When play goes off the graph, the co-GM's notes, whispers and routes steer the scene, and the quick co-GM answers within the turn.
- **Client:** a quiet line when someone will remember it ("Kell will remember that."), optional.
- **Simulation:**
  - `review` and `repair` jobs, scheduled from the settle commit and keyed `<uid>:s<scene>:t<n>:review` and `:repair`.
  - At most one runs per game and kind (a lease). `repair` runs when `shouldRepair` (`repair.ts:281`) says it's due, and its commit lands only while its scene still holds.
  - `gm_state` gains `notes`, `whispers` (each with the turn it lapses), `patches` and `canon`, which the copied brief already prints.
  - The procedure pool is set above the number of thinks expected at once.
- **AI service:** `POST /v1/jobs/memory-review` (`v2/ai/docs/reviews.ts` and `remember.ts`, shared; a person's memories listed by a query, so two reviews can't lose each other's lines); `POST /v1/jobs/co-gm` (`repair.ts`); `repair.quick` beside `director.before` in `decide` (`repair.ts:317`).
- **Patterns:** background GM moves that write only the AI service's documents or the GM's state; leases per game and kind; commits that land only while they still apply.
- **Proof:**
  - Offline: the repair tests; two reviews' memories both kept; golden prompts for `memory.attend`, the reviews' first calls and `repair`.
  - End to end: a review after a turn, and the next `decide`'s disclosure opens the new memory; a 150 s fake review completes; a timed-out review is retried with one model call; SpacetimeDB restarted mid-review and the reaper finishes it; four jobs and a turn at once, with the turn's latency unchanged.
  - Live: the memory eval through the endpoint; the design's charm-Cob turn writes Kell's memory.
- **Defers:** nothing the arc needs.
- **Risks:** a review has taken 105 s, which holds a procedure's isolate that long: size the pool. If the 180 s cap ever bites, the documented fallback is for the service to answer `202` at once and commit later through `job_done`, a reducer only it may call, as it streams. SpacetimeDB still calls the service; there's still no relay.

### V7 · A spell or a blow in a scene

- **After it:**
  - In a scene the player casts, strikes, shoves, grapples, jumps or uses a feature by saying so. The rules resolve it on the scene's world from the game's dice.
  - "I cast Fireball at the elm" catches Moll, brings the hoist beam down and sets the elm alight. The dice lines and the damage show before the GM speaks, and the slot comes off the sheet.
  - Witnesses flee, cower, intervene or fight back. A threatened blow lands next turn. Fire spreads round by round.
  - Between scenes, time passes, the player comes to, rests and levels up.
- **Client:** the dice lines as transcript entries; hit points and slots in the side panel; `/sheet` as it stands. The `rules_event`s V7 emits float the damage over the place once V9 and V10 draw it, so nothing parses dice lines.
- **Simulation:**
  - The rules bridge, copied: `src/rules/dnd.ts`, `actions.ts` and `spells.ts` (`castSpell`, `rulesAttack`, `wrestle`, `leap`, `useFeature`, `rest`, `aimable`). It runs in the decide commit on the place's world, rebuilt from its rows and written back, as V0's settle commit does. The engine is cached per game and log position. Its dice lines and its directive for the GM ("Rules: the player cast Fireball… Narrate exactly this") travel in `outcome.lines` and `outcome.directives`, as `dnd.ts` writes them.
  - `rules_event`, an event table: each die, typed (check, save, attack, damage, condition, slot, refused).
  - **The round:** at a turn's start, what the last reply left hanging lands first (`engine.ts:517-542`: timed spells, `tick`, coming round, a threat), and `place.round` moves on.
  - Reactions applied in the reply commit (`engine.ts:1336-1388`); threats from the settle landing at the next resolve (`threats.ts`); the rules between scenes in the open commit (`engine.ts:192-201`).
- **AI service:** `decide` asks `director.mechanic`, `.feature` and `.jump`, with choices built from what exists (`director.ts:492-623`, `:1118`; `aimable`, `engine.ts:1391-1409`); `reply` asks `director.reactions` first when there are witnesses (`director.ts:1164`) and takes the rules' directives; `settle` reads the threat and whether the player has left.
- **Campaign:** nothing new: the statblocks are on the cast cards.
- **Patterns:** the rules resolved inside a commit; typed rules events; the round; caches that make things faster but never decide anything.
- **Proof:**
  - Offline: the seed-6 Fireball at the elm gives the prototype's dice lines (CS §5); `src/rules`' tests and the threats, attack and spells tests, adapted; golden prompts for the mechanic, feature, jump and reactions questions; replaying from the `dice` row gives the same snapshot.
  - End to end: the rules' rows reach both clients before the first words; the fire burns on into the next turn; reducers stay under 100 ms over a 50-turn game.
  - Live: the mechanic cases of the decision suite.
- **Defers:** the action menu (V10); the place's menu (V9); considered rolls (V8); fights (V12).
- **Risks:** `dnd.ts` is the biggest port into the module. Reducer time grows with the campaign, and reducers run one at a time: snapshots bound it, and engine work stays off the stream's path. The prototype's areas ignore walls; that's kept for parity (V18 fixes it).

### V8 · The GM rules on it

- **After it:** a risky act that no route covers gets the GM's ruling before the reply, while the status line steps through considering, weighing, success, failure and the roll. The ruling is rolled like a route and played; a failed roll shuts that way of trying.
- **Client:** the status line's steps, from `turn.step`.
- **Simulation:** a fourth step in a turn. After the decide commit (and after the rules, when the act's means was a mechanic), a `consider` think. Its commit rolls the ruling from the `dice` row and applies it like a route, with the state halves of `settleRuling`, `landRuling` and `patchesFor` (`consider.ts`), and keeps it in `gm_state.rulings`. The reply's directive about it is the AI service's, built from the ruling and the roll, as V0's are.
- **AI service:** `decide` flags a considered act (`director.ts:261`, `:902-925`); `POST /v1/turns/consider` (`consider.ts`, `prompts/consider.md`), with its 12 s deadline, after which it answers with a plain check, as the prototype does.
- **Patterns:** a commit that hands back another think; a turn's progress as a column.
- **Proof:** offline, the consider tests adapted and golden prompts; end to end, a considered turn, and one past its deadline that still rolls; live, the decision suite's considered cases scored against the prototype, with first text within its 5 to 7 s.
- **Defers:** nothing the arc needs. (A fight reads typed lines its own way: V13.)
- **Risks:** patches change the graph that both sides read, so both use `effectiveScene` from `v2/shared/scene/graph.ts`.

### V9 · The scene's place, and deeds

- **After it:** the scene's place is drawn beside the talk. People and things in it can be pointed at and picked from a menu, which makes a deed: "(I pick up Prout's satchel)", or a spell already aimed. Things the story creates get a look of their own.
- **Client:** `ui/place.tsx` and `ui/menu.tsx`; the pointing in `scene.tsx:345-432`; the scene's-place section of `game.ts` (1817-1868); the look layer's stage view (`src/game/look/stage.ts`) fed `rowsToWorld`. The look director plays what changed: it works it out by comparing the world, rebuilt from rows, with what it saw last, as the prototype's does, and floats damage from `rules_event`s.
- **Simulation:** `deed({ text, mechanic? })`, a turn like `say`, but with the mechanic already chosen; `scene-menu.ts`'s checks in `v2/shared`, run on the client to offer and grey out; an `inventLook` job that writes `look` rows.
- **AI service:** `decide` skips the mechanic question when the deed brings one; `POST /v1/looks` (`src/game/look/invent.ts`).
- **Patterns:** deeds as moves with their mechanic chosen; a job that fills a look.
- **Proof:** offline, the scene menu's tests, copied (a glance never shows an entity's `description`), and the stage view's check at 80x24 and up; end to end, a deed picked from the menu plays, and a new thing gets a look; arc check 5; live, a deed and an invented look.
- **Defers:** the menu on the map (V10); a fight in the place (V12).
- **Risks:** `stage.ts` (1,061 lines) assumes a live `SceneWorld`. The director's comparison has to run once per change of rows, not once per turn.

### V10 · The rules on the map

- **After it:** on the map the action menu aims a spell, a blow, a shove, a grapple or a jump, and offers hiding and short or long rests. It greys out what can't be done and says why. A Fireball at the watch house door burns it open and the people about scatter; the fire burns on while the player is in town. An act aimed at a waiting scene's people or place opens that scene and is played as its first turn. A fight that breaks out is recorded for V12.
- **Client:** `ui/actions.tsx`, `ui/menu.tsx` and the aim view; the action menu section of `game.ts` (1047-1320); refusals on the status line, in the game's words.
- **Simulation:**
  - `cast`, `attack`, `useFeature`, `leap`, `hide` and `rest` as reducers on the town's rows, through V7's bridge, with their checks in `v2/shared` so the client and the simulation agree (`checkAim`, `menu.ts:244`; `areaReach`, `:332`; `doMenuAct`, `:516`).
  - The town's reactions, by its table (`townReactions`, `menu.ts:684`).
  - An act at a waiting scene (`storyRoute`, `menu.ts:503`) opens it, and the open commit queues the act as the scene's first turn: a `deed` with its mechanic (V9), as the prototype says it after the opening (`src/game/play.ts:256`).
  - `tick_place`, scheduled every 6 s while a place is active and a player is in it, catching up at most ten rounds. It runs the scenes' own `tick`, so scenes and the town share one coding of fire. The map's time-of-day ageing (`src/game/map/reconcile.ts:297`) isn't ported.
  - Refusal codes with the prototype's words: `no_line`, `out_of_reach`, `too_far`, `no_slot`, `not_ready`, `not_now`, `shut`.
- **AI service:** nothing new: the opening is V0's, and the act is an ordinary turn after it.
- **Campaign:** statblocks and reactions for the town's people.
- **Patterns:** the client offering and greying out acts by the same check the simulation runs; refusal codes; a scheduled world clock.
- **Proof:** offline, the menu and town tests adapted, with each refusal's code and words; end to end, the seed-6 Fireball at the watch house door gives the prototype's dice lines, a `no_line` refusal from up the lane writes nothing, and the fire spreads on the clock.
- **Defers:** the fights that break out (V12); one coding of fire for fights too (V18).
- **Risks:** tick cost on a big map; `tick_place` must stop when no one's there. Fire on the map now burns on the clock, not by the hour: the tests should say so.

### V11 · A talk with Kell

- **After it:** between scenes, the player can stop and talk with Kell, or anyone walking with them: a talk built from her lore, with suggested lines as choices. Walking away ends it, and the story's waiting scene is exactly as it was.
- **Client:** a talk's choices (`scene.tsx:189-200`); starting a talk from the map, or from the card between scenes.
- **Simulation:** `interact` talk with a follower opens a scene of kind `talk`; the waiting scene is set aside and put back exactly; staged secrets in `gm_state` (talks turn staging on).
- **AI service:** `open` for a talk (`talk.ts`: `talk.sift`, `talk.plan`); `talk.suggest` in `reply`; the staged secrets' bookkeeping (`director.ts:1263-1275`, `brief.ts:401`).
- **Campaign:** the talk template (`scenes/talk.ts`) as data.
- **Patterns:** a talk as a kind of scene; a scene set aside and put back.
- **Proof:** offline, the talk tests adapted (`talk.test.ts`: the waiting scene restored) and golden prompts; end to end, a talk between the granary and the Rat; live, a talk with Kell.
- **Defers:** nothing the arc needs.
- **Risks:** a talk started while a turn is in flight; restoring the waiting scene exactly.

### V12 · Roll for initiative

- **After it:**
  - At the Heron, Sallow comes at midnight with the Crakes: "Roll for initiative!"
  - The fight plays on the map a turn at a time: move, attack, cast, use, wrestle, dash, dodge, disengage, end turn. The dust and the lanterns behave as the prototype's fights do, and Kell fights beside the player.
  - When it's over, the Heron's aftermath picks up and the story goes on to the King. A fight that broke out in town (V10) plays the same way.
- **Client:** `ui/combat.tsx`; the fight's view through `views.ts` on V2's renderer; the initiative list, the log and the effects; the combat section of `game.ts` (1963-2131).
- **Simulation:**
  - A `fight` row (place, scene, exit, round, whose turn, status, outcome) holding the fight's state (`CombatG`) as JSON. It's built from the place's rows (`battlefield` in `src/game/combat/fights.ts`) and written back into them as it goes (positions, hit points, conditions, what burned), so clients draw the fight from the same rows as the map.
  - The fight rules, copied: `skirmish`, `rules`, `grid`, `ai`, `model`, `setup`, `flavour` and `moves` from `src/game/combat`. boardgame.io is dropped: its turn hooks become two calls, `beginTurn` and `advance`.
  - Everyone else's turns run as short scheduled reducers, paced for the screen, drawing on the `dice` row. `not_your_turn` refuses out of turn. The fight's end opens the aftermath.
- **AI service:** `open` for an aftermath.
- **Campaign:** the Heron's encounter on its combat exit (V4): Sallow's group, Kell, the statblocks, the dust and the lights.
- **Patterns:** a fight as rows (a row per fight, with the place's rows as its board); turn order kept by reducers; the other side's turns paced by schedules.
- **Proof:** offline, the combat and acts tests adapted, and recorded fights replay to the prototype controller's logs for the same seed; end to end, the Heron fought by `auto` to an outcome, then the aftermath and the King, with every combatant's turn under 100 ms; arc checks 11 to 13, so 16 of 16; live, one fight and its aftermath.
- **Defers:** fights on the one world (V18). Until then, fights keep their own coding of fire, dust and props.
- **Risks:** turn order without boardgame.io is the largest change of behaviour in the stack. There's no `structuredClone` in a module. Long `endTurn` reducers hold up everything: pace them. If it runs long, fights that break out in town split off.

### V13 · Words in a fight

- **After it:** in a fight, the player can type what they do. Plain words are said and answered. A deed is read onto the turn's own actions, walked on the board, done as a click, and given the GM's line.
- **Client:** the typing box in a fight, and its steps (reading, the rules, the line).
- **Simulation:** a line typed in a fight is a move that thinks inside the fight's turn: the read, the actions applied, then the line, streamed.
- **AI service:** `POST /v1/fights/read` (`typed.ts`, `typed-decider.ts`, `typed-plan.ts`, `typed-turn.ts`, `typed-words.ts`); `POST /v1/fights/line` (`voice.ts`, `prompts/fight.md`).
- **Patterns:** a think inside a fight's turn.
- **Proof:** offline, the typed tests adapted and golden prompts; end to end, a typed line in the Heron fight; live, one typed turn.
- **Defers:** nothing the arc needs.
- **Risks:** the read has to choose among exactly the actions a click would offer, so the fight's own action list is the read's only choices; a slow read holds the fight's turn.

---

## 4. Parity, and what follows

### The parity point: after V13

v2 can replace the prototype for the demo arc, in a terminal, when:
- `npm run arc` passes 16 of 16 in CI;
- every model call on the arc has a golden request equal to the prototype's for the same state, or a listed reason;
- a blind QA round of the arc on v2 (the arc personas, through `npm run play`) reads at least as well as arc-r2;
- first words come within 0.3 s of the prototype's (1.4 s median); a plain turn costs within 10% of its $0.0041; a considered turn's first text comes within its 5 to 7 s;
- a turn carries on after either service is killed mid-turn.

**Still only the prototype's at that point:**
- the browser builds and the PR previews (V14);
- the zoo, and places from a description (`src/game/map/generate`) (V19);
- problem reports (V16);
- the eval suites not yet moved, and the nine scenes off the arc that some of them use (`blocked-entrance`, the four `crossroads` scenes, `garrows-toll`, `green-standoff`, `holed`, `warren-hostage`): they convert with the campaign tool when their suites move;
- the prototype's other approaches and the scribe, which aren't ported.

### After parity

The order after parity is the user's call. A suggestion:

- **V14 · Play in a browser, and without a server** (two PRs). The local host as a client's host: `Connection` over the memory host, with in-process subscriptions as row diffs, views per caller and schedules, and the AI service in process through the same JSON. One contract suite, every e2e scenario, runs on both hosts. The static build in a worker, with the player's own key (`src/web/static`, `src/web/tui`, copied), so v2 gets PR previews. A browser tab against a SpacetimeDB server.
- **V15 · Two players, BG3-style.** `joinGame` with a character; `handOff`, `acceptHandOff`, `requestControl`; `releaseControl` two minutes after a disconnect; queued turns; notices; several live scenes at once, one stage per entity; names heard per player. Prompts that know the party (today `brief.ts:321` and `engine.ts:1173` say "the only player character"), with two-player eval cases and the one-player goldens unchanged. Proof: the design's hand-off flow as a contract test, and two QA clients sharing a scene with a hand-off mid-scene inside the 5 s budget.
- **V16 · Playtesters.** The `allow` table checked in `clientConnected` (verified in the spike); usage rows per player and day; the host's budget; `my_usage`; caps that refuse with `over_budget` and spend nothing. Problem reports: a game's rows, its documents and its call log (`GET /v1/games/{game}/calls`), restorable into a local stack, and `b` or `/report` in the client.
- **V17 · Hosted.** The AI service on Cloud Run or Lambda, at an HTTPS URL with its bearer token and the key in a secret store; its stores in Cloud Storage and Firestore behind V0's interfaces (the docs service's store becomes asynchronous, a change to code the prototype shares); SpacetimeDB standalone on a VM; backups of both. From here, schema changes are additive or migrated: a publish that conflicts wipes data.
- **V18 · One world.** Components for the words in `narrative`; one registry of interaction rules, in TypeScript, in place of the scenes' `systems.ts` and the fights' own coding (the eight disagreements in `src/game/README.md`); `applyOps` as a check plus a handler per operation; walls that stop areas; fights on the same world; typed `world_event`s for everything the look director plays. Guarded by the zoo's world expectations and the stage manager's F1 of 0.82.
- **V19 · Campaigns as packs, and the zoo.** Install from a folder or a git tag, by version, running the campaign's exhibits at install; rules, moves, components and prefabs as data (`rule_def`, `move_def`, `component_def`, `prefab`), with `PHYSICS` and `WORLD_LANGUAGE` generated from them; the skep of bees as the acceptance test; the zoo (10 maps, 146 exhibits) as a second campaign, with its tour in CI.

---

## 5. Lanes, the stack and the critical path

Everyone builds V0. Then three teams work in three lanes, each taking the next vertical whose needs have landed:

| Lane | Verticals, in order | What holds them together |
|---|---|---|
| A: the map and the screens | V2, V5, V9, V10 | the client's big copies: the renderer, the look layer, the reply's markup, the menus |
| B: the story and the GM's craft | V3, V4, V6, V8, V11 | heavy on the AI service: boundaries, background jobs, rulings, talks |
| C: the rules and the fight (the critical path) | V1, V7, V12, V13 | the engine arrives in V1 and the bridge in V7; the fight uses both |

- **The critical path** is V0 → V1 → V7 → V12 → V13: about 4 + 2.5 + 3 + 3 + 2 = 14.5 hours of building. V12 also needs V2 and V4, which lanes A and B reach hours before, and V9, V10 and V8 need V7, which lane C has by then. With three teams, parity is about 15 hours from the start, plus the blind QA round; a fourth team shortens the lanes, not the path.
- **Tonight**, if V0 lands in about four hours, a night of about ten hours could reach V1 to V5, with V7 close behind: make a character, walk Caerwyn into the granary yard, and play the hanged clerk, the Rat, the Heron and the King to The End on the split (fights skipped), with the GM's colours and notes.
- **How stacking works:**
  - V0 stacks on `claude/v2-ai-shared`, which stacks on PR #650.
  - A vertical branches from the stack's tip when its team starts, and rebases onto the new tip before it's marked ready. The stack is in the order PRs land, not in their numbers. Each PR names what it needs below it.
  - Lanes meet only in the append-only registries and the generated bindings (§1).

---

## 6. The cross-cutting threads

| Thread | Where it lands |
|---|---|
| The local host and the contract suite | V0: the memory host runs every move in the unit tests, and `hosts/local.ts` plays a scene with the AI service in process. Every vertical: its moves on the memory host, its e2e scenarios through `Connection`. V14: the local host as a client's host, and one contract suite on both hosts. |
| The Pages preview | V14. Until then `preview.yml` keeps publishing the prototype. |
| The campaign tool | V0: check, and install into both services (the PUT and the owner-only `install_campaign`). V2: maps and places. V3 and V4: scenes, through the converter, with only its output committed. V19: git tags, versions, and exhibits at install. |
| The scripting API | V0: the stage manager's operations through one gate. V3: the story operations, applied (exits' effects, `afterwards`, `follow`). V7 and V10: the rules' writes through the same gate. V18: the registry. V19: rules as data. |
| Multiplayer | V0: rows keyed by player, `controller_id`, spectators, `not_controller`. Every vertical: moves written for an actor and a seat. V15: control, hand-offs and the party in the prompts. |
| Accounts and caps | V0: identities from saved tokens; each turn's calls and cost on its row. V1: the AI service's daily ceiling. V16: the allowlist, usage rows, budgets and caps. |
| Hosting | V0: a container-ready AI service (configured by env, its state in one folder), the dev host's two modes, CI's address. V17: Cloud Run or Lambda, a VM, backups. |
| Evals and QA | V0: golden prompts, and `npm run play` keeps the QA console's verbs and output, so the QA personas carry over. V1 or V2: `npm run arc`. A side PR beside V6 builds the eval runner on the AI service's endpoints, converts the 48 fixtures into working sets once, and moves the suites whose endpoints exist (opening, reply, the stage manager's 26 cases, trajectory, memory); V7 and V8 move the decision cases. The suites that use scenes off the arc convert those scenes when they move. At parity, a blind QA round of the arc. V16: problem reports. |
| The zoo | V19. Its world expectations guard V18. |
| Sharing the GM code with the prototype | Below. |
| Determinism and speed | V0: the deterministic-code rule. V1: the engine's reducer times measured. V7: snapshots. V10: the tick's cost. V12: each combatant's turn. |
| Local networking | Below. |

### Sharing the GM code with the prototype

The AI code is shared so that prompts can be iterated on in both builds at once (the user's wish when `v2/ai` was made). `v2/ai` already holds the model client, the prompts and the docs service, and the prototype runs them through shims. The GM pipeline joins it the same way:

1. **Each vertical copies** the GM code it needs into `v2/ai/gm`, behind `TurnView`, a structural subset of the prototype's `SessionState` under the same field names. Golden prompts pin the copy to the prototype's behaviour.
2. **The prototype then adopts the copy,** in a side PR on its own branch, owned by one agent: `src/runtime`'s files become adapters over `v2/ai/gm`, proven by the characterization script that proved the docs service's move (`v2-ai/characterize.ts` in the scratchpad: 47 requests, byte for byte) and the prototype's tests. Batches: after V0 (brief, voice, markup, knowledge, the director's V0 questions, the stage manager); after V5 and V6 (speakers, notes, suggest, repair); after V7 and V8 (the mechanic questions, reactions, consider); after V3 and V11 (the boundary, owed, talks).
3. From the first adoption, a prompt changes in one place for both builds. Until then, a change to `src/runtime` shows up as a failing golden test in v2.

Each adoption edits `src/runtime`, which PR #650 is still changing, so its timing is the user's call.

### Local networking, and why not kind

- **Why.** SpacetimeDB 2.12's `ctx.http.fetch` refuses every special-purpose address in RFC 6890: loopback, 10/8, 172.16/12, 192.168/16, 100.64/10, link-local, IPv6 ULA, and the documentation ranges. It checks IP literals and DNS answers alike, and it's hard-coded (`crates/core/src/host/instance_env.rs`), with no setting. It's an SSRF guard: modules are untrusted code on shared hosts such as Maincloud, so a procedure mustn't reach its host's private network.
- **What it allows:** any other address, including one that's local to the machine. Verified on 16 Oct: a procedure's POST to `11.0.0.1` on loopback, and to a hosts-file name for it, returned 200; `127.0.0.1` and `localhost` were refused.
- **So, locally,** the module always calls `http://11.0.0.1:8787`. (11.0.0.0/8 is a public range; using one address of it on loopback shadows only that address.) `npm run dev` picks the mode itself, and the doctor checks both directions at every start:
  - **host mode,** when 11.0.0.1 is on this machine: `sudo ip addr add 11.0.0.1/32 dev lo` once per boot, or a NetworkManager dummy interface for good;
  - **namespace mode,** with no root: only SpacetimeDB runs inside `pasta --config-net --map-host-loopback 11.0.0.1`, which maps that address to the host's loopback, where the AI service listens, and forwards SpacetimeDB's port back out;
  - **CI:** GitHub's runners have passwordless sudo, so the e2e job adds the address;
  - **production:** the AI service's public HTTPS URL, with a bearer token.
- **Kind wouldn't help.** Its nodes sit on a Docker bridge (172.18/16), its pods on 10.244/16 and its services on 10.96/12: all private, all refused the same way. Any local setup needs the AI service at a non-special address, and one address on loopback is the whole fix. Local development isn't scuppered, and production's public URL never meets the block.

---

## 7. Deviations from the design

### Taken in V0

| The design (CS) says | v2 does | Why |
|---|---|---|
| `runJob` loops think and commit in one procedure; `move_plan`, a `job` schedule row and `job_run`; `reapTurns` after a minute | One durable `job` row per move in flight (its plan, its next request, key, state, attempts, deadline); a `job_dispatch` schedule row per dispatch; `reap_jobs` every 2 s re-dispatches what's past its deadline or due a retry | A scheduled procedure's row is deleted when it starts, so a crash would lose the job. `ctx.sleep` throws, so retries are scheduled. One path serves retries, crashes and re-dispatch |
| `think` runs outside any transaction, from the plan | The request is built in the transaction that queues the job, and stored | It's exactly the state the revision check compares against, and a crash can re-POST it unchanged |
| The AI API beside SpacetimeDB on one machine | The AI service at a non-special-purpose address: 11.0.0.1 on loopback, a pasta namespace, or a public URL in production | `ctx.http.fetch` refuses private and special-purpose addresses (§6) |
| `streamReply(turn, seq, speaker, text, done)`, its caller listed in `service` | The stateless AI service posts `stream_reply` over SpacetimeDB's HTTP API (p50 about 4 ms) as its own identity, with `attempt` and `markup` too | No worker and no relay: the service behaves the same whichever way a job reaches it. A retried reply replaces its draft; speech is coloured as it streams |
| The `service` table (identity, URL, token) | Env values set at publish: `AI_URL`, `AI_TOKEN`, `AI_IDENTITY` | Set by the owner, changed with `--env-only`, readable in reducers and procedures |
| `installCampaign`, a procedure that fetches its half from the AI API | An owner-only reducer handed the structure; the tool PUTs the whole pack to the AI service | No procedure for an admin task; the AI service needs the graph too, for the decider's questions |
| `scene_def` holds no prose | `scene.json` whole: the graph and its short logic text (route `when`s, check lines, fact sentences); no Markdown | The bookkeeping reads the prototype's `Scene` shape; the design keeps short logic text in the JSON |
| `gm_state` in columns | (Planned: one JSON column. As built: typed columns, a column for each field V0 uses, as the design has it; later verticals add theirs. See [v0-design.md](v0-design.md)'s note.) | The AI service gets `GmState` whole on every request, built from the row |
| `transcript` and `reply_draft` without markup | A `markup` column on both | Otherwise every reply is drawn in the narrator's colour, with no marks |
| A scene's title and hook only in the private `scene_def` | `title` and `hook` on the public `scene` row | The client's frame and heading need them |
| Looks guessed by the look layer | The cast's colours as data (`looks.json`, `look` rows) | Kell is `#6d9eeb`, not a hashed hue |
| `my_names` gives a name | It gives the entity's key too | Markup and dialogue name speakers by key |
| The AI API's types (CS §4) | gm-port §13's amendments: `Decision` with `plain`, `sameAgain`, `earned`, `answering`, `remembered`; `Outcome` with `move.from`, `taken`, `held`, `pending`, `wasStuck`, `closes`, `windDown`; `SettleRequest.settled`; `After.unanswered` and `theirs`; `ReplyResponse.gm`; `pc` for `line.player`; the world as `PlaceRows`; no `heardBy`; `game.uid` as the game's id | What the copied code reads, and nothing it doesn't; keys and folders unique across databases. Later verticals add their fields (`mechanic`, `witnesses`, `threat`, `kind: talk`…) as the design has them |
| Watchers are characters in the place | Spectators, with no character, until V15 | Keeps the GM single-player, so prompt parity holds |
| `check` shared with the client | In the simulation; the client mirrors `say`'s | One move to offer in V0. Shared checks arrive with paths (V2) and the menus (V9, V10) |
| The world's components (CS §2) | content-world's minimal set; every word in `narrative`, until V18 | The gate and the renderers stay the prototype's code |
| The GM's bookkeeping in shared code | In `simulation/src/gm` | Only the simulation runs it |
| `v2/ai` imports only itself | Itself and `v2/shared` | The module and the service share the protocol, the scene graph and the world |
| Caps, usage rows and budgets | Each turn's calls and cost on its row (and a daily ceiling in the AI service from V1), until V16 | One player and the developer's key until playtesters |
| Dice through the rules engine | `rollCheck` from the `dice` row, until V1 | The engine comes with V1 |
| Facts as sentences | Ids in the data; the sentences in `gm_state.established` | A reworded sentence can't break a condition, and the copied code reads the sentences |
| Procedures as a stable API | Pinned at 2.12.0, where they're labelled unstable; the worker design is the documented fallback behind the same job rows | It works as measured, and switching would be a change of host, not of moves |

### Taken by later verticals

| Vertical | The design says | v2 does | Why |
|---|---|---|---|
| V3 | Exits' effects in the scripting language | The prototype's exit scripts translated by hand into effects (checked against every set of facts); `wrong-man`'s computed accused as paired `if`/`unless` branches; `moveTo` and `leaveScene` as `remove`, with the destination as text; a new `follow` operation | Scripts can't be data; following was story code in the map module |
| V3 | The way on is walked on the map | A game with no map for the player's place goes from lead to lead with `walk({ toward: "lead" })` | The story can land before the map, and a campaign needn't have one |
| V4 | A combat exit starts a fight | Until V12, it goes on to its `next`, with the fight noted as not played | The arc reaches The End before fights land |
| V5 | Suggestions only in a talk | Suggested lines on every reply, as `scene_suggestion` rows written by a job | The prototype has them in every scene |
| V8 | No row for a considered turn's steps | `turn.step` | The status line's steps |
| V2, V9 | The look director plays typed `world_event`s and `rules_event`s | `rules_event` for dice, `world_event` for walks and barks; the rest the director works out by comparing worlds rebuilt from rows, as the prototype does, until V18 | Parity first; events for everything come with one world |
| V10 | `tickPlace` on the map | `tick_place` runs the scenes' `tick`; the map's ageing by the hour isn't ported | One coding of fire for scenes and the town |
| V10 | An act on the map that opens a scene travels as the opening's `firstLine` | The opening is V0's, and the act is the scene's first turn, a `deed`, after it | As the prototype plays it (`play.ts:256`), so the opening's prompt keeps parity |
| V12 | A fight as rows, with an `initiative` component, on one world | A `fight` row with the fight's state as JSON, mirrored into the place's rows; the fights' own fire, dust and props kept until V18 | The prototype's fight code (about 5,800 lines with its typed lines) ported without a rewrite |

---

## 8. How this plan was made

Three plans were proposed, through three lenses: the player's journey, risk first, and the shortest road to replacing the prototype. This one takes the player's journey as its spine: verticals by screen, each a slice a player can see, with progress counted in the arc's own checks. From the others it takes:

- **From the shortest road:** the story to The End early, without stand-ins (V3 and V4 before the fight, the way on without a map, the King reached through the Heron's other exits); copied files headed by their source and edits; a fight's typed lines as two endpoints; a fight's state ported as it is.
- **From risk first:** moves over `TxCtx` and e2e scenarios through `Connection`, so the second host comes cheap; moves written for an actor and a seat; the AI service's daily ceiling; measured reducer times with the engine in; the `202` and `job_done` fallback for the 180 s cap; one coding of fire for scenes and the town.

---

## Appendix: the AI API, by vertical

| Endpoint | From | Model calls | Timeout |
|---|---|---|---|
| `POST /v1/scenes/open` | V0; after a boundary V3; talks V11; aftermath V12 | `memory.disclose.*`, `gm.opening`; `director.presence`; `talk.sift`, `talk.plan` | 60 s |
| `POST /v1/turns/decide` | V0; `repair.quick` V6; mechanics V7; the considered flag V8; a deed's mechanic V9 | `memory.disclose.*`, `director.before`, `director.ooc`; `director.mechanic`, `.feature`, `.jump` | 20 s |
| `POST /v1/turns/reply` | V0; speakers V5; reactions V7; `talk.suggest` V11 | `gm.reply`, `gm.closing`; `director.reactions` | 60 s |
| `POST /v1/turns/settle` | V0; threats V7 | `world.stage`, `director.after` | 60 s |
| `PUT /v1/campaigns/{c}/{v}`, `GET /v1/health` | V0 | none | |
| `POST /v1/characters`, `POST /v1/backstories` | V1 | `rules.build`; the backstory's draft and check | 30 s |
| `POST /v1/scenes/boundary` | V3 | `handoff`, `boundary`, `fronts` | 120 s |
| `POST /v1/turns/notes`, `POST /v1/turns/suggest` | V5 | `notes`; `scene.suggest`, `scene.suggest.judge` | 30 s |
| `POST /v1/jobs/memory-review`, `POST /v1/jobs/co-gm` | V6 | `memory.attend`, `memory.review.*`; `repair` | 170 s |
| `POST /v1/turns/consider` | V8 | `consider` (its own 12 s deadline), `director.freeform` | 20 s |
| `POST /v1/looks` | V9 | `look.invent` | 30 s |
| `POST /v1/fights/read`, `POST /v1/fights/line` | V13 | the typed decider; the fight's line | 20 s, 60 s |
| `GET /v1/games/{game}/calls` | V16 | none | |

Every request carries its idempotency key and its working set; every answer carries its usage. The procedure's timeout stays under SpacetimeDB's 180 s cap.
