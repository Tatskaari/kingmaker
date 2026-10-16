# The whole story: every scene of the arc, from the yard to The End, dropped in

The brief for one PR, `claude/v2-story`, stacked on the full GM (`claude/v2-gm` at 1e7c5ed: V0, V5, V1, then the full GM). It is the plan's V3 and V4 ([verticals.md](verticals.md) §3) as one unit, with the fight stubbed. After it, a game plays from the title to The End: a scene ends through any of its exits, the story crosses the boundary as the prototype's does, and the player goes on to the Drowned Rat, the Heron and the King's morning, and reads The End.

The user's direction: **drop in.** Copy the prototype's files whole wherever possible, each headed by its source at `44c6d4a` and its edits; adapt only at the seams. Checks are functional: the type check, the unit tests, one run of the e2e and a short playthrough. The first blueprint, `v3-design.md` (in the author's scratchpad, written against V0), is reused where it still holds. `file:line` means the prototype unless a v2 path is given.

**Decisions, in short**
- **The boundary is the prototype's, in the AI service.** `chainScene` and `crossBoundary` (`engine.ts:1055-1242`), `moveOn` (the fronts), `rememberBetween`, `settlePresence` and `owed.ts` are copied into `v2/ai/gm` behind one endpoint, `POST /v1/scenes/boundary`, which also writes the scene's memories and the played scene into the game's docs.
- **A scene ends in one function**, `closeScene`, where V0's `endScene` is: the ending's effects as story rows (quests, flags, the journal, attitudes, who follows), the place's `afterwards`, a `chapter` row, then the boundary queued as a job. The other effects (memories, things given or moved, a fight's set-up) are recorded, not applied, as the prototype records them all.
- **The next scene waits** as a `waiting` row with what was handed on in its `gm_state`: the adjustments, the rewritten opening, the lead, who's absent, what's owed. `walk({ toward: "lead" })` opens it, straight in where there's no map; the map unit later walks there through the same `openLead`. A summons (the King's morning, `next-morning`) opens at once.
- **The story so far rides every request**: the game's chapters (the prototype's `history`) and the earlier scenes' entries, so the copied prompts read it unchanged.
- **The way on is the prototype's app, copied**: the scene's end and Continue, `between.tsx` (Kell's talk, or the card), `end.tsx` with `story.ts`'s epilogue, the notebook, and a quests overlay (new). Kell's words between scenes are copied into the client.
- **The fight is the prototype's own stand-in** (`src/game/fight-standin.ts`): "Roll for initiative!", one action resolves it as won, and the Heron picks up as `resumeAfterFight` has it (the aftermath, then on to an ending), with a journal line saying the fight wasn't played.

---

## 1. How to try it

### 1.1 Run it

```sh
git fetch && git switch claude/v2-story && cd v2 && npm ci && npm run check
KM_AI_FAKE='{"choices":{"ending":["open-case","hobb-talks","fight","caught-in-the-act","justice"],"own_exit":"theirs"}}' npm run dev -- --fresh --fake
npm run client -- --session wren --new "Wren Ashdown: a hedge wizard from the fens" --build wizard
npm run client -- --session tam --join <game>      # a spectator: the game's number is in Wren's side panel
```

The recipe has the fake decider find each scene at the first of those endings it offers, by the player's own doing, so a scene closes in two lines: the first reaches the ending, the second is its wind-down. On real models (`npm run dev -- --fresh`), say the lines in brackets below, or end a scene at once with `/end <exit>` (testing: the dev stack's owner ends it; `/end` alone lists the exits).

### 1.2 One playthrough, from the title to The End

| # | Do | See in v2 | The prototype it matches |
|---|---|---|---|
| 1 | Set off; two lines in the yard ("Sergeant, that's a cord mark, not a rope. Write him down as murdered, persons unknown.", then "Let's go.") | The wind-down, then "── Murder by persons unknown ──". The box becomes the way on: "▶ Continue, once the story has moved on (take your time: the last word stays put)", then (at once on the fake, about 10 s on real models) "▶ On, with Sergeant Agnes Kell" | `finishScene` (`engine.ts:981-996`); the app's `moveOn` and `onward` (`game.ts:1625`, `scene.tsx:231-256`) |
| 2 | Enter | Under "Evening, on the eve of the Assembly", Kell, a line at a time: "“For the record.” She reads the entry back to you … “Prout was murdered. The watch has it down as persons unknown.” … “Noted.”"; the lead (the boundary's words; on the fake, "The afternoon goes in paperwork…"); "“The Drowned Rat, then.” She writes it down. “I’ll walk with you: somebody has to write it down.”" | `leadCard`, `talkBetween`, `PASSING`, `KELL_ON` (`game.ts:1752`, `:2397-2432`), `between.tsx`. No map, so no way drawn in her margin |
| 3 | `/journal` (`j` between scenes), then `/quests` | "The investigator's notebook": "The Hanged Clerk: Murder by persons unknown", its line, how things stood (the hand-off). The quests: "The Hanged Clerk (active): Prout's death is on the books as murder by persons unknown." | the notebook (`overlay.tsx:242-252`); the quests are new (the prototype records them and shows none) |
| 4 | Enter ("On to The Drowned Rat") | The Rat's opening streams in, at evening, picking up from the yard (rewritten by the boundary on real models); Kell is here | `chainScene`, then `openScene` and the opening directive's second branch (`engine.ts:163-228`) |
| 5 | Two lines in the Rat ("(I sit by the big man with the bandaged hand) Your master had a clerk hanged. Give me his name and nobody hears it from me.", "Go home, Hobb.") | As 1 and 2: "What Big Hobb knows"; under "Night, before the midnight bells", "“The Heron Warehouse, then.” … “If that barge sails on the ebb, so does the evidence. I’d rather it didn’t.”" The wharf-night interlude is skipped | the same boundary from the Rat, `skipInterludes` |
| 6 | Enter, Enter, then one line at the Heron ("(I go for Sallow with my blade)") | The scene ends at once, "── Roll for initiative ──", and the way on in red: "Roll for initiative!" ▶ To the fight | a combat exit ends its scene at once (`reachEnding`); `onward`'s fight (`scene.tsx:239`) |
| 7 | Enter, then Enter on "▶ Fight it out" | "(Tactical combat on the map isn't wired in yet: this stand-in resolves the fight in one go.)", then "Steel, dust and lantern light: …"; back in the Heron, "— The fight: After a short, ugly fight the Crakes went down and Sallow surrendered, very politely. —" and the GM's aftermath streaming in. The notebook gains "The fight wasn't played: it's told as won." | `fight-standin.ts`; `afterFight`, `resumeAfterFight` (`play.ts:479-507`, `engine.ts:1003-1043`) |
| 8 | Two lines ("Sergeant, arrest him: he was caught with the King's grain.", "To the palace, then.") | "Caught in the act"; the way on reads "▶ On to The King's Morning" as soon as the story has moved on: a summons, no card between | `onward`'s summons (`play.ts:524`); the way on to it (`scene.tsx:236`) |
| 9 | Enter; two lines with the King ("Majesty, Sallow's initials are on every lost wagon.", "Thank you, Majesty.") | "The morning of the Assembly"; then "Done right by", and "▶ The End" | the King's exits have no next (`play.ts:510-516`) |
| 10 | Enter | THE END: the closing, "How it went" (each scene's ending with its notebook lines) and the GM's bar tab. Enter: the title, where the game is over | `end.tsx`, `epilogue` (`story.ts:60-77`) |

The spectator sees every step, its way on saying "Watching: Wren Ashdown goes on when ready", and The End.

### 1.3 Headless, and the prototype beside it

```sh
npm run play -- new --session qa --as "Pell Marrow: a disgraced herald" --build rogue
npm run play -- end --session qa --exit open-case   # without --exit, the exits; waits, then MODE: between
npm run play -- journal --session qa                # the notebook, the quests, the flags, the attitudes
npm run play -- go --session qa                     # the lead opens (act --id go_to_lead too); at the Heron's fight, act --id fight
```

At the repo root the prototype's QA console does the same: `npm run qa -- new --session p --as "…" --build 1`, `act --id go_to_lead`, `end --exit open-case`, and so on to The End.

### 1.4 The checks

`npm run check`; `npm run e2e` (one run: the story's scenario after the full GM's); `npm run arc` (checks 1, 6 to 11 and 13 to 16); `npm run live -- --script story` beside the prototype (under $0.10); at the repo root, `npm run typecheck && npm test`.

---

## 2. Scope

**It adds:** every scene of the arc as campaign data (the Rat, the Heron, the King's morning, with their places `drowned-rat`, `heron` and `dressing-room`; the two interludes); a scene's end through any exit, played or forced (`end_scene`), its effects written as story state; the boundary (the hand-off; the verdict: overtaken scenes skipped, the adjustments, the opening rewritten, the lead; the fronts moved on; presence; what's owed carried on; the scene's memories and the played scene in the story's index); the next scene waiting, the lead and the time of day; the way on with no map; a summons; The End; the fight stub and its aftermath; the client's way on, between screen, notebook, quests and The End; the headless verbs.

| Left | For |
|---|---|
| The town map, walking to the lead, the way in Kell's margin, followers on the map | the map unit (`claude/v2-map`), through the same `walk` and `openLead` |
| The fight played on the map, and its flags | V12 |
| The rules between scenes: time passing, coming round, the King's level-up and long rest (`engine.ts:192-201`) | the world bridge's `betweenScenes` |
| `remember`, `give`, `remove`, `create`, `promise` effects applied | nowhere yet: the prototype records them too |
| A talk with Kell between scenes | V11 |
| Golden prompts for the boundary | not needed: the copies are the prototype's, and the live run is beside it |

---

## 3. The copy list

Each copied file's first line names its source at `44c6d4a` and its edits. "The usual": `SessionState` → `TurnView`; `respond`, `respondJson` and the deciders take the request's `calls`; `sceneById` → the campaign's story; what the session was given is returned.

| Source | To | Who | The edits |
|---|---|---|---|
| `src/runtime/engine.ts:1055-1119, 1168-1286` (`chainScene`'s middle, `rememberBetween`, `journalOf`, `crossBoundary`, `moveOn`) | `ai/gm/boundary.ts` | C | the usual; the history entry is returned, not pushed |
| `src/runtime/owed.ts` but `placeOwedThings` | `ai/gm/owed.ts` | C | `bringOver` returns `{ patches, owed, hinted }`; things by entity key at the edges |
| `engine.ts:236-248` (`settlePresence`) | `ai/gm/presence.ts` | C | returns `absent`; run in the boundary, after the hand-off |
| `engine.ts:225-228` | `ai/gm/directives.ts` `openingDirective` | C | the second branch V0 left out |
| `engine.ts:1003-1043` (`resumeAfterFight`'s middle, `aftermathDirective`, `stageAftermath`) | `ai/gm/aftermath.ts` | C | for the open endpoint's aftermath |
| `src/runtime/{boundary,crossing,owed,story}.test.ts` | `ai/gm/*.test.ts` | C | on `ai/gm/fixtures.ts`' story |
| `engine.ts:981-996, 1046-1053` (`finishScene`, `forceEnding`) | `simulation/src/story/end.ts` | B | the recording world becomes the effects interpreter; `dispelConjured` is the world bridge's |
| `engine.ts:1061-1069` (the candidates) | `shared/scene/graph.ts` `candidatesOf` | A | pure, over a scene lookup |
| `engine.ts:163-189`, `:1423-1430` (`carriedBy`), `owed.ts:213-233` (`placeOwedThings`) | `simulation/src/world/place.ts`, `cross.ts` | B | the place built as the prototype's, written with the movers (§4.3) |
| `src/game/play.ts:325-344, 425-440, 479-527` (`endScene`, `carryOn`, `afterScene`, `afterFight`, `onward`) | `simulation/src/story/*.ts` | B | the flow as rows |
| `src/game/fight-standin.ts` | `simulation/src/story/fight.ts` | B | its words and result, resolved by one reducer |
| `src/app/ui/scene.tsx:231-256` (`onward`, `Continue`); `between.tsx`; `end.tsx`; `overlay.tsx:242-252` | `client/ui/` | D | `Game` → the story's view model, from rows; a quests overlay beside the notebook |
| `src/app/story.ts:19-25, 60-77`; `game.ts:1752-1777, 2397-2432` | `client/story/words.ts`, `view.ts` | D | `TIME_WORDS`, `PASSING`, `KELL_ON`, `talkBetween`, `leadCard`, `epilogue`; no way, so "She writes it down." |
| `src/cli/qa.ts:203-215` (`end`) | `client/headless.ts` | D | through `end_scene`, as the owner |
| `scenes/{drowned-rat,heron-warehouse,kings-morning,interludes}.ts`, `scenes/worlds/*.ts` | `campaigns/caerwyn/scenes/*`, `places/*` | E | through the converter; each exit's script as effects |

---

## 4. The seams

### 4.1 Rows (A: `schema.ts`, the bindings)

| Table | Change |
|---|---|
| `game` | + `leadScene`, `leadText` (options, the map unit's names); + `onward` (option: `moving`, `waiting`, `failed`: a boundary in flight) and `onwardNote`; `status` gains `ended`, `time` gains `next-morning` |
| `scene` | `status` gains `waiting` (handed on, not yet opened: `placeId` 0 until it opens) and `fighting` (its combat exit reached: the stub's fight is next); + `time` (option, from its `scene.json`) |
| `gm_state` | + `adjustments`, `fought` (string[]), `opening`, `lead` (options), `owed` (`OwedRow[]`: `{ from, id, hinted, things, holders, where? }`, things by entity key, outermost first); `absent` gets its column (`entered` is still refused) |
| `chapter` (new) | a played scene: `sceneId` pk, `gameId`, `seq`, `sceneKey`, `title`, `exitKey`, `ending` (its title), `summary` (the hand-off, "" until the boundary), `lastMoments`, `facts`, `fronts`, `skipped` (`{ sceneKey, why }`), `calls`, `costMicros`, `at` |
| `quest` (new) | `id`, `gameId`, `key`, `title`, `status` (active, complete, failed), `stage` (option), `notes` (each change's text, oldest first), `updatedAt` |
| `flag`, `journal`, `attitude`, `follower` (new) | `flag`: `name`, `value`, `sceneId`. `journal`: `sceneId`, `seq` (per game), `text`, `at`. `attitude`: `castKey`, `playerId`, `attitude`, `reason`, `at`. `follower`: `castKey`, `name`, `leaderId`, `sinceScene`. Each with `id` and `gameId` |

The new tables are public, read by game. Each new column has a default, so a full-GM database migrates. `job.step` gains `boundary` and `job.move` `crossBoundary` (values only).

### 4.2 Shared types (A)

- `shared/gm/state.ts`: `GmState` + `adjustments`, `opening?`, `lead?`, `owed`, `fought`; `OwedRow`; the row's mapping.
- `shared/protocol/ai.ts`: `Entry.scene?` (an earlier scene's key); `Chapter` (the prototype's history entry, `session.ts:337-345`); `Story` + `history?: Chapter[]`, `earlier?: Entry[]` (absent from a request built before them); `BoundaryRequest { turn: SceneContext; exit; candidates }` and `BoundaryResponse { handOff, lastMoments, next: { scene, skipped, adjustments, opening?, lead?, absent, patches, hinted }, owed, fronts, usage }`; `OpenRequest.aftermath?: { summary }` with the scene's `transcript?`, `OpenResponse.ops?`; the endpoint, its step and its timeout (120 s).
- `shared/protocol/keys.ts`: `Step` + `boundary`, keyed `<uid>:s<scene>:t<n>:boundary` (the ended scene's last turn).
- `shared/protocol/refusals.ts`: `scene_on` and `no_way` (the map unit's words), `no_lead`, `story_over`, `not_stuck`, `no_scene`, `no_exit` (it lists the exits), `no_fight`.
- `shared/scene/{files,load,types}.ts`: `SceneFile` + `interlude`, `assumes`, `overtaken`, `rest`, `milestone`, `background`, `onEnd`; `Effect` + `follow`, `promise`; a condition takes one fact or a list (all of them); `CampaignFile.quests` (key to title). `graph.ts`: `candidatesOf`.

### 4.3 The simulation (A's stubs refuse `not_built`; B makes them)

| Reducer | Args | Who | What |
|---|---|---|---|
| `walk` | `to` (option `Tile2`), `toward` (option string): the map unit's | the controller | `toward: "lead"` with no map: `openLead`, which opens `game.leadScene`'s waiting scene through V0's `openScene`. Refuses `scene_on`, `no_lead`, `story_over`, `no_way` |
| `end_scene` | `game`, `exit` | the owner | the scene ends through the exit with no closing reply (`forceEnding`) |
| `carry_on` | none | the controller | a boundary that failed, queued again |
| `fight_it_out` | none | the controller | the stand-in: its line, a journal line, the scene picked up, its aftermath queued |

- **`closeScene(tx, scene, exit, how)`**, called by V0's `endScene` (`say-commits.ts`) and `end_scene`: V0's end (the "Scene ends" entry, `ended`, a queued line cancelled); a combat exit then goes `fighting`, effects recorded, and nothing more; otherwise a `chapter` row, the scene's `onEnd` and the exit's effects (each when its facts are established), `afterwards`, then the candidates: some, `game.onward = moving` and the boundary queued; none, `game.status = ended`.
- **Effects:** `quest`, `flag`, `attitude` (the controller's), `journal` and `follow` write rows; the rest (`remember`, `promise`, `give`, `remove`, `create`, `startFight`) are a log line each, as `state.ended.operations` was.
- **`crossBoundary`**, a job with an owner as creation's (no turn): its progress on `game.onward` and `onwardNote`, its cost on the chapter, its request built in `closeScene`'s transaction. Its commit: the chapter's summary, last moments, facts, skipped and fronts; the next scene's row `waiting`, its `gm_state` the prototype's `freshScene` with the answer's `next` and `owed`; `game.leadScene`, `leadText`, `time`; `onward` cleared. A summons opens at once.
- **Opening a waiting scene** (`openScene.resolve`): the row opens with its `gm_state`; its place is built as the prototype's `openScene` builds it (the cast present without the absent, the player, what they carry, what's owed with whoever has it), written with movers that keep the entity ids of the player's character and of cast already in the game, and re-key carried things to the new place; the seats move with it; `heard` rows over the whole story (`v3-design.md` §3.7 has the details).
- **The aftermath:** `fight_it_out` marks the exit `fought`, establishes "The fight is over: <summary>", writes "The fight: <summary>", and queues the opening's think with `aftermath` on a new turn; its commit applies the stage manager's operations through the gate, and the scene is live again.
- **Every request's `story`** carries the chapters (each with its journal lines and facts), the earlier scenes' entries, and the flags.

### 4.4 The AI service (C)

- **`POST /v1/scenes/boundary`**: the ended scene and its view; `owedAtEnd`; `crossBoundary` over the candidates (the hand-off, the verdict and the fronts at once, each falling back as the prototype's does); `settlePresence` for the scene chosen; `bringOver`; then the docs once per key: `broadcastEnding` for those present, `rememberBetween`, `savePlayedScene`, `moveFronts`. Canned: the first candidate, the fallback hand-off, nothing rewritten, no docs.
- **`viewOf`** fills what V0 left empty: `history`, `adjustments`, `opening`, `lead`, `absent`, `fought`, `owed` (each with its essential from the campaign), and the transcript as the earlier entries, then this scene's. V0's endpoints then send the prototype's prompts after a boundary unchanged.
- **`open` with `aftermath`**: `gm.aftermath` in place of the opening, streamed as the opening is, and `stageAftermath`'s operations in the answer.
- **The fake** (`ai/llm/fake-openrouter.ts`, shared): `choices` takes a list per question, the first on offer taken (§1.1's recipe); `hosts/dev/fake.ts` merges a list as it is.

### 4.5 The client (D)

- **Rows:** `chapter`, `quest`, `flag`, `journal`, `attitude`, `follower` by game. An ended scene stays on screen until Enter, even once the seat has moved (a summons, a spectator following).
- **The way on** (`onward`): "Continue, once the story has moved on" (with `onwardNote` while it waits), "On, with Sergeant Agnes Kell" (or "Go on" with nobody), "The story got stuck on the way: try again" (`carry_on`), "Roll for initiative!" ▶ "To the fight", "On to <title>" for a summons, "The End"; a spectator's "Watching: <name> goes on when ready".
- **Between:** Kell's talk or the card, its Enter `walk({ toward: "lead" })`, the button "On to The Drowned Rat", the card's last line "Press Enter to go on." **The fight card:** the stand-in's line, ▶ "Fight it out" (`fight_it_out`).
- **Overlays and commands:** `/journal` (`/j`, `/notebook`; `j` between scenes), `/quests`; `/end <exit>` and `/end` as the dev stack's owner. **The End:** the epilogue from rows (chapters, journal lines, the last narration, the turns' and chapters' costs); Enter, the title.
- **Headless:** `end [--exit]`, `go`, `journal`, `act --id go_to_lead` and `--id fight`; `observe` prints `MODE: between`, `MODE: fight` and `MODE: end`, as the QA console does.

### 4.6 The campaign (E)

- **The converter** (outside v2, durable): `tools/v2/scene-files.mts`, from the scratch `convert-hanged-clerk.mts`, with each scene's hand-written facts and effects in `tools/v2/scenes/<scene>.mts` (`v3-design.md` §3.10's mapping). It checks the round trip, and the effects against the recorded scripts for every set of the facts they test. Only its output is committed.
- **Scenes:** `drowned-rat`, `heron-warehouse`, `kings-morning`, `caerwyn-afternoon` and `wharf-night` (interludes, no place), every exit's effects; the hanged clerk gains `onEnd: [{ "op": "follow", "who": "kell" }]`. `campaign.json`: six scenes, four places, `quests`. The campaign check: every `next` and `overtaken` resolves, an interlude has an exit with a next, the effects' facts, people and quests exist.

---

## 5. The packages

A lands first on `claude/v2-story`; B, C, D and E build from A's commit on `claude/v2-story-b`, `-c`, `-d` and `-e`; the integrator merges them in that order. A's stubs are their package's to fill in place (`story/moves.ts` and `story/boundary.ts` are B's, `endpoints/boundary.ts` C's); otherwise, after A, only the integrator edits A's files: a package that needs a contract changed writes a local helper and says so in its report.

**A · Contracts.** Owns this brief; `shared/gm/state.ts` and its test; `shared/protocol/{ai,keys,refusals}.ts`; `shared/scene/{files,load,types,graph}.ts`; `simulation/src/schema.ts`, `tables.ts`, `games/delete.ts`' lines, `index.ts`' and `host/memory.ts`' registrations, `moves/{plans,move,registry}.ts`, the stubs `story/moves.ts` and `story/boundary.ts`; the boundary's route, check, context, stub endpoint and canned answer in `ai/service`; `client/module_bindings`. **Done when:** `npm run check` passes, the bindings are current, `gm_state`'s round trip holds with every new column, a scratch stack plays a game as before and answers `walk` with `not_built`, and the root's checks pass.

**B · The simulation.** Owns `simulation/src/**` but A's files: `story/` (A's stubs `moves.ts` and `boundary.ts` filled; end, effects, lead, fight), `moves/open-scene.ts` (a waiting row), `world/place.ts`, `world/cross.ts` (the movers), `say-commits.ts`' `endScene` (one call), `gm/requests.ts` (the story, the boundary's request), `views.ts` ("heading for", The End), memory-host tests. **Builds against** §4.3, A's types, E's first commit, a scripted AI. **Done when (memory host):** each hanged clerk exit writes its quest, flag, attitude, journal and follower rows and logs the rest; `afterwards` removes Prout, but not on a combat exit; the boundary's commit leaves the Rat waiting with what was handed on, the lead and evening; `walk` opens it with the player, what they carry, Kell (her entity kept) and the owed page with whoever has it; the Heron's fight goes `fighting`, `fight_it_out` picks it up, and its next ending crosses to the King's morning, which opens at once; the King's ending is The End; `end_scene` and `carry_on` work; the stack's tests pass. **Must not touch** `shared/`, `ai/`, `client/`, `hosts/`.

**C · The AI service.** Owns `ai/gm/{boundary,owed,presence,aftermath}.ts` and the copied tests, `directives.ts`' second branch, `view.ts`; `ai/service/endpoints/{boundary,open}.ts`; `ai/llm/fake-openrouter.ts`' lists, `hosts/dev/fake.ts` and `fake.json`; `ai/README.md`'s lines. **Builds against** §4.4, A's types, E's first commit, `ai/gm/testdata/scenes`. **Done when:** on `fakeFetch` the boundary answers its verdict, falls back as each call fails, asks presence only of named recurring people, and writes the docs once for a key (an exit after the docs, then the rerun, writes no memory twice); an opening after a boundary sends the second branch with the story so far; the aftermath streams and stages; the copied tests pass; `KM_AI_GM=canned` crosses; the fake takes §1.1's list of endings; the root's `npm run typecheck && npm test && npm run build:web` pass. **Must not touch** `shared/`, `simulation/`, `client/`, `hosts/` but the fake's two files.

**D · The client.** Owns `client/**` but the bindings: `ui/{scene,between,end,overlay}.tsx`, `story/`, `scene/{view,rows,model}.ts`, `app/model.ts`, `net/{connection,owner}.ts`, `commands.ts`, `headless.ts`, `demo.ts`, `check/*`; `hosts/client.tsx`, `hosts/play.ts`. **Builds against** §4.5, the bindings, A's types. **Done when:** the screen check draws the way on (moving, ready with Kell, stuck, the fight, a summons, The End), Kell's talk, the card, the notebook, the quests, the fight card and The End at 80x24 and 130x42; the talk is word for word `talkBetween`'s; `--demo` plays an ending through to the between screen; the headless verbs print their modes; the client's tests pass. **Must not touch** anything else.

**E · The campaign and the tools.** Owns `tools/v2/scene-files.mts`, `tools/v2/scenes/`, `campaigns/caerwyn/**`, `hosts/dev/campaign.ts`. **First commit within half an hour:** the five scenes and three places, effects empty, so B and C can build; then the effects, `onEnd`, `quests` and the check. **Done when:** the converter's checks pass, `npm run campaign -- check campaigns/caerwyn` passes, and `npm run dev -- --fake` installs six scenes in both services. **Must not touch** `shared/`, `simulation/`, `ai/`, `client/`.

**The integrator.** Owns the merges and what makes them meet; `hosts/e2e.ts` (one scenario: the whole story on the fake, two clients, `end_scene` and the recipe, the fight, the summons, The End), `hosts/arc.ts` (checks 6 to 11, 13 to 16), `hosts/local*.ts`, `hosts/status.ts`' story fields, `hosts/live/` (`--script story`), the READMEs, this brief's "As built", `docs/live/story-<date>.md` and the PR's description (§1). **Done when:** `npm run check`, one `npm run e2e` and `npm run arc` pass; §1.2 is played once on the fake; the live run beside the prototype's QA console costs under $0.10 (each scene ended by `end_scene` and `end --exit`, so each boundary and opening is real); the root's checks pass.

---

## 6. Risks, and the other units

| Risk | What's done |
|---|---|
| The world across places: the player, carried things, recurring cast and owed things move between places | Movers that keep ids and re-key things; B's tests open the Rat from the yard as each ending left it |
| Requests grow with the story (the earlier entries) | About 10 KB a scene: far under the 2 MB limit |
| A crash after the boundary's docs reruns its calls | The docs are written once per key: each guard reads the index first |
| The boundary takes 10 to 12 s on real models | The way on says so, as the prototype's does |

**The map unit** (`claude/v2-map`, on V1) shares `game.leadScene` and `leadText`, a `waiting` scene, `walk`'s arguments and the words of `scene_on` and `no_way`, and `openLead` through V0's `openScene`. A waiting scene's place is built when it opens here, and on its map there. Whichever lands second folds the two `openLead`s and the two `TIME_WORDS` (`client/explore/words.ts` there, `client/story/words.ts` here).

**The world bridge** (`claude/v2-world`, from the same base) works in the middle of a turn. Both touch `shared/gm/state.ts` and `gm_state` (both give `absent` its column), `shared/protocol/{ai,keys}.ts`, `schema.ts`, `moves/plans.ts`, `say-commits.ts`' `endScene` (its `dispelConjured`; here one call), `open-scene.ts` (its `betweenScenes`; here the waiting row), `gm/requests.ts`, `ai/gm/view.ts`, `ai/service/{server,requests}.ts`, `canned.ts`, `hosts/dev/fake.json`, `hosts/e2e.ts`, `hosts/status.ts`, `client/scene/rows.ts`, `net/connection.ts`, `ui/scene.tsx`, `headless.ts`, the README and the bindings.

---

## 7. As built

**A (contracts):** as §4, with these choices made in building it. `Story.history` and `earlier` are optional, as the full GM's `gm.rulings` was: a request a job stored before them reads as a first scene. The aftermath's request carries the scene's `transcript` (an opening has none). The boundary is keyed by the ended scene's last turn (`<uid>:s<scene>:t<n>:boundary`), so `keyParts` and the AI service's faults name it as any step. The stubs sit where B fills them (`story/moves.ts` for the four reducers, `story/boundary.ts` for the job's move), so the registrations never change. Until C, the pipeline's boundary answers as the canned GM does, so a stack crosses every boundary on the fake meanwhile. A scene's row gets its `time` from its `scene.json` as it's inserted. The literals the type check found were given the new fields (`ai/gm/fixtures.ts`, `parity.test.ts`, `games/create.ts`, `host/memory.test.ts`, `hosts/dev/gm-status.test.ts`), and the campaign check reads a list of facts and the two new effects (`hosts/dev/campaign.ts`). The integrator adds each package's departures here.
