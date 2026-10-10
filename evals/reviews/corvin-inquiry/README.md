# Corvin's separate Nine Furrows interviews

Synthetic review scenario derived from `kingmaker-issue-report-2026-10-10T13-45-02-342Z.zip`.
`source.json` records the archive hash and original final reply. The replacement reply
is authored: Corvin agrees to speak to Elinor, Oswin and Rowan separately to establish
what was said about his academic record. It preserves his distinction between an
unverified allegation and evidence. This is not an observed model agreement.

The first exchange's saved warning is retained. The subsequent refusal memory and
index entry are excluded, because they resulted from the replaced reply. No activity
is seeded. `fixture.json` contains a character reference, explicit progressive-disclosure paths
and messages. `docs_override` points at ordinary vault-relative Markdown under
`test_data/lore`; `world.json` holds physical starting positions. Fresh worlds use
source lore plus those captured Corvin/player notes and positions. Mechanics come from the source fixtures; no roll is reconstructed.
Other lore comes from the source revision. The old dialogue/disclosure/review traces
are not replayed as fresh model results.

Run `node --experimental-ffi --import tsx scripts/run-corvin-inquiry-eval.ts --repeats 3 --concurrency 1`
with `OPENROUTER_API_KEY`. The shared game conversation strategy receives the authored
reply, runs live attention/reviews and commits through the real services.
The standard review rubric judges final documents; model traces are also recorded.
The dump opened no extra documents in any of its four PD calls, so the fixture has
`docs: []`. Base character/private/memory-index notes still load through normal setup.
Both character and GM contexts use the fixed disclosed set; Jev does not choose new
documents during this prompt comparison. Named PD paths must be reachable through
the character's permitted lore graph. This helper represents one review boundary: PD
setup precedes the messages to review.
Inspect the active activity for all three names, separate interviews, uncertainty,
Corvin's motivation, unfinished progress and an executable first step. Require
memory of the commitment without inventing an answer or moving any actor.

This baseline layer targets #529 and does not include #547's tool-argument changes.
It reproduces the primary checkout's HEAD (`a5d4c68`) before the user's local edits.
The earlier smoke run reran PD and is not comparison evidence. Validation and fresh
live results are reported in the PR and follow-up comparison layer.

## Promoted prompt

The user's prompt now lives in the production `lore/gm_prompts/conversation/review/review-activity.md`.
The temporary candidate and its lore prompt override have been removed. The runner
uses the game baseline only. Captured character/player document overlays remain as
scenario preconditions. Activities contain structured handoff fields without the
originating conversation appended to their body.

The comparison below is historical evidence from before promotion.

## Comparison results — 2026-10-10

Three repeats per configuration at revision `4affd29`, with identical initial states,
activity tools and model settings (`openai/gpt-6-luna`, high reasoning). No fresh PD
calls. All six attention classifications chose deferred commitment; no execution or
judging errors. The exact candidate still matched the user's file after the run.

| Observed result | Source prompt | Local override |
| --- | --- | --- |
| Active inquiry assigned | 0/3 | 3/3 |
| All three interviewees retained in activity fields | 3/3 | 3/3 |
| Separate interviews retained | 3/3 | 3/3 |
| Shared judge total | 100% | 100% |

The source prompt used `activate:false` for “as soon as we finish here”, leaving
Corvin without an active task. The override activated the inquiry and used `status`
for motivation, uncertain allegations, individual interviews and current progress.
Each version named Elinor as the first contact; the override's current_goal still
included later interview steps, so it did not always restrict that field to one step.

The shared judge missed the inactive-intent difference: its total is not evidence
that both versions met the active-task expectation. The activation counts above are
read directly from committed runtime pointers. This is a small synthetic case, not
proof of broader improvement or successful planner execution. This comparison preceded promotion.

See `comparison-results.json` for all six activity outputs. Full local recordings:
`eval-output/2026-10-10T14-00-38.850Z-097ca83e/`. Validation passed all 571 tests,
TypeScript, contract lint, compilation and web build.

## Planner follow-through without the transcript

Run `node --experimental-ffi --import tsx scripts/run-corvin-planner-eval.ts --repeats 3 --concurrency 1 --timeout-ms 600000` with `OPENROUTER_API_KEY`.
Both Corvin runners are registered in `workspace:eval`.

`planner-activity.json` is the exact structured activity from working-tree repeat 1
in the historical comparison. The planner-only test seeds this **input**, not a
review result: the review eval above separately tests producing the activity.
No original dialogue is passed to the planner or subsequent GM reviews. Normal
scoped lore and live progressive disclosure remain available.

Jev chooses real actions. The headless host uses the game's room actions, route
validation, movement and PalaceMechanics; elapsed movement time advances instantly.
Other actors stay fixed at the captured positions. Each validated individual talk
runs the normal NPC-exchange resolver with scripted character speech; its normal
GM reviews must update progress/current_goal themselves. The fixture never supplies the next interviewee.
The three accounts are synthetic, not actual character-model responses. This tests
navigation, sequential handoff and continuation, not dialogue quality or truth finding.

At most 24 planner steps run. Coverage counts successful physical talk interactions;
repeated/unrelated interviews and premature wait/complete/unable/idle fail full
coverage. Inspect map interactions, AI requests, debug choices and committed activity
changes in trial JSON. A separate invariant scans all AI inputs for the original
exchange and transcript attachment. Model errors are reported separately by the
common runner. Rubric scores are measurements, not CI pass/fail thresholds.

## Promoted baseline and planner results — 2026-10-10

At revision `5de9b83`, three serial trials per runner, with no execution or judging
errors. The production prompt is the unchanged user snapshot recorded above.
The review baseline created an active task naming all three people in **3/3** runs;
all activity bodies were empty. The shared review judge scored 100% in all three,
with activation separately verified from committed pointers. Review artifacts:
`eval-output/2026-10-10T14-20-49.903Z-fd49e3b2/`.

| Planner repeat | Physically reached interviews | Subsequent navigation | Source transcript absent |
| --- | --- | --- | --- |
| 1 | Elinor, Oswin, Rowan | Entered Entrance Hall to reach Rowan (4 total actions) | Yes |
| 2 | Elinor, Oswin | Alternated back hall / Great Hall until the 24-step budget | Yes |
| 3 | Elinor, Oswin | Alternated back hall / Great Hall until the 24-step budget | Yes |

Full interview coverage was **1/3** runs. Mean target coverage was 77.8%; exactly
three distinct target interactions scored 33.3%; source-transcript exclusion scored
100%. The two failures retained a current goal to find Rowan but never reached him.
This demonstrates a remaining navigation/search failure; it does not establish that
removing the transcript caused it. No navigation policy was changed in this layer.
Planner artifacts: `eval-output/2026-10-10T14-20-49.868Z-5194f84e/`.

An earlier exploratory smoke run at `d553b82` used a task-outcome review instead of
the game's NPC-exchange boundary and is excluded. Final tests cover actual validated
arrival and premature-completion scoring. All 571 tests, TypeScript, contract lint,
compilation and web build passed via `proto run moon -- run workspace:check workspace:build`.
