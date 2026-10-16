# V1: Who you are

The blueprint for the second vertical: the title, character creation, the rules engine in the simulation, the sheet, and saved games. Package A lands the contracts; R, B, C and D build against them in parallel; F integrates and lands one PR. Every name, table and type below is a contract unless it says otherwise.

> **As built.** V1 was built from this blueprint as one pull request (`claude/v2-v1`): package A on that branch, then R, B, C and D each on a branch from A's commit (`claude/v2-v1-r`, `-b`, `-c`, `-d`), merged in that order by F with V0's review fixes as they landed; §5's branch names don't apply. Every port and run folder can be moved (`--port`, `--ai-port`, `--root`), as several stacks ran at once. Where the build departs from the text below, §8 says, with the reason.

- **Builds on** V0 ([v0-design.md](v0-design.md)), with the two overrides that apply to it too: `gm_state` is a table of typed columns each vertical extends, and each unit lands as one PR. V0's schema as its contracts agent wrote it (`v2/simulation/src/schema.ts` in `claude/v2-v0`, 16 Oct) is what the deltas below are against.
- **Plan:** [verticals.md](verticals.md) §3, V1. **Design:** `content-server.md` (CS). **Research:** `gm-port.md` §4, §17; `content-world.md` A2; `client.md` §5-7; `spacetime.md` §7-8. The design's long form and the research notes live in the author's scratchpad, not the repo, so the references name a section rather than link.
- **The prototype** is read at `44c6d4a` (a checkout of it, beside this one); `file:line` pointers are there. The shared AI code is `v2/ai` at `8ff3c28`.
- **Measured for this blueprint** (Node, the prototype's code): `createCharacter` 283 ms cold, `sheetData` 161 ms cold, a check 128 ms cold; a level 3 wizard's engine campaign is 15.2 KB (20 events), and a check adds about 340 bytes; `loadCampaign` draws nothing from the engine's generator, and a cached engine reseeded rolls as a fresh one (100 seeds of 100). The canon list in §3.9 picks the same 9 World docs as the prototype's regular expression.

---

## 0. Decisions at a glance

1. **V1 ports the prototype's title and character creation whole** (`src/app/game.ts:466-900`): three builds from a sentence, or one of the player's own; a backstory written, drafted or worked in from notes, checked against Caerwyn's lore, with fixes to accept or rewrite; the sheet the rules engine made; then set off into the hanged clerk. Continue and delete. `/sheet` in a scene.
2. **One copy of the rules code, two hosts.** `v2/shared/rules` holds the prototype's creation, sheet, check and builds code, handed the engine by its host. The simulation makes the real character and rolls every check. The AI service runs the engine only to make the cards it offers.
3. **Creation is a row, moves and jobs before there's a game:** a `creation` row per identity, read through `my_creation`; one small move per prototype method; each AI step a job on V0's loop, which learns that a job's owner may be something other than a turn.
4. **The game is made when the backstory is settled** (the sheet screen), and `begin` opens the first scene, as in the prototype: the sheet comes before setting off, and "Choose again" deletes the game it made.
5. **`POST /v1/characters`** (three, one, own) answers legal builds with their cards. **`POST /v1/backstories`** (draft, work, check, traits) runs the shared `v2/ai/docs/backstory.ts`. Every prompt is the prototype's, byte for byte, pinned by recorded goldens.
6. **Checks roll through the engine** (`rollFor`, `dnd.ts:905`) from the `dice` row. The opening's `comeTo` and the settle's `carryGear` come too, so the dice stream and the sheet stay the prototype's for the same seed.
7. **No `rules_log`.** One `rules_state` row per character holds the engine's serialized campaign, which is its event log. A per-isolate cache of the loaded campaign, keyed by the exact string, keeps a check to milliseconds.
8. **The sheet row** carries the typed numbers (level, HP, AC, slots, conditions, what they can do) and the whole `SheetData` as JSON for the screen. The purse and pockets are refreshed from the world, without the engine.
9. **A shim pins the engine's ids and clock** for each call: ids from the dice row's seed (never advancing it), the clock at `tx.now`. A commit stays a pure function of the rows.
10. **A daily spending ceiling:** `KM_AI_DAILY_USD` (default $5), read from the ledger. Over it, model endpoints answer `402 over_budget`, and the move fails in the game's words.
11. **The backstory reaches the GM:** `SheetRow.backstory`, and the opening writes the player's doc (`writePlayerBackstory`) before disclosure reads it.
12. **`gm_state` gains no columns.** Everything V1 adds is the character's.
13. **The client gains a screen switch** (the title, creation's screens, the sheet, the scene) over a `TitleModel` and a `CreationModel` fed by rows. The copied screens keep their bodies; `game` becomes the model.
14. **`npm run play` drives creation as the QA console does** (`--build 1|2|3|own:…`, `--backstory`, `--accept-fixes`), and gains `builds`, `sheet`, `games`, `continue`, `delete` and `begin`. `npm run arc` arrives, with check 1 on.

Team and time: five agents (A then F is one), about three hours.

---

## 1. How to try it

### 1.1 Run it

```sh
git fetch && git checkout claude/v2-v1 && cd v2 && npm ci
npm run dev                            # SpacetimeDB, the module, the AI service, the campaign; real models (--fake for none)
npm run client -- --session tamsin     # another terminal: the client opens on the title
```

To compare, run the prototype at `44c6d4a` in another checkout: `npm run game` (the app) and `npm run qa -- …` (the QA console).

### 1.2 What to do, and what to see

| # | Do | See | It should match the prototype's |
|---|---|---|---|
| 1 | Start the client | KINGMAKER, "The Hanged Clerk of Caerwyn", a tagline; New game, Quit; keys ↑↓ Enter n q | title (`ui/title.tsx`), without The zoo and Report a problem (V19, V16) |
| 2 | New game. Name "Tamsin Vell"; Tab; concept "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier"; Enter | "Who are you?", then "Three tailors take your measurements…" | `CreateScreen`, `CreatingScreen`; `offerBuilds` (`game.ts:500`) |
| 3 | Wait a few seconds | "Three ways to be Tamsin Vell": three cards of three different classes (species, class 3, subclass, background; how they'd play; HP, AC, speed, the weapon, spells, features; skills) | `ChooseScreen`; `threeBuilds` (`builds.ts:270`): the model's three, made legal by the engine |
| 4 | ←→ to pick one out; m | "Make Tamsin Vell your own way": Species, Class, Subclass, Background; ↑↓ picks, and the card below follows ("The rules engine is making it…") | `CustomScreen`; `ownBuild` (`builds.ts:344`) |
| 5 | Esc; Enter on a card | "Who were you, before the King sent for you?": the box, and Draft one · Work it in · Skip · Done | `BackstoryScreen` |
| 6 | Tab to the buttons; Draft one | A draft over the box, "A draft: not in your box until you take it". Keep mine leaves the box; Use this puts it in | `draftBackstory` (`backstory.ts:102`) |
| 7 | Replace it with "I'm the King's nephew, though nobody at court will say so. I owe Fat Jory three crowns." Done | "The GM checks your story against the world…", then "The lore check: 1 of 1", what doesn't fit and "A fix that keeps its spirit" | `checkLore` (`backstory.ts:293`); the prototype's screen check case (`screens-check.tsx:1086`) |
| 8 | Accept the fix | "…checks it again, with the fixes in…", "Writing you into the story…", then the sheet | `acceptFix`, `makeCharacter`, `create` (`game.ts:729-804`) |
| 9 | Read the sheet | "Morning, on the eve of the Assembly." and the hook, over the sheet: the class's portrait, HP, AC, abilities, saves, skills, attacks, spells (click one: the SRD's words), features, equipment, purse; the Story page with the backstory and its traits | `CreatedScreen`, `ui/sheet.tsx`; `sheetData` (`dnd.ts:706`) |
| 10 | r | Back at the three builds, the backstory kept; the game made from it gone | `chooseAgain` (`game.ts:811`) |
| 11 | Enter on a card, Done, then Enter on the sheet | The hanged clerk's opening streams in; the side panel has her status line | V0's opening; `begin` (`game.ts:949`), going straight to the scene until V2 brings the map |
| 12 | "I look closely at the body." | A dice line from the engine, with the sheet's own modifier, then the reply | `rollFor` (`dnd.ts:905`) through `skillCheck` |
| 13 | /sheet (or /c); pick a spell; Esc, Esc | The sheet over the scene; the spell's page; back; closed | `showSheet` (`game.ts:2332`), `ui/overlay.tsx:174` |
| 14 | /quit | The title: "Continue   Tamsin Vell: Morning, in The Hanged Clerk (just now)" | `describe` (`title.tsx:32`) |
| 15 | x on it, then x again | "Delete this game?", then gone from the list | the title's delete (`title.tsx:76`) |

Headless, as the QA console:

```sh
npm run play -- builds --session t --as "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye"   # qa builds
npm run play -- new --session t --as "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye" \
  --build 2 --backstory "I'm the King's nephew. I owe Fat Jory three crowns." --accept-fixes                # qa new
npm run play -- sheet --session t                                                                            # qa sheet
npm run play -- new --session u --as "Pell Marrow: a hedge-wizard" --build own:gnome,wizard,evoker,sage
npm run play -- new --session v --as "Brother Odo: a large, gentle hedge-priest"     # no --build: the model picks one
npm run play -- games --session t;  npm run play -- delete --session t --game 2
```

The ceiling: `KM_AI_DAILY_USD=0.001 npm run dev`, then say a line: the turn fails with "The GM has spent today's budget…". Restart with the ceiling raised; `/retry` finishes the turn.

The checks: `npm run check`, `npm run e2e`, `npm run arc` (check 1 of 16 on), and `npm run live -- --creation` (about $0.03; it stops at $0.10).

---

## 2. Scope

### 2.1 What V1 adds

- **The title:** Continue (the three most recent of the player's games), New game, Quit; x twice deletes a game.
- **Creation:** the six screens and their keys; three builds, or their own; the backstory and its lore check; the sheet the engine made; Choose again; Set off.
- **The rules engine in the module:** the character made by the engine; checks through it; `comeTo` at the opening; `carryGear` after the stage manager moves the player's gear.
- **The sheet:** the row the screen draws, and `/sheet` in a scene.
- **The AI service:** `POST /v1/characters` and `POST /v1/backstories`; the daily ceiling; the backstory in the GM's view and the player's doc.
- **Headless and harness:** the QA console's creation verbs; `npm run arc` with check 1.

### 2.2 What it leaves, and for which unit

| Left | For |
|---|---|
| The map: "Set off" goes straight to the first scene | V2 |
| `passTime`, `levelUp` and `rest` at an opening; spells, blows, features, the rules' aliases in dice lines | V7 |
| The zoo on the title, its wardrobe | V19 |
| Report a problem (`b`, the title's item) | V16 |
| A second campaign's words in the client (the title's subtitle, the create screen's line, `TIME_WORDS`) | V19 |
| A character for someone who joins | V15 |

### 2.3 What it ports, from where

| Prototype (`44c6d4a`) | To | What changes |
|---|---|---|
| `vendor/dnd-srd-engine/` (bundle, pack, typings) | `v2/vendor/dnd-srd-engine/` | The module-ready copy: line 1 (the `node:module` banner) deleted; `process.env.NODE_ENV` replaced with `"production"` (5 places); typings renamed `dnd-srd-engine.module.d.ts`. README records the source's sha256 and both edits (spacetime.md §8; the spike's copy was lost on 16 Oct) |
| `vendor/srd-spells/spells.json` | `v2/vendor/srd-spells/` | none |
| `src/rules/dnd.ts:19-138` | `shared/rules/engine.ts` | the loader becomes an injected `Rules`; `engineFor` a cached engine reseeded per use; `event()`'s clock pinned by the shim |
| `dnd.ts:140-447` (but `chooseBuild` 289-297), `449-560`, `562-632`, `635-878`, `884-909`, `1108-1183`, `1454`, `1459-1518`, `1763-1773`, `1870-1886`, `1956-1992` | `shared/rules/character.ts` | `SessionState` becomes `RulesSession` (§3.6), same field names; `createCharacter` requires a build; `pocketsOf` takes the world it's given; `.at(-1)` twice; nothing else |
| `dnd.ts:289-297` with `createCharacter`'s settle and style (`:393-399`) | `ai/rules/builds.ts` `pickBuild` | the model half, `ask` injected |
| `src/rules/spells.ts` (1-392) | `shared/rules/spells.ts` | the SRD's text injected; `.at(-1)` once |
| `src/rules/builds.ts:1-241, 297-371` | `shared/rules/builds.ts` | `rules` injected; no model |
| `builds.ts:246-295` (`askThree`, `threeBuilds`) | `ai/rules/builds.ts` | `ask` required (`null` is offline) |
| `src/game/combat/pregen.ts:12-35`; `builds.ts:87-91` | `campaigns/caerwyn/builds.json` | the five ready-made builds (§3.9) |
| `src/runtime/engine.ts:106-125` (the player, rules, backstory parts) | simulation `makeCharacter` | rows, not a session |
| `engine.ts:192-201` (`comeTo` only) | simulation, the open's resolve | V7 ports the rest |
| `engine.ts:933-942` | the settle commit | as `carryGear` per gear item |
| `src/app/game.ts:466-900` | `client/creation/model.ts`, `client/title/model.ts`; moves in `simulation/src/creation/` | each method a move or a model method (§3.4) |
| `src/app/ui/title.tsx`, `create.tsx`, `creation-layout.ts`, `sheet.tsx`, `sheet-layout.ts`, `portraits.ts` | `client/ui/` | imports; `game` is the model; title's zoo and report items cut; create's "(GM offline)" labels cut; `PALETTE`'s 30 colours inlined; `Span`, `StyledLine` in `client/ui/types.ts` |
| `ui/overlay.tsx:124-127, 174-188` | `client/ui/overlay.tsx` | the sheet overlay |
| `src/app/story.ts:15-25` | `client/creation/words.ts` | `LEVEL` from the campaign row |
| `src/app/save.ts` | `my_games`, `continueGame`, `deleteGame` | rows, not folders |
| `src/cli/qa.ts:34-39, 55-78, 112-176` | `client/headless.ts`, `hosts/play.ts` | through the moves |
| `src/app/smoke/flow.ts:31-32` | `hosts/arc.ts` | check 1 |
| `src/app/smoke/screens-check.tsx:798-849, 853-874, 890-1306` | `client/check/screens.tsx` | fixture rows, stub actions |
| `src/rules/builds.test.ts`; `src/app/ui/sheet.test.ts` (but the cases that cast, rest or use a feature); `creation-layout.test.ts`; `src/rules/spells.test.ts:17-102` | beside their copies | engine half to `shared/rules`, model half to `ai/rules` |
| `v2/ai/docs/backstory.ts` (already shared) | stays | `CreationWorld` option; `ask: null`; helpers moved to `shared/creation` (§3.8) |

---

## 3. The deltas to V0's contracts

### 3.1 Tables

New:

| Table | Access | Columns |
|---|---|---|
| `creation` | private, read through `my_creation` | `identity` pk · `uid` (`tx.uuid()`: the creation's id in requests and keys; the game made from it takes it as `game.uid`) · `campaign` · `campaignVersion` · `name` · `concept` · `how` (three, model, own) · `step` (concept, choose, custom, backstory, made) · `busy` option (builds, pick, own, draft, work, check, traits) · `rev` u32 · `offer` option (JSON `Offer`) · `own` option (JSON `{ picks: OwnPicks; option?: BuildOption; lists?: SrdLists }`) · `chosen` option (JSON `BuildOption`) · `story` · `version` u32 (bumped when the story is replaced from outside: the box starts again with it) · `proposal` option (JSON `{ kind: "draft" \| "work"; text }`) · `issues` option (JSON `LoreIssue[]`) · `issue` u32 · `rewriting` option (JSON `LoreIssue`) · `again` bool · `note` option · `unchecked` option · `backstory` option (JSON `Backstory`) · `gameId` option u64 (the game made from it, until `begin`) · `calls` u32 · `costMicros` u64 · `updatedAt` |
| `rules_state` | private | `playerId` pk · `gameId` ix · `pc` (the engine's character id) · `campaign` (`serializeCampaign`: the engine's event log) · `prefer` string[] (the build's preferences, for V7's level-ups) · `gear` array `GearRow { id, name, kind, slot option }` · `gone` string[] (gear the story has parted them from) |

Changed:

| Table | Change | For |
|---|---|---|
| `sheet` | + `level` u32 · `hp` i32 · `maxHp` i32 · `ac` i32 · `slots` array `SlotRow { level u32, max u32, used u32 }` · `conditions` string[] · `spells` array `SpellRef { id, name, level u32 }` · `weapons` array `WeaponRef { id, name }` · `features` array `FeatureRef { id, name, target }` · `data` (JSON `SheetData` without `purse` and `carrying`) · `pockets` (JSON `{ purse, carrying }`) · `backstory` option (JSON `Backstory`). V0's `build`, `skills` and `statusLine` now come from the engine | the plan's sheet; the sheet screen; the GM's `SheetRow` |
| `player` | + `lastPlayedAt` timestamp | the title's "(5 min ago)" |
| `job` | `gameId`, `sceneId`, `turnId` become option u64; `move` gains `creation`; `step` gains offer, pick, own, draft, work, check, traits | jobs that aren't a turn's |
| `gm_state` | **no new columns** | nothing V1 adds is the GM's bookkeeping of a scene |

Every column added to an existing table has a `.default(…)`, so a dev database migrates (spacetime.md §4.10). The `job` change can't migrate: the dev host's `--delete-data=on-conflict` wipes once, and says so.

### 3.2 Views

| View | Returns | Body |
|---|---|---|
| `my_creation` | option `creation` row | the caller's |
| `my_games` | array `GameSummary` (`t.row`): `gameId` pk · `name` · `time` · `where` · `hook` · `begun` bool · `lastPlayedAt` | the caller's `host` players in games whose status is playing. `where`: "in \<title\>" while the latest scene is opening, live or closing; "\<title\>, over" once it ended (V3 replaces it); "heading for \<title\>" before `begin`, from the first scene's `scene_def`. `hook`: that scene's |

### 3.3 Reducers

Each creation move bumps `rev` except `setBackstory`, refuses `not_creating` when the caller has no creation (or when it's made, but for `chooseAgain`), and runs for the caller's identity (V0's `Actor` with no `id`).

| Export (wire) | Args | Who | Refuses | Writes |
|---|---|---|---|---|
| `startCreation` | `campaign, name, concept, how` | anyone | `no_campaign`, `bad_name`, `bad_concept` (1-500 characters), `bad_how` | the caller's `creation`, replacing any; `story` kept from it and `version + 1`. The same name and concept as one with an `offer`: step choose, no job (`game.ts:504`). Else by `how`: `three`, step choose, busy builds, the `offer` job; `model`, step backstory, busy pick, the `pick` job; `own:<s>,<c>,<sc>,<bg>`, step custom, `own.picks`, busy own, the `own` job |
| `creationBack` | `story` option | | | choose → concept; custom, backstory → choose, or concept without an offer; proposal, issues, note, rewriting cleared; busy cleared; `story` saved when given |
| `chooseBuild` | `index` u32 | | `creation_busy`, `not_offered` | `chosen`, step backstory |
| `makeOwn` | `from` u32 (the card picked out) | | `creation_busy`, `not_offered` | `own.picks`: kept, else `picksOf` that card (or the first); step custom; busy own; the `own` job |
| `pickOwn` | `speciesId, classId, subclassId, backgroundId` | | `creation_busy` (unless busy is own) | the subclass rule (`game.ts:573-576`, from `own.lists`); `own.picks`; busy own; the `own` job |
| `takeOwn` | | | `still_making` | `chosen = own.option`, step backstory |
| `setBackstory` | `text` | | `story_too_big` (over 40,000 characters) | `story` only |
| `draftBackstory` | `text` | | `creation_busy` | `story`; busy draft; the `draft` job |
| `workInBackstory` | `text` | | `creation_busy`, `nothing_to_work_in`, `story_too_long` | `story`; busy work; the `work` job |
| `takeProposal` | | | `not_now` | `story = proposal.text`, `version + 1`, note "It's yours now: change anything you like." |
| `leaveProposal` | | | `not_now` | proposal cleared |
| `finishBackstory` | `text` | | `creation_busy`, `story_too_long` | `story`; rewriting and again cleared. Empty: `makeCharacter` now. Else busy check, the `check` job |
| `acceptFix` | | | `creation_busy`, `not_now` | `applyFix`; a quote no longer there is `rewriteIssue`. The next issue; after the last, again false: again true, busy check, the `check` job; again true: busy traits, the `traits` job |
| `rewriteIssue` | | | `not_now` | rewriting = the issue; issues cleared |
| `skipBackstory` | | | `creation_busy` | story "", `version + 1`, unchecked cleared; `makeCharacter` now |
| `chooseAgain` | | | `not_now` (nothing made) | the made game's rows deleted (§3.5); gameId cleared; step choose (concept without an offer) |
| `begin` | | the seated host | `not_in_game`, `already_begun` | V0's `openScene` resolve for the campaign's first scene, with `comeTo` (§3.6); the caller's `creation` deleted when it made this game; `lastPlayedAt` |
| `continueGame` | `game` u64 | anyone | `unknown`, `not_yours` | the caller's `seat` to their host player there; `lastPlayedAt` |
| `deleteGame` | `game` u64 | the game's host | `unknown`, `not_yours` | every row of the game (§3.5), seats on it included |
| `newGame` (V0) | unchanged | | `no_build` now lists builds.json's five | the character from builds.json's `build` through the engine (§3.6), then V0's opening |
| `joinGame` (V0) | unchanged | | + `not_begun` | unchanged |
| `say` (V0) | unchanged | | unchanged | its commits roll through the engine (§3.6) |
| `installCampaign` (V0) | unchanged | | `bad_pack` when a build names a class, species or background the pack hasn't | unchanged |

### 3.4 Refusals

Appended to `RefusalCode` and `WORDS` in `shared/protocol/refusals.ts`. The two that are the prototype's notes keep its words, with no brackets: the creation screens show them in their note line.

| Code | Words |
|---|---|
| `not_creating` | "(You're not making a character: New game starts one.)" |
| `creation_busy` | "(The GM is still working on it.)" |
| `not_offered` | "(That isn't one of the builds on offer.)" |
| `still_making` | "(The rules engine is still making it.)" |
| `not_now` | "(That doesn't apply just now.)" |
| `bad_concept` | "(Who they are needs saying in a sentence or two: 500 characters at most.)" |
| `bad_how` | "(That isn't a way to make a character: three, model, or own:\<species\>,\<class\>,\<subclass\>,\<background\>.)" |
| `nothing_to_work_in` | "There's nothing in the box to work in yet: write a few notes first, or Draft one." (`game.ts:647`) |
| `story_too_long` | `tooLong(text)`'s words: "It's 2,345 words, and the GM reads all of it every turn: cut it to 2,000 or fewer." |
| `story_too_big` | "(That's more than the box can keep.)" |
| `already_begun` | "(The story has already begun.)" |
| `not_yours` | "(That isn't one of your games.)" |
| `not_begun` | "(That game hasn't begun: its player is still making their character.)" |

### 3.5 Jobs, the creation's steps, and making the game

**The job loop learns about owners.** V0's loop is a turn's: its revision check, its waiting note, its usage and its failure all touch the turn. V1 moves those four onto the move, with V0's as the default:

```ts
// simulation/src/moves/move.ts (A)
export interface JobOwner<Plan> {
  wanted(tx: TxCtx, plan: Plan): boolean;                          // V0: the lease is this turn, the scene isn't over
  waiting(tx: TxCtx, plan: Plan, note: string | undefined): void;  // V0: turn.note
  charge(tx: TxCtx, plan: Plan, usage: Usage): void;               // V0: turn.calls, turn.costMicros
  failed(tx: TxCtx, plan: Plan, words: string): void;              // V0: the turn failed, the draft deleted, the lease kept
}
export interface Move<Args, Plan> { /* V0's four phases */ owner?: JobOwner<Plan> }   // absent: V0's turn owner
// AiCall.request widens to CharactersRequest | BackstoriesRequest; Endpoint gains "/v1/characters" | "/v1/backstories".
```

The creation's owner: `wanted` is the creation row of the plan's identity, still at `plan.rev` (a stale answer is dropped, as `game.ts:582` drops a pick overtaken by another); `waiting` writes `creation.note` (V0's words) without bumping `rev`; `charge` adds to `creation.calls` and `costMicros`; `failed` clears busy, bumps `rev` and writes `note` = the words. A 402 `over_budget` fails at once, with the AI service's message as the words. Everything else in V0's loop (claim, deadline, backoff, the reaper, the 10-minute give-up) is unchanged.

**The creation's steps** (`move: "creation"`; the plan is `{ step, identity (hex), uid, rev, ask?, op?, text? }`; each commit bumps `rev` and carries it into the next step's plan):

| Step | POST | Key | Timeout | Commit |
|---|---|---|---|---|
| offer | `/v1/characters` `{ ask: { kind: "three" } }` | `<uid>:c<rev>:offer` | 60 s | `offer`; busy cleared |
| pick | `/v1/characters` `{ ask: { kind: "one" } }` | `…:pick` | 60 s | `chosen`; step backstory |
| own | `/v1/characters` `{ ask: { kind: "own", picks } }` | `…:own` | 30 s | `own.option`, or note "The rules engine couldn't make that one: \<refusal\>" (`game.ts:584`); `own.lists` when absent |
| draft | `/v1/backstories` `{ op: "draft", who }` | `…:draft` | 60 s | proposal `{ draft }`, or note = `why` |
| work | `{ op: "work", who, text }` | `…:work` | 60 s | proposal `{ work }`, or note |
| check | `{ op: "check", who, text }` | `…:check` | 60 s | issues found: issue 0, wait for the player. Otherwise `unchecked` as `game.ts:713-720` (cleared when checked; else "Your backstory went in as you wrote it, without the lore check: \<reason\>.", or "…with the fixes you took, but nobody checked them again: \<reason\>." when `again`), then busy traits and the `traits` step |
| traits | `{ op: "traits", who, text }` | `…:traits` | 60 s | `backstory`; then `makeCharacter` in the same commit |

`who` is `{ name, concept, build: chosen.line }` for every op (`game.ts:614`); `workIn` leaves the build out of its own prompt (`backstory.ts:203`). Keys live in `shared/protocol/keys.ts` (`creationKey(uid, rev, step)`), and `keyParts` learns them, so the AI service's `KM_AI_FAULTS=exit-after-store:<step>` names creation steps too.

**`makeCharacter(tx, creation)`** (`simulation/src/creation/make.ts`), the prototype's `create` with `Core.create` and `createSession` (`game.ts:783-804`, `play.ts:178-189`, `engine.ts:106-125`):
1. V0's `createGame` with `uid = creation.uid`: the game (time from the first scene), the player (host, name, concept), the seat (replacing any), the dice (seed `tx.seed()`).
2. `createCharacter(rules, session, campaign.level, chosen.build)` on a `RulesSession` of `{ id: uid, seed: dice.seed, rollCount: 0, player }` (no roll is drawn: hit points are the average).
3. `rules_state` from `session.rules`; the `sheet` (§3.6); `player.lastPlayedAt`.
4. The creation: step made, `gameId`, busy cleared. The module logs `[rules] makeCharacter <ms> ms (createCharacter <ms>, sheetData <ms>)`.

**Deleting a game** (`simulation/src/games/delete.ts`) goes through an append-only registry of the game's tables, one line each, which later verticals extend: by game (game, player and the seats on its players, sheet, dice, rules_state, scene, turn, transcript, place, entity, heard, job and its `job_dispatch` rows, a `creation` pointing at it), by scene (gm_state, on_stage, reply_draft), by place (every component, world_log, look). A job of the game that's in flight finds no row at commit and is dropped. The AI service's folder for the game stays, as the prototype keeps a deleted game's logs.

### 3.6 The rules engine in the simulation and the service

**Files.** `v2/vendor/` is vendored code (§2.3). `shared/rules/shim.ts` is what the bundle needs of its host before it loads: `process.env.NODE_ENV`, a `window.crypto.getRandomValues` drawing on a per-call source, and a `Date` subclass whose clock can be pinned (a `Date` with no arguments, and `Date.now`). Each host imports it before the bundle: `simulation/src/rules/load.ts` (the bundle, the pack and the SRD's spells as JSON imports, which work in the module and under tsx) and `ai/rules/load.ts` (plain node: the bundle, and `fs` for the JSON). `shared/rules` never imports the bundle at run time: it's handed a `Rules`, and imports the typings as types only.

```ts
// shared/rules/engine.ts
export interface Rules {
  E: typeof Dnd; pack: unknown; srd: SrdFile; content: Dnd.Content;
  engine(seed: number): Dnd.Engine;   // one per isolate, rng.state = seed: rolls as createEngine({ rng: seededRNG(seed) }) does
}
/** Runs fn with the engine's ids drawn from rng(seed) and its clock at nowMs; restores both after. */
export function withEngine<T>(pin: { seed: number; nowMs: number }, fn: () => T): T;
/** The campaign loaded from its exact string, cached per isolate (64, least recently used); never mutated. */
export function loaded(rules: Rules, serialized: string): Dnd.Campaign;
```

In the simulation the pin is `seed = dice.seed + 104729 × (dice.rolls + 1) + tx.engineCalls++` and `nowMs = tx.now`: ids are a pure function of the rows, and `dice.rolls` isn't advanced by them. In the AI service the source is `crypto.getRandomValues` and the clock is real. `TxCtx` gains `rules(): Rules` (loaded once per isolate), `engineCalls` and `elapsedMs()` (host time for the timing log lines, so simulation code never reads the clock).

**`RulesSession`** (`shared/rules/types.ts`) is the subset of the prototype's `SessionState` the rules code reads, under the same names, so the copied bodies don't change: `{ id, seed, rollCount, player: { name, concept, modifiers, build?, backstory? }, rules?: RulesState, world?, carried?, history? }`. `simulation/src/rules/session.ts` builds one from the rows (dice, player, sheet, rules_state, and the place's world through `rowsToWorld` when there is one) and writes back what changed: `dice.rolls`, `rules_state` (campaign, gone), the sheet.

**The sheet row**, written by `sheetRows(rules, session)` after creation and after `carryGear`: `build` (`buildLine`), `skills` (`modifiersFrom`, all 18), `statusLine` (`status`), `level`, `hp`, `maxHp`, `ac`, `slots`, `conditions` (from the engine's sheet), `spells`, `weapons`, `features` (`refresh`, `dnd.ts:116`), `data` (`sheetData` with `purse` and `carrying` taken out), `backstory`. `pockets` is `pocketsOf` alone, refreshed without the engine whenever the player's place is written back (the open, every settle), and the campaign's `startingPurse` before the story begins (`dnd.ts:630`). A wizard's `data` is about 19 KB.

**Where the engine runs in the simulation:**

| Where | What | Dice |
|---|---|---|
| `makeCharacter`, `newGame` | `createCharacter`, then `sheetRows` | none |
| open's resolve (`begin`, `newGame`) | the build's gear into the world from `rules_state.gear` less `gone` (V0's `place.ts`, `engine.ts:182-188`); then `comeTo` (`engine.ts:194`) | `rolls + 1` (for a character who isn't down, no line and no change) |
| decide commit | a route's check: `rollFor` (`skillCheck` on the cached campaign) | `rolls + 1` |
| settle commit | an outcome route's check: `rollFor`; then, after `moveOnAfterReply` and before `joinWorld`, `carryGear` for each gear item whose holder changed, in entity order (`engine.ts:933-942`): a dice line ("You no longer have your dagger (AC now 12)"), `gone`, `sheetRows` | `rolls + 1` for each check and each change |

So for the same seed and lines, v2 draws the prototype's dice: `comeTo` at the opening is why the first check is the seed's second draw, as in the prototype.

**Time.** The engine's work is in reducers and commits, which hold every other transaction up (spacetime.md §7, question 1). The budget: `begin` and a check under 100 ms (a check on the cached campaign is a few milliseconds; the first on a cold isolate loads it, about 70 ms); `makeCharacter` and `newGame` once per game, expected 100-250 ms, logged and reported. If `makeCharacter` runs over 250 ms, `data` moves into a follow-up scheduled reducer, so no single transaction holds the lock that long.

### 3.7 The AI service

**Types** (`shared/protocol/ai.ts`; `Who`, `LoreIssue`, `Asked`, `Backstory` move to `shared/creation/types.ts`, re-exported where they were):

```ts
/** What every request carries: V0's AiRequest without the player, whom creation doesn't have yet. */
export interface AiRequestBase { key: string; game: { id: string; campaign: string; version: string } }   // game.id: the creation's uid
export interface AiRequest extends AiRequestBase { player: { id: string; name: string } }
export interface SheetRow { name: string; concept: string; build?: string; skills: Partial<Record<Skill, number>>; status?: string; backstory?: Backstory }

export type CharactersAsk = { kind: "three" } | { kind: "one" } | { kind: "own"; picks: OwnPicks };
export interface CharactersRequest extends AiRequestBase { who: { name: string; concept: string }; level: number; ask: CharactersAsk }
export interface CharactersResponse { offer?: Offer; option?: BuildOption; refusal?: string; lists?: SrdLists; usage: Usage }

export type BackstoryOp = "draft" | "work" | "check" | "traits";
export interface BackstoriesRequest extends AiRequestBase { op: BackstoryOp; who: Who; text: string }
export interface BackstoriesResponse { asked?: Asked<string>; checked?: Asked<LoreIssue[]>; backstory?: Backstory; usage: Usage }
// AiError's code gains "over_budget" (402).
```

**Endpoints:**

| Endpoint | Steps | Model calls (prompts byte for byte the prototype's) |
|---|---|---|
| `POST /v1/characters` three | `threeBuilds(rules, name, concept, level, { ask })` | `rules.builds` (`builds.ts:251-262`: `BUILD_GUIDE`, `buildMenu(level, content)`) |
| one | `pickBuild`: `chooseBuild` (caught, `dnd.ts:395`), `settleBuild`, `styleFor` (the model chose, so a style is fitted: `dnd.ts:398`), the card | `rules.build` (`dnd.ts:289-297`) |
| own | `ownBuild`; an id not on the lists is `refusal` (its words), with `lists` | none: no ceiling, no model |
| `POST /v1/backstories` draft, work, check, traits | `draftBackstory`, `workIn`, `checkLore`, `finishBackstory` from `v2/ai/docs/backstory.ts`, with `world` from campaign.json and `ask` | `backstory.draft`, `.work`, `.check`, `.traits` |
| `POST /v1/scenes/open` (V0) | first, the player's doc: `writePlayerBackstory` (`docs.ts:180`) when `party[0].backstory` has text, else V0's `playerDoc` | unchanged |
| decide, reply, settle (V0) | `viewOf` puts `party[0].backstory` on `TurnView.player.backstory`, which `backstoryBrief` and `genderOf` read (`brief.ts:204-238`) | unchanged |

`ask` is `(request) => respondJson({ ...request, calls: ctx.calls })`: V0's `CallContext` seam, so the call log, the ledger and `usage` see every call. The model's failure is the prototype's: `threeBuilds` falls back to the class defaults with a note, and the backstory's four answer `{ ok: false, why }` or the traits from their own words; all are 200s. An engine error is a 500 `model_failed`. `KM_AI_GM=canned` passes `ask: null`, which gives the prototype's offline answers ("The GM is offline: three from the class defaults…", "The GM is offline, so nobody has checked it…"). The engine loads on the first `/v1/characters`, once per process.

**The ceiling** (`ai/service/budget.ts`): `KM_AI_DAILY_USD` (default `5`; `0` turns it off). `Ledger` gains `spentToday(): Promise<number>`, the sum of today's (UTC) `costUsd` lines, read incrementally from the byte offset it last read. Before a handler that may call a model runs, and after the key's stored answer has been looked for (a stored answer is always served), spent ≥ the ceiling answers `402 { error: { code: "over_budget", message: "The GM has spent today's budget ($5.00): it starts again at midnight UTC, or raise KM_AI_DAILY_USD." } }`. A request already running may go over by its own cost. `GET /v1/health` gains `budget: { dailyUsd, spentToday }`.

**Campaigns.** `service/campaigns.ts` reads campaign.json's `creation` block into a `CreationWorld` (§3.9) for the backstory calls. The `Containerfile` copies `vendor/` too.

### 3.8 Shared code with the prototype

All in A, each change optional for the prototype, whose imports don't change:
- **`v2/ai/docs/backstory.ts`:** `options.world?: CreationWorld` on `draftBackstory` and `checkLore`, and `canonFor(story, world)`, defaulting to `CAERWYN` (today's `PREMISE`, `World/Caerwyn.md`, the three World docs the check skips, `PLACE_WORDS`); `options.ask` may be `null` (offline, whatever `modelOffline()` says).
- **Moved to `shared/creation/story.ts`:** `MOST_WORDS`, `wordCount`, `tooLong`, `locate`, `applyFix` and their helpers (`STARTERS`, `wordsOf`, `thousands`), with `locate`'s `.at(-1)` made ES2021. `backstory.ts` re-exports them. The client and the simulation need them, and may not import `v2/ai`.
- **Moved to `shared/creation/types.ts`:** `Who`, `LoreIssue`, `Asked`, `Backstory`, re-exported from `backstory.ts` and `docs/types.ts`.
- The prototype's `npm run typecheck`, `npm test` and `npm run build:web` must pass at the repo root.

### 3.9 Campaign data

- **campaign.json** gains `creation`; `level` (3) and `rulesPack` ("starter-pack@0.1.0") are there already:

```json
"creation": {
  "name": "Caerwyn",
  "premise": "This morning, the eve of the Centennial Assembly in Caerwyn, a palace clerk, Wendell Prout, … none of the story's other named people know them yet.",
  "primer": "World/Caerwyn.md",
  "notCanon": ["World/Caerwyn now.md", "World/Fronts.md", "World/index.md"],
  "places": [{ "doc": "Places/Granary Yard.md", "words": "\\b(granary|prout|clerk|loft|hoist)\\b" }, "…the other six of backstory.ts:60-68, in order"]
}
```

  `premise` is `PREMISE` (`backstory.ts:57`) verbatim; `words` are the regular expressions' sources, read with the `i` flag.
- **builds.json** becomes `{ "<id>": { "concept": string, "build": Build } }`, and `BuildFile` with it: `fighter`, `wizard`, `rogue`, `cleric` from `PREGENS` (`pregen.ts:12-35`, builds and concepts verbatim); `ranger` from the class defaults (`builds.ts:87-91`, without `plays`) with `DEFAULT_CONCEPT` (`story.ts:17`). The engine makes the rest; V0's dumped fields go.
- **The install** is V0's: the PUT carries the folder, so the AI service has `creation`; `install_campaign` checks each build's ids against the pack.
- **The campaign check** (`npm run campaign -- check`) gains: the builds' ids on the pack's lists; `creation`'s docs exist in `lore/`; each `words` compiles; `rulesPack` is the vendored pack's `id@version`.

### 3.10 The client

**The screens**, chosen by `screenOf(rows, intent)` (`client/app/model.ts`, pure, tested), where `intent` is the client's own (title, creation, game):

| Screen | When | From |
|---|---|---|
| title | intent title | `my_games` |
| create | intent creation, before `startCreation` or at step concept | the row, to fill the fields |
| creating | busy builds, pick or traits | MEASURING, ROLLING or WRITING lines (`create.tsx:22-42`) |
| choose, custom, backstory | step | `my_creation`, the `campaign` row (level) |
| created | intent game; the seat's game not begun | the seat's `sheet` (`data` with `pockets`), `my_games`' row (time, hook), `my_creation` (unchecked; r only when it made this game) |
| scene | intent game; a scene | V0 |

`TitleModel` (`client/title/model.ts`) has the prototype's names: `saves`, `newCharacter`, `resume` (`continueGame`), `deleteSave` (`deleteGame`), `quit`. `CreationModel` (`client/creation/model.ts`) has `game.ts:487-823`'s: `offerBuilds`, `backToConcept`, `pickCard`, `chooseBuild`, `backToBuilds`, `makeOwn`, `pickOwn`, `ownColumn`, `takeOwn`, `storyTyped`, `draftStory`, `workInStory`, `takeProposal`, `leaveProposal`, `finishStory`, `acceptFix`, `rewriteIssue`, `skipStory`, `chooseAgain`, `begin`, `toTitle`; and `creation`, the prototype's `Creation` (`game.ts:64-96`) built from the row with the screen's own state (the card picked out, the list with the keys, the box's text). `storyTyped` keeps the text locally and calls `setBackstory` a second after typing stops; moves that need the text carry it. `aiOffline` is always false: the answer says when the GM is offline. A refusal's text goes to the note line on the creation screens and to the status line elsewhere.

**Rows to views:** `creationOf(row, local)` (`client/creation/rows.ts`) gives the prototype's `Creation`; `describe(GameSummary)` gives the title's line (`title.tsx:32`); V0's `sceneViewOf` gains nothing, since the sheet overlay reads the `sheet` row as it is (`data` with `pockets` laid over it).

**Keys** are the copied screens' own: the title ↑↓ Enter x n q; create Tab Enter Esc; choose ←→ Enter 1-3 m Esc; custom ←→ ↑↓ Enter Esc; backstory Tab, Alt+Enter (Done), Esc (back to the builds), and on a draft or an issue ←→ Enter Esc ↑↓; created Enter (Set off) and r; the sheet's own (pages, ↑↓ and Enter on a spell, Esc).

**Subscriptions** (`client/net/connection.ts`): always `my_seat`, `my_games`, `my_creation`, `campaign`; on a seat, V0's set. The new reducers are called by name.

**In a scene:** `/sheet` and the alias `c` (`game.ts:156`) open the sheet overlay from the seat's `sheet` row; `COMMANDS` gains sheet; `/quit` goes to the title, the game kept.

**Headless** (`client/headless.ts`, `hosts/play.ts`):

| Verb | Does | Prints (the QA console's words) |
|---|---|---|
| `builds --as "Name: concept"` | `startCreation(three)`; waits for the offer | each card (`cardText`), the note, then "(play new … --build 1, 2 or 3 takes one; --build own:… makes your own.)" |
| `new --as … [--build <ready-made>\|1\|2\|3\|own:s,c,sc,bg] [--backstory "…" \| --backstory-file p] [--accept-fixes]` | a ready-made id: V0's `newGame`. Else `startCreation` (three for 1-3, which keeps an offer `builds` made; own; model without `--build`), `chooseBuild` or `takeOwn`, then `finishBackstory` or `skipBackstory`; with `--accept-fixes`, `acceptFix` for each issue, as the screens do; then `begin` | "Build 2 of three: \<line\>", the card; "Backstory: it fits the world's lore." or each issue (`qa.ts:158-166`); "Who you are: \<summary\>"; "Game \<id\>: you are \<name\>, \<build\>."; then V0's observation |
| `sheet` | | the sheet as text, from `data` and `pockets` (`sheetText`'s lines, `dnd.ts:562`) |
| `games`, `continue --game`, `delete --game`, `begin` | | the title's lines; `MODE: …` |

Issues left without `--accept-fixes` stop it with exit 1, the issues printed and the creation kept (the QA console goes on with the text unchanged; the screens can't). `--backstory` with a ready-made build is refused: those go straight in. `observe` prints `MODE: title` (the games) with no seat, `MODE: created` (the sheet, "Use: play begin") before `begin`, else V0's.

`npm run client -- --session <profile>` opens on the title; the profile keeps one identity token, so the title lists that profile's games. `--new "Name: concept"` without `--build` goes straight to creation; V0's `--new … --build wizard` and `--join` are unchanged.

---

## 4. Tests

### 4.1 Unit tests (`npm test`, offline)

| Where | What |
|---|---|
| `shared/rules` (R) | the sheets of the five ready-made builds and of the three builds a concept is offered equal the prototype's (`SheetData`, the status and build lines, the modifiers, `refresh`'s lists with instance ids masked); 300 checks (skill × DC × seed) equal the prototype's `RollResult`s; a cached engine and a cached campaign roll as fresh ones; the same pin gives the same serialized campaign twice; `settleBuild` twice changes nothing; `builds.test.ts`'s engine cases (offline defaults, the concept's words, their own and its refusals, a card's numbers are the sheet's, styles, a caster's top slot); `spells.test.ts:17-102`; `sheetText`, `pocketsOf`, `comeTo`, `carryGear` |
| `shared/creation` (A) | the moved helpers' tests from `backstory.test.ts`; the canon list picks what the regular expression picked, on the campaign's lore |
| `simulation` (B), on the memory host with a scripted `ai` | each creation path to `made` (three; model; own, with an overtaken pick dropped and a refusal noted); draft, take, leave, work; finish empty; check with issues, accept, check again, traits; check unreachable (both `unchecked` words); `makeCharacter` (the game takes the creation's uid; the sheet equals R's golden); `chooseAgain` leaves no row of the made game; `begin` (`comeTo` moves `rolls` by one; the creation goes; `already_begun`); `newGame` ready-made, and its first route check's dice line equals the prototype's for the seed; the stage manager giving away the dagger (`carryGear`'s line, `gone`, the sheet without it, `rolls + 1`); `continueGame`, `deleteGame` (every registered table empty for the game; `not_yours`); the creation's owner (waiting note, give-up, 402's words); `joinGame` `not_begun`; every new refusal; `my_games`' body for each state |
| `ai` (C) | `/v1/characters` on `fakeFetch`: the model's three made legal; a class it doubled made up from the defaults; the model failing (defaults and the note); one; own and its refusal; `/v1/backstories`' four ops, `ask: null` and a failing model; the ceiling (402 before a model call; a stored answer served over it; `spentToday` reads only what was appended); canned creation answers; the open writes the player's doc with the backstory before disclosure; `builds.test.ts`' model cases with a stand-in `ask` |
| `client` (D) | `screenOf` for every row state; `creationOf(row, local)`; the title's `describe`; `sheetText` from `data` equals the prototype's for the five builds |

### 4.2 Prompt parity, and how to record it

The recorder is `tools/v2/record-v1-golden.mts` in the repo (outside `v2/`, as verticals.md §1 says for tools that import the prototype). It imports the prototype by path from a checkout at `44c6d4a`, never from the stack's own `src/` (whose `backstory.ts` is V1's):

```sh
KM_RUNS_DIR=$(mktemp -d) OPENROUTER_API_KEY=offline node --no-warnings tools/v2/record-v1-golden.mts \
  --proto <a checkout of the prototype at 44c6d4a> --out v2
```

It installs the prototype's `fakeOpenRouter({ byName, choices, replies })`, wraps its fetch to keep each request body with its operation, and records:
1. **Creation's prompts:** `threeBuilds` for the create screen's three example concepts (one with `byName.builds` set to three real suggestions, two with the least JSON); `createCharacter` with no build (`rules.build`); `draftBackstory`, `workIn`, `checkLore` (a story that names the granary, so a place's doc is read) and `finishBackstory`, with `ask` left to default. To `v2/ai/rules/golden/*.json`.
2. **Sheets and checks:** for the five ready-made builds and the first concept's three, `createCharacter` (seed 7) with `sheetData`, `sheetText`, `statusLine` and `refresh`'s fields, instance ids masked in order; `rollFor` for three skills × three DCs × seeds 1-100. To `v2/shared/rules/golden/`.
3. **A GM session with a backstory:** `createSession({ build: PREGENS.rogue.build, backstory, seed: 4242 })`, `openScene`, and "I look closely at the body." with `choices: { attempt: "examine-body" }`, in V0's golden format. To `v2/ai/gm/golden/hanged-clerk-backstory/`.
4. **The client's fixtures:** the offline offer for Tamsin's concept, `srdLists(3)`, an own option (orc, rogue, thief, criminal), the wizard's and the fighter's `SheetData`. To `v2/client/check/fixtures/`.

Each golden folder gets a README saying how it was made. The tests compare:
- **byte for byte**, the request bodies of `rules.builds`, `rules.build` and `backstory.*` (instructions, input, schema), sent by v2's endpoints under `fakeFetch` with the same options and the campaign's `creation` block;
- **byte for byte**, `gm.opening` and `gm.reply` from the backstory session (the brief's "Who they are, from their own backstory" and the player's doc in the stable lore block), through V0's `parity.test.ts`;
- **the dice:** the memory host, given the session's seed, the same build and line, writes the session's dice line.

### 4.3 End to end (`npm run e2e`, F)

V0's scenario stays, now with engine-made sheets. Added before its last step (down), on the fake model:

- **C1 · A concept to the opening.** `KM_AI_FAKE` gives `byName` answers for `builds`, `backstory` and `traits`. A: `startCreation(three)`; three cards of three classes; `chooseBuild(1)`; `draftBackstory`, `takeProposal`, `finishBackstory`; the check fits; traits; made: A's `sheet` has the chosen card's HP and AC; `begin`; the opening streams; the call log's `gm.opening` input holds the backstory's summary. B joins after `begin` and watches; before it, `joinGame` is refused `not_begun`.
- **C2 · The AI service killed after it kept a creation answer:** restarted with `exit-after-store:check`; `finishBackstory`; it exits; restarted without the fault; made; `backstory.check` once for that key.
- **C3 · SpacetimeDB restarted mid-think:** `streamMs: 3000`; `startCreation` for a second concept; a second into busy builds, SpacetimeDB stopped and started on the same data; the offer lands within 60 s; `rules.builds` once for that key.
- **C4 · Continue and delete:** A has two games; `my_games` lists both, newest first; `continueGame` moves A's seat; `deleteGame` empties every registered table for it (SQL counts), and B, watching it, loses its seat.
- **C5 · Checks beside a stream:** game 1 replying with `streamMs: 3000` while C makes a character and says two lines with checks in game 3: game 1's draft keeps arriving, no gap over 600 ms; the module's logs show `begin` and each check under 100 ms, and print `makeCharacter`'s time.
- **C6 · The ceiling:** a $10 line for today appended to `runs/e2e/ai/ledger.jsonl`; A says a line; the turn fails with the ceiling's words; the AI service restarted with `KM_AI_DAILY_USD=100`; `retry_turn`; done.

### 4.4 The screen check (`npm run screens`, D)

At 80x24 and 130x42, from fixture rows with the actions recorded:
- **title:** a click on New game; a click on Continue calls `continueGame`; x then x calls `deleteGame`; the line `describe` writes.
- **create:** the fields; Tab; Enter sends `startCreation` with the defaults when empty; Esc goes to the title.
- **creating:** each busy's lines.
- **choose:** three cards whole; the pointer picks one out; a click, → → Enter, and 1 each choose; m makes their own; Esc goes back.
- **custom:** a click on Orc and ↓ in Class call `pickOwn`; the preview is the fixture card; Take this one.
- **backstory:** typing, paragraphs and the box scrolling; Draft one; a proposal row shows "A draft: not in your box until you take it", with Keep mine and Use this; an issues row shows "The lore check: 1 of 1", with Rewrite it myself and Accept the fix; a rewriting row shows "Rewrite this so it fits" over the box.
- **created:** the intro, the sheet, the unchecked line; Enter calls `begin`; r calls `chooseAgain`.
- **the prototype's other creation cases** (`screens-check.tsx:1100-1306`): a long fix shown whole; a fix too long to show isn't taken, and the screen says why; the box's word count; Done on a story too long; the wheel in the box; the defaults' note when the GM is out of reach; a caster's spell DC in what their own build comes to.
- **the sheet:** the prototype's own checks (`screens-check.tsx:798-849`): a tab click turns to the spells; Burning Hands whole in the box; ← Back; ↓ Enter shows Fire Bolt; Esc three times.
- **the scene:** /sheet opens the overlay, Esc closes it.

### 4.5 The arc (`npm run arc`, F)

`hosts/arc.ts`: a stack on its own ports and the fake model; `play new --as "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier"` with no build (`rules.build`, as `flow.ts:31`); check 1: the sheet's build line is the engine's ("\<species\> \<class\> 3 (\<subclass\>), \<background\> background") and its status line starts "HP ". It prints "ok: the character is built by the rules engine (\<build\>: \<status\>)" and "skip" for checks 2-16 with the unit that turns each on. It runs in CI's e2e job.

### 4.6 The live run (`npm run live -- --creation`, F)

On `npm run dev` with real models, recorded to `v2/docs/live/v1-<date>.md` (as `src/app/smoke/creation-live.tsx` does for the prototype):
1. The create screen's three example concepts (Tamsin Vell, Brother Odo, Pell Marrow): each offer's cards, checked legal and of three classes, printed for a human to judge the fit.
2. Tamsin: card 1; the nephew backstory; at least one issue whose quote has "nephew"; accept; checked again; traits; made; `begin`; the opening; one line ("Sergeant, who found him?").
3. Each call's operation, latency and cost, and the total: about $0.03. It stops before passing $0.10.

---

## 5. Work packages

Branches: A `claude/v2-v1-contracts` from V0's tip; R, B, C, D from A (`-rules`, `-simulation`, `-ai`, `-client`); F integrates on `claude/v2-v1`, merging R, B, C, D in that order, and opens the one PR. After A merges into the branches, only F edits A's files; a package that needs something of A's writes a local helper and says so in its handoff, and F folds it in.

### A · contracts (one agent, about an hour; then F)

- **Owns:** `v2/vendor/**`; `shared/rules/types.ts`, `shim.ts` (+ test), `index.ts` (R's signatures, stubs throwing "not built"); `shared/creation/**`; the deltas to `shared/protocol/{ai,keys,refusals}.ts` and `shared/scene/files.ts`; `ai/docs/backstory.ts` and `ai/docs/types.ts` (§3.8); `campaigns/caerwyn/{campaign.json,builds.json}`; `simulation/src/schema.ts`, `index.ts`, `moves/move.ts` (`JobOwner`), `stubs.ts` (the new reducers refusing `not_built`); `simulation/tsconfig.json` (`resolveJsonModule`); the imports tests (`shared` may import `vendor`'s typings as types; `ai` may import `vendor`); `client/module_bindings/`.
- **Builds against:** this document; V0's merged code.
- **Done when:** `npm run check` passes; `npm run simulation:build` succeeds; a scratch publish answers `start_creation` with `not_built`; a scratch probe module (not committed) imports the shim, the module-ready bundle and the pack, and a reducer runs `createEngine` and an ability check; the bundle loads in plain node with the shim; at the repo root `npm run typecheck`, `npm test` and `npm run build:web` pass.
- **Must not touch:** the prototype's `src/`; any other file in `simulation/`, `ai/`, `client/`.

### R · the rules (one agent)

- **Owns:** `shared/rules/{engine,character,builds,spells}.ts` and their tests; the recorder (`tools/v2/record-v1-golden.mts`) and everything it writes (`shared/rules/golden/`, `ai/rules/golden/`, `ai/gm/golden/hanged-clerk-backstory/`, `client/check/fixtures/`).
- **Order:** the recorder first; then `character.ts` (`createCharacter`, `sheetData`, `sheetRows`' parts, `rollFor`, `comeTo`, `carryGear`), which B needs first, within an hour; then `builds.ts` and `spells.ts`.
- **Builds against:** A's types and shim; §2.3's line ranges.
- **Done when:** §4.1's rules tests pass in node.
- **Must not touch:** `simulation/`, `ai/` and `client/` but the golden and fixture folders.

### B · the simulation (one agent)

- **Owns:** `simulation/src/**` but A's files: `creation/*.ts` (the moves, the owner, `make.ts`), `rules/{load,session}.ts`, `games/{create,delete}.ts`, `views.ts` (`my_creation`, `my_games`), and the edits to V0's `context.ts`, `jobs.ts`, `moves/open-scene.ts`, `moves/say.ts`, `moves/new-game.ts`, `moves/join-game.ts`, `world/place.ts`, `world/rows-io.ts`, `install.ts`, `lifecycle.ts`, `host/memory.ts`; its tests.
- **Builds against:** A's schema and types; R's functions, merged from R's branch once its first part lands (stubs until then).
- **Done when:** §4.1's simulation tests pass on the memory host; a scratch publish plays creation against a stand-in AI server (canned JSON for both new endpoints) to made, and `begin` opens the scene; the module's log shows `makeCharacter`'s and a check's times.
- **Must not touch:** `shared/`, `ai/`, `client/`, `hosts/`.

### C · the AI service (one agent)

- **Owns:** `ai/rules/**` but `golden/` (the loader, `builds.ts`, its tests and parity test); `ai/service/endpoints/{characters,backstories}.ts`; `ai/service/budget.ts`; the edits to `ai/service/{server,stores,folder-stores,campaigns,config,context}.ts`, `endpoints/{open,canned}.ts`, `ai/gm/view.ts`, `ai/gm/parity.test.ts` (the backstory session); `ai/Containerfile`; `hosts/ai.ts`.
- **Builds against:** A's protocol and `shared/creation`; R's `shared/rules`; V0's server, seam and stores.
- **Done when:** §4.1's AI tests and §4.2's parity pass; `npm run ai` with `KM_AI_GM=canned` answers both endpoints; the image builds with `vendor/` and answers `/v1/characters`; the repo root's checks pass.
- **Must not touch:** `shared/`, `simulation/`, `client/`, other hosts.

### D · the client (one agent)

- **Owns:** `client/**` but the bindings and fixtures; `hosts/client.tsx`, `hosts/play.ts`.
- **Builds against:** the bindings; `shared/rules/types.ts` and `shared/creation` (types and the moved helpers only: the client never loads the engine); R's fixtures; §3.10.
- **Done when:** §4.1's client tests and §4.4's screen check pass; `npm run client -- --demo` walks the title and creation's screens on fixture rows; once B has published, `play builds`, `new`, `sheet` and `games` run against a scratch stack with B's stand-in AI.
- **Must not touch:** anything else.

### F · integration (A's agent)

- **Owns:** `hosts/arc.ts` and its script; `hosts/e2e.ts`, `hosts/live-run.ts`; `hosts/dev.ts`, `hosts/dev/**` (`KM_AI_DAILY_USD` passed on; the screen's line "Budget $0.12 of $5.00 today"); `hosts/doctor.ts` (the budget); `hosts/campaign.ts` (§3.9's checks); `.github/workflows/v2.yml` (arc in the e2e job); `docs/live/`; `v2/README.md` ("What you can play") and the READMEs the packages touched; every copied file's header (its source path at `44c6d4a` and the edits); after merging, any file, to make the packages meet; the bindings regenerated.
- **Done when:** `npm run check`, `npm run e2e` (here, namespace mode, and in CI, host mode) and `npm run arc` pass; the live run is recorded under $0.10; CI's check, e2e and container jobs and the prototype's `check.yml` are green; the PR's description is §1.

---

## 6. Risks, and what V1 leans on in V0

### 6.1 Risks

- **Reducer time.** Engine work holds every transaction up, stream posts included. A check is cached to milliseconds, but the first on each of 16 procedure isolates loads its campaign (about 70 ms). `makeCharacter` is once a game, 100-250 ms; past 250 ms, `data` goes to a follow-up reducer (§3.6). §4.3's C5 measures it.
- **The shim.** Replacing the global `Date` in a module is untried. If the module's runtime objects, the shim pins the ids only, and the clock stays the transaction's, which in a reducer starts at `ctx.timestamp` anyway (spacetime.md §4.9); the test that compares two serialized campaigns then masks the events' `at`.
- **The module-ready bundle was lost** in the 16 Oct reboot (the spike's folder has only the original). It's made again by two documented edits and proven by A's probe; `NODE_ENV` must be replaced in exactly five places.
- **Production immer.** The module's copy runs the engine's immer in production mode, the prototype in development. R's golden sheets and checks catch any difference.
- **Shared code.** `backstory.ts` and the moved helpers are the prototype's too; its checks run on the PR.
- **The flow is long:** 19 new reducers, and `rev` and `busy` decide which answers land. The memory-host tests walk every path; the screen check every screen.
- **Two places run the engine.** A card must be what the game makes (`builds.test.ts:145`); both run one copy of `shared/rules` on one vendored bundle, and the e2e compares a card with the sheet made from it.
- **`my_games` reads several tables,** so it's recomputed for its subscribers when scenes change: fine for one player; V16 measures it, and can keep `where` on the player row.
- **The `job` table's column types change,** so a dev database is wiped once on publish.
- **The ceiling is per ledger folder:** right for one AI service process; V17's hosted ledger replaces it.

### 6.2 What V1 leans on in V0, and what to do if it lands differently

| V0's contract | V1 leans on it for | If it changed |
|---|---|---|
| `builds.json`'s dumped sheets, read by `newGame` and `world/place.ts` | the ready-made path | replace the file and both readers anyway (§3.9) |
| The job loop's turn fields and its revision check (`jobs.ts`) | creation's jobs | if V0 already has an owner hook, use it; else add `JobOwner` with V0's behaviour as the default, its tests unchanged |
| `AiRequest` requiring `player` | creation's requests | if `player` became optional, drop `AiRequestBase` |
| `SheetRow` and `TurnView.player` without a backstory | the GM's brief | add the field wherever V0 builds `party[0]` and the view |
| The open's `ensurePlayerDoc` | the player's doc | write the backstory's doc wherever V0 writes the doc, before disclosure |
| `rollCheck` in the decide and settle commits | checks through the engine | call `rollFor` where V0 rolls; put `carryGear` after the outcome move, before `joinWorld` |
| `openScene`'s resolve building the place | gear from `rules_state`; `comeTo` | after the purse and gear go in |
| `createGame` inside `newGame` | `makeCharacter` | factor it out of `new-game.ts` if it's inline |
| `keyParts` and `KM_AI_FAULTS`' step names | e2e kills | teach both the creation steps |
| `startStack`, `fakeFetch`'s `byName` and `streamMs`, V0's golden format | e2e, arc, parity | adapt to what's there |
| The client's one-screen `App`, `SceneModel`, `connection.ts` | the screen switch | put `screenOf` where V0's `App` renders its screen |
| `gm_state` in typed columns (the override, as V0's schema has it) | nothing | none |

---

## 7. Departures from the plan and the design

| The plan (or CS) says | V1 does | Why |
|---|---|---|
| `rules_state` and `rules_log`, a snapshot every 50 events (CS §2) | one `rules_state` row a character, and a per-isolate cache of the loaded campaign | The engine's serialized campaign is its event log, and loading always replays it (no state is stored); the log was for Firestore's 1 MiB documents. The cache, not a log, makes a check fast |
| `POST /v1/characters` answers a `Build`; the simulation makes the character (CS §4) | it answers legal builds with their cards, made by the engine in the AI service; the simulation still makes the real character | The cards must be shown before choosing; three characters made in one commit would hold every transaction up for half a second; the prompt needs the pack's lists anyway |
| `POST /v1/backstories` with draft or check | four ops: draft, work, check, traits | The prototype makes four calls |
| The player's doc written at `begin` | written by the opening's request, before disclosure | The simulation keeps no documents; `begin` causes the opening, whose first step writes it: the same moment as `createSession` before `openScene` |
| `newGame({ campaign, name, concept })` starts the draft | `startCreation` and its moves; `newGame` keeps V0's ready-made signature | V0's paths, its e2e included, stay as they are |
| `begin` makes the character and opens the scene | the character is made when the backstory is settled; `begin` opens the scene | The prototype shows the sheet before setting off, and lets the player choose again |
| Levelling and resting at an opening wait for V7 | `comeTo` and `carryGear` come now | Without them the dice stream and the sheet drift from the prototype's for the same seed |
| The backstory screen's "(GM offline)" labels | dropped; the answer says the GM is offline | The client can't see whether the AI service has a model |
| `play new` without `--build` gives V0's ranger | the model picks one, as `qa new` does | The arc's check 1 is that path (`flow.ts:31`) |
| `qa new --backstory` goes on past issues it didn't fix | `play new` stops, and `--accept-fixes` accepts as the screens do | The moves have no "go on regardless": the screens don't |
| `chooseAgain` with no offer makes the character again (`game.ts:822`) | back to the concept | The prototype's screens can't reach that path |
| Watchers join any game (V0) | not before `begin` | There's nothing to watch while a character is made |

---

## 8. As built

V1 keeps to this blueprint, but for these departures, each with its reason. The packages' reports (A, R, B, C, D, F) and the PR give the full account.

### The contracts and the rules

| The blueprint says | V1 does | Why |
|---|---|---|
| `bad_concept`: 1-500 characters, its own words (§3.4) | V0's: 300 characters at most, "(Your character's concept needs to be 300 characters or fewer.)", for `start_creation` and `new_game` alike; an empty concept is filled with the prototype's default | V0's review landed the same code first. One code has one limit and one text |
| `withEngine` is in `shared/rules/engine.ts`, exported from `index.ts` (§3.6) | In `shared/rules/pin.ts`, which only the hosts import | It loads the shim, whose global `window` the SpacetimeDB SDK takes for a browser's (`withAutomaticReconnect` calls `window.addEventListener`); the client imports `index.ts`, which stays shim-free (a test holds it) |
| `event()`'s clock is pinned by the shim | An event the rules code makes is stamped with its own id's time | `shared/` may not read a clock; the ids carry the shim's pinned time already |
| The campaign cache is keyed by the exact string (§3.6) | Also: a check commits its events through the engine's own schema, and what it leaves is kept under its new string | Each check changed the string, so the next one missed and reloaded the whole campaign (137-148 ms for a wizard in the module); a test holds that what's kept is what loading would give |
| `sheetText` equals the prototype's (§4.1) | It reads the sheet's data, so two lines differ: a `Feats:` line, and languages named as the sheet names them ("Thieves' Cant") | The prototype's text came from the session; the row has only the data |
| `sheetData` carries the purse | The row's `data` has no purse or pockets; `pockets` is `pocketsOf` with the campaign's starting purse | `sheetData` isn't given the starting purse; the pockets change without the engine |
| A game's uid is `tx.uuid()` (§3.1) | `newUid`: the transaction's time in microseconds, then `tx.uuid()`'s randomness, as a UUID | The module's random ids repeat between transactions close in time (`new_game` hit a taken `game.uid` 4 times in 50). V0's `new_game` uses it too |
| The ready-made dwarf cleric starts at full HP | 24 of 27, as the prototype's `createCharacter` makes it | A dwarf's toughness raises the maximum, not the current; only the prototype's pregen session healed to full. Parity kept |

### The simulation

| The blueprint says | V1 does | Why |
|---|---|---|
| A creation step's plan is `{ step, identity, uid, rev, ask?, op?, text? }` (§3.5) | `{ step, identity, uid, rev }` | The think reads the rest from the row at that rev, in the same transaction, so the stored request is the same |
| The owner's `failed` clears busy and notes the words | Also back to the concept when the builds (or the model's pick) never came; and their own pick that was never made leaves no card (`take_own` is `not_now` until one is), as `game.ts:584` deletes it | The screen would otherwise wait on cards that don't exist; and Take this one would have taken the card of the picks before, under the lists' newer ones |
| A failed job is kept | A creation's is deleted; a turn's is kept for `retry_turn` | Nothing retries a creation's step but the player's next move |
| The job loop's revision check is at commit | `wanted` is asked first, before a retry or a failure, and the reaper and `dispatch_waiting` let go of what nobody wants | A creation the player has moved on from was otherwise asked again for ten minutes |
| `take_proposal`, `leave_proposal` and `rewrite_issue` refuse `not_now` (§3.3) | Also `creation_busy` while the GM works, as every move that moves the row on does but back and a new concept (which let go of it); and `draft_backstory`, `work_in_backstory` and `finish_backstory` take a draft or the check's issues off the box | Moving the row on drops the step's answer, and only the answer clears `busy`: a draft taken while its check ran left `busy` set with no job, so every move after it was refused for good, and the screen's spinner took every key |
| `lastPlayedAt` is written by `begin` and `continueGame` (§3.3) | Also by every line said, on the game's host | The prototype dates a game by its save, written after every turn: the title said "(1 h ago)" after an hour's play, and listed a game played a minute ago below one only begun |
| A 402 fails the move with the AI service's words (creation) | For a turn too: `turn.error` is the message | So `/retry` after the ceiling is raised finishes the turn, and the words are the game's |
| `makeCharacter` over 250 ms moves `data` to a follow-up reducer (§3.6) | It doesn't | After package R's cache fix the sheet is 3-34 ms on a warm isolate; what's left over 250 ms is a wizard's `createCharacter` (170-304 ms) and, for a character whose creation the cache can't keep (a rogue, whose class has no resources to reload), the sheet's load of its campaign (287 ms for a sage, whose Magic Initiate choices make the log long). A follow-up reducer for `data` wouldn't help the first; keeping creation's campaign for the sheet would help the second. Left for a later unit |
| Small choices the blueprint left open | `take_own` is `still_making` while busy, `not_now` with no card; `finish_backstory` and `skip_backstory` need a build chosen; `join_game`'s `not_begun` is for a new spectator only (the host is seated as before); `choose_again` clears the traits, the story kept; "the same name and concept" reuses an offer for `three` only, never a made creation's | Each as the prototype's screens behave, or because a made creation's game holds its uid |

### The AI service

| The blueprint says | V1 does | Why |
|---|---|---|
| `own`: an id off the lists is a refusal (§3.7) | Whatever `ownBuild` throws is, with the lists | The same picks would fail again: a 500 retried for ten minutes would help nobody. The prototype notes any error |
| `threeBuilds` as the prototype's | The three made one at a time, a turn of the event loop between | The engine is synchronous in the service: three cold builds held the event loop about 360 ms, which would stall other games' streams |
| The ceiling stops a think that may call a model | Never the canned GM, nor `own`'s step; a 402 stores nothing for its key | They call no model; `/retry` after the ceiling is raised should run anew |
| `Health.budget` | Always present | So the doctor and the dev host can read it |
| A creation's endpoints check their requests (§3.7) | `service/requests.ts` checks them with a scene's, before a kept answer or the ceiling is looked at; the endpoints take their ask or op from the same check | Past the ceiling, a creation's request it couldn't read was a 402 in the budget's words, a scene's a 400 |
| The engine loads on the first `/v1/characters` | The shim too | `hosts/local.ts` runs the pipeline beside `spacetimedb` in one process |
| A campaign PUT is V0's | It checks `creation` (each place's words a regular expression), else 400 | A broken block would otherwise surface only as a 500 at the first lore check |
| A ceiling's words: "($5.00)" | To the hundredth of a cent below a cent ("$0.0010") | `KM_AI_DAILY_USD=0.001` read as "$0.00" |

### The client

| The blueprint says | V1 does | Why |
|---|---|---|
| Three intents: title, creation, game (§3.10) | A fourth, `new`: the create screen until `start_creation` goes in | Without it New game dropped the player into an old creation's screen |
| The create screen before `start_creation`, or at step concept | Also at step `choose` with no offer, or `backstory` with no build chosen | A failed offer or pick: the row's note says why there, as the prototype went back to its create screen with the error |
| r on the created screen chooses again | Only when this creation made the seat's game, and it says "Start again" when there was no offer | `choose_again` without an offer goes back to the concept now |
| Their own build's lists are the engine's | The screen waits for them ("The rules engine lays out the SRD's…") | They come with the first `own` answer: the client never loads the engine |
| A refusal goes to the note line | On the cards, in the offer note's lines; and only on the screen it came on | The choose screen had no note line; a line refused in a scene isn't the title's to say after `/quit` |
| The title's Esc | Quits | The prototype's browser check went (the browser is V14's) |
| V0's TUI says when its game has gone from the server, on the status line | The title, which says why: "(The game's server no longer has that game: carry on another, or start a new one.)" | V1's client is a screen switch: a game whose seat goes falls back to the title |

### The hosts, the e2e and the checks

| The blueprint says | V1 does | Why |
|---|---|---|
| C3: the offer lands within 60 s (§4.3) | About 70 s | A creation step's deadline is its timeout plus 10 s: the reaper sends it again then, and the kept answer lands |
| C5: begin and each check under 100 ms | Printed, not held: begin 10-12 ms; checks 2-10 ms on a campaign the isolate had, 36-78 ms on one it hadn't, and 309-326 ms on one it hadn't with a sage background | A procedure isolate that hasn't seen a character's latest roll loads the campaign first, and a sage background's Magic Initiate choices make the log long. What the player would feel is held instead: another game's stream gapped 339 ms at most beside it over six runs. Warming each isolate's engine as it starts was tried and dropped: an isolate's start then took about 950 ms, and the first load was no faster |
| The e2e's steps C1-C6 in that order, before V0's last | After V0's ending, in the order C1 and C2, C3, C5, C6, C4 | C5 and C6 need a game that can still reply (V0's has ended), and C4 deletes it |
| `npm run arc` runs `play new` | The headless client's `new` in process, over the client's connection, on a stack of its own (3320 and 8807) | The same verb, without a child process to parse |
| The live run: about $0.03 | $0.0126 (20 calls) | The models' prices; the run is as specified |
| The dev host's Play lines are V0's | The title first: `npm run client -- --session <name>` | V1's way in |
| The dev host's `--delete-data=on-conflict` wipes a V0 database once, and says so (§3.1) | It also answers the CLI's prompt for it (`--yes=…,delete-data`, never `remote`), and reads the 2.12 CLI's words for a clear ("Proceeding with database clear…") | With no terminal to answer "this will DESTROY … ALL corresponding data", the publish was aborted, so a folder that had run V0 couldn't start V1; and the clear went unsaid |
| `npm run live` writes `docs/live/<unit>-<date>.md` | Never over a record without `--force`: a second run that day goes beside the first, and a rehearsal to `runs/live/` | V0's review found a rehearsal could replace the committed record; V1's run takes the same rule |

### Known limits

- **The fake model's lore check** answers by its schema's name, the same every time: given an issue (`KM_AI_FAKE`'s `byName.lore_check`), the check with the fixes in finds it again with its words gone, and Accept leads to Rewrite it myself. A limit of the stand-in, not the game; with real models the second check passes (the live run).
- **The ceiling is one ledger's** (§6.1), and `--fresh` empties it with the rest of the AI service's store.
