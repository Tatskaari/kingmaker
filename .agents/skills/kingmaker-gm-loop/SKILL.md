---
name: kingmaker-gm-loop
description: Run Kingmaker's GM improvement loop - blind persona testers play a scene, blind reviewers judge each game against the rubric, I triage and publish a report, failing turns become V1-style fixtures, the eval reproduces them, and GM variants (prompt overlays or code) iterate until the eval improves, then a new round confirms. Use when asked to QA or improve the GM, run a QA round, turn a playtest report into eval cases, or test a GM prompt or harness change.
---

# The GM improvement loop

```
 1 QA round           2 blind review        3 cases + eval          4 iterate the GM          5 repeat
 persona testers  →   reviewer per game  →  flagged turn → fixture → variants vs baseline  →  a new round
 play blind arms      rubric findings       judge sees the failure?  until the eval improves    confirms blind
        └──── report ──────┘ (triaged, published)  └──── report ─────────┘ (triaged, published)
```

Everything runs through `npm run loop -- <command>` (src/eval/loop, evals/loop/README.md). The user steers from the published reports: publish each one as soon as it's built and triaged, say what it shows in a few lines, and keep going unless they redirect.

## Ground rules

- **Plan before fan-out.** A round spawns two Claude agents per game. Before launching one, give the plan: scene, arms, personas, games, max turns, agents (2 × games), rough OpenRouter spend (about $0.03–0.10 a game for play, under $0.01 a review pack). Wait for a yes. Evals call no agents and cost cents (a turn about $0.005, a Luna-high judgement about $0.001–0.003), so run them without asking, but sparingly: Luna at high reasoning is the most expensive judge the user allows.
- **Triage every finding before you show it.** The judge and the blind reviewers are fallible. Read each finding against the reply, the criterion and the truth sheet, and write `triage.json` beside the run or round: keep (why, in plain words; adjust the severity if needed) or discard (why). The report's "why" column shows your words first. An untriaged report isn't finished.
- **Verify by reading, not by score.** Open the calls of a failing turn in the report's debug view (each call is its own transcript; changed parts are diffed against the last call of the same kind). Find the call where it goes wrong before you form a hypothesis.
- **Blind means blind.** Testers and reviewers see neutral names (k1, g03) and nothing of the build. Never tell them the arms, the hypothesis or what you're hunting for.
- **Don't fit the eval to the GM.** When a judge call is wrong, fix the criterion or the rubric (`loop rejudge` costs no GM calls), never the case's expectations to match what the GM happens to do.
- Work in a worktree for any change. Testers play from the checkout you run the loop in: leave its tree alone while a round runs.

## Setup

```sh
export KM_LOOP_DIR=~/git/kingmaker-scratch/loop     # rounds and eval runs live here (durable; /tmp is wiped on reboot)
npm run loop -- help
```

`OPENROUTER_API_KEY` or `~/secrets/kingmaker-dev-openrouter.txt` must be there. The Artifact tool publishes only files under the working directory, so copy a report to `runs/publish/<name>/` (gitignored) before publishing it.

## 1. A QA round

```sh
npm run loop -- round r1-1017 --scene hanged-clerk --variants baseline,<candidate> \
  --personas thief,wizard,barbarian,tangent --max-turns 20
npm run loop -- games r1-1017                      # the game ids, for the workflow
npm run loop -- import r1-1017 ~/Downloads/kingmaker-report-….json.gz   # optional: the user's own playtests
```

- **Variants** are `baseline` (the game as it is) and overlay folders in `evals/loop/variants/<name>/`: `variant.json` (`description`, optional `approach`, optional `env`) and an optional `prompts/` whose files replace `prompts/`'s. Each arm gets a shuffled neutral name.
- **Personas** are in `evals/loop/personas.json` (thief, wizard, barbarian, tangent, investigator, schemer, terse, absurd). Include `tangent` or `absurd`: the user cares most about how the GM improvises off the prep. `--goal "..."` makes a goal-directed round (docs/QA.txt).
- An imported game is its own arm, marked "not comparable": a different player and maybe a different build.

Then, after the user's yes, launch the saved workflow:

```
Workflow({ name: "gm-qa-round", args: { round: "r1-1017", games: ["g01", "g02", …], loopDir: "<KM_LOOP_DIR>" } })
```

Each game is a pipeline: a tester agent gets its brief (`loop brief`) and plays with `loop start` and `loop say`, which apply the arm's variant, strip the markup lines and stop at the scene's end or the turn limit. Its notes go to `notes/<game>.md`. As soon as a game is played, a reviewer agent builds its pack (`loop review-pack`: the reviewer brief, the rubric, the truth behind the screen, the scene as the player saw it), writes `reviews/<game>.json`, and checks it with `loop review-check` (every quote must be in its turn's reply).

## 2. Triage and the round report

```sh
npm run loop -- review-check r1-1017                # every review valid?
npm run loop -- triage r1-1017                      # the worksheet: each finding, its key, the turn it's on
# write $KM_LOOP_DIR/r1-1017/triage.json: { "g03/2": { "verdict": "keep" | "discard", "why": "...", "severity"?: 3 } }
npm run loop -- report r1-1017                      # report/index.html + report/games/*.html
```

Publish it: index.html as the page, `games/*.html` as files. Tell the user, in a few lines: the arms compared (penalty per 10 replies, scenes ended, ratings), the worst kept findings, and what you discarded and why. The report's "Make it a case" column has the command for each finding.

## 3. Cases: the flagged turn as a fixture

```sh
npm run loop -- case r1-1017 g03 2 --id hanged-clerk-knows-kell-page     # from a review's finding
npm run loop -- fixture <session-dir | report.json.gz> --turn 7 --id <id> --check knows --severity 5 --quote "…" --why "…"
```

A case (`evals/loop/cases/<id>/`) is the moment before the turn, built V1-style. The scene, prompts and lore load live, and the engine rebuilds every model input. The case keeps only what play made:

- `state.json` and `transcript.json`;
- `world.json`;
- `harness.json`, the co-GM's work, pinned;
- `lore/`, the session's memory notes as they stood (later notes left out);
- `case.json`.

No captured prompt is kept. Read the generated README.md: it lists what's undated or assumed.

Then write `case.json` by hand:

- **criterion:** what a good reply does here, as an outcome. Say what's fair for people to reason from, and fail stalling and withholding as well as the failure seen.
- **checks** and **failAt:** the rubric checks that decide pass or fail.
- **harness:**
  - `recorded`: the co-GM's notes as they were;
  - `fresh`: today's co-GM rewrites them before the turn, for co-GM changes;
  - `none`: isolates the GM.
- **memory:** `recorded` or `none`.

Then reproduce:

```sh
npm run loop -- run --case <id> --samples 5          # baseline, plus the judge on the recorded reply
npm run loop -- triage <run>                         # then write <run>/triage.json
npm run loop -- run-report <run>
```

- **The recorded reply must be caught.** If the judge passes it, the eval can't see the failure: sharpen the criterion or the rubric and `loop rejudge <run>` until it's caught. Check that the rejudge didn't start failing good replies.
- **Record how often baseline fails.** Sample 0 rolls the game's own dice. A stochastic failure may fail 1 in 5: report that rate, not "reproduced".
- Publish the run report, commit the case. `npm test` checks every case still loads.

## 4. Iterate the GM

Form a hypothesis from the calls, not the score. Open the failing turn's calls in the debug view and find what put it there: a decider's choice, a line in the GM's input, a co-GM note, a memory. Put the hypothesis in your summary, with the call that shows it, and go on unless the user steers.

Make the smallest candidate:

- **A prompt or instruction change:** a new variant folder with only the changed files.
- **A harness change** (code): make it on a branch. Run the same cases before and after, then `loop run-report <before-run> <after-run>` puts them side by side.

```sh
npm run loop -- run --variants baseline,<candidate> --samples 5    # every case, not only the target: regressions count
```

Triage, then compare. A candidate is better when:

- the target cases pass more often;
- no other case gets worse beyond noise;
- the recorded replies are still caught;
- the mean penalty drops.

One or two samples either way is noise at 5 samples, so read the replies. Iterate until it holds up, publishing each run's report.

## 5. Confirm and promote

Run a new QA round with arms `baseline,<candidate>` (step 1). Blind play is the real test: an eval can only see the turns it was built from.

If the candidate holds:

- **Promote:** copy its prompt files into `prompts/` (or land the code), delete the variant folder, and rerun the whole case suite on baseline.
- **Commit and PR:** open a PR whose body links the round and eval reports.
- **Carry on:** the new round's findings feed step 3.

## Where things are

| what | where |
|---|---|
| the rubric (checks, severities, penalties 1/2/4/8/16) | evals/loop/rubric.md |
| tester and reviewer briefs, the judge's | evals/loop/tester.md, reviewer.md, judge.md |
| personas | evals/loop/personas.json |
| truth sheets (what the prep doesn't spell out) | evals/loop/truth/<scene>.md |
| cases, variants | evals/loop/cases/, evals/loop/variants/ |
| rounds, eval runs, triage | $KM_LOOP_DIR/<round>/, $KM_LOOP_DIR/evals/<run>/ |
| the saved workflow | .claude/workflows/gm-qa-round.js |
| code | src/eval/loop (cli, round, play, review, report, fixture, eval, judge, triage, html) |

## Sharp edges

- **Use `loop run`, `run-report` and `sample`, not "eval":** Claude Code's sandbox reads a literal `eval` in a command as the shell's eval and refuses it.
- **A run that exits saying "work unfinished":** a model call never answered. Run it again; judge calls time out after four minutes (`KM_JUDGE_TIMEOUT_MS`).
- **A case's `state.json` is a SessionState minus a few fields:** a big change to SessionState can break old cases, and `npm test` will say so. Recut the case from its source with `loop fixture`. Don't migrate it.
- **Truth sheets matter:** the judge and reviewers see the prep plus `evals/loop/truth/<scene>.md`. Keep a scene's sheet in step with its lore's public/private marking, or the judge will flag public facts as leaks.
