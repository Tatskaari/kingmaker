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

## Local prompt comparison

Drop the candidate at `test_data/lore/gm_prompts/conversation/review/review-activity.md`.
The existing fixture's `docs_override` resolves that folder. The `working-tree`
variant substitutes only this prompt in the existing agent setup hook; `game` still
uses the source prompt from HEAD a5d4c68. No changes to production prompts or tools.
The checked-in candidate is the user's exact local prompt snapshot (SHA-256
`5ba847b7cb5f385509f03cd1d58c049406cc0f0584bc19f97b577d70e4df0fa4`).

Run the same CLI with `--repeats 3 --concurrency 1` to compare both. To run the
baseline alone, use `--variants game`. Both variants use identical transcript,
fixed disclosure, lore starting state, model settings, tools and scoring. Inspect
recorded `ai.responses` calls to verify the changed activity-purpose message.
Only the review/handoff is exercised; the planner does not perform the interviews.
