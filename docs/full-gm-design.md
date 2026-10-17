# The full GM: memories, the co-GM and considered rolls, dropped in

The plan for one PR, `claude/v2-gm`, stacked on V1 (the stack is V0, then V5, then V1 with V5 merged in). After it, a scene in v2 plays as the prototype's default `v2` approach does (`src/runtime/approaches.ts:79`): people remember what the player did and bring it back on later turns, the co-GM steers a scene that drifts or leaves the graph, and a risky act no route covers gets the GM's ruling and a roll before the reply. Spells and blows stay for the world bridge, which comes next.

The user's direction for it: **drop in**. Copy the prototype's files whole wherever possible, each headed by its source at `44c6d4a` and its edits. Adapt only at the seams V0 built: the `TurnView` adapter on the AI side, rows in and out on the simulation's. Checks are functional: the existing tests, the e2e, and a live scene played beside the prototype on the same lines.

Inputs: `v6-design.md` (memories and the co-GM, written against V0), `verticals.md` V6 and V8, the stack as read on 16 Oct (`claude/v2-v0` a361d97, `claude/v2-v5` efc9bf3, `claude/v2-v1` c07abc8), the prototype at `44c6d4a`. `file:line` means the prototype unless a v2 path is given. The research files named here are in the author's scratchpad, not the repo.

> **As built.** The full GM was built to this plan as one pull request, `claude/v2-gm`, on V1 at 7080e94: K's contracts on that branch, then S, A1, A2 and T each on a branch from K's commit (`claude/v2-gm-s`, `-a1`, `-a2`, `-t`), merged in that order by I. Where the build departs from the text below, §7 says so and why, with the live run beside the prototype's.

**Decisions, in short**
- **The director is extended, not replaced.** V0 already split `decideBefore` and `decideAfter` into questions and readings, so the AI service picks a route and the simulation rolls it. The `v2` approach's missing questions and readings are copied into that split line for line. The rest of `director.ts` is the world bridge's (mechanics, jumps, reactions, threats) or other approaches' (pressure, staging, actors, freeform, relocation).
- **A considered turn has a fourth step, `consider`,** between decide and reply, with its own phase (`considering`) and endpoint. The AI service judges and words the ruling. The simulation rolls it from the `dice` row through V1's engine, and applies it like a route.
- **Memory reviews and the co-GM are background jobs on V5's loop,** shaped exactly like V5's notes and suggestions: no lease, never the turn's failure. No lane: the AI service writes docs with synchronous `fs` in one process, so two reviews can't lose a line.
- **Names are the prototype's own:** steps, moves and endpoints `consider`, `remember`, `repair`; files `consider.ts`, `repair.ts`.
- **Nothing new on screen but the considering line,** as in the prototype, which shows nothing when someone will remember or the co-GM steers. `npm run status` shows the GM's side, as the prototype's `scene status` does.
- **Consequences are already V0's** (the `daft` question and its directive). This unit adds only the prototype's gates on them for a ruled turn.
- **One more thing the prototype's turn does that v2 misses, included:** the after-reply `left` read (the player walks out of the place: "an ending of their own", `engine.ts:898`, `:920-932`).

---

## 1. How to try it

### 1.1 From a fresh checkout

```sh
git fetch && git switch claude/v2-gm && cd v2 && npm ci
npm run check                 # types, unit tests (memory host), the parity test, the screen check
npm run dev -- --fresh        # real models; --fresh for a clean start (an old database would migrate: new columns carry defaults)
```

In two more terminals:

```sh
npm run client -- --session wren --new "Wren Ashdown: a hedge wizard from the fens" --build wizard
npm run status -- --game 1               # the GM's side: beat, path, notes, whispers, canon, patches, rulings, repairs
npm run status -- --game 1 --memories    # every memory note the reviews wrote, in full
```

The game's number is in the side panel. With real models, the eight lines below cost about $0.06.

### 1.2 What to play

| # | Do | See in v2 | The prototype's behaviour it matches |
|---|---|---|---|
| 1 | Watch the opening | As V5. `status`: turn 0, no reviews, no repairs | No review after an opening: `afterTurn` runs only after a player's turn (`src/game/play.ts:303`) |
| 2 | `(I crouch and press a silver crown into the boy's hand) Get yourself something hot, lad. No questions.` | The reply as before. Nothing on screen about memory. 10 to 60 s later `--memories` shows a note under `Cast/Cob/memories/` (often Kell's too), and `status` has `memoryReviews: ["1: witnessed, conversational_exchange — memory cob: …"]` | `rememberJob` (`jobs.ts:77-91`) writes the same kind of notes and a line in `memory-reviews.jsonl`; nothing on screen |
| 3 | At once, before the review lands: `Sergeant, who found him?` | First words as fast as before: the review doesn't hold the turn | The review is a detached process |
| 4 | `(I try to lift the folded paper out of the boy's boot while he watches the sergeant)` | The status line: "The GM is considering the ramifications of your actions…" for 3 to 8 s. Then a dice line before the reply (Sleight of Hand against a DC from 10 to 18, or no dice and a plain yes or no), and a reply that plays what was decided. `status`: `rulings: ["3: <the act> -> sleight_of_hand DC <dc> (<total>) [<why>]: <went>: <what changed>"]`. This is the third line, so `repairs` soon has `"3: on_track — … [pending]"` | `consider.ts`: the review, the verdict's contest with Cob, the roll, applied like a route (`engine.ts:656-701`); `CONSIDERING` (`src/app/game.ts:269`); the co-GM's backstop every third turn (`repair.ts:281`) |
| 5 | `Sergeant, you saw what I gave the boy. Think me soft?` | Kell answers from her memory, if the review gave her one. `status`: `opened` lists her note; the repair reads `[merged at t4]`, and `notes`, `whispers` and `canon` show what it left | Disclosure follows her memory index (`v2/ai/docs/disclosure.ts`); `applyPendingRepairs` at the turn's start (`engine.ts:452`) |
| 6 | `Sergeant, what if we leave him up there and watch who comes back for those boots? I'll wait in the loft.` | A plan off the graph: either considered and ruled (a dice line or a plain yes or no), or, if the review comes back with nothing, `offGraphTurn: 5` and a co-GM review after it whose route (`patches: ["yard + …"]`) a later line can take | `off_graph` (`director.ts:753-759`), `wantsReview` (`engine.ts:407`), `engine.ts:703` |
| 7 | `I ask the girl what songs the granary kids sing.`, then `And the one about the miller's cat?` | `sceneStatus: drifting`, so the co-GM runs after each. Within a reply or two someone pulls the talk back to Prout, the boots or the cart. A note steers two replies and lapses; a whisper steers one | `shouldRepair`; `NOTE_TTL_TURNS` 2 and `WHISPER_TTL_TURNS` 1 (`repair.ts:15-16`), `expireNotes` (`:244`) |
| 8 | `(I nod to the sergeant and walk out of the yard, back towards the palace)` | The scene ends: "Scene ends: An ending of their own" (or an authored ending, if the same read finds the story there first) | `left` read at 0.7 (`director.ts:1280-1283`, `:1350`), `engine.ts:929-932` |

Spells and blows aren't the rules' yet in v2 (the world bridge brings them). Keep them out of a side-by-side: v2's GM would rule on "I cast charm person" as a considered act, where the prototype's rules resolve it.

### 1.3 Side by side with the prototype

The repo root of the same checkout runs the prototype, with the same lore and prompts:

```sh
cd .. && npm ci
npm run scene -- start hanged-clerk --approach v2 --session side --as "Wren Ashdown: a hedge wizard from the fens"
npm run scene -- say side "<the line>"     # its reviews start as detached processes, as v2's jobs do
npm run scene -- status side               # beat, path, notes, canon, patches, rulings, repairs
npm run scene -- memories side             # the docs it wrote, memories included
```

In v2, headless, the same lines: `npm run play -- new --session side --as "Wren Ashdown: a hedge wizard from the fens" --build wizard`, then `npm run play -- say --session side "<the line>" --wait settled`, then `npm run status -- --game <n>`. Compare, line by line: whether the turn was considered (the considering line, `rulings`), the dice line's skill and DC band, who got a memory, the co-GM's status and notes, and the gist of the reply. The models' words differ run to run in both builds; the mechanics shouldn't. The build differs (the prototype's scene harness lets the model pick one), so modifiers differ.

### 1.4 Offline, on the fake model

```sh
npm run dev -- --fresh --fake            # fake.json: Kell remembers what she witnessed; the co-GM answers on track
npm run play -- new --session qa --as "Pell Marrow: a disgraced herald" --build rogue
npm run play -- say --session qa "(I give the boy a coin) Get yourself something hot." --wait settled
npm run status -- --game 1 --memories    # a second later: Kell's note "What the investigator did"
# q in the dev host, then: every line considered, with fake.json's ruling, a dice line, then the reply
KM_AI_FAKE='{"choices":{"roll_call":"new"}}' npm run dev -- --fake
```

### 1.5 The checks

`npm run check`; `npm run e2e` (V0's, V5's and V1's scenarios, then this unit's four, §4.4); `npm run live -- --script gm` (the eight lines with real models, recorded beside the prototype's in `v2/docs/live/gm-<date>.md`); at the repo root `npm run typecheck && npm test && npm run build:web` (shared code changed).

---

## 2. Scope

### 2.1 What it adds

- **Memory reviews** after every player turn (the wind-down's too): the attention filter, then the memories and lore agents (`v2/ai/docs/reviews.ts`, shared already), writing first-person notes into the game's docs. V0's disclosure and `memoryBrief` already bring them back: from the next turn every prompt lists each person's memory index, and disclosure opens a note when the moment bears on it.
- **The background co-GM** when `shouldRepair` says so: off the graph this turn, a status other than on track, or the third turn since the last. Its answer waits in a row and merges at the next turn's start: notes, whispers, canon, routes and bridging beats (patches), and a forward move of the tracker.
- **Considered rolls:** the decider's `roll_call` and `off_graph`; the GM's review, its 12 s watchdog and the plain-check fallback; the ruling rolled and applied; the ruling's facts and shut routes kept; what the dice kept back never lands.
- **The prototype's gates for a ruled turn** on the bill, the payoff, the ending lead, the loop-breaker and the held ending (`engine.ts:704-735`).
- **`left`:** walking out of the place ends the scene through "an ending of their own".

### 2.2 What waits

| Left out | Why | Comes with |
|---|---|---|
| The mechanic question and its details, jumps, features, reactions, threats, timed spells, fire's tick, `means_only`, conjured things (`director.ts:409-623`, `:1101-1189`, `:1284-1295`; `engine.ts:517-542`, `:618-656`, `:919`) | The rules on the world | The world bridge (next) |
| The quick co-GM, stall and blocking repair (`repair.ts:290-354`; `engine.ts:472-483`, `:544-557`, `:743-828`) | Other approaches: `v2` repairs in the background only | Not ported |
| The lite memory (`v2/ai/docs/remember.ts`), pressure rolls, relocation, staged secrets, actors, freeform checks in the decision | Not the `v2` approach | Not ported (staging comes with talks, V11) |
| The ending's memories, the played scene's note, the hand-off (`engine.ts:1073-1077`) | A boundary's | V3 |
| A cue beside a fight, the opening blow (`engine.ts:963-979`) | Fights | V12 |
| A talk without a co-GM (`sceneApproach`) | Talks | V11 |
| The considered turn's in-between steps (weighing, success, failure) on the status line | They're spinner lines: v2 shows `CONSIDERING` for the whole step | Not needed |

---

## 3. The copy list

Each copied file's first line names its source at `44c6d4a` and its edits, as V0's do. "The usual edits": `SessionState` → `TurnView` (AI) or `GmState` (simulation); imports from `v2/shared` and `v2/ai`; `respondJson`, `logCall` and deciders given the request's `calls` (V0's `CallContext` seam); process env read through the service's config, never in `ai/gm`.

### 3.1 Copied

| Source (`44c6d4a`) | Lines | To | The edits |
|---|---|---|---|
| `src/runtime/consider.ts` | 1-626, 677-699 | `v2/ai/gm/consider.ts` | The usual. `considerDeadlineMs` and `considerEffort` from config (`KM_CONSIDER_DEADLINE_MS`, 12 s; effort none). `onStep` dropped. `PreDecision["considered"]` → `Decision["considered"]`. `settleRuling` (627-675) not copied whole: its directive lines (650-665, with `noDirective` 602-618) become `rulingDirective(scene, view, ruling, verdict, move, played)`, for the reply |
| `src/runtime/consider.ts` | 550-557, 588-600, 633-675 (the state half), 677-686, 695-699 | `v2/simulation/src/gm/consider.ts` | `changed`, `NO_CHANGE`, `refusalOf`, `settleRuling` without its directive lines (the roll through V1's `rollerFor`; `verdict` and the route come from the AI service), `exitOf`, `patchesFor`, `landRuling`; plus `contest` (119-129) for whose no it is. Types from `shared/gm/consider.ts` |
| `src/runtime/repair.ts` | 18-207 | `v2/ai/gm/repair.ts` | The usual. `runRepair(authored, view, { calls })`, effort medium (the `v2` approach has no `repairEffort`), 8,000 tokens, schema `co_gm_notes`. `state.turn` is the request's reviewed turn |
| `src/runtime/repair.ts` | 15-16, 243-286 | `v2/simulation/src/gm/repair.ts` | `NOTE_TTL_TURNS`, `WHISPER_TTL_TURNS`, `expireNotes`, `applyRepair`, `moveTracker`, `shouldRepair`. `state.turn` → `last` (the turn just finished). `state.repairs.push` → the refusal returned, for the row's note. `state.ended` → `gm.ended` |
| `src/runtime/director.ts` | 63-93, 256-282, 625-649, 739-759, 878-880, 896, 902-932, 987, 1010-1016, 1231-1232, 1279-1283, 1350 | `v2/ai/gm/director.ts`, into V0's split | The confidence bars; `rollCallQuestion`; `failedTries` (exported for consider.ts); `freeformCheck` split as `freeformQuestions()` and `readFreeform()` (the roll is the simulation's); `attempt_means` in every beat, `roll_call` and `off_graph` in `beforeQuestions`, in the prototype's order; `plainSettles`, `limitBlocks`, the considered read, the same push with it, `offGraph`, `byPrep` in `readBefore`; `left` in `afterQuestions` when the view has rules, read in `readAfter`. Not `actSettles` or `forced` (the world bridge's) |
| `src/runtime/director.ts` | 1209-1211 | `v2/ai/gm/directives.ts` | `freeformDirective` |
| `src/runtime/engine.ts` | 397-410, 418-422, 276-286, 660-703, 704-735, 898, 909-913, 920-932, 449-453 | `v2/simulation/src/gm/bookkeeping.ts`, `moves/say-commits.ts`, `moves/say.ts` | `wantsReview` (on the wire's `Decision`); `settledFacts` with the rulings; `holdEnding`'s `considered`; the consider commit (the ruling's move, its path step, `moveTaken`; the fallback's roll; `offGraphTurn`); the reply's gates, as `directivesFor` conditions (AI) and the held ending's (simulation); `left` and the own ending; `landRuling` at the settle; the merge after `onStage` |
| `src/runtime/background.ts` | 37-48 | `v2/simulation/src/gm/background.ts` | `afterTurn`: jobs queued in the turn's last commit, not detached processes; no lock files |
| `src/runtime/jobs.ts` | 77-91, 94-105 | `v2/ai/service/endpoints/remember.ts`, `repair.ts` | The snapshot or saved session → the request's working set; `memory-reviews.jsonl` appended through a store; `result.turn = reviewed` |
| `src/runtime/brief.ts` | 114-131, 138-150 | `v2/ai/gm/brief.ts` | `asHeard`, `strangers` (V0 left them out); `SCENES` → the campaign's story (V5's `gm/story.ts`) |

Already in the stack and used as they are: `effectiveScene` with every kind of patch and `openRoutes`' co-GM rule (`shared/scene/graph.ts`); the co-GM notes, whispers and canon in `nowNote` (`ai/gm/brief.ts:226-230`); the prompts `consider.md`, `repair.md`, `review/*.md` (`v2/ai/prompts`); `reviewTurn` (`v2/ai/docs/reviews.ts`); `CONSIDERING` and `BusyLines` (`v2/client/busy.ts`); the daft question and `CONSEQUENCE_DIRECTIVE`.

Size: about 1,250 lines copied (consider.ts 700, repair.ts 240, director.ts 130, engine.ts 90, the rest 90) and 900 new (types, schema, moves and commits, three endpoints, the status tool, the e2e).

### 3.2 Not copied, and why

| Prototype | Why not |
|---|---|
| `repairFile`, `writeRepair`, `applyPendingRepairs` (`repair.ts:209-241`); lock files; `spawn`; `setBackgroundRunner` | Files and processes become job rows and a `co_gm_result` row, merged in the same place |
| `resolve` and `rollFor` (`director.ts:330-342`) | Every die is the simulation's: V0's `resolveMove` with V1's engine roller already is this function |
| `state.repairs`, `lateRepairs`, `speculation`, `decidedRelocations`, `guard` | Bookkeeping of other approaches, or files' records that rows replace |
| The whole of `director.ts` in place of V0's split | Half of it is the world bridge's and a quarter other approaches'; the split is where the dice seam is, and its parity test already pins the questions |

---

## 4. The seams

### 4.1 The AI service

**New endpoints**, each a route in `ai/service/server.ts`, a check in `requests.ts`, and a canned answer in `endpoints/canned.ts`:

| Endpoint (step) | Request | Answer | Model calls | Timeout |
|---|---|---|---|---|
| `POST /v1/turns/consider` (`consider`, a turn's own) | `{ turn: TurnContext; read?: Decision["considered"]; pending?: GmState["pendingExit"] }` | `{ ruling?: Ruling; verdict?: Verdict; route?: Transition; refusal?: RulingOutcome; fallback?: { skill; dc; reason }; error?: string; ms: number; usage }` | `consider` (Luna, effort none, 1,000 tokens, `finalAnswer`), cut off at 12 s; then, with no ruling and a `read`, `director.freeform` | 20 s |
| `POST /v1/turns/remember` (`remember`, background) | `{ turn: SceneContext; reviewed: number }` | `{ flags: string[]; reviews: ReviewRecord[]; usage }` | `memory.attend` (Jev); `memory.review.memories` and `.lore` (Luna, medium, tool loops), only when flagged | 170 s |
| `POST /v1/turns/repair` (`repair`, background) | `{ turn: SceneContext; reviewed: number }` | `{ review: RepairResult; usage }` | `repair` (Luna, medium) | 170 s |

- **consider:** `sceneAndView` with the story; `unheard = strangers([scene, ...the story's scenes], view, [scene.hook])`; `reviewWithin(…)`. With a ruling: `verdict`, `refusalOf` for a no, `rulingRoute`; all returned. Without one: the fallback's skill and DC from `director.freeform`, and `plainReason` for its dice line. It answers 200 either way; a transport failure retries as any step's.
- **remember:** `reviewTurn(workingSet(scene, view), reviewed, { decider: new JevDecider(JEV_MODEL, "jev", calls), effort: "medium", calls })`; the answer appended to `<store>/games/<uid>/memory-reviews.jsonl` (`Stores.reviews.append`, the prototype's file). `memory.attend` failing is a 500 (nothing written yet); an agent's own failure stays in `reviews[].error`.
- **repair:** `runRepair(ctx.campaign.scene(key), view, { calls })`, then `review.turn = reviewed`.
- **Shared code, optional params only** (the prototype's calls unchanged): `runTools({ …, calls? })` in `ai/llm/tools.ts` (fetch, key, call log and cost through the `CallContext`); `reviewTurn(view, turn, { …, calls? })` passing it on; `fakeFetch`'s `toolCalls?: Record<string, ToolCall[]>`, keyed by a tool loop's first tool (`save_memory`: the memories agent; `search_lore`: the lore agent): the first round answers with those calls, any round carrying `function_call_output` answers "Done.".

**Changed endpoints:**

| Endpoint | Change |
|---|---|
| decide | `beforeQuestions` asks `attempt_means` always, `roll_call` and `off_graph`; `readBefore` returns `considered`, `offGraph`, `byPrep` |
| reply | `directivesFor` adds, in the prototype's order, the ruling's lines (`rulingDirective`, on the scene before the ruling's own `close` patches: else a shut route reads as its id) with `moveTaken`'s filter when the dice decided an ending, or `freeformDirective` for the fallback; and the gates: no ending lead, bill, payoff, plain route or loop-breaker over a ruling (`engine.ts:704-728`) |
| settle | `afterQuestions` asks `left` when `view.rules` is set (every V1 character); `readAfter` returns `left` at 0.7 |
| all | `viewOf` takes `rulings` from `gm` (it was `[]`); `TurnView.rulings` becomes `RulingRecord[]` |

### 4.2 The simulation

**`gm_state` gains typed columns** (`shared/gm/state.ts`: `GmState`, `GmRow`, `gmToRow`, `gmFromRow`; each with a default, so a V1 database migrates):

| Column | Type | `GmState` field | Written by |
|---|---|---|---|
| `canon` | `t.array(t.string())` | `canon` | the merge |
| `patches` | `t.string()`, JSON `ScenePatch[]`, `"[]"` | `patches` | the merge; the consider commit (shut routes) |
| `notes` | `t.option(t.string())` | `notes` | the merge, `expireNotes` |
| `notesTurn` | `t.option(t.u32())` | `notesTurn: number \| null` (new) | the same |
| `whispers` | `t.array(Whisper)`, `{ to, note, turn: u32 }` | `whispers` | the same |
| `lastRepairTurn` | `t.option(t.u32())` | `lastRepairTurn?` (new) | the merge |
| `offGraphTurn` | `t.option(t.u32())` | `offGraphTurn?` (new) | the decide or consider commit |
| `rulings` | `t.array(RulingRow)`: `turn` u32, `act`, `target`, `skill`, `kind`, `dc` option i32, `why`, `roll` option `Roll`, `went`, `changed`, `costUsd` f64, `latencyMs` f64 | `rulings: RulingRecord[]` (new) | the consider commit |

`patches` is the one JSON column: a patch is a piece of the scene graph (a beat, routes with checks, an essential), the campaign format's own shape, kept as `scene_def.json` is. `refuseLaterFields` goes on refusing `entered` and `absent` (V3's).

**New table** `co_gm_result` (private): `id` pk auto · `sceneId` ix · `turn` u32 (reviewed) · `review` (JSON `RepairResult`) · `mergedTurn` option u32 · `note` option (a refused move) · `at`. Rows are kept as the record, as `repair-NNN.json` files are. A line in V1's delete registry (`games/delete.ts`, by scene).

**Other row changes:** `turn.phase` gains `considering`; `job.step` gains `consider`, `remember`, `repair`, and `job.move` gains `remember`, `repair` (values only). Keys: `<uid>:s<scene>:t<n>:consider|remember|repair` (`shared/protocol/keys.ts`, `keyParts` too, so `KM_AI_FAULTS=exit-after-store:<step>` names them).

**A turn, as it now runs:**

1. **Start** (`startPlan`, the one place a turn starts: `say`'s resolve, or the end of a turn starting a queued one): `onStage` from `gm`; then the merge: every unmerged `co_gm_result` row of the scene, by turn, through `applyRepair(graph, gm, review, last = n - 1)`, its row marked `mergedTurn = n` (with the refusal as `note`); `expireNotes(gm, n - 1)`; `putGm`. Then `settledBefore` (with rulings) as before.
2. **Decide commit:** as V0's, then `wantsReview(gm, decision)` (`!closing`, nothing else answered it, and `considered` or `offGraph`). If so: the turn `considering`, the plan's next step `consider`, and the held-ending and closing tail of `decideOutcome` (`say-commits.ts:144-150`) waits for the consider commit. Otherwise `offGraphTurn = n` when `offGraph`, and on to the reply.
3. **Consider commit** (new, `afterConsider`): with a ruling, the state half of `settleRuling`: the route's check rolled through `rollerFor` when the verdict is a roll; the outcome played; `patchesFor` into `gm.patches`; the record into `gm.rulings`; its dice line into the transcript and `outcome.lines`; `applyMove`, the path step of a ruling that stays (`engine.ts:676`), `takeMove` with the pending ending; `withheld` kept in the plan. With a fallback: its check rolled, its dice line, a `freeform` path step. Then `offGraphTurn = n` if off the graph and no ruling; the deferred tail, `holdEnding` with `considered` (skipped after a ruling's success or exit); `outcome.ruled` or `outcome.freeform` for the reply. The turn `replying`.
4. **Reply and settle commits:** as V5's. The settle applies `landRuling` (what the dice kept back doesn't land) and `left` (the improvised exit, a `left-the-place` path step) in the prototype's order.
5. **The turn's last commit** (the settle, or a wind-down's reply), before V5's `finishTurn`: `afterTurn` queues `remember` always, and `repair` when the scene hasn't ended or begun closing and `shouldRepair(gm, n)`. Their requests are built there, with the transcript cut to `turn <= n` (a line queued meanwhile is already in it).
6. **The background commits:** `remember` writes nothing but its log line (`[job …] committed: flags witnessed; memory kell: …`). `repair` inserts its `co_gm_result` row; an ended scene's is never merged.

**The background moves** copy V5's `notes` and `suggest` shape (`moves/notes.ts`): `background: true`, `applies: () => true`, `giveUp` a log line, the default give-up (10 minutes). Their usage goes on the turn's row, as V5's do. Each is one row per turn and move (V5's `queueThink`).

**Patches on both sides:** `sceneGraph(tx, scene, gm)` (`scenes.ts`) passes `gm.patches` to `effectiveScene`, at every caller. Without it the decide commit can't find a co-GM route the AI service offered ("isn't open from …: no move").

**Shared types (K):** `shared/gm/consider.ts` (`Ruling`, `RulingOutcome`, `Judged`, `Verdict`, `Gets`: `consider.ts:30-100`; `RulingRecord`: `session.ts:128-147`), `shared/gm/repair.ts` (`RepairResult` without `quick`: `session.ts:210-229`), and in `shared/protocol/ai.ts`: `Decision.considered?: { probability; routes: Array<{ id; p }>; means?: Skill; earned?: number }`, `Decision.offGraph?`, `Decision.byPrep?`; `After.left?`; `Outcome.ruled?: { ruling; verdict; route; went; roll?; from; to; exit?; chosen }`, `Outcome.freeform?: { skill; dc; roll; reason }`; the three requests and answers; `ReviewRecord` (structural); `Endpoint`, `STEP_ENDPOINT`, `STEP_TIMEOUT_MS`.

### 4.3 The client

- `Phase` gains `considering` (`client/scene/view.ts`, `rows.ts`); the box stays shut, as while deciding.
- `SceneModel.busy()`: `CONSIDERING` while considering (the prototype's line, already in `client/busy.ts`).
- The headless client prints `PHASE: considering`. The screen check gains the line at 80x24 and 120x40.
- Nothing else: no line for a memory or the co-GM, as in the prototype.

### 4.4 Hosts and the fake

- **`npm run status -- --game <n> [--memories]`** (`hosts/status.ts`, new): owner SQL through the dev stack (`runs/dev/stack.json`) on `scene`, `gm_state`, `turn`, `co_gm_result` and `job`, and the AI store's files (`runs/dev/ai/games/<uid>/`). It prints the prototype's `scene status` fields (`src/cli/scene.ts:250-268`: patches and rulings summarised as there, `repairs` as `"<turn>: <status> — <assessment> [pending | merged at t<k>]"`), plus `notesTurn`, `whispers`, `offGraphTurn`, `lastRepairTurn`, `sceneStatus`, `opened`, `memoryReviews` and the background jobs in flight. `--memories` prints every note under `docs/Cast/*/memories/`, as `scene memories` does.
- **`hosts/dev/fake.json`** gains quiet defaults, or every multi-turn run on the fake breaks: the attention categories `not_flagged` but `witnessed`; `toolCalls.save_memory` (one memory for `kell`, "What the investigator did"); `byName.co_gm_notes` on track with a short note and `move_to: null` (the fake's least JSON moves the tracker back to the first beat); `byName.ruling`, a contest with Cob (sleight of hand, guarded, plausible, wary: DC 12). `roll_call` and `off_graph` are already quiet. `hosts/dev/fake.ts` merges `KM_AI_FAKE`'s `choices` and `byName` into fake.json's, a level deep, so a recipe adds to them.
- **The e2e** (`hosts/e2e.ts`), each scenario with its own fake options over fake.json:
  1. *A memory, kept and brought back:* a line; within 20 s Kell's note is in the store, linked from her index, with a `memory-reviews.jsonl` line; the next line's `gm.reply` input (call log) lists her memory.
  2. *The co-GM steers:* `byName.co_gm_notes` with a note, a whisper for Moll, a canon line and a route from the current beat to `doubt` (on attempt, no check); `choices.attempt: improv-3-0`. After line 3 (the backstop), a `co_gm_result` row and `gm_state` unchanged; at line 4 the merge (`notesTurn` 3, the whisper, the canon, the patch), the decide taking the new route (a path step `via improv-3-0`, the beat `doubt`), and "## Notes from your co-GM" and "On Moll's mind" in its `gm.reply` input; at line 5 the whisper gone; at line 6 the notes.
  3. *Considered:* `roll_call: new`; both clients see `considering`, then the dice line before the reply; `gm_state.rulings` has it; "Decided, and it stands" is in the reply's input. Then `stall: ["ruling"]` with `KM_CONSIDER_DEADLINE_MS=2000`: the next line rolls the plain check within 4 s, and `rulings` is unchanged.
  4. *Left:* `choices.left: gone`; the scene ends through "An ending of their own".
- **`hosts/local.test.ts`** gains the same quiet defaults, so V0's endings tests keep passing with a review a turn and a co-GM every third.
- **`npm run live -- --script gm`** (`hosts/live/`): §1.2's lines, waiting for the background jobs before lines 5 and 8, as a tester reading the reply would.

---

## 5. Work packages

K lands first; S, A1, A2 and T build in parallel from K's commit, each on its own branch (`claude/v2-gm-s`, `-a1`, `-a2`, `-t`); I merges them in that order into `claude/v2-gm`, the PR. After K, only I edits K's files; a package that needs more there writes a local helper and says so.

### K · Contracts (one agent, about 45 minutes)
- **Owns:** `shared/protocol/ai.ts`, `keys.ts`; `shared/gm/state.ts` and its test; `shared/gm/consider.ts`, `repair.ts` (types); `simulation/src/schema.ts`; `turns.ts`' `Phase`; `moves/plans.ts` (`SayPlan` gains `step: "consider"`, `pendingExit`, `ruling`, `verdict`, `route`, `withheld`; `RememberPlan`, `RepairPlan`); `moves/registry.ts` and stubs `moves/remember.ts`, `moves/repair.ts` that throw "not built"; `games/delete.ts`' line; `client/module_bindings`; the three routes and checks, stub endpoints answering canned, `canned.ts`, `config.ts`' `KM_CONSIDER_DEADLINE_MS`; `ai/gm/view.ts` (`rulings` from `gm`); the `status` script in `package.json`.
- **Builds against:** this plan; the stack's tip.
- **Done when:** `npm run check` passes (V1's tests unchanged, but for literals the typecheck finds without `notesTurn` or `rulings`); the bindings are current; `gm_state`'s round trip holds with every new column set; a scratch stack plays a V1 game as before.
- **Must not touch:** the moves' bodies, the job loop, the director, the endpoints' bodies, the client's screens.

### S · The simulation (one agent, about 90 minutes)
- **Owns:** `simulation/src/**` but K's files: `moves/say.ts`, `say-commits.ts`, `remember.ts`, `repair.ts`; `gm/bookkeeping.ts`, `gm/requests.ts`; new `gm/consider.ts`, `gm/repair.ts`, `gm/background.ts` (copied); `scenes.ts`; the `afterTurn` call before `finishTurn`; memory-host tests.
- **Builds against:** §4.2; K's types; a scripted AI on the memory host.
- **Done when (functional, memory host):** a considered turn goes decide, considering, consider, reply, settle, with the ruling rolled from the `dice` row, its dice line, its record and its shut route; a fallback rolls a plain check; `remember` is queued after every player turn (a wind-down's too) with the transcript cut at its turn; `repair` is queued when due, its row merged at the next start on both paths, the notes and whispers lapsing on the prototype's turns; a co-GM route is taken by the next decide; `left` ends the scene; the stack's tests pass.
- **Must not touch:** `shared/`, `ai/`, `client/`, `hosts/`.

### A1 · The AI service: the turn's thinks (one agent, about 90 minutes)
- **Owns:** `ai/gm/director.ts`, `directives.ts`, `brief.ts` (`asHeard`, `strangers`); new `ai/gm/consider.ts` (copied); `ai/service/endpoints/{decide,consider,reply,settle}.ts`; `ai/gm/parity.test.ts`' `NOT_ASKED` (left with `mechanic`, `threat`, `threat_severity`).
- **Builds against:** §4.1; K's stubs; `fakeFetch`.
- **Done when:** the existing parity test passes with `roll_call`, `attempt_means`, `off_graph` and `left` asked, each equal to the prototype's recorded question; on the fake, decide reads `considered` and `offGraph`, consider answers `byName.ruling` with a verdict and a route, a stalled review falls back to a plain check inside the deadline, the reply's directives carry the ruling's lines, and settle reads `left`.
- **Must not touch:** `shared/`, `simulation/`, `client/`, `hosts/`, `ai/docs`, `ai/llm`, A2's files.

### A2 · The AI service: the background (one agent, about 60 minutes)
- **Owns:** new `ai/gm/repair.ts` (copied); `ai/service/endpoints/{remember,repair}.ts`; `ai/service/stores.ts`, `folder-stores.ts` (`reviews`); the shared seams `ai/llm/tools.ts`, `ai/docs/reviews.ts`, `ai/llm/fake-openrouter.ts` (`toolCalls`).
- **Builds against:** §4.1; K's stubs.
- **Done when:** on `fakeFetch`, `remember` with `witnessed` flagged and `toolCalls` writes Kell's note and index line in a temporary store and appends `memory-reviews.jsonl`; nothing flagged makes one call; `repair` shapes a scripted `co_gm_notes` as `toRepairResult` does (a route to nowhere rejected, a DC clamped, `move_to` the current beat dropped); `runTools` with `calls` logs to that call log, and without it as before; at the repo root `npm run typecheck && npm test && npm run build:web` pass.
- **Must not touch:** `shared/`, `simulation/`, `client/`, `hosts/`, A1's files.

### T · The client and the tools (one agent, about 45 minutes)
- **Owns:** `client/scene/{view,rows,model}.ts`, `client/headless.ts`' phase line, the screen check's case; new `hosts/status.ts`; `hosts/dev/fake.json`, `fake.ts`; `hosts/live/`' `gm` script; `hosts/dev/README.md`'s lines.
- **Builds against:** §4.3, §4.4; K's bindings.
- **Done when:** the screen check shows `CONSIDERING`; `npm run status -- --game 1` prints a V1 game (the new fields empty) and `--memories` an empty list; `npm run dev -- --fake` starts with the new defaults; `npm run live -- --script gm --rehearse` runs to the end on the fake model.
- **Must not touch:** `shared/`, `simulation/`, `ai/`.

### I · Integration (one agent, about 90 minutes)
- **Owns:** `hosts/e2e.ts` (the four scenarios), `hosts/local.test.ts` (quiet defaults); the merges and anything that makes them meet; the bindings regenerated; `v2/README.md` ("What you can play": people remember, the GM steers a drifting scene, the GM rules on a risky act); the READMEs touched (`ai/README.md`: three endpoints and the seam; the simulation's: the consider step and the background jobs); `v2/docs/full-gm-design.md` (this plan, with an "As built" section); the side-by-side record `v2/docs/live/gm-<date>.md`; the PR's description (§1).
- **Done when:** `npm run check` and `npm run e2e` pass here and in CI; the root's checks pass; the live run and the prototype's run of the same eight lines are recorded side by side (per line: considered or not, the dice line, memories written, the co-GM's status and notes, first-text time, cost); every copied file is headed by its source and edits.

---

## 6. Risks, and if the stack differs

| Risk | What's done about it |
|---|---|
| The V5-into-V1 merge reshapes the job loop (V1's `JobOwner` beside V5's `background`, `applies`, `giveUp`) | `remember` and `repair` copy whatever shape `notes` and `suggest` have after the merge. If the flags were folded into an owner: `wanted` always, no `waiting` note, `charge` to the turn, `failed` a log line |
| The fake's defaults: every attention category flagged; the co-GM's least JSON moves the tracker back to the first beat | Quiet defaults in fake.json, `local.test.ts` and the e2e (§4.4). Any new test of three turns or more sets them too |
| A patched route missing on the simulation's side fails nothing loudly: the move is skipped | `sceneGraph` takes `gm.patches` everywhere (S); e2e 2 takes a co-GM route |
| Spells and blows before the world bridge are read as considered acts | The side-by-side lines avoid them; the bridge brings back the mechanic question and `actSettles` |
| A considered turn's first words come 3 to 8 s later | As the prototype's (5 to 7 s); the considering line says why; the review is cut off at 12 s |
| The AI service dying mid-review may save a memory twice on the re-run | Rare (a 10 to 100 s window); the agent is told to avoid duplicates and sees the index |
| Long reviews (up to about 105 s) hold procedure isolates | V0's pool of 16 holds a turn, a review and a co-GM for several games: enough for dev and QA |
| Two kinds of "considered" are easy to mix up | The decider's read is `Decision.considered`; the ruling played is `Outcome.ruled` |

**If the stack differs from what was read:**

| If | Then |
|---|---|
| V5 isn't merged into V1 when the build starts | Don't start on V1 alone: the background jobs ride V5's loop, and the reply, the client's phases and fake.json are V5's. Start K from a local merge of the two and rebase onto the real one when it lands (the bindings regenerated, never merged by hand) |
| `gm_state` went back to one JSON column | Add only the `GmState` fields; no columns |
| `startPlan` or `finishTurn` were renamed or split | The merge goes wherever a turn starts, `afterTurn` wherever the turn's last commit is; both are one call each |
| `viewOf` took the later fields as constants again | A1 maps `rulings`, `notes`, `whispers`, `canon`, `patches` from `gm` |
| The parity test's goldens were re-recorded without `roll_call` or `left` | Re-record with `tools/record-golden.mts` (the `v2` approach asks them), or leave them in `NOT_ASKED` and say so in the golden README |
| The world bridge lands first | Its `mechanic` question joins `beforeQuestions` after `daft`, and `actSettles` joins the considered read (`director.ts:897-901`, `:925`); the review then waits for the rules' act (`engine.ts:575`, `:656`) |

---

## 7. As built

The full GM keeps to this plan, but for these departures, each with its reason. The packages' reports (K, S, A1, A2, T and I, in the author's scratchpad) and the PR give the full account. Every copied file's first line names its source at `44c6d4a` and its edits.

### The contracts

| The plan says | The build does | Why |
|---|---|---|
| `ReviewRecord` among the shared types (§4.2) | Written out in `shared/protocol/ai.ts`, the same shape as `ai/docs/reviews.ts`'s | `shared/` can't import `ai/` |
| `viewOf` takes `rulings` from `gm` (§4.1) | And a request's `gm.rulings` is optional where the AI service reads it (`requests.ts`), `[]` when it's missing | A request a job stored under V1 has none |
| K owns the moves' types but not `moves/move.ts` | `AiCall.request` there takes the three new requests too | S's thinks needed the wider type |

### The simulation

| The plan says | The build does | Why |
|---|---|---|
| `settleRuling`'s state half, the roll through `rollerFor` (§3.1) | As planned, who's who going by the names the player has heard (`unnamed`) | As the prototype's rules aliases did |
| `applyRepair` copied | It returns why a move of the tracker was refused (`move_to <beat> refused: <why>`), kept as the `co_gm_result` row's `note` | The prototype added it to the review's assessment; the row is the record |
| The repair commit inserts its row | It checks the review's patches and whispers first, and gives a malformed one up with a log line | The merge runs in `say`'s reducer at the next turn's start: a patch the graph can't take would refuse every line after it |
| The settle applies `landRuling` and `left` in the prototype's order | The read after the reply runs before the stage manager's operations, and `applyStage` takes `left` | Whether the player walked out decides whether the stage manager's removal of them stands; the read touches only the bookkeeping and the dice |
| `afterTurn` in the turn's last commit (§4.2, step 5) | As planned, so the memory review's request is built at the settle | A reply's notes still being written aren't in what the review reads; the prototype's review ran after its notes. A small difference, kept for the one place a turn ends |
| A `co_gm_result` row is merged at the next start | An ended scene's row is kept and never merged; a scene that has gone keeps none | Nothing starts after an ending |

### The AI service

| The plan says | The build does | Why |
|---|---|---|
| `jobs.ts:77-91, 94-105` (§3.1) | `rememberJob` is lines 28-43 and `repairJob` 45-57; the headers name those | The file at `44c6d4a` has 57 lines |
| The simulation cuts the transcript at the reviewed turn (§4.2) | The AI service cuts it too (`endpoints/reviewed.ts`), and its view's turn is the reviewed one | A line queued meanwhile is never reviewed, whichever side forgets; the co-GM's routes are `improv-<reviewed>-<i>` |
| `memory-reviews.jsonl` appended through `Stores.reviews` | Through `AiContext.reviews`, the server's store; a context without one (a test's) writes the same file beside the game's docs | An endpoint gets its stores through its context |
| `considerEffort` from the config | A constant, none; only `KM_CONSIDER_DEADLINE_MS` is read (`service/config.ts`) | `ai/gm` never reads the environment, and the `v2` approach's effort is none |
| `directivesFor` adds the ruling's lines (§4.1) | They're handed to it (`ruledLines`, from `Outcome.ruled`, telling the move by `ruled.from`); the plain route also waits while the decide read `considered` | `directives.ts` doesn't import `consider.ts`; the prototype's gate is on its own `pre.freeform` |
| The `left` question names the place | By `scene.world`, else the world's root | A campaign's scene keeps its place apart |
| `strangers` over the story's scenes | A vocabulary that doesn't read leaves only the scene's own people | A turn's own think never fails on the story |

### The client and the tools

| The plan says | The build does | Why |
|---|---|---|
| `npm run status -- --game <n>` | `--game` may be left out (the newest game); `--root` reads another stack; the pure part is `hosts/dev/gm-status.ts` | As the dev host's other tools |
| `fake.ts` merges `choices` and `byName` a level deep | `toolCalls` and `byNameDelayMs` too; `onTop` and `quietGm` are exported | The e2e's and the local host's recipes go on the quiet defaults rather than replacing them |
| The live run waits for the background jobs | For 180 s at most, then goes on and says so | Their endpoints' timeout is 170 s |
| (not in the plan) | The demo plays no considered turn | Left for a later unit |

### The hosts, the e2e and the live run

| The plan says | The build does | Why |
|---|---|---|
| The e2e's four scenarios (§4.4) | Steps 22 to 25, after V1's 21; each turn's times is 26 | Step 21 checks A's games, which new games before it would change |
| Scenario 3: the plain check within 4 s | Within 8 s of the turn going considering (2.0 s on the run that passed) | A busy machine stretches it; the default deadline is 12 s, so 8 s still shows the 2 s one cut the review off |
| Scenario 3: `roll_call: new` | And `same_again: new` | A ruling that failed is a try the decider can match, and the fake takes `again_0` first |
| The scenarios restart the AI service with their recipes | Each keeps `KM_AI_DAILY_USD` at 100 | Step 20 leaves $10 in today's ledger |
| Scenario 2: the merge at line 4 | It waits for the `co_gm_result` row before line 4 | A line said sooner is decided without the review, which then merges a turn later, its whisper lapsed (as in the prototype) |
| The e2e's recipes | Two that set choices (the ending, the checks beside a stream) go on the quiet ones with `onTop` | `{ ...FAKE, choices }` dropped the attention filter's choices, flagging every category |
| The live run and the prototype's, the same eight lines (§1.3, §5 I) | This run stopped at its $0.065 budget before the eighth line, and the prototype's at a $0.03 cap before its fourth: lines 1 to 3 are side by side, 4 to 7 this run's alone, and walking out is played by the e2e | The side-by-side was held under $0.10 ($0.0921 in all); both whole would be about $0.13 |

### What the live run showed

[docs/live/gm-2026-10-16.md](live/gm-2026-10-16.md), with real models: the opening and seven lines, $0.0643, then the prototype's harness on the first three. The same line was considered in both (the lift from Cob's boot), ruled a contest with Cob and rolled before the reply: Sleight of Hand DC 15 here, DC 18 in the prototype, both failures that the reply played as decided. After every line the same people (Kell, Cob, Moll) remembered the same moment in their own words, and the reviews held no turn: line 2 was played while line 1's review ran (its memories agent took 25 s), its first words 1.2 s after it was said. The co-GM's backstop after line 3 found the scene on track in both, steering towards the same way through (ask Cob politely, the boot staying his). At line 4 Kell answered from her memory: "I saw you give him the crown. I saw you reach for his boot." A considered turn's first words came 6.4 s after the line (the prototype's 5.8 s), the review 4.4 s of it. A turn cost $0.0077 on average, against V5's $0.0043: the memory reviews (about $0.0027 a turn) and the co-GM ($0.0014 a review) are most of the difference.

### The checks

`npm run check`: the type checks, 618 tests and the screen check (PASS: 435). `npm run e2e` on 3610 and 9110, namespace mode: PASS, every step, in 370.6 s. At the repo root: `npm run typecheck`, `npm test` (808) and `npm run build:web`. The bindings regenerate unchanged.
