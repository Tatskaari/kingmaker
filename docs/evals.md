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
