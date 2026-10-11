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
is pre-seeded. The review is followed by one real Jev planning decision, without executing movement or dialogue.

Run `npm run eval:review:locations -- --repeats 3 --concurrency 1`
with `OPENROUTER_API_KEY`. The route criterion checks that Jev selects
`enter_entrance_hall` after review; physical-state checks that review and planning
leave the map unchanged. Jev receives live NPC locations regardless of whether
the reviewer included navigation in `current_goal`. These narrow deterministic criteria do not grade every
semantic aspect of the promise or guarantee subsequent planner completion.

Historical results below used the old goal-text rubric, requiring an action ID
in `current_goal`. They are not directly comparable with the current next-action
rubric. The user requested the simpler shared context instead of prescribing goal wording.

Baseline at `3b98f5b`: route 0/3, physical-state 3/3, no execution errors.
Artifacts: `eval-output/2026-10-11T14-09-01.887Z-98a7a996/`.
The dedicated runner is registered in `workspace:eval`; its narrow rubric stays
separate from the broader conversation review suite. The final regression runs against the promoted game baseline only.


The temporary candidate added live NPC rooms and ordered `enter_<room>` actions
only to the focused activity-review prompt. The interleaved comparison (three
trials per configuration, concurrency 1) scored route 3/3 for the candidate versus
0/3 for game, with physical-state 3/3 for both and no execution errors. Committed
goals retained the unfinished order and directed Aldren to Holt in Entrance Hall.
See [comparison-results.json](comparison-results.json) for goals, revision and
artifact location. Both used the same scenario, model settings and rubric.
This narrow sample supports the handoff; it does not measure full quest completion.
The candidate hook and template were removed when promoted into the game prompt.

Post-promotion game check at `08e79de`: route 1/1, physical-state 1/1, no errors.
Artifacts: `eval-output/2026-10-11T14-15-57.056Z-12c617df/`.
The 29 focused navigation, prompt, conversation-strategy and lore-access tests,
workspace typecheck and contracts lint passed on the promoted implementation.
