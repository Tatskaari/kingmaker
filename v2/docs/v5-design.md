# V5: the reply as drawn

The blueprint for the vertical that draws the GM's reply as the prototype draws it: each speaker's lines in their colour, a note on the words a moment turns on (written only from what the player knows, with a knowledge card), and suggested lines over the box. It lands as one PR, `claude/v2-v5`, built by six agents: A lands the contracts alone; B, C, D and E build against them in parallel; F integrates.

Sources: [verticals.md](verticals.md) §3 V5 (the plan) and [v0-design.md](v0-design.md) (V0: every contract not named below as a delta is V0's, and its section numbers are quoted as V0 §n). The research: `gm-port.md`, `client.md`, `content-world.md`, `spacetime.md`; the design `design/content-server.md` (CS). The research and CS are in the author's scratchpad, not the repo, so they're named by section rather than linked. The prototype is read at `44c6d4a`; `file:line` means there. Two overrides apply: `gm_state` is a table of typed columns that each vertical extends, and the unit lands as one PR. Where V5 departs from the plan or CS, the text says so, and §7 lists every departure with its reason.

> **As built.** V5 was built to this blueprint and merged as one pull request, `claude/v2-v5`: A's contracts and F's integration on that branch, B to E on `claude/v2-v5-b` to `-e` (§5's branch names were never used). Where the build departs from the text below, §8 says so and why.

---

## 0. Decisions at a glance

1. **Speakers are the AI service's.** `withSpeakers` (markup.ts:507-634) and speakers.ts (whole) join V0's markup copy. Open and reply resolve who says each line as the reply streams and once it's final, so the draft is coloured as it grows. Stored markup names speakers by game key. The client's colours stay V0's (`look` rows for the cast on stage).
2. **Notes and suggestions are background jobs on V0's job loop.** The reply commit and the open commit queue `notes` when the reply has a spoken line or a GM mark, and `suggest` unless the reply ends the scene. Two new endpoints: `POST /v1/turns/notes` and `POST /v1/turns/suggest`.
3. **A turn ends when its notes are in.** The prototype ends a turn only once its notes are written (engine.ts:953, :507, :213), and the next reply's history writes them back (voices.ts:73-78). So when the notes are still being written, the settle commit hands over to a new phase, `noting`, and the notes commit ends the turn. The box still opens at the reply, as in V0, and a line typed meanwhile queues. Nothing waits for the suggestions. (The plan had nothing wait for either: §7.)
4. **The knowledge card is written with the note.** The notes endpoint runs `knowledgeCard` (knowledge.ts:303-333) for each linked mark and returns it on the mark (`Mark.card`). The client has no docs; it draws the card.
5. **Suggestions are rows.** `scene_suggestion` holds one set per scene, replaced when a new set lands. A set for a turn the player has already moved past is dropped. The client shows the latest turn's set to the controller only.
6. **Picking a suggested line puts it in the box,** to send or change, as the prototype's screen does (scene.tsx:326). The headless `act --id say_2` says it, as the QA console does (qa.ts:42). (The plan said picking says it: §7.)
7. **`/suggestions [on|off]` is a move,** `set_suggestions`, on the player's own row (`player.suggestions`, on by default, as `settings.suggestions`, play.ts:364). Turned on, it asks for this moment's lines at once (`suggestNow`, play.ts:381-385).
8. **The suggestions' vetting reads the prototype's other scenes.** suggest.ts screens lines against the story's names and places, and against "the words any scene might use" (`everyday`, suggest.ts:753-762, built from all 25 of the prototype's scenes). The AI service holds only the campaign's scenes, so the campaign gains `vocabulary.json`, generated from the prototype: each scene's hook, ways on, cast names, place names and prep text. A scene the campaign installs with its words is read from the campaign instead.
9. **A model failure answers with nothing,** as the prototype does (`annotate` catches, notes.ts:342; a failed proposal lands no lines, suggest.ts:91). The job loop retries only transport failures, and a background job gives up after 60 s without failing the turn.
10. **`gm_state` gains no columns** (§3.2).
11. **Prompt parity is still the acceptance test.** The golden session is re-recorded with marked-up replies, notes and suggestions. V0's `gm.opening` and `gm.reply` then match with speakers' names and notes in the history, and `notes`, `scene.suggest` and `scene.suggest.judge` match byte for byte.

---

## 1. How to try it

### 1.1 From a fresh checkout

```sh
git fetch origin && git switch claude/v2-v5
cd v2 && npm ci
npm run check            # offline: types, unit tests, golden prompts, the screen check
npm run dev              # SpacetimeDB, the module, the AI service, the campaign; real models
```

```sh
# a second terminal: play
npm run client -- --session wren --new "Wren Ashdown: a quick-witted investigator lent to the case by the King" --build rogue
# a third terminal: watch (the game's number is in Wren's side panel)
npm run client -- --session tamsin --join <game>
# headless, as an agent or the QA personas play
npm run play -- new --session qa --as "Pell Marrow: a disgraced herald" --build rogue
npm run play -- say --session qa "Sergeant, who found him?"
npm run play -- act --session qa --id say_2
npm run play -- suggestions --session qa off
```

- V0's prerequisites hold: Node 26.9 through proto, `spacetime` 2.12.0, pasta or 11.0.0.1 on loopback, the OpenRouter key. `npm run doctor` says what's missing.
- `npm run dev -- --fake` needs no key. It plays canned marked-up replies, with notes and suggestions, from `hosts/dev/fake.json`.
- The steps below take about ten minutes. With real models a line costs about $0.005.

### 1.2 What to see and try

| # | Do | See | The prototype's behaviour it matches |
|---|---|---|---|
| 1 | Start the game | The opening streams in, each person's lines in their colour as they're written: Kell `#6d9eeb`, Cob `#e8b15a`, Moll `#e07ab0`, your own words `#8fc7ff`, narration in parchment, a voice nobody can place in gold italics | `speechColor` (game.ts:1897-1902); coloured while streaming (`streamed`, voices.ts:103-114) |
| 2 | Wait 2-3 s after the opening ends | Up to three phrases underlined on a tint: coral for why, teal for know, lavender for you. "Tab marks" joins the keys. Until then the status line says "The GM makes a note…", with the box open | notes after the reply (notes.ts; 2.2 s p50 live, LOG.md 15 Oct); a mark is drawn only with its note |
| 3 | Tab, then Enter | Tab reverses the first mark, and the bottom line says "Why: ‹phrase› · ‹note›". Enter opens the popover by the phrase: the phrase in its kind's colour, the note, then the card. A person: the name you know them by, their public lore once you've heard their name, "You met them in this scene.", "Last said to you (turn 0): “…”". A place or custom: its title, its first sentence or two, "What anyone in Caerwyn could tell you.". Your own deed: "What you did", "In this scene, turn 2:", your words. Esc or a click outside closes it; Tab goes on to the next | `MarkPopover` (popover.tsx:18-63); `knowledgeCard` (knowledge.ts:303-333) |
| 4 | Wait about 3 s after a reply | Three to five numbered lines over the box. Lines to say and a deed in your blue, a risky try "(I try …)" in the dice's yellow, a way out dimmed, and only near an ending or after four lines | suggest.ts (`mix`, :890-896); scene.tsx:202-228 |
| 5 | Press 2 | Its line goes into the box, to send or change, and the list goes. Empty the box and it's back. Type anything and it hides | `fill` (scene.tsx:326) |
| 6 | Say a line | The old lines go at once. Their rows stay blank over the box while the next set comes, so the conversation doesn't jump | `kept` (scene.tsx:338-340) |
| 7 | While it says "The GM makes a note…", type a line and press Enter | Your line shows at once, queued. It's played when the last turn's notes and settle are both in, and that turn's reply has its marks | the prototype holds the box until the turn's notes are written (engine.ts:953) |
| 8 | `/suggestions off`, then `/suggestions on` | Off: "Suggested lines off. (/suggestions brings them back.)", the lines go, and no rows are kept. On: "Suggested lines on: a few things to say or do come up over the box after each reply.", and this moment's lines are asked for at once | `setSuggestions` (game.ts:1454-1462); `suggestNow` (play.ts:381-385) |
| 9 | Look at Tamsin's screen | The same colours, marks and popovers, row for row. No suggested lines, and no rows kept for them | |
| 10 | Headless `say`, then `act --id say_2` | The reply, then `⟨who says what: Sergeant Agnes Kell “…”; the boy in the too-big boots “…”⟩` and each note as `⟨why on “…”: … (who: Sergeant Agnes Kell)⟩`, then `ACTIONS:` with `- say_1: …`. `act` says the second line | the QA console (qa.ts:180-200; `markupLines`, markup.ts:623-633) |
| 11 | In the dev host, `f` just after a reply, then `s` | The AI service exits after storing its next answer (often the notes). After `s` the notes land, and its log says "from the store, no model call" | V0's kill test, on the new jobs |
| 12 | Read every note | Nothing from behind the GM's screen: no one's secret, no name you haven't heard (Cob is "the boy in the too-big boots" until someone says "Cob") | notes written from what the player knows (LOG.md, 15 Oct evening) |

### 1.3 Side by side with the prototype

From the repo root (the prototype at `44c6d4a`, still playable on this branch):
- **The app:** `npm run game`, then New, a concept and a build; in the lane, talk to Kell. The same scene in the prototype's screen, for the colours, the marks, the popover's cards and the suggested lines.
- **The scene harness:** `npm run scene -- start hanged-clerk --session p5 --as "Wren Ashdown: …"`, then `npm run scene -- say p5 "Sergeant, who found him?"`. It prints who says what and the notes in the same `⟨…⟩` lines as `npm run play`.
- **The QA console:** `npm run qa -- new --session p5q --as "…" --build 1`, `observe`, `act` on the action that talks to Kell, then `say` and `act --id say_2`. Suggested lines are its `say_N` actions.

---

## 2. Scope

### 2.1 What V5 adds

- Speakers resolved by the AI service, streamed and final, by game key. The GM's history written back with the speakers' names and the player's notes, as the prototype writes it.
- The notes on a reply's marks: written from what the player knows, placed, linked, with a card, landing on the transcript row. The turn ends when they're in.
- Suggested lines after the opening and after every reply, screened, judged and mixed, as rows. `/suggestions`; the headless `act` and `ACTIONS:`.
- The client: the popover's card, rows kept for lines on their way, the help and the command, the `noting` phase, the headless verbs.
- Campaign data: `vocabulary.json`.

### 2.2 What it leaves, and for which unit

| Left | For |
|---|---|
| A talk's choices, `talk.suggest`, choices said at once | V11 |
| Non-cast people's colours from the look layer (a constable, a porter the GM made up). Gold until the client has the look layer | V2; whichever of V2 and V5 lands second wires `speechColor` to it |
| Notes and suggestions that know earlier scenes: `history`, `lead`, the notebook, earlier deeds, names heard before | V3 |
| Spells in the suggestions' "who they are" (`state.rules.spells`, suggest.ts:232) | V7 |
| Suggestions for two players. The rows are already per player | V15 |
| The Esc menu's toggle: there's no game menu yet | the vertical that brings one |
| The client's guesser for replies with no markup (`markupOf`, game.ts:1872-1891) | not ported: every v2 reply has markup, and the AI service keeps the guesser for the GM's history (`asWritten`) |

### 2.3 What it ports

| Prototype | Lines | To | What changes |
|---|---|---|---|
| src/runtime/speakers.ts | 1-336 | ai/gm/speakers.ts | whole, unchanged; replaces V0's small speakers.ts |
| src/runtime/markup.ts | 507-634 | ai/gm/markup.ts | `speechIn`, `withSpeakers` and their helpers, `markupLines`. `SPEECH`, which V0 inlined, is imported from speakers.ts again |
| src/runtime/voices.ts | 62-125 | ai/gm/voice.ts | `entryOf`, `asWritten`, `streamed`, `readReply` as written (V0 cut `withSpeakers` and `speakersOf`); `Spoken.drafted`; `onText` goes to the stream sink |
| src/runtime/knowledge.ts | 1-339 (V0 has 29-81, 104-109) | ai/gm/knowledge.ts | `SessionState` → `TurnView`; `sceneById`/`safeScene` → the story (§3.8); `talkOf` → undefined until V11; "Caerwyn" from the campaign, as V0's `knowledgeBrief`; `loreIndex` cached per lore root |
| src/runtime/notes.ts | 1-345 | ai/gm/notes.ts | `SessionState` → `TurnView`; `respondJson` gets the request's `CallContext`; `annotate`'s rules move to the endpoint and the simulation (§3.5, §3.6) |
| src/runtime/suggest.ts | 1-903 | ai/gm/suggest.ts | `SessionState` → `TurnView`. The in-flight machinery (:53-93) is dropped, and its rules are kept by the jobs and the rows (§3.5). `sceneById`, `SCENES` and `ZOO_SCENES` → the story (§3.8); `prepText` returns a vocabulary entry's `prep`. `deciderFor(…)` and `respond` are injected. Caches keyed by campaign version |
| src/app/ui/popover.tsx | 25, 34, 43-44 | client/ui/popover.tsx | the card's rows, from `mark.card` |
| src/app/ui/scene.tsx | 319-340 | client/ui/scene.tsx | rows kept while lines are on their way |
| src/app/ui/overlay.tsx | 45 | client/ui/overlay.tsx | the suggestions' paragraph of `HELP.scene`, without the talk's sentence and the Esc menu |
| src/app/game.ts | 146, 1432-1462, 1490-1505 | client/scene/model.ts, commands.ts | `/suggestions` and its words; the setting is a move |
| src/game/play.ts, src/cli/qa.ts | 349-385; 42-46, 180-227 | client/headless.ts, hosts/play.ts | `say_N` actions, `act`, `suggestions`, waiting for the lines |
| Tests: markup.test.ts 251-361, notes.test.ts, suggest.test.ts, knowledge.test.ts, src/app/suggest.test.ts, screens-check.tsx 606-720 and 1359-1460 | | §4 | |

About 2,100 lines copied and 900 new, near the plan's 2.2k and 0.8k.

---

## 3. The deltas to V0's contracts

### 3.1 Tables and columns (A)

New columns carry `.default(…)`, so a V0 database keeps its games across the publish (spacetime.md §4.10).

| Table | Delta |
|---|---|
| `scene_suggestion` (new, public) | `id` pk auto · `gameId` · `sceneId` ix · `playerId` (the controller they're for) · `turn` u32 (the turn whose reply they follow; 0 for the opening) · `ord` u32 · `kind` (say, do, try, leave) · `text` |
| `turn` | `phase` gains `noting`: everything in but the notes · `notes` string, default `"none"` (none, writing, written, lost) · `suggest` string, default `"none"` (none, coming, landed, dropped, lost) · `suggestAsks` u32, default 0 |
| `player` | `suggestions` bool, default true |
| `job` | `move` gains `notes` and `suggest`; `step` gains `notes` and `suggest` (values only) |
| `transcript.markup` | its marks gain `card` (§3.6); no schema change |

### 3.2 `gm_state`

No new columns. Nothing the GM's bookkeeping reads changes. The marks live on the transcript rows, the suggestions in their own table, and the setting on the player. The prototype's `suggestions` and `settings` fields (session.ts:329) aren't the GM's state, and its `notes` and `notesTurn` are the co-GM's (V6).

### 3.3 Reducers

| Export (wire) | Args | Who | Refusals | Writes |
|---|---|---|---|---|
| `setSuggestions` (set_suggestions) | `on` bool | a seated player, controller or spectator: it's their own setting | `not_in_game`: "(You're not in a game: start one with --new, or watch one with --join.)" | `player.suggestions`. When on, and the caller controls a live or closing scene whose latest turn has its reply in (settling, noting or done), with `suggest` not `coming` and no rows for that turn: a `suggest` job for that turn (`suggestAsks + 1`), and `suggest = "coming"` |

`say`'s check treats `noting` as it treats `settling`: a line queues. No new refusal codes; no other reducer changes.

### 3.4 Background jobs on V0's loop

```ts
// simulation/src/moves/move.ts (A): V0's Move, plus what a job nobody waits for needs
export interface Move<Args, Plan> {
  /* V0's: name, check?, resolve, think?, commit? */
  /** run_job's revision check on an answer. Default (V0's): the scene's lease is this turn and the scene hasn't ended. */
  applies?(tx: TxCtx, plan: Plan): boolean;
  /** A job that can't finish: a fatal status, a commit that threw, or failing for giveUpMs. Default (V0's): failJob. */
  giveUp?(tx: TxCtx, plan: Plan, why: string): void;
  /** How long a failing job keeps trying. Default (V0's): 10 minutes. */
  giveUpMs?: number;
  /** A background job: its retries leave turn.note alone, and it never fails the turn. */
  background?: boolean;
}
```

| Move (B) | Plan | Key's step | Endpoint | Timeout | Gives up after | `applies` | `giveUp` |
|---|---|---|---|---|---|---|---|
| `notes` | `{ game, scene, turn, n, seq }` | `notes` | `/v1/turns/notes` | 30 s | 60 s | always | `turn.notes = "lost"`; `finishTurn` if the turn is `noting` |
| `suggest` | `{ game, scene, turn, n, ask }` | `suggest`, then `suggest-2`, `suggest-3`… for asks of the same turn | `/v1/turns/suggest` | 30 s | 60 s | always: the commit decides | `turn.suggest = "lost"`; when the turn is still the scene's latest and the scene hasn't ended, the scene's rows are deleted (the prototype lands no lines then, suggest.ts:91) |

Both are `background`, are queued by commits (their `resolve` is unused), and build their request in the queueing transaction, as V0's thinks do. The loop's changes (B, `jobs.ts`):
1. **One job row per turn and move.** `queueThink` finds the row by `turnId` and `move` (V0 has one move in flight per turn).
2. **The revision check** is `move.applies`, or V0's.
3. **A retry** sets `turn.note` only for a move that isn't background. (As built, also for the notes once the turn is `noting`: a turn noting through an outage says so, waits up to 60 s, then loses its notes and ends. §8 says why.)
4. **Fatal, a commit that threw, or failing past `move.giveUpMs ?? 600_000`:** `move.giveUp`, or `failJob`. The row is deleted after a give-up.
5. **Usage:** every answer's usage goes to its turn's `calls` and `costMicros`, the notes' and suggestions' too.
6. **`retry_turn`** picks the turn's failed job that isn't background.

A turn runs up to three thinks at once (settle, notes, suggest). V0's pool of 16 holds five games' worth.

### 3.5 The commits (B)

**The reply commit** (V0's `afterReply`), in this order:
1. The GM's entry, as V0. Its markup is `{ speech: reply.markup.speech, marks: [] }`; the speech now carries speakers.
2. **Notes**, when the reply has a spoken line or a GM mark (`speech.length || drafted.length`, notes.ts:333): queue `notes` with the entry's `seq`; `turn.notes = "writing"`. Otherwise `notes` stays `none`.
3. **Suggest**, unless this reply ends the scene (`gm.ended` set by the decide commit, or a wind-down that isn't out of character: engine.ts:869, :498-504), and only when the controller's `player.suggestions` is on: queue `suggest` with ask 1; `turn.suggest = "coming"`, `suggestAsks = 1`. An out-of-character wind-down gets them (:504).
4. Steps 2 and 3 come before V0's `joinWorld` and `syncStage`, so the requests see the world as the prototype's calls did (`pushReply` :844 and `startSuggesting` :869, before `joinWorld` :880).
5. Then V0's rest. Where V0 ends the turn (a wind-down), call `finishTurn`.

**The open commit:** the opening's entry (V0), then steps 2 to 4 for turn 0 (engine.ts:211-212), then `finishTurn` in place of "turn 0 done; lease released". The scene goes `live` as in V0, whatever the notes.

**The settle commit:** V0's, with `finishTurn` in place of "the turn done, the lease released; then a queued turn starts".

**`finishTurn(tx, scene, turn)`** (new, `simulation/src/turns.ts`): when `turn.notes === "writing"`, the phase becomes `noting` and the lease is kept. Otherwise it's V0's end of a turn, moved here: `done`, `endedAt`, the lease released, a queued turn started (or cancelled when the scene has ended).

**The notes commit:** the transcript row by `(sceneId, seq)`. When the answer has marks, the row's markup gets them as its `marks` (as `annotate`, notes.ts:337-339; an empty answer leaves the row alone). Then `turn.notes = "written"`, and `finishTurn` if the turn is `noting`. A failed turn stays failed: its `retry_turn` re-runs its own step, and `finishTurn` then finds the notes written.

**The suggest commit:** it drops the set (`turn.suggest = "dropped"`, the rows untouched) when the scene's latest turn isn't `n` any more, the scene has ended, or the controller has turned them off: the prototype's `land` (suggest.ts:85-90) and `stopSuggesting` (:69). Otherwise it deletes the scene's `scene_suggestion` rows, inserts the answer's lines in order (`playerId` the controller) and sets `turn.suggest = "landed"`. With no lines, the rows are deleted and none written, as the prototype's empty set, so the next request offers nothing under "Not again" (:369).

Where the prototype's in-flight machinery went:

| suggest.ts | v2 |
|---|---|
| one set in flight per session; a later reply's replaces it (:53, :80) | a suggest job per turn; an earlier turn's set is dropped at its commit |
| `land` only for the same scene and turn, not ended (:85-90) | the suggest commit's drop |
| `currentSuggestions`: this scene and turn, not ended or a talk (:57-60) | the client's rule (§3.9) |
| `lastOffered`: the scene's last set (:408-411) | `offered` in the request, from the scene's rows |
| `stopSuggesting` when the scene ends or they're turned off (:69) | the drop |
| `suggesting`: lines on their way (:63) | `turn.suggest === "coming"` |

### 3.6 The AI service (C)

Types (A writes them):

```ts
// shared/markup.ts
export interface Card { title: string; lines: string[] }                       // knowledge.ts:274
export interface Mark { start: number; end: number; kind: MarkKind; note: string; link?: MarkLink; card?: Card }

// shared/protocol/ai.ts
export type Endpoint = /* V0's four */ | "/v1/turns/notes" | "/v1/turns/suggest";
export interface Drafted { start: number; end: number; kind: MarkKind }         // a GM's mark: where and what kind, never its note (notes.ts:23)
export interface Suggestion { kind: "say" | "do" | "try" | "leave"; text: string }   // session.ts:192
export interface Reply { speaker: "gm"; kind: "narration"; text: string; markup?: Markup; drafted?: Drafted[] }   // + drafted; speech by game key
export type SceneContext = Omit<TurnContext, "line">;                          // the scene's working set: an opening has no line
export interface NotesRequest extends AiRequest {
  turn: SceneContext;                                                          // the transcript up to and including the reply
  reply: { seq: number; text: string; speech: Speech[]; drafted: Drafted[] };  // seq: the reply's transcript.seq
}
export interface NotesResponse { marks: Mark[]; usage: Usage }                 // placed, linked, carded, by game key; [] when none
export interface SuggestRequest extends AiRequest {
  turn: SceneContext;                                                          // the transcript up to and including the reply
  offered: string[];                                                           // the scene's last set, in order
}
export interface SuggestResponse { lines: Suggestion[]; dropped: Array<{ text: string; why: string }>; usage: Usage }
```

Keys (`shared/protocol/keys.ts`): `${uid}:s${scene}:t${n}:notes`; `${uid}:s${scene}:t${n}:suggest`, then `:suggest-${k}` for the k-th ask of the same turn.

| Endpoint | Steps | Model calls (byte for byte with the prototype's) |
|---|---|---|
| `POST /v1/turns/notes` | `scene` as the reply had it (`effectiveScene`); `view = viewOf(req.turn, scene)`; the reply's entry by `seq`, and `before`, the entries before it. Nothing to note (`!speech.length && !drafted.length`): `{ marks: [] }`. Else `writeNotes(scene, view, { text, speech, drafted }, before)` (notes.ts:311-323); a throw gives `{ marks: [] }` (notes.ts:342-344). Each linked mark gets `card = knowledgeCard(view, link)`. Person ids go back to game keys | `notes`: LUNA, effort none, 900 tokens, JSON schema `notes` (notes.ts:41-59); instructions `prompt("notes")`; input `notesInput(…)` (notes.ts:282-291) |
| `POST /v1/turns/suggest` | `scene` as above; `view = viewOf(req.turn, scene)` with `suggestions = { scene: key, turn: n, lines: offered }`; `propose(view, { ask, decider, story })` (suggest.ts:105-124). A throw gives `{ lines: [], dropped: [] }` (:91); a judge that throws leaves the lines unjudged (:118) | `scene.suggest`: LUNA, effort none, 150 tokens, `asFarAsItGot`; instructions `prompt("suggest")`; one user message, `suggestionBrief(scene, view)` (:347-371). `scene.suggest.judge`: `new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions", calls).decide(facts, questions, "scene.suggest.judge")` (:161-223) |
| `POST /v1/scenes/open`, `/v1/turns/reply` (changed) | `readReply` with `withSpeakers` (voices.ts:121-125): each entry's `markup.speech` with speakers by game key, `marks: []`, and its `drafted`. The stream sink posts `withSpeakers`' speech as the reply streams (voices.ts:103-114) | unchanged calls; their history writes speakers' names and notes back (voices.ts:73-78) |

- **Timeouts:** notes 30 s, suggest 30 s. Answers by key, coalescing and `exit-after-store:<step>` (`notes`, `suggest`) are V0's.
- **Canned** (`KM_AI_GM=canned`, C's first deliverable): notes gives one `why` on the reply's first spoken line, linked to its speaker, with a card; suggest gives four lines (say, say, do, try).
- **The fake** (`v2/ai/llm/fake-openrouter.ts`, shared code, A): `fakeFetch` gains `byNameDelayMs?: Record<string, number>` (a JSON call's delay, by its schema's name: `notes`) and `suggestDelayMs?: number`. Both are optional, and the prototype's calls don't change.

### 3.7 The view and keys (C)

- `viewOf` accepts a `SceneContext`.
- Transcript entries' `marked` is their markup, with `speech[].speaker` and person links' `id` mapped from game keys to local keys (`localKey`, shared/world/rows.ts). `card` is dropped: the copied code never reads it. `"you"` stays.
- `suggestions` is `{ scene, turn, lines }` built from `offered`; only the texts are read (`lastOffered`, suggest.ts:408).
- Answers map back with `fullKey`: speech speakers (the stream's too) and person links.
- Empty in V5, as V0's view already has them: `history`, `talks`, `lead`, `rules.spells`, `talk`, `ended`, `fought`, `patches`.

### 3.8 The story the lines are vetted against (C; the data is A's)

What suggest.ts and knowledge.ts read of scenes other than the one being played:

| Read | Where | Of each scene |
|---|---|---|
| the story: played scenes, this one, those its ways on reach (`storyScenes`) | suggest.ts:707-719 | `exits[].next`, `companion` |
| the story's people (`storyCast`): unheard names, who's away, names partly heard | :722-726, :578-590, :168, :384 | cast `id`, `name`, `called`, `aka` |
| names and places only the prep has (`namesInPrep`) | :657-663 | the prep's text |
| other scenes' places and things (`places`) | :595 | the world's area and thing names |
| words any scene might use (`everyday`) | :743-762 | every other scene's prep text |
| played scenes' hooks (`heardText`) | :681 | `hook` (V3 on) |

`campaigns/caerwyn/vocabulary.json`, generated by A's `tools/v2/export-vocabulary.mts` from the prototype and committed as data:

```json
{ "source": "44c6d4a", "scenes": [
  { "id": "drowned-rat", "hook": "…", "next": ["wharf-night"], "cast": [{ "id": "nan-quill", "name": "Nan Quill", "called": "the landlady" }],
    "worldNames": ["…"], "prep": "…" } ] }
```

- One entry for each of the prototype's 25 scenes, `SCENES` then `ZOO_SCENES`, in their order. `next` is deduplicated in exit order. `cast` keeps card order, with `aka` when set. `worldNames` lists the areas' names, then the things', and is absent when the scene has no world. `companion` appears when set. `prep` is `prepText(scene)` (suggest.ts:729-741, copied into the tool). About 425 KB.
- `ai/gm/story.ts`: `story.scene(id)` gives the installed scene when the campaign has it with its words, else a stub made from the entry (cast, exits with `next`, world names, hook, `prep`). `story.all()` gives every id of either.
- In the copy, `safeScene` reads `story.scene`, `[...SCENES, ...ZOO_SCENES]` reads `story.all()`, and `prepText(s)` returns `s.prep` when it's set. Nothing else changes. So the vetting is the prototype's: the hanged clerk's story is itself, caerwyn-afternoon, the Rat, wharf-night, the Heron and the King's morning, and its `everyday` words are the other 19 scenes' prep and the GM's prompts.
- The PUT carries the file with the rest of the folder. The simulation's install ignores it.

### 3.9 The client (D)

**Rows → view** (`client/scene/rows.ts`, `view.ts`):
- `SceneRows` gains `suggestions: SuggestionRow[]` (`{ sceneId, turn, ord, kind, text }`); `PlayerRow` gains `suggestions`; `TurnRow` gains `suggest`.
- `Phase` gains `noting`. `mayType` treats it as `settling`.
- The latest turn is the one whose `n` is `scene.turns`.
- `view.suggestions`: when the viewer controls the scene, has suggestions on, and the scene is live or closing, the rows whose `turn` is `scene.turns`, by `ord`; else none.
- `view.suggestionsComing`: under the same conditions, the latest turn is queued, deciding or replying, or its `suggest` is `coming`.
- `view.suggestionsOn`: the viewer's setting.
- Marks keep their `card` (markup JSON as V0 parses it).

**The model and the screen:**
- `busy()` treats `noting` as `settling`: "The GM makes a note…".
- `/suggestions [on|off]` (no word toggles) calls `actions.setSuggestions(on)` and sets the status words of §1.2, step 8. `COMMANDS` gains `suggestions` ("[on|off]: the suggested lines over the box"). It works any time, as the prototype's `peek` (game.ts:1490-1505).
- `kept` (rows over the box) follows the prototype: the picks' count while a command is typed or the box has a draft; otherwise five rows (four under 26 rows high) when there are lines or `suggestionsComing`, else none. V0's `fitSuggestions`, `Picks`, `KIND_COLOR` and the number keys stay as they are.
- The popover draws the card under the note: its title bold in `C.title`, its lines in `C.dim`. When there isn't room, the card goes first, then the note's end (popover.tsx:41-45).
- The help gains the prototype's suggestions paragraph, without "A talk's are said at once." and "(or the Esc menu)".
- `speechColor` is V0's: the player's blue, a cast member's `look` colour, else gold.

**The connection** subscribes `SELECT * FROM scene_suggestion WHERE scene_id = {s}` with the scene's other queries, and gains the `setSuggestions` move.

**Headless** (`client/headless.ts`, `hosts/play.ts`):
- `viewText` prints `ACTIONS:` and `- say_N: <line>` before the `PHASE:` line when the view has lines.
- `say` waits for the reply, then, at most 15 s more, for the notes (`notes` not `writing`) and the lines (`suggest` not `coming`), then prints. `--wait settled` waits for `done` as in V0.
- `act --session <s> --id say_N` says the N-th line. A missing one exits 1: "(There's no say_4 here: the choices are say_1 to say_3.)".
- `suggestions --session <s> [on|off]` prints "Suggested lines: on." or "off.". Turned on, it waits for the lines and prints `ACTIONS:`, as qa.ts:216-227.
- `--demo` (V0's canned turns) gains a card on a mark and four lines, so the screen and the headless verbs can be seen with no server.

### 3.10 Campaign data and the dev host (E)

- `vocabulary.json` (§3.8): checked by `npm run campaign -- check`, installed by the PUT with the rest of the folder.
- `hosts/dev/fake.json`: what `npm run dev -- --fake` plays when `KM_AI_FAKE` isn't set. Four marked-up replies (taken from `tools/v2/golden-replies.json`), written notes for the `notes` schema, and one set of six suggested lines.
- No change to `campaign.json`, `builds.json` or `looks.json`. The cast's colours have been in `looks.json` since V0.

---

## 4. Tests

### 4.1 Unit tests (`npm test`, offline)

| Where | What |
|---|---|
| `simulation/` (B, memory host) | the reply commit queues notes only with a line or a mark, and suggest only when the scene goes on and the setting is on (an out-of-character wind-down gets them; a closing reply doesn't); notes then settle, and settle then notes, both end the turn once, with a queued line started by whichever lands last; a notes give-up after 60 s ends the turn with no marks; the notes land on the right row as an update; a suggest answer writes the set, replacing the last; an overtaken, off or ended one is dropped; no lines clears the set; `set_suggestions` on asks at once with `suggest-2` keys, and never twice while one is coming; `not_in_game`; background retries leave `turn.note` alone; a background failure never fails a turn; `retry_turn` ignores background jobs; each answer's usage reaches the turn |
| `ai/` (C) | copied whole and run unchanged except for fixtures: markup.test.ts 251-361, notes.test.ts, suggest.test.ts, knowledge.test.ts. Scenes the campaign doesn't install come from `ai/gm/testdata/scenes/*.json` (drowned-rat, heron-warehouse, kings-morning, zoo-ferry, zoo-pie-stall, exported by C's recorder); the lore is the campaign's. Endpoints on `fakeFetch`: notes placed, linked, carded and keyed; nothing to note makes no call; a model failure answers `{ marks: [] }`; suggestions screened, judged and mixed; a judge failure leaves them unjudged; a reply cut short loses its last line. The view's key mapping both ways. The story: an installed scene wins over its entry; the hanged clerk's story and `everyday` as above. The stream posts speakers as it streams. Canned notes and lines |
| `client/` (D) | rows → view: lines only for the controller, the latest turn and the setting on; `suggestionsComing`; `noting`; cards on marks. Text: `ACTIONS:`, `⟨…⟩` lines with links. Headless: `act`, `suggestions`, the waits |
| `hosts/` (E) | the campaign check on `vocabulary.json`: valid; 25 entries; unique ids; every `next` names an entry or an installed scene; each installed scene with words has an entry whose `prep`, `hook` and cast equal those computed from it (today the hanged clerk, so the conversion is checked too) |

### 4.2 Prompt parity (C): recording and comparing

**Recording.** `tools/v2/record-golden.mts` lives in the prototype's `tools/`, outside v2, as the plan's rule asks; if V0 left its recorder in a scratchpad, C moves it there first. It runs this branch's `src/` (44c6d4a plus the `v2/ai` move) under `fakeOpenRouter`:
1. **Options:** `replies` are the four marked-up replies of `tools/v2/golden-replies.json` (A's): speaker tags, a why, a know on "the Royal Purveyor's office", a you. `byName.notes` holds written notes that land on M1, on an L line and on free words, a `know` naming a D id, and a `you` with a turn. `suggestions` holds one list of six lines: one naming Hobb (a name from the Rat, so the vocabulary is exercised), a `leave` (too early), one in square brackets (markup), and three fit. `choices` set `line_2` to `gives_away` for the judge.
2. **Play V0's moments** with `{ suggest: true }`: `createSession`, `openScene`, then three `playerTurn`s (a plain question to Kell; `catch-moll`; an out-of-character question).
3. **Freeze the state.** At each `notes` and `scene.suggest` call, deep-copy the session (V0's recorder copies it at every call). Then call the prototype's exported `writeNotes`, `propose`, `vetting` and `knowledgeCard` on each copy, under a fresh capturing fake with the same options. The judge is then asked on the state the lines were asked on; in the game it runs after an await, while the turn moves on.
4. **Write** `v2/ai/gm/golden/hanged-clerk/<moment>.notes.json` (the body sent, the session, the reply's text, speech and drafted marks, the placed marks and their cards) and `<moment>.suggest.json` (both bodies, the session, the vetting, the lines and the dropped). V0's files are re-written from the same run.

**Comparing** (`ai/gm/parity.test.ts`). Each session is turned into the V5 request, as V0's test does, and V5's handler is run under `fakeFetch` with the same options.
- **Byte for byte:** `notes` (instructions, input, `text.format`); `scene.suggest` (instructions, input, `max_output_tokens`); `scene.suggest.judge` (state and questions); V0's `gm.opening` and `gm.reply`, now with the speakers' names and the notes in the history.
- **Equal:** the placed marks (offsets, kinds, notes, links) and their cards; every field of the vetting (as sets where the code only tests membership, in order where a prompt prints them); the lines and the dropped, with their reasons; `withSpeakers`' speakers for every recorded reply and every streamed prefix of it.
- **Listed:** any difference left goes in `golden/README.md` with its reason, pinned by the test. V0's listed differences for speakers and notes are removed.

### 4.3 The local host (F)

`hosts/local.test.ts` gains: a turn's notes land, and the turn waits for them; a line said while `noting` starts after the notes commit, and its `gm.reply` history has the last reply's notes; an overtaken set is dropped; a notes model failure ends the turn with no marks; the same seed and lines give the same marks and lines twice.

### 4.4 End to end (`npm run e2e`, F)

V0's scenarios stay, with the speakers and the notes in their event logs. Then:
1. **Speakers:** A's opening draft updates carry speech with `kell`, `cob`, `moll`; the transcript row has them; B's events are identical.
2. **Notes:** the opening's row is updated with marks, each with a note and, when linked, a card; A and B both see the update; turn 0 goes `noting`, then `done`.
3. **The wait:** with `byNameDelayMs: { notes: 3000 }`, A says a line the moment turn 1 is `noting`. It's queued, and it starts only after turn 1's notes commit; its `gm.reply` input (the call log) has turn 1's `)[why: `.
4. **Suggestions:** A has `scene_suggestion` rows for the latest turn after each reply. B's view shows none. `act say_2` says exactly the second row's text.
5. **Overtaken:** with `suggestDelayMs: 5000`, A says a line straight after a reply. The late set is dropped (no rows for that turn, the old rows kept), with one `scene.suggest` call for the key.
6. **Kept answer:** with `KM_AI_FAULTS=exit-after-store:notes`, the service exits after storing the notes; started again without the fault, the notes land, with one `notes` call for the key.
7. **The setting:** after `setSuggestions(false)` the next reply makes no `scene.suggest` call; `setSuggestions(true)` asks at once, with key `…:suggest-2` when the turn had been asked before.

### 4.5 The screen check (D)

The prototype's checks, adapted to rows, at 80x24 and up (screens-check.tsx 606-720 and 1359-1460):
- **Suggestions:** rows kept while lines are coming, and the conversation doesn't move when they come; numbered, a line each that fits (a second say gives way at 24 rows); the keys say a number puts one in the box; 2 puts its line in the box with the GM still making a note; the box emptied brings them back; a click fills the box; Enter sends; typing hides them; `/suggestions off` shows its words and keeps no rows; a spectator gets none.
- **Marks:** Kell's, Cob's and Moll's lines in their colours as the draft grows; the popover has the card's title and lines with room, and drops the card first without it.

### 4.6 The live run (E writes it; F runs and records it)

`npm run dev`, then `npm run live -- --script v5`. It plays 12 lines of the hanged clerk with real models and writes `v2/docs/live/v5-<date>.md`.

| # | Line |
|---|---|
| 1 | Sergeant Kell? I'm told you've been waiting for me. |
| 2 | \*I look up at the body, then at the two on the wall\* Who found him? |
| 3 | You two. Did either of you see anything last night? |
| 4 | `act say_1` |
| 5 | Kell, what has the Royal Purveyor's office to do with grain? |
| 6 | (I crouch and look at his boots) |
| 7 | Cob, nobody's in trouble for talking to me. I'm not the watch. |
| 8 | `act` the `try` line, else `say_2` |
| 9 | What did Prout do up in the tally loft? |
| 10 | (I hold up a shilling for the boy) |
| 11 | Moll, why are you keeping him away from me? |
| 12 | Kell, I think he was killed. Let's look at the loft. |

- **After each turn** the run waits, at most 15 s, for the notes and the lines.
- **Each turn's record:** said, first text, final, notes landed and lines landed (both in ms after the reply's final text), calls and cost by operation; who says what (by name, with the GM's tag); every note (kind, phrase, note, link, card); every set of lines (kind, text) and what was dropped and why.
- **Totals, against the prototype's:** notes p50 and p90 after the reply (2.2 s and 3.9 s, LOG.md 15 Oct); lines p50 after the reply (about 2.8 s, the plan); lines tagged and lines with a speaker (83% and 51 of 52); notes a reply; a turn's cost by operation (notes about $0.00024).
- **Leaks:** the report ends with the scene's held facts (the cast's secrets, the essentials not yet landed) for a reader to check each note and line against. The plan's model-judged check of 20 replies is left out to stay under budget (§7).
- **Budget:** 13 replies at about $0.004, plus $0.00024 of notes and about $0.0008 of lines and judge each: about $0.07. The script stops if the turns' cost passes $0.10.

---

## 5. Work packages

Branches: A `claude/v2-v5-contracts` from the stack's tip; B `-simulation`, C `-ai`, D `-client`, E `-campaign`, each from A; F `-integration` from A, merging B, C, D and E in that order. F raises the one PR, `claude/v2-v5`. After A merges into the branches, only F edits A's files. A package that needs something in `shared/` writes a local helper and says so, and F folds it in.

### A: contracts (one agent, under an hour)
- **Owns:** `shared/markup.ts` (`Card`, `Mark.card`); `shared/protocol/ai.ts` (§3.6's types); `shared/protocol/keys.ts` (notes and suggest keys); `simulation/src/schema.ts` (§3.1); `simulation/src/index.ts` (register `setSuggestions`, append-only); `simulation/src/moves/move.ts` (§3.4's hooks); `simulation/src/stubs.ts` (`setSuggestions` refusing `not_built`); `client/module_bindings/` (regenerated); `v2/ai/llm/fake-openrouter.ts` (the two delays); `tools/v2/export-vocabulary.mts` and its output, `campaigns/caerwyn/vocabulary.json`; `tools/v2/golden-replies.json` (four marked-up replies from a live session's `calls.jsonl`, which C's recorder and E's fake both play).
- **Builds against:** this doc; V0's contracts as landed.
- **Done when:** `npm run check` passes; `npm run simulation:build` succeeds; the bindings are current; a scratch publish answers `set_suggestions` with `not_built`; `vocabulary.json` has 25 entries and its hanged-clerk entry's `prep` equals the tool's `prepText` of the prototype's scene; at the repo root, `npm run typecheck` and `npm test` pass (the fake is shared code).
- **Must not touch:** the prototype's `src/`; any body V0's packages own.

### B: the simulation
- **Owns:** `simulation/src/moves/notes.ts`, `suggest.ts`, `set-suggestions.ts`; `moves/registry.ts` (append); the commit changes in `moves/say.ts` and `moves/open-scene.ts`; `gm/requests.ts` (`sceneContext`, the two requests); `jobs.ts` (§3.4); `turns.ts` (new: `finishTurn`); their tests. Deletes the `setSuggestions` stub.
- **Builds against:** the schema, `move.ts`, `shared/protocol`, §3.3 to §3.5.
- **Done when:** §4.1's simulation tests pass. The module publishes to a scratch stack and plays against a stand-in AI server (V0's, plus canned notes and suggest answers): notes land on the row, the turn goes `noting`, then `done`; lines arrive as rows; a stand-in killed mid-notes shows the turn waiting, then finishing after a restart.
- **Must not touch:** `shared/`, `ai/`, `client/`, `hosts/`, the schema's public tables.

### C: the AI service
- **Owns:** `ai/gm/speakers.ts`, `markup.ts`, `voice.ts`, `knowledge.ts`, `notes.ts`, `suggest.ts`, `story.ts`, `view.ts`; `ai/gm/golden/**`, `ai/gm/testdata/**`, `ai/gm/*.test.ts`; `ai/service/endpoints/notes.ts` and `suggest.ts`; the changes to `open.ts`, `reply.ts`, `canned.ts`, `service/server.ts` (routes, append-only), `service/stream.ts` (speakers), `service/campaigns.ts` (loading the vocabulary); `ai/README.md`'s sections on these; `tools/v2/record-golden.mts`.
- **Order:** the canned notes and suggest first, so B, D and E can bring the stack up; then speakers and the stream; then notes; then suggest; then parity.
- **Builds against:** `shared/protocol`, `shared/markup.ts`, `vocabulary.json`, §3.6 to §3.8, gm-port's copy rules.
- **Done when:** §4.1's AI tests and §4.2's parity pass; `npm run ai` with `KM_AI_GM=canned` answers both new endpoints; at the repo root, `npm run typecheck`, `npm test` and `npm run build:web` pass.
- **Must not touch:** `shared/`, `simulation/`, `client/`, `hosts/`, `v2/ai/llm` (A changes the fake), the prototype's `src/`.

### D: the client
- **Owns:** `client/scene/{view,rows,model,text}.ts`; `client/ui/{scene,popover,overlay}.tsx`; `client/commands.ts`; `client/net/connection.ts`; `client/headless.ts`; `client/demo.ts`; `client/check/{screens.tsx,fixture.ts}`; `hosts/play.ts`; their tests.
- **Builds against:** the bindings, `shared/markup.ts`, `shared/protocol/ai.ts` (`Suggestion`), §3.9.
- **Done when:** the rows and text tests and §4.5's checks pass. `npm run client -- --demo` shows the card and the lines. Once B has published, `play new`, `say`, `act` and `suggestions` run against a scratch stack.
- **Must not touch:** anything outside its files.

### E: the campaign check, the dev host's fake, the live run
- **Owns:** `hosts/campaign.ts` (the vocabulary's checks); `hosts/dev/fake.json`, and the line in `hosts/dev/stack.ts` that uses it; `hosts/live-run.ts` (`--script v5` and its report).
- **Builds against:** §3.8, §3.10, §4.6; the bindings for the live run's reads.
- **Done when:** the campaign check passes, and fails on a tampered `prep`; `npm run dev -- --fake` shows marked replies, notes and lines in the client; `npm run live -- --script v5 --lines 2` runs against the fake stack and writes a report.
- **Must not touch:** `shared/`, `simulation/`, `ai/`, `client/`.

### F: integration
- **Owns:** `hosts/e2e.ts` (§4.4), `hosts/local.test.ts` (§4.3), `docs/live/v5-*.md`, `v2/README.md` ("What you can play": each speaker's colour, notes with cards, suggested lines, `/suggestions`), `.github/workflows/v2.yml` if a job needs to change. After merging B to E, any file, to make them meet; the bindings' regeneration.
- **Done when:** `npm run check`, `npm run e2e` (namespace mode here, host mode in CI) and `npm run arc`, with V5's flows, pass; the live run is recorded under $0.10; the PR's description is §1, with the live run's numbers.

---

## 6. Risks, and what V5 assumes of V0

**Risks**

| Risk | What's done about it |
|---|---|
| The turn waits for its notes, so a slow notes call holds a queued line | The notes come before the settle in the prototype's runs (2.2 s against the stage manager's 1.3-4.5 s); the timeout is 30 s, and the give-up 60 s. The live run measures it. If it bites, drop the wait (`finishTurn` stops looking at `notes`) and list the history difference in `golden/README.md` |
| suggest.ts's screens are subtle | Copied whole, with its tests; the parity test compares every field of the vetting |
| `vocabulary.json` is frozen at 44c6d4a | Re-run the tool when the prototype's scenes change. An installed scene is read live, and the campaign check compares it with its entry |
| The Rat, the Heron and the King aren't installed yet | Their entries stand in until V3 and V4 install them; nothing in V5 needs them installed |
| Turn numbers are per scene in v2, session-wide in the prototype | The same for a first scene. V3 must decide for "Turn N, the player" in the notes' input and for deeds across scenes |
| A speaker misread is drawn in the wrong colour | As the prototype (51 of 52 right live); its tests are copied |
| Up to three thinks per turn at once | V0's pool of 16 holds five games' worth |
| Notes and lines add about $0.001 a turn | Usage on the turn row; the live run reports cost by operation |
| The fake's delays are shared code | Optional parameters only; the prototype's checks run on the PR |
| Lane A meets V2 in the client (the scene screen, the connection's subscriptions, `speechColor`) | Append-only registries; regenerate the bindings; whichever lands second wires `speechColor` to the look layer |
| V1's "jobs that aren't turns" may reshape the loop first | B puts §3.4's behaviour onto whatever shape is there; the behaviour is the contract, not the field names |

**What V5 assumes of V0, and what to do if it changed**

| V0 contract | If it didn't survive V0's build |
|---|---|
| `markup` on `transcript` and `reply_draft`; `stream_reply` with markup | A adds the columns and the argument, with defaults |
| `look` rows with the cast's colours from `looks.json` | D colours by `colorOf(key)`, and F adds the rows in `syncStage` |
| The cut screen keeps `Picks`, `fitSuggestions`, `KIND_COLOR` and the popover | D copies them from scene.tsx:202-228 and popover.tsx |
| V0's small speakers.ts and its markup copy with `SPEECH` inlined | C replaces both whichever way V0 cut them |
| `TurnView` under the prototype's field names; `viewOf(request, scene)` | C maps V5's fields onto V0's names |
| `gm_state` as typed columns | No effect: V5 adds none |
| One job row per move in flight, keyed by turn; `queueThink`; the reaper | B makes the row per turn and move (§3.4) on whatever V0 keyed it by |
| `my_names` with the key | D needs it for names in `⟨who says what⟩`; else names by key |
| The golden recorder and its moments | C extends it in `tools/v2/`, moving it there if needed |
| The headless `say` with `--wait settled` | D adds the waits of §3.9 to whatever V0 has |
| `scene.turns`, the latest turn's `n` | D finds the latest turn by the highest `n` |

---

## 7. Departures

| The plan or the design says | V5 does | Why |
|---|---|---|
| Notes and suggest are jobs nothing waits for (plan) | A turn ends when its notes are in; suggest is never waited for | The prototype ends a turn after its notes (engine.ts:953), and the next reply's history and the notes' own input (notes.ts:294-297, :314) need them |
| Picking a suggested line says it (plan) | It goes into the box, to send or change; the headless `act` says it | The prototype's screen (scene.tsx:326) and QA console (qa.ts:42) |
| The popover's card, from the client (prototype) | The AI service writes it with the note, on the mark | The client has no docs. The card is as of the note, where the prototype's re-reads names heard and later words when it's opened |
| (not in the plan) | `vocabulary.json` in the campaign | The vetting reads the prototype's other 24 scenes; without them the lines and their prompts would differ |
| `/suggestions` (plan) | A move, `set_suggestions`, on `player.suggestions` | A setting the simulation must see; per player, for V15 |
| Each speaker in their colour (plan) | The cast's colours; non-cast people's lines in gold | The prototype colours them through its look layer, which reaches the client with V2 |
| Live: 20 replies' notes judged none leaked (plan) | 12 lines, with each note set beside the scene's held facts for a reader | Under $0.10; a model judge costs about as much again |
| Suggestions only in a talk (CS) | On every reply, as rows written by a job | The prototype has them in every scene (already the plan's departure) |
| A failed model call is retried (V0's loop, for 5xx) | Notes and suggest answer 200 with nothing | As the prototype, which catches and moves on (notes.ts:342, suggest.ts:91) |

---

## 8. As built

V5 keeps to this blueprint but for these, each with its reason. The packages' reports and the PR give the full account.

### The contracts (A) and the simulation (B)

| The blueprint says | V5 does | Why |
|---|---|---|
| `job` is found by turn and move (§3.4) | A private index on `job.turnId` | The per-turn lookup `queueThink` needs; private, so not in the bindings |
| `scene_suggestion.ord` (§3.1) | Counts from 1, in the order shown | The blueprint didn't say; `say_1` is ord 1 |
| The golden replies come from a live session's `calls.jsonl` (§5 A) | The opening and the first reply do, word for word; the second is a real reply from the markup's evals, edited to carry a you; the third is written in the form of a real out-of-character answer, carrying the know | No stored live reply had a you, or a know on the Royal Purveyor's office, this early in the scene. Each entry of `tools/v2/golden-replies.json` says where it came from and what was edited |
| `NotesPlan` is `{ game, scene, turn, n, seq }` (§3.4) | It also carries `drafted`, the GM's marks | The transcript row never keeps the GM's drafted marks, and the request is built from the plan |
| A lines give-up clears the set when the turn is still the latest and the scene hasn't ended (§3.4) | Also only while the setting is on | As the commit's drop: the prototype's aborted proposal lands nothing |
| `/suggestions off`: "no rows are kept" (§1.2, step 8) | The move deletes no rows; the screen keeps no blank rows for them, and shows none while the setting is off. Turned back on with lines for the moment, nothing is asked | The setting is the player's (§3.3); the rows are the scene's one set. The prototype's `suggestNow` asks only when there are none |
| A notes or lines answer the commit can't use | Thrown in the commit and given up: `lost` | As V0's `needs`; the turn goes on |
| `set_suggestions` asks for a live or closing scene's latest turn (§3.3); the suggest commit drops a set once the scene has ended (§3.5) | Neither asks for nor lands lines while the scene ends on the reply in: its decide closed it (`gm.ended`), and the settle ends it | A reply that ends the scene has none (§3.5, step 3). The scene is live until the settle, so `/suggestions on` then asked for lines that could land, and show over the box, until the settle ended the scene |
| A background job's retries leave `turn.note` alone (§3.4) | The notes' retries set it once the turn is `noting` (the move's `waitedOn`), and the notes landing or given up clear it | Then the turn, and a line queued behind it, wait on the notes alone. Through an outage the screen says "The GM has lost the thread for a moment: trying again." as V0's turns do, not "The GM makes a note…" for a minute. After 60 s the notes are lost and the turn ends |

### The AI service (C)

| The blueprint says | V5 does | Why |
|---|---|---|
| The recorder is `tools/v2/record-golden.mts` (§4.2) | `tools/record-golden.mts` | V0's review moved V0's recorder there: one recorder for both verticals. It also writes `ai/gm/testdata/scenes` |
| One list of written notes and one set of lines for every moment (§4.2) | Each moment has its own | The notes are written for the words each reply has, so every case of §4.2 lands somewhere: on M1, an L line, free words, a know by its doc's D id, a you with a turn, and notes that don't land |
| `scene.suggest` and the judge byte for byte (§4.2) | Byte for byte but for the wizard's spells, which the prototype tells the suggester and the judge (`Spells: …`) | v2's sheet has no spells until V7. Pinned by the parity test and listed in `ai/gm/golden/README.md` |
| `markupLines` joins `ai/gm/markup.ts` (§2.3) | It's the client's (`client/scene/text.ts`) | The AI service never prints markup |
| The golden sessions | Keep no timings: the turns' `metrics` (V0's review) and how long the last lines took (`suggestions.ms`) | So a recording differs from the last only in the rules engine's random ids |
| Several sets of stand-in lines | Go a turn each, as the stand-in's replies do | A set is never offered twice running, so one set every turn would be dropped every other turn |
| The copied code's caches are kept by campaign version (§2.3), the public lore's index per lore root | All are kept with the story object: each scene's names and the words any other scene might use (`suggest.ts`), and the public lore's index (`knowledge.ts`) | V0's PUT replaces a version's files and the scenes and story read from them, but a version's name and its lore root stay the same: after the dev host's `p` the lines were vetted with the old words beside the new until a restart |
| The PUT carries `vocabulary.json` with the rest of the folder (§3.8) | It refuses one that doesn't read as the story reads it (400 `bad_request`), with the campaign check's own reader (`vocabularyOf`, now in `ai/gm/story.ts`); and the story is on the view only for the notes and the lines | V0's PUT refuses a campaign it can't read. A vocabulary read only at first use made every think of that version a 500, the turn's own too, though none of them reads it |

### The client (D)

| The blueprint says | V5 does | Why |
|---|---|---|
| `suggestionsComing` while the scene is live or closing (§3.9) | Also while it's opening | The prototype keeps the rows from the start of a scene; otherwise the conversation jumps five rows at the open commit |
| `TurnRow` gains `suggest` (§3.9) | Also `notes`, and the view `notesComing` | The headless verbs wait for the notes as well as the lines |
| `say` waits for the notes and the lines (§3.9) | So do `new`, `act` and `retry` | The opening's marks and lines, and a line said by its number, are printed whole too |
| `act` says the N-th line | It prints `> <line>` first; a spectator gets `not_controller`; with the setting off it says so | The agent didn't type the line, so it's shown; the rest are the simulation's refusals or the plain reason |
| `/suggestions` with no word toggles (§3.9) | Any word but on or off is refused on the status line | The prototype turned them over on any word, a typo too |
| The status words of §1.2, step 8 | Shown once the move is made, a refusal's words instead | So the screen never claims a setting the simulation refused |
| The `⟨…⟩` lines as the prototype's `markupLines` | Plus a `⟨card: …⟩` line under each mark with a card | So a headless tester can read the cards for leaks (§1.2, step 12) |
| Rows kept while lines come | None for a line queued behind a failed turn | Nothing is on its way until the retry |

### The campaign check, the dev host's fake and the live run (E)

| The blueprint says | V5 does | Why |
|---|---|---|
| One set of six suggested lines in `fake.json` (§3.10) | Nine | The screen drops the lines offered last time: with six, four are offered after one reply and two after the next; with nine, four every time |
| The line that uses `fake.json` is in `hosts/dev/stack.ts` (§5 E) | In `hosts/dev.ts` and `hosts/dev/fake.ts` | V0's review moved the fake's options into the dev host |
| The check compares prep, hook and cast (§4.1) | Also the ways on and the world's names | The story's walk reads `next`, and `places` reads the world names |
| The notes 2.2 s after the reply on the fake | 3.5 s | 2.2 s lands before the fake's 2 s settle, so "The GM makes a note…" would never show |
| `npm run live -- --script v5 --lines 2` against the fake | Needs `--rehearse` | V0's guard against recording a fake run as a live one |

### The integration (F)

| The blueprint says | V5 does | Why |
|---|---|---|
| The e2e's opening draft names Kell, Cob and Moll (§4.4, 1) | The opening's names Cob and Kell; turn 1's reply names all three, and A's and B's events for it are compared with their speakers | The e2e plays the golden replies, and Moll speaks first in the first reply |
| A and B both see the opening's notes land (§4.4, 2) | The opening's notes are held back 6 s, and B joins while turn 0 is noting | B can only join once the game exists |
| The e2e's fake | The dev host's (`fake.json`), with holds where a step needs the notes or the lines late; the notes steps play the golden first reply every turn | Whichever turn a step falls on, its reply then has notes that land: the other replies' depend on the turn (a you on the player's words, a know on its lore's place in the brief) |
| The local host's concurrency (§4.3) | Its tests run the job loop's dispatches side by side, as SpacetimeDB's procedures do | The memory host drains one dispatch at a time, so a held think would hold the settle up and no turn would be seen noting |
| The checks include `npm run arc` (§5 F) | Not run | It arrives with V1, which was built alongside from the same V0 head |
| `npm run e2e` takes about as long as V0's | About 165 s, from V0's 75 s | Seven more steps, each with a turn or two of 3.5 s notes |

### What the live run found

Recorded in [live/v5-2026-10-16.md](live/v5-2026-10-16.md): 13 turns, 142 calls, $0.0563.

| | V5, live | The prototype, live |
|---|---|---|
| Notes after the reply, p50 / p90 | 1.8 s / 2.3 s | 2.2 s / 3.9 s |
| Lines after the reply, p50 | 2.2 s | 2.8 s |
| Spoken lines tagged by the GM | 29 of 39 (74%) | 43 of 52 (83%) |
| Spoken lines with a speaker | 39 of 39 | 51 of 52 |
| Notes a reply | 0.8 | 1.6 |
| A turn | $0.0043 | $0.0040 |

The notes came sooner and fewer than in the prototype's run. Five of the thirteen replies had none, and an empty answer comes back fastest (about 1.1 s). The GM marked one moment in its thirteen replies, and that mark reached the notes' writer as M1. The writer is asked what the prototype's is, byte for byte at the golden moments (§4.2), so one run of twelve lines can't tell this from chance: later live runs will.
