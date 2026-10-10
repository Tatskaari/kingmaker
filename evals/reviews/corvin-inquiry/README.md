# Corvin's separate Nine Furrows interviews

Synthetic review scenario derived from `kingmaker-issue-report-2026-10-10T13-45-02-342Z.zip`.
The fixture records the archive hash and original final reply. The replacement reply
is authored: Corvin agrees to speak to Elinor, Oswin and Rowan separately to establish
what was said about his academic record. It preserves his distinction between an
unverified allegation and evidence. This is not an observed model agreement.

The first exchange's saved warning is retained. The subsequent refusal memory and
index entry are excluded, because they resulted from the replaced reply. No activity
is seeded. Fresh worlds use source lore plus captured Corvin/player documents and
actor positions. Mechanics come from the source fixtures; no roll is reconstructed.
Other lore comes from the source revision. The old dialogue/disclosure/review traces
are not replayed as fresh model results.

Run `node --experimental-ffi --import tsx scripts/run-corvin-inquiry-eval.ts --repeats 3 --concurrency 1`
with `OPENROUTER_API_KEY`. The shared game conversation strategy receives the authored
reply, runs live attention/disclosure/reviews and commits through the real services.
The standard review rubric judges final documents; model traces are also recorded.
Inspect the active activity for all three names, separate interviews, uncertainty,
Corvin's motivation, unfinished progress and an executable first step. Require
memory of the commitment without inventing an answer or moving any actor.

This baseline layer targets #529 and does not include #547's tool-argument changes.
It reproduces the primary checkout's HEAD (`a5d4c68`) before the user's local edits.
Validation and live results are reported in the PR and follow-up comparison layer.
