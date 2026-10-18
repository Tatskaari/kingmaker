# The GM loop: qa/loop

A loop for improving the GM, on the game. How to run it end to end is the `kingmaker-gm-loop` skill ([.claude/skills/kingmaker-gm-loop/SKILL.md](../../.claude/skills/kingmaker-gm-loop/SKILL.md)). This page is what the parts are and how they fit.

It's the prototype's GM loop (draft PR #663, branch `claude/gm-loop`, `src/eval/loop` and `evals/loop` at 5f01806) ported to the game: its QA rounds, steps 1 and 2 of the skill. Its cases, fixtures and evals (steps 3 to 5) aren't ported yet.

## What a round is

1. Blind persona testers play the game's scenes as players, each game its own session and player on a dev stack, through the headless client's verbs.
2. Blind reviewers judge each game against one rubric, from a pack: the rubric, the truth behind the screen (the scene's truth sheet, its prep as the GM had it, what the story handed on), and the scene as the player saw it.
3. I triage every finding, and the report shows the arms side by side, the endings reached, every finding with my why first, and each turn's model calls in full.

Testers and reviewers see neutral names (k1, g03) and nothing of the build: blind means blind.

## What it owns

| path | what it is |
|---|---|
| `rubric.md` | The one rubric: five severities (penalties 1, 2, 4, 8, 16) and 22 checks in six groups. Reviewers and the report key on its `#### \`id\`` headings. The prototype loop's, as it was. |
| `brief/tester.md`, `brief/reviewer.md` | The blind tester's brief and the blind reviewer's. |
| `personas.json` | The archetypes testers play (docs/QA.txt): who, in a sentence (their character is made from it), how they play, and the ready-made build nearest them, for when the sentence won't make a character. |
| `truth/<scene>.md` | What a reviewer needs beyond the prep: what's public (the hook, what anyone can see, what the campaign's public lore lets anyone say, which the prep doesn't hold), what the player may know from the scenes before, what's held and who holds it. One for each scene a round can play: the hanged clerk's (the prototype loop's, brought in step with the re-authored scene), and the Rat's, the Heron's and the King's morning's, written from their scene files and the campaign's lore. The scene's own truth, cards and discoveries are the authority where they differ, and a test holds each sheet to naming its scene's discoveries. |
| `paths.ts` | Where things are, and a round's folder. |
| `round.ts` | Rounds: the games dealt across the scenes asked for (`--scenes hanged-clerk:3,drowned-rat:2`), the personas and the arms, under shuffled neutral names. |
| `play.ts`, `reach.ts`, `patience.ts` | Blind play: `start` makes the character (the persona's sentence, else its ready-made build), turns the suggested lines off, takes the story to the game's scene and prints the opening; `say` plays a line and prints what answered it, as the player saw it (a check the GM calls: the narration that sets it up, the dice line with how far the roll made or missed the DC, then the outcome that came up). A later scene is reached through every real boundary before it: each scene on the way is ended for QA on its first good or mixed ending by its `result` (end_scene, the dev stack's owner's), thorough: every discovery it can reach is reached first and what each is in taken into the player's hands, as a thorough player's game would have them, so the story owes nothing it carries on to the next scene and the player carries its things on, with whatever the ending gives; and the lead walked to. A busy GM is waited on, a backoff at a time (the key's in-flight cap: HTTP 402), and each wait logged on the turn. |
| `record.ts` | A game's record (`games/<game>.json`): what its player saw, entry by entry, who said each spoken line by the name the player knew them by, and how each turn went. |
| `scenes.ts`, `prep.ts` | The campaign as the AI service loads it (its own loader, from the .kmscene files the stack installed), the endings graded by their `result`, and the prep written out from the runtime scene in the two-part GM's order: the scene with what really happened and its clock, where it starts with each person's first role, the cards with why they're here, what never works on them and their role palette, the discoveries with their paths, the events with what they do if the scene stalls and who arrives, the endings with their result and closing, each route under where it goes as the GM read it (its cue, its dice, what it needs reached first), and the facts. |
| `review.ts` | Review packs, the rubric's check ids, and the check on a review (every quote in its turn's reply, with or without the speakers' names). |
| `triage.ts` | `triage.json`, what counts after it, and the worksheet. |
| `probe.ts` | The co-GM asked again on a round's own games with the code as it is now (`loop probe <round> <game> <turn>[-<turn>]`): the scene's bookkeeping on that turn rebuilt from the round's co-GM moves before it, its instructions, input and tools as coGm writes them, with the round's own transcript, roles and prep's head (the story so far) spliced in from the call log, on real models, a few tries a turn; each try's moves, and how many reached `--want` or kept off `--not`. It reads the round and writes nothing to it. Written for QA round qa1-1018's fixes to the co-GM's routes. QA round qa2-1018's added the turns the round's co-GM never saw: `--reply` asks the turn's reply again first (the mouthpiece's logged request, a closing's included, with the routes the rebuilt bookkeeping has open and no closing directive; a check it calls rolled on a d20, or set with `--band`) and the co-GM about it, with the turn before's transcript and roles, the player's line and the new reply; `--reply-text <file>` puts a reply of your own there instead (a moment the round never reached); `--drop <route>,…` leaves the round's moves on those routes out of the rebuilt bookkeeping (the bad ending a co-GM took the turn before); and `--role <id>` prints the role each try set for that person. QA round qa3-1018's added `--owe <discovery>,…`: those leads' names owed in the rebuilt bookkeeping, as if the co-GM before had been refused them (the round's code never was), so a reply asked again is told who names them (`owedDirective`, after the round's own directives); and each try prints the names it left owed. With `--mouthpiece` (QA round qa2-1018's fixes) it asks the mouthpiece again instead, `--arm before` as the round sent it, `--arm after` with this checkout's rules after the user's prompt and its per-turn note's parts made again from the cards, the cast and the bookkeeping (the stage, the routes, the details established, the world, the player's turn and the directives the round's, a closing's directive and, since QA round qa3-1018's fixes, a move to show made again), on a view rebuilt from the round (the bookkeeping from its co-GM moves, the transcript from the game's record, the world from the scene's place, the player in the area the round's world had them in); each try's narration as the model wrote it, its check with the five outcomes, whether a closing closed, and with `--log` each try as a line of JSON. Each arm is asked in the schema its instructions were written for (`roundSchema`: a round from before QA round qa3-1018's fixes in its own, the narration first), and its reply read in either. With nothing changed, after is the round's request byte for byte. |
| `calls.ts`, `report-data.ts`, `report.ts`, `html.ts` | The report: the stack's call log by each call's key, the numbers, and the pages with the call viewer (each call opened as its own transcript). |

The command line is [hosts/loop.ts](../../hosts/loop.ts) (`npm run loop -- help`), the composition root: qa/ reads no environment, and is handed the stack's connections, its owner's rows, its campaign and its call log. The background stack is [hosts/loop/stack.ts](../../hosts/loop/stack.ts).

## A round's folder

Rounds aren't checked in: they go under `KM_LOOP_DIR` (default `runs/loop`), and `loop archive` copies one to `KM_LOOP_ARCHIVE` to keep it.

```
runs/loop/<round>/
  round.json              the scenes, the arms (k1 → a stack), the games (g01 → arm, persona, scene)
  play/<game>.json        each game's session: the identity its player plays as
  games/<game>.json       what the game's player saw, turn by turn, and how it went
  notes/<game>.md         the tester's notes
  reviews/<game>.pack.md  what a blind reviewer reads
  reviews/<game>.json     the review
  calls/<game>.jsonl      the game's model calls, kept from its stack's log by the report
  triage.json             each finding kept or discarded, and why
  report/                 index.html and games/<game>.html
```

## The stack

The games are played on a dev stack: `npm run loop -- stack up [--fake]` runs the dev host in the background in `runs/loop-stack`, on ports 3330 and 8817 (so it never meets a dev stack being played on, the e2e or the arc), and `stack down` stops it. A round plays on that stack unless it's told another (`--stack runs/dev`, a stack `npm run dev` brought up; or `--arms baseline=runs/loop-stack,candidate=<another checkout's stack>` to compare two builds, each a stack of its own).

An arm is a stack, not a prompt overlay as the prototype's variants were: the game's AI service takes no overlay, and a stack from another worktree plays any change, prompts or code.

## How to test it

`npm test` covers it offline (qa/**/*.test.ts): rounds and the scene mix, the record and its speakers, the prep of every scene of the story through the AI service's loader, quote checking and the pack, the truth sheets (one per scene a round can play, each naming its scene's discoveries), triage, the report's numbers, the call log by turn, and start, say (a check among its answers) and a later scene reached against the client's demo (whose yard ends through the tests' own hanged clerk's endings). The live path is the skill's; a small check on the fake model:

```sh
npm run loop -- stack up --fake
npm run loop -- round try --scenes hanged-clerk:1,drowned-rat:1 --max-turns 3
npm run loop -- start try g01 && npm run loop -- say try g01 "Sergeant, who found him?"
npm run loop -- stack down
```
