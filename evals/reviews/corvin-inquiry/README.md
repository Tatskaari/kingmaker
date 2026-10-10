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
