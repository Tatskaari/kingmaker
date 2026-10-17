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
| `truth/<scene>.md` | What a reviewer needs beyond the prep: the hidden facts, who knows what, what's public. Only the hanged clerk has one (the prototype loop's). |
| `paths.ts` | Where things are, and a round's folder. |
| `round.ts` | Rounds: the games dealt across the scenes asked for (`--scenes hanged-clerk:3,drowned-rat:2`), the personas and the arms, under shuffled neutral names. |
| `play.ts`, `reach.ts`, `patience.ts` | Blind play: `start` makes the character (the persona's sentence, else its ready-made build), turns the suggested lines off, takes the story to the game's scene and prints the opening; `say` plays a line and prints what answered it. A later scene is reached through every real boundary before it: each scene on the way is ended for QA on its first good or mixed ending (end_scene, the dev stack's owner's), and the lead walked to. A busy GM is waited on, a backoff at a time (the key's in-flight cap: HTTP 402), and each wait logged on the turn. |
| `record.ts` | A game's record (`games/<game>.json`): what its player saw, entry by entry, who said each spoken line by the name the player knew them by, and how each turn went. |
| `scenes.ts`, `prep.ts` | The campaign as the AI service loads it (its own loader, from the files the stack installed), the endings graded (the scene's `result`, or before M2 its kind), and the prep written out from the runtime scene, loosely, so the M2 format's truth, paths, roles and graded endings show when a scene has them. |
| `review.ts` | Review packs, the rubric's check ids, and the check on a review (every quote in its turn's reply, with or without the speakers' names). |
| `triage.ts` | `triage.json`, what counts after it, and the worksheet. |
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

`npm test` covers it offline (qa/**/*.test.ts): rounds and the scene mix, the record and its speakers, the prep through the AI service's loader (today's scenes and an M2-shaped one), quote checking and the pack, triage, the report's numbers, the call log by turn, and start, say and a later scene reached against the client's demo. The live path is the skill's; a small check on the fake model:

```sh
npm run loop -- stack up --fake
npm run loop -- round try --scenes hanged-clerk:1,drowned-rat:1 --max-turns 3
npm run loop -- start try g01 && npm run loop -- say try g01 "Sergeant, who found him?"
npm run loop -- stack down
```
