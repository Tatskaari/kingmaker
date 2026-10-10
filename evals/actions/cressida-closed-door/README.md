# Cressida: closed quarters door

This `jev-action` case replays call 11 at 00:18:33.341Z from
`kingmaker-issue-report-2026-10-10T00-19-07-125Z.zip` (10 October 2026).
Cressida had reached the Saltmere Drawing Room at (87, 11). Her assigned activity
was to run to her chamber before transforming; it did **not** contain the later
step-by-step route directions. The observed choice was `enter_palace_back_hall`,
back toward the East Wing. Later calls bounced between the Great and Entrance Halls.

`fixture.json` preserves the captured Jev request's state and questions verbatim,
including disclosed lore, the activity, room graph, local door state, action criteria
and recent history. No later directions or desired outcomes are inserted into the
model input. Expected/observed choices and provenance are grading metadata only.
The original dump remains outside the repository; credentials, other agent runs,
player saves and screenshots are not copied.

The dump did not retain concrete command objects at this boundary. Those are
reconstructed from fresh authored map state with Cressida at the captured position;
the complete action-ID set was checked against the captured criteria. Paths are
empty because this eval selects and resolves a command without executing movement.
These objects are not sent as extra model evidence.

The deterministic rubric awards 1 for `open_saltmere_quarters_door_0`, otherwise 0.
Opening that door advances the published route to Saltmere Back Hall and Cressida's
Chamber. Returning east, waiting, claiming completion or reporting inability earns
no credit. Provider errors are recorded as execution errors and score zero.

Run `npm run eval:navigation -- --repeats 3 --concurrency 1` with
`OPENROUTER_API_KEY` set. `--list` makes no model calls. Uses the common runner,
recorded AI service and game's shared default action strategy, with no variants.
This is a fixed single-decision regression, not a full trip or timer test. It freezes
the original prompt intentionally; future prompt-builder edits do not change it.

## Recorded baseline

On 10 October 2026, three serial live repeats with `typesafe/jev-1.13` all
selected `enter_palace_back_hall`: 0/3 correct, with no execution or grading
errors. This reproduces the observed mistake on this fixed input; it does not
estimate general navigation accuracy. Full local recordings:
`eval-output/2026-10-10T00-28-45.860Z-69d6fbdd/`.

An earlier harness attempt failed before any model call because the action strategy
was not registered. It is not included in these baseline results.
