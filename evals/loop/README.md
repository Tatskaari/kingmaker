# The GM loop: evals/loop and src/eval/loop

Part of the [evals](../README.md). How to run it end to end is the `kingmaker-gm-loop` skill (`.agents/skills/kingmaker-gm-loop/SKILL.md`). This page is what the parts are and how they fit.

## What it is

A loop for improving the GM:

1. Blind persona testers play a scene.
2. Blind reviewers judge each game against one rubric.
3. Each flagged turn becomes a fixture. The eval replays it on the current engine, and on candidate variants, and judges it against the same rubric.
4. A new blind round confirms what the eval says.

Every finding is triaged by hand before anyone believes it. At each stage a report (HTML, published as an artifact) shows the results and every model call in full.

## What it owns

| path | what it is |
|---|---|
| `rubric.md` | The one rubric: five severities (penalties 1, 2, 4, 8, 16) and 22 checks in six groups (truth, the player's game, reveals and pacing, voices, dice, craft). Reviewers, the judge and the reports all key on its `#### \`id\`` headings. |
| `tester.md`, `reviewer.md`, `judge.md` | The blind tester's brief, the blind reviewer's, and the eval judge's instructions (the rubric goes in after them). |
| `personas.json` | The archetypes testers play (docs/QA.txt). |
| `truth/<scene>.md` | What a judge needs beyond the generated prep: the hidden facts, who knows what, what's public. |
| `cases/<id>/` | Cases, one moment each: `case.json` (the turn, the player's line, what went wrong, the reply as recorded, the criterion, the checks that decide pass or fail, provenance), `state.json`, `transcript.json`, `world.json`, `harness.json` (the co-GM's work), `lore/` (the session's memory notes as they stood), and a README of what was assumed. |
| `variants/<name>/` | Candidates: `variant.json` (description, approach, env) and a `prompts/` overlay (KM_PROMPTS_DIR). |
| `src/eval/loop/cli.ts` | `npm run loop`: every command (its usage text lists them). |
| `round.ts`, `play.ts`, `import.ts` | Rounds (neutral arm and game names), blind play over the scene harness (`KM_SCENE_ONLY` stops it at the scene's end), games imported from problem reports. |
| `review.ts` | Review packs, the rubric's check ids, and the check on a review (every quote in its turn's reply). |
| `fixture.ts` | Cutting a case from a session or report, and loading it back as a session. |
| `eval.ts`, `judge.ts` | `loop run` (a process per sample, the judge on the recorded reply too) and `loop rejudge`. |
| `triage.ts` | `triage.json`, what counts after it, and the worksheet. |
| `report.ts`, `eval-report.ts`, `html.ts` | The reports, and the call viewer (each call opened as its own transcript). |

Rounds and runs aren't checked in: they go under `KM_LOOP_DIR` (default `runs/loop`; the skill uses `~/git/kingmaker-scratch/loop`).

## How a case replays a turn (V1's rule)

A case keeps what play made and nothing the engine can make again. No captured prompt is kept: the GM's input is rebuilt by the current code from the live scene (`scenes/`), prompts (`prompts/`, or a variant's overlay) and lore (`lore/`), plus the case's files. So a change to any of them is tested, and a case doesn't go stale when a prompt changes.

- **What it keeps:** the session after the turn before, as a few files:
  - the scene's progress (`state.json`);
  - what the player saw (`transcript.json`);
  - the world (`world.json`);
  - the co-GM's notes, canon and patches, plus its results still waiting to land (`harness.json`);
  - the memory notes written before the turn (`lore/`).
- **What it drops:** diagnostics, and notes written on the turn or later, along with the index lines linking to them.
- **Co-GM mode (`harness`):**
  - `recorded` replays what the co-GM had written;
  - `fresh` runs today's co-GM on the fixture first, to test a co-GM change;
  - `none` leaves the co-GM out.
- **Dice:** sample 0 keeps the game's own seed, so it rolls what the game rolled. Variants share seeds sample for sample.

## How to test it

`npm test` covers it offline (src/eval/loop/*.test.ts): docs filtering, every case loading in each mode, the review check, triage. The live path is the skill's; a small check is one case:

```sh
npm run loop -- run --case hc-kell-page-leak --samples 2      # about $0.03
```
