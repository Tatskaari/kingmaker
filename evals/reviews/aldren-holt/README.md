# Aldren seeks Holt

Source: `kingmaker-issue-report-2026-10-11T13-54-32-582Z.zip`, initial Aldren conversation
starting at 13:48 on 2026-10-11. The final player turn, binding ruling and reply are
transcribed exactly. Initial review physical evidence places Aldren at (62,18) in
Great Hall. The dump is later state: he subsequently asked several guards in the
Royal Back Hall where Holt was. The original activity explicitly said Holt's
location was unknown. Holt is in Entrance Hall in the dump and fresh fixture.

Reconstruction uses fresh authored world/lore, without later activities or memories,
with Aldren's captured initial position. Earlier small talk, player customisation,
and unrelated review events are omitted. The normal live conversation review policy
replays the fixed reply and runs attention/disclosure normally. No desired activity
is pre-seeded. This isolates the route handoff, not subsequent walking or dialogue.

Run `npm run eval:review -- --experiments aldren-holt --repeats 3 --concurrency 1`
with `OPENROUTER_API_KEY`. The route criterion checks the committed active
`current_goal` for `enter_entrance_hall` and Holt; physical-state checks that review
leaves the map unchanged. These narrow deterministic criteria do not grade every
semantic aspect of the promise or guarantee subsequent planner completion.

Baseline validation pending. This layer changes no production behavior.
