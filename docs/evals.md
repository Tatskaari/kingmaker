# Engine experiments

Follow the [Kingmaker eval workflow skill](../.agents/skills/kingmaker-eval-workflow/SKILL.md)
for scenario reproduction, temporary strategy comparisons and promotion into the baseline.

An experiment supplies baseline and variant runtime configurations, `run(runtime, signal)`,
`summarise(recording)` and `score(recording, context)`. A strategy groups policy hooks;
a variant selects strategies and service factories. The framework constructs a fresh
runtime per trial, records services, scores evidence, saves artifacts and prints comparisons.

## Run conversation review

```sh
npm run eval:review -- --list
OPENROUTER_API_KEY=… npm run eval:review -- --repeats 3
```

`oswin-parlour` replays the transcript against fresh physical/document state using
only `game`, the default game strategy objects shared with the browser runtime.
Temporary variants can be added for a hypothesis-driven comparison, then removed
when the supported change is promoted into the game baseline. The scenario and rubric
remain as regression coverage; the framework still supports variant comparisons.

`oswin-kobold-city` reconstructs a review from a game dump where Oswin accepted a
fashion consultation in an off-map city and was assigned an immediate journey there.
It checks that the agreement survives without inventing executable travel. See the
[fixture notes](../evals/reviews/oswin-kobold-city/README.md) for reconstruction limits
and the recorded planner loop. Select it with `--experiments oswin-kobold-city`.

The old physical travel probe remains `npm run eval:review:handoff`; its existing
`REVIEW_EVAL_REPEATS` and `REVIEW_EVAL_OUTPUT_DIR` settings apply only to that command.

The common CLI accepts `--experiments`, `--variants`, `--repeats`, `--timeout-ms`,
`--output`, `--concurrency`, `--list` and `--help`. Concurrency defaults to Node’s
available CPU count (`os.availableParallelism()`); `--concurrency 1` restores serial runs.
Each experiment queues variants interleaved per repeat and runs up to that many complete
trials (execution, grading and artifact publication) concurrently. Experiments run in
sequence, so the limit is shared across the suite. Summaries and numbered artifacts
appear in completion order; each retains its variant and repeat. The library returns
trials in queue order. Recordings and services remain isolated per trial.
Listing/help make no model calls. SIGINT cancels the current phase and retains completed
artifacts. Hooks should honor the supplied abort signal; a timeout cannot forcibly stop
arbitrary JavaScript that ignores cancellation.

## Define another experiment

Import `Experiment`, `RuntimeConfig`, `runExperiment` from
`packages/evals/src/experiment.ts`, and `runEvalCli` from `packages/evals/src/cli.ts`.
A configuration's `configure()` runs afresh each time and returns strategy overrides
plus service factories. Factories receive already recorded dependencies:

```ts
configure() {
  return {
    strategies: { review: myReviewStrategy },
    services: {
      ai: () => makeAiService(),
      docs: () => makeFreshDocsService(),
      character: services => ({
        respond: (request, signal) => services.ai.responses(request, signal),
      }),
    },
  };
}
```

Use these supplied dependencies when composing services, rather than capturing raw peer
implementations or calling providers directly. The framework resolves factories once per
trial, detects dependency cycles and wraps every service, including runtime defaults.
Individual missing methods retain the runtime's explicit unimplemented-service errors.

`run` returns no result: observe services through `recording.getServiceRecord("docs")`
or `getCalls()`. Records contain invocation IDs, async parent IDs, detached arguments,
return values/errors and timing. When a scenario factory is provided, recordings also
include initial/final snapshots. Partial writes remain visible after execution failures.
The standalone `Recording.wrap(name, service)` lives in `packages/service-tools/src/recording.ts`.
Pass credentials as runner `secrets` so occurrences in arbitrary text are redacted;
credential-shaped object fields are always redacted. Service recording does not intercept
network calls that bypass the registered services.

## Documents and grading

`loadDocumentLayers(["lore", "evals/my-eval/test-data/variant/lore"])` loads vault-relative
Markdown and `properties.json` sidecars in order; later layers replace whole files.
`createLayeredDocumentServices(roots, buildWorld)` constructs real isolated document/scenario
services using the caller's world builder. Runtime writes never touch those source roots.
Review variants can provide `overlays`, which their case's `loadWorld(overlays)` applies.

Review grading includes committed document diffs, relevant starting documents, document
update calls and resulting intent pointers. Jev assesses grounding, coverage, knowledge,
intent, preservation and restraint. Physical-state preservation is checked deterministically.
`createJevScorer` is reusable for other rubrics: each judged criterion uses anchored accuracy levels:
0%, 25%, 50%, 75% and 100%, from fundamentally incorrect to fully correct. Partial credit
measures correctness and completeness, not judge confidence. Unscorable evidence is a
judging error, not a zero score. Level descriptions and probabilities remain in artifacts.
The physical-state preservation invariant remains a deterministic 0 or 1. The total is
a weighted mean of criterion scores, not a pass rate or a statistically calibrated accuracy.
The judge sees evidence and expectations, not configuration names. Judge model calls have
a separate recording. Keep rubric and judge settings fixed when comparing policies.

Artifacts under a unique `eval-output` subdirectory contain a manifest with source revision
and rubric, one JSON file per trial, and aggregate `results.json`. AI requests preserve model
and generation settings. Columns are rubric criteria; rows aggregate each variant across
repeats and selected experiments, sorted by weighted total, with baseline deltas. Combined
experiments must use identical rubrics. Execution failures score zero; missing judge results
leave a variant unranked. Error counts remain visible. Nonzero exit means execution/judging
failed; low rubric scores are comparison data, not an automatic CI failure threshold.

## Published history

The `Run evals` workflow runs `workspace:eval` on main pushes or manual dispatch.
A new run cancels any older running eval workflow, so landing a stack prioritizes the
latest commit. Model requests already sent may still incur charges; cancelled runs
may retain diagnostic artifacts but do not proceed to history publication.
Set the repository secret `OPENROUTER_EVAL_KEY`; CI maps it to `OPENROUTER_API_KEY`.
Register new framework runners as uncached Moon tasks in `workspace:eval`'s dependencies.
The legacy wait/handoff probes are not part of this suite.

Completed trials are retained even when execution or judging fails. The publisher stores
`evals/<experiment>/<commit>.json` (metadata, per-experiment comparison and trial scores),
`evals/<experiment>/index.json` (result filenames), and `evals/index.json` (experiment names)
on the data branch `gh-pages`. Full trial recordings remain in the workflow's `eval-results`
Actions artifact, subject to the repository's artifact retention policy. Pages JSON contains
only metadata, trial scores and aggregate comparisons; it excludes service recordings,
world snapshots and judge calls. Rerunning a commit replaces its result without duplicating
its index entry. Deploy GitHub Pages includes this history alongside the game and previews;
results are not committed to main. Concurrent preview writes are preserved by push retries.
Recordings use the framework's credential redaction and are published as public site data.

Open `evals/index.html` on the published site to select an experiment, graph its weighted
total or individual criteria across commits, and inspect a commit's variant breakdown.
Chart points are keyboard accessible and select the same detail table as the commit picker.
Missing scores create gaps; rubric changes break connecting lines. Scores JSON is linked from each commit. Download full recordings from the corresponding workflow run’s `eval-results` artifact. Until the first publication, the dashboard displays setup guidance.
## Gift review reproduction

`OPENROUTER_API_KEY=… npm run eval:review:gift -- --repeats 3` runs the baseline-only
`peregrine-gift` screenshot reconstruction. It adds an inventory ownership criterion to
the shared review rubric so a memory of giving a gift cannot substitute for a real item.
See [fixture assumptions and criteria](../evals/reviews/peregrine-gift/README.md).

## Responsive conversation attention

`npm run eval:attention -- --repeats 3` runs the CLI post-reply analysis hook against
18 fixed interactions; `--list` requires no credentials. It is registered in
`workspace:eval` for published history. The runner is baseline-only again after
promoting the responsive-world prompts; the temporary candidate has been removed.

Attention asks what the player expects the world to react to. Prompts cover immediate,
future and general commitments, improvised details, plot progress, narrated world
changes, conversational exchanges, relationship/knowledge changes and feasibility.
Unsupported player details are flagged unless explicitly denied, including hedging or
changing the subject. Focused GM guidance explains collaborative storytelling, continuity
and follow-through. Flags request review: they do not establish truth, execute actions,
transfer inventory or add objectives themselves.

The graduation case transcribes the user's screenshot. Its original request/disclosed
lore was unavailable, so minimal context is reconstructed without establishing shared
attendance. Fixed replies test classification, not the probability of generating a
reply. Other cases cover explicit denial, authoritative facts, indirect assent, future
promises, gifts/refused trades, narrated travel, forgiveness, greetings and binding GM
facts versus deception-induced belief. No world state is mutated.

The deterministic `attention` rubric checks named expected label choices, averaging
within each fixture. Missing optional labels count as unflagged. Execution errors score
zero and remain visible. This is classification accuracy over the stated expectations,
not prose quality, exhaustive false-positive measurement or world-update correctness.

### Historical comparisons

The first reproduction used a narrower acceptance rubric and treated noncommittal
responses as negative controls. The user then explicitly chose to flag unsupported
details unless denied. Expectations and rubric were updated for both configurations;
old and revised aggregate scores are not comparable.

Initial live baseline (2026-10-04, three repeats per case, Jev `typesafe/jev-1.13`):

| Case | Correct decisions |
| --- | --- |
| Observed graduation accommodation | 0/3 |
| Explicit acceptance | 3/3 |
| Rejected claim | 3/3 |
| Noncommittal reply | 3/3 |
| Lore-supported history | 3/3 |

The baseline missed reconciliation in all three observed-case trials, flagging only
`deferred_commitment`. It detected explicit acceptance via `improvised_detail`. The
aggregate was 12/15 (80%), with zero execution or judging errors. This small sample
reproduces the accommodation gap; it is not an estimate of general classifier accuracy.
Local full recordings: `eval-output/2026-10-04T20-16-02.548Z-0a0312b1/`.

Comparison on 2026-10-04 (three repeats for 16 cases, 48 trials/configuration): the
revised candidate scored 100% on expected choices versus 78.1% for unchanged `game`,
with no execution/judging errors. All 48 paired requests had identical input evidence.
Accommodation and noncommittal history, forgiveness, and GM deception-as-belief improved;
explicit denial, lore/GM-supported facts, greetings, future timing and narrated movement
passed the checked expectations. The first candidate scored 87.5% and regressed denial,
future feasibility and narrated movement; it was not promoted. The revised wording
clarified those boundaries before rerunning both sides.

Artifacts: initial comparison `eval-output/2026-10-04T20-44-17.530Z-3fb1e694/`;
revised comparison `eval-output/2026-10-04T20-45-59.594Z-8cc9cdc7/` (revision `1826c40`).
These are small fixed-transcript samples, not a general accuracy estimate. The rubric
checks named expectations, not all emitted labels: some extras, such as world/plot flags
on a blocked promise, remain possible with this deliberately broad attention policy.


Feasibility also supports `gms_discretion`: the GM can reconcile inventories by adding
an improvised item, transferring ownership or adjusting quantities, as well as editing
world notes and assigning objectives/waits. Missing inventory is not by itself a hard
blocker. Ordinary transfers of established possessions remain `possible`; explicit
constraints remain `impossible` unless a ruling overrides them. Two additional fixtures
distinguish an improvised wooden-bird gift from an established-key transfer.

## Eval types

Every `Experiment` declares a `type`: `conversation`, `review`, `jev-decision`, or
`jev-action`. Classify by the behavior exercised, not by which model grades it.
Review replay cases (including the gift case) use `review`; attention classification
cases use `jev-decision`. Add further categories to the shared `EvalType` definition.

The CLI saves `experimentTypes` in manifests and aggregate artifacts. Published
per-experiment results include a top-level `type`; `evals/types.json` maps experiment
names to types for the dashboard's Type filter. Existing result URLs and indexes stay
unchanged. Publication backfills missing types for experiments in that run, preserving
scores, dates and existing classifications. Unknown historical cases stay unclassified.
