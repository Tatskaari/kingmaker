---
name: kingmaker-gm-loop
description: Run Kingmaker's GM improvement loop on the game - blind persona testers play its scenes on a dev stack, blind reviewers judge each game against the rubric, I triage every finding and publish a report. Use when asked to QA the GM or the scenes, run a QA round, compare two builds of the game blind, or see how the GM handles players the prep didn't plan for. The cases, fixtures and evals half (turning a flagged turn into an eval case and iterating the GM against it) isn't ported to the game yet.
---

# The GM improvement loop, on the game

```
 1 QA round            2 blind review         3 cases + eval          4 iterate the GM          5 repeat
 persona testers  →    reviewer per game  →   flagged turn → case  →  variants vs baseline  →   a new round
 play blind arms       rubric findings        (not ported yet)        (not ported yet)          confirms blind
        └──── report ──────┘ (triaged, published)
```

Everything runs through `npm run loop -- <command>` (hosts/loop.ts; the parts are qa/loop, and qa/loop/README.md says what each is). The user steers from the published reports: publish each one as soon as it's built and triaged, say what it shows in a few lines, and keep going unless they redirect.

Steps 1 and 2 are the game's. Steps 3 to 5 (cases cut from a flagged turn, the eval that replays them on candidate GMs, iterating until the eval improves) were built on the prototype (draft PR #663, branch `claude/gm-loop`: `src/eval/loop`, `evals/loop/cases`) and aren't ported yet: until they are, a finding worth chasing is chased by reading its turn's calls in the report and changing the game, then confirmed by another round (step 1) with the change as an arm.

## Ground rules

- **Plan before fan-out.** A round is games × two Claude agents each (a tester and a reviewer), and real models. Rounds of up to 8 games and 20 turns, on baseline plus at most one candidate, are pre-approved: state the plan in a line (the scenes and how many games each, the arms, the personas, the max turns, the agents) and launch. Anything bigger needs a yes first. For scale: on the prototype, 8 games of 20 turns took about 12 minutes, 1M agent tokens and $0.20 a game on OpenRouter. On the game (2026-10-17, real models), a start and two lines in the hanged clerk cost $0.020 in 40 calls: the character and the opening about $0.004, and a turn about $0.008 with its background memory reviews (6 to 10 s), so a 20-turn game is about $0.17. A later scene's game costs more, since every scene before it opens and crosses its boundary first: starting on the Drowned Rat cost $0.012 and took 30 s on real models, and the King's morning, three boundaries on, took 31 s on the fake.
- **Triage every finding before you show it.** The blind reviewers are fallible. Read each finding against the reply, the rubric's check and the truth behind the screen (the pack has it), and write the round's `triage.json`: keep (why, in plain words; adjust the severity if needed) or discard (why). The report shows your why first. An untriaged report isn't finished.
- **Verify by reading, not by score.** Open the calls of a flagged turn in the report (each call is its own full transcript, a part unchanged since the last call of its kind folded, a changed one diffed). Find the call where it goes wrong before you form a hypothesis.
- **Blind means blind.** Testers and reviewers see neutral names (k1, g03) and nothing of the build. Never tell them the arms, the hypothesis or what you're hunting for, and never hand them anything from runs/ but their own brief and pack.
- Work in a worktree for any change. Testers play from the checkout you run the loop in: leave its tree alone while a round runs.

## Setup

```sh
npm run loop -- help
npm run loop -- stack up                 # real models; --fake for the fake model (plumbing only: it plays the yard's golden replies wherever a scene is)
npm run loop -- stack status
```

- **The stack.** `stack up` runs the dev host in the background in `runs/loop-stack`, on ports 3330 and 8817, so it never meets a dev stack someone is playing on (3300), the e2e (3310) or the arc (3320). It's namespace mode unless 11.0.0.1 is on this machine (hosts/dev/README.md). `stack down` stops it when the round is played. A round can play on any stack instead: `--stack runs/dev` for one `npm run dev` brought up.
- **The key and the money.** `OPENROUTER_API_KEY` or `~/secrets/kingmaker-dev-openrouter.txt`. Set `KM_AI_DAILY_USD` before `stack up` to cap the day's spend (the AI service refuses a model call past it, in the game's words, and the loop stops that game). The key has an in-flight spending cap: several games at once hit it (HTTP 402 `in_flight_budget_exhausted`) for half a minute or so. The game's module retries the calls by itself, the loop waits on a busy turn a backoff at a time, and each wait and each 402 is on the turn in the report: note which turns it touched before you triage them.
- **Run in a worktree, with KM_LOOP_DIR unset.** Rounds then go under the worktree's `runs/loop/` (gitignored), and every command the agents type is a plain `npm run -s loop -- …` with relative paths. Don't point KM_LOOP_DIR or a symlink outside the worktree: a background session's worktree guard refuses writes through it (the testers couldn't save their notes).
- **Archive when you're done.** `npm run loop -- archive <round>` copies it to `KM_LOOP_ARCHIVE` (the user's is `~/git/kingmaker-scratch/loop`), so it outlives the worktree. Archive after triage, and again if you re-triage.
- The Artifact tool publishes only files under the working directory, so copy a report to `runs/publish/<name>/` (gitignored) before publishing it.

## 1. A QA round

```sh
npm run loop -- round r1-1018 --scenes hanged-clerk:3,drowned-rat:2,heron-warehouse:2,kings-morning:1 \
  --personas thief,wizard,barbarian,tangent,absurd --max-turns 20
npm run loop -- round r2-1018 --scene hanged-clerk --personas thief,tangent,investigator,schemer \
  --arms baseline=runs/loop-stack,candidate=../<other worktree>/runs/loop-stack     # two builds, compared blind
npm run loop -- games r1-1018                      # the games, for the workflow (no arms shown)
```

- **Scenes.** `--scenes` gives each scene its number of games; `--scene` alone plays every persona on every arm (`--repeat` times). The scenes are the story's (the interludes aren't played). A later scene's game is reached the way the story reaches it: each scene before it opens, is ended for QA on its first good or mixed ending (`end_scene`, the dev stack's owner's), and crosses its real boundary, and the lead is walked to. The tester is told what their notebook says happened.
- **Arms** are stacks: `baseline` is the round's stack; a candidate is a stack of its own run from another checkout (`npm run loop -- stack up --root <its runs/loop-stack> --port 3340 --ai-port 8827` there), so any change, prompts or code, is an arm. Each arm gets a shuffled neutral name.
- **Personas** are in qa/loop/personas.json (thief, wizard, barbarian, tangent, investigator, schemer, terse, absurd). Include `tangent` or `absurd`: the user cares most about how the GM improvises off the prep. `--goal "..."` makes a goal-directed round (docs/QA.txt).

Then launch the saved workflow (after the user's yes, if the round is bigger than the pre-approved size):

```
Workflow({ name: "gm-qa-round", args: { round: "r1-1018", games: ["g01", "g02", …] } })
```

Each game is a pipeline:

- **A tester agent** gets its brief (`loop brief`) and plays: `loop start` makes the character from the persona's sentence (or its ready-made build, if the sentence won't take), turns the suggested lines off, takes the story to the scene and prints the opening; `loop say` plays a line and prints what answered it, as the player saw it (each speaker's name before their words, the dice, no notes or markup), and stops at the scene's end or the turn limit. Its notes go to `notes/<game>.md`.
- **A reviewer agent**, as soon as the game is played, builds its pack (`loop review-pack`: the reviewer's brief, the rubric, the truth behind the screen, which is the scene's truth sheet, its prep as the GM had it and what the story handed on to a later scene, then what the player was told and the scene turn by turn), writes `reviews/<game>.json`, and checks it with `loop review-check` (every quote must be in its turn's reply).

## 2. Triage and the round's report

```sh
npm run loop -- review-check r1-1018                # every review valid?
npm run loop -- triage r1-1018                      # the worksheet: each finding, its key, the turn it's on
# write runs/loop/r1-1018/triage.json: { "g03/2": { "verdict": "keep" | "discard", "why": "...", "severity"?: 3 } }
npm run loop -- report r1-1018                      # report/index.html + report/games/*.html
npm run loop -- archive r1-1018                     # keep it beyond this worktree
npm run loop -- stack down
```

Publish it: index.html as the page, `games/*.html` as files. Tell the user, in a few lines: the arms compared (penalty per 10 replies, the endings reached by grade, the ratings), the worst kept findings, and what you discarded and why.

## 3 to 5. Cases, the eval, iterating the GM (not ported yet)

On the prototype a flagged turn became a case (`loop case`, `loop fixture`: the session before the turn, V1-style, with a criterion), `loop run` replayed every case on baseline and candidate variants with a judge at Luna high, and a candidate that held up was confirmed by a new blind round. None of it is on the game yet: the game's state is SpacetimeDB's rows and the AI service's stores, not a session folder, so a case is cut differently, and the GM it replays is M2's two-part GM. Until it's ported, chase a finding by reading its calls, change the game in a worktree, and confirm with a round whose arms are the two stacks.

## Where things are

| what | where |
|---|---|
| the rubric (checks, severities, penalties 1/2/4/8/16) | qa/loop/rubric.md |
| the tester's and the reviewer's briefs | qa/loop/brief/tester.md, reviewer.md |
| personas | qa/loop/personas.json |
| truth sheets (what the prep doesn't spell out) | qa/loop/truth/<scene>.md (the hanged clerk's) |
| rounds and their triage | runs/loop/<round>/ (KM_LOOP_DIR), archived to KM_LOOP_ARCHIVE |
| the loop's stack | runs/loop-stack (its logs in logs/, its call logs in ai/games/<uid>/calls.jsonl) |
| the saved workflow | .claude/workflows/gm-qa-round.js |
| code | hosts/loop.ts (the commands), hosts/loop/stack.ts, qa/loop (round, play, reach, patience, record, scenes, prep, review, triage, calls, report, html) |

## Sharp edges

- **A scene ended for QA is forced:** no closing reply, its ending's effects applied as if played. What the notebook says is what the story knows; the reviewer's pack says which scenes were ended so.
- **The fake model** answers every scene with the yard's golden replies, so a fake round tests the loop's plumbing, never the GM.
- **The suggested lines are off and the notes on marked words aren't shown:** the testers write their own lines, and the review is of the GM's replies.
- **A turn cut off** (an agent's command timed out) goes on on the stack: the next `say` waits for it first and prints what answered it with the new answer; `transcript` shows where things stand.
- **Truth sheets matter:** the reviewers see the prep plus `qa/loop/truth/<scene>.md`. Keep a scene's sheet in step with its lore's public and private marking, and with M2's re-authored scenes (whose own `truth` the pack shows too), or reviewers will flag public facts as leaks.
