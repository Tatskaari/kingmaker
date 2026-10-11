---
name: kingmaker-eval-workflow
description: Reproduce Kingmaker game behavior in an eval, develop a causal hypothesis with the user, compare a temporary strategy against the game baseline, and promote a supported improvement through three reviewable PRs. Use for investigating game dumps, prompt or strategy regressions, and eval-driven engine changes.
---

# Kingmaker eval workflow

Use a three-PR sequence: reproduce the scenario, compare a candidate strategy, then
promote the supported improvement and remove the temporary strategy. Keep the scenario
and rubric as regression coverage. Respect a request for only one stage; do not invent
an engine change when the user only asked for a reproduction.

Work in the active Kingmaker checkout. Read its `AGENTS.md` for worktree, GitHub Stacks,
early-publication and validation requirements, and `docs/evals.md` for the current eval
APIs. Paths below are relative to that checkout; do not depend on a particular worktree.

## 1. Start from an observed scenario

Use a game dump, transcript, model trace or reproducible player report. Identify the
observed problem and expected behavior. Retain the relevant pre-operation documents,
physical state, participants, intent and authoritative GM rulings. Remove credentials
and unrelated private material from checked-in fixtures.

A dump may contain state after the failure: distinguish observed state from reconstructed
preconditions. Record reconstruction assumptions. If an old save is incompatible, rebuild
the smallest faithful scenario in the current format; do not add save migrations. Never
seed the desired result, such as the activity that the review is supposed to create.

## 2. PR 1: recreate the scenario as a baseline eval

Add the fixture, repeatable initial-state construction, expected outcomes and marking
criteria. Exercise the actual engine strategy through the common eval framework. Start
with the game's shared baseline and no experimental variants. Avoid changing production
behavior in this PR.

Use `Experiment`/`RuntimeConfig` and the common runner/CLI in `packages/evals/src/`.
Construct fresh services per run; use supplied recorded dependencies for composed services,
including AI. Ordered document overlays live in `packages/service-tools/src/layered-docs.ts`.
For conversation review, reuse `createReviewExperiment` and the normal review hooks.

### Build fixtures from the engine

Build the initial state from source fixtures and let the game build model inputs. Do not
check in captured prompts, rendered request text, offered-action lists or whole world dumps.
A frozen request stops testing the game as soon as prompts, lore or actions change.
Follow `packages/evals/src/corvin-inquiry-case.ts`, `corvin-planner-experiment.ts` and
`corvin-nine-furrows-case.ts`:

- Start from `loadPlayableWorld(undefined, overlays)` in `scripts/lib/playable-world.ts`.
- Put each captured note that differs from source lore, using its captured vault path, under
  `evals/<kind>/<case>/test_data/lore/`. Include only those notes: character situation,
  activity, memories, player notes. Use the state just before the failure, not the dump's
  later edits; the captured request is often the best source for that text.
- Keep physical preconditions in a small `world.json`, such as actor positions keyed by
  instance ID and the player document. Apply them in `loadWorld` and point runtime intent
  (activity, wait) at overlay notes, then call `refreshDocumentGraph`.
- Keep case metadata in a small `fixture.json`: the overlay folder, the expected outcome,
  the observed failure and the source dump, its hash and call ID.
- Drive the real entry point (`planWorldAction`, conversation review, NPC exchange) with
  `defaultWorldStrategies` and `createScenarioServices`, using `plannerMap` for a headless
  host. Script only the boundary under test, such as character speech.
- Compare a prompt or lore candidate by adding a variant overlay with that one file
  (e.g. `test_data/lore/gm_prompts/...`). Do not fork the prompt in code.
- Test the world setup and grading with a mocked AI under `tests/`.
- In the README, record what was captured, what source lore supplies, any differences from
  the original game (new actors, later edits excluded) and the reconstruction assumptions.

Grade committed state and relevant missing changes, not just the model's claimed summary.
Include deterministic invariants where appropriate and Jev criteria for semantic quality.
Record baseline results, repeats, errors and artifact locations. A stochastic problem may
not fail every time; report its observed frequency rather than claiming a reliable repro.
Publish this scenario PR with concrete reproduction and QA steps before starting the fix.

## 3. Develop a causal hypothesis with the user

Inspect the recorded inputs, model calls, document operations and resulting state. Separate
observations from explanations. Present the evidence and plausible explanations to the user,
ask for their interpretation, and discuss the cause together. Suggestions are discussion
starters, not a diagnosis chosen on the user's behalf. Do not infer a cause solely from
the final score.

Agree with the user on the hypothesis, the smallest candidate change, and which rubric
criteria or observable behavior should improve before creating or running a candidate
strategy in PR 2. Wait for their response; a reproduction request alone does not authorize
choosing a hypothesis and proceeding to a fix. Continue independent evidence gathering
while discussing it. If the user has already selected a hypothesis and experiment, use
that agreement without asking again.

## 4. PR 2: compare a temporary strategy with the unchanged baseline

Add a named candidate variant that changes only the relevant setup/classify/resolve hooks
or explicitly identified service/document configuration. A strategy is the group; a hook is
one callback. Keep the production baseline unchanged so both implementations can run together.

Run both on the same scenario and reconstructed preconditions. Keep the rubric, judge and
unrelated settings fixed. Use repeated trials and the common comparison table; include
execution/judging failures and inspect document diffs and AI traces. Record any intentional
input differences from overlays. The CLI's CPU-count concurrency default is configurable
with `--concurrency`; keep comparisons under equivalent conditions.

Report the hypothesis, candidate change, per-criterion comparison and remaining uncertainty
in PR 2. A single successful run or tied scores do not establish an improvement. If the
evidence does not support the change, discuss revisions to the hypothesis with the user or report that outcome instead
of promoting it. If the rubric itself needs correction, rerun both sides under the revised
rubric rather than comparing incompatible scores.

## 5. PR 3: promote into the baseline and delete the candidate

Move the supported change into the shared game implementation so the game and eval baseline
receive it together. Delete the temporary strategy, its registration and candidate-only
assets. Keep the scenario, expectations, rubric and reusable comparison infrastructure.
The finished scenario normally runs baseline-only again; do not retain a second copy of
the accepted policy just for the eval.

Rerun the scenario against the updated baseline and perform the repository's required
checks. Compare with the recorded PR 1/PR 2 evidence, identifying revisions and settings.
Document the resulting behavior and any tradeoffs; do not claim live validation if only
mocked tests ran. Verify PR base/head order and report the PR links and actual results.
