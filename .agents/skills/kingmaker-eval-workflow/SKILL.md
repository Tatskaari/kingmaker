---
name: kingmaker-eval-workflow
description: Reproduce Kingmaker game behavior in an eval, test a causal hypothesis with a temporary strategy against the game baseline, and promote a supported improvement through three reviewable PRs. Use for investigating game dumps, prompt or strategy regressions, and eval-driven engine changes.
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

Grade committed state and relevant missing changes, not just the model's claimed summary.
Include deterministic invariants where appropriate and Jev criteria for semantic quality.
Record baseline results, repeats, errors and artifact locations. A stochastic problem may
not fail every time; report its observed frequency rather than claiming a reliable repro.
Publish this scenario PR with concrete reproduction and QA steps before starting the fix.

## 3. Form a causal hypothesis

Inspect the recorded inputs, model calls, document operations and resulting state. Separate
observations from explanations. State the suspected cause, the smallest proposed change,
and which rubric criteria or observable behavior should improve if the hypothesis is right.
Do not infer a cause solely from the final score.

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
evidence does not support the change, refine the hypothesis or report that outcome instead
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
