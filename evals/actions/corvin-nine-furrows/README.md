# Corvin: confronting the Nine Furrows delegation

This `jev-action` case reproduces planner call 28 from
`kingmaker-issue-report-2026-10-09T17-51-26-118Z.zip` (hash in `fixture.json`),
reported as “Corvin had an activity but didn't follow” on 9 October 2026. Corvin was
in the Great Hall at (58, 20). The player reported that Nine Furrows delegates said he
left humiliated and asked him to confront them. A successful persuasion ruling
instructed Corvin to confront them while treating the accusation as an unverified
report. His dialogue narrated crossing to them; physical movement had not occurred.

The active goal was to approach the delegation and obtain their answer. Call 28
selected `unable` (0.65 probability). The subsequent outcome review created a wait;
calls 50, 93, 99 and 103 all selected `continue`.

## Fixture

The world is built by the engine, not replayed from captured prompt text:

- `loadPlayableWorld` creates a fresh game from source lore, map and conversation trees.
- `test_data/lore` is a vault-relative overlay holding only notes that differed at
  call 28: Corvin's `situation.md` and the active
  `activity-8284d99f-9d1b-4780-a488-099d435fb055.md`. Other Corvin and player notes
  matched source lore and come from it.
- `world.json` holds every actor position from the dump. Nobody moved between call
  28 and the export, and the distances match the captured request. The two court
  servants added to the game since then keep their fresh-game positions.
- `fixture.json` names the active activity, the expected talk targets and the source.

The exported `situation.md` gained a sentence from a later review (“The nearby
conversation faltered…”). The overlay uses the call-28 text from the captured request
instead. The later wait note, presentation change and wait pointer are excluded.

`planWorldAction` then builds the planner context, live progressive disclosure, the
offered actions and the Jev request with the game's own strategies, through the
headless `plannerMap` host. Planner prompt, lore and room-action changes therefore
reach this eval. Its input is no longer byte-identical to call 28.

## Expectations

The deterministic `navigation` criterion awards 1 when the planner selects a talk
action with Elinor, Oswin or Rowan, and 0 otherwise. The captured overview
`Scenarios/Centennial Assembly/Delegations/Nine Furrows Delegation.md` names those
three. Any of them advances the requested confrontation; no single spokesman was
established. Following someone does not start that exchange. Waiting, abandoning the
task, claiming completion or approaching unrelated people earns no credit. `unable`
may be reasonable when the delegates' identity is not disclosed, so a low score does
not by itself establish a model reasoning error.

Only one planning decision runs: this reproduces action selection, not movement, the
subsequent conversation or the wait loop.

## Running

Set `OPENROUTER_API_KEY`, then run:

```sh
npm run eval:navigation -- --experiments corvin-nine-furrows --repeats 3 --concurrency 1
```

`--list` needs no credentials. The navigation runner and `workspace:eval` CI task
include this case with the shared game strategies and no variants. Provider errors
remain execution errors and score zero. `tests/corvin-nine-furrows.test.ts` checks
the world setup and grading with a mocked AI.

## Recorded baselines

On 11 October 2026, three serial trials of the engine-built fixture at revision
`7418e46` with the game's default Jev settings all selected `unable` (probabilities
0.50–0.51): 0/3 advancing actions, zero execution or grading errors. Each recorded
request used the current planner template, disclosed the call-28 situation and
offered `talk_elinor`, `talk_oswin` and `talk_rowan`. Local artifacts:
`eval-output/2026-10-11T10-19-37.324Z-283a0cd7/`. This is a small reproduction, not
an accuracy estimate.

On 10 October 2026, three serial trials at revision `1720510` with
`typesafe/jev-1.13` replayed the frozen call-28 request (the previous fixture format).
All selected `unable`: 0/3 advancing actions, zero execution or grading errors.
That run predates the engine-built fixture and the current planner template, so it
is not directly comparable with later results.
