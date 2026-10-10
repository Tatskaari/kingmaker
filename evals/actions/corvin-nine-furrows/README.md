# Corvin: confronting the Nine Furrows delegation

This `jev-action` case replays planner call 28 from
`kingmaker-issue-report-2026-10-09T17-51-26-118Z.zip`, reported as
“Corvin had an activity but didn't follow” on 9 October 2026. Corvin was in the
Great Hall at (58, 20). The player reported that Nine Furrows delegates said he
left humiliated and asked him to confront them. A successful persuasion ruling
instructed Corvin to confront them while treating the accusation as an unverified
report. His dialogue narrated crossing to them; physical movement had not occurred.

The active goal was to approach the delegation and obtain their answer. Call 28
selected `unable` (0.65 probability). The subsequent outcome review created a wait;
calls 50, 93, 99 and 103 all selected `continue`. The exported world is after that
failure, so it is not loaded as the initial state.

## Preserved evidence and expectations

`fixture.json` preserves call 28's state and questions verbatim: private lore,
activity, situation, map observations, offered actions and empty recent history.
It includes the commitment but neither the conversation transcript nor the court
briefing/delegation overview identifying the delegates. The captured overview
`Scenarios/Centennial Assembly/Delegations/Nine Furrows Delegation.md` names
Elinor, Oswin and Rowan. All three have talk actions in the failed request.
Their identity is used for grading only; it is not inserted into the model input.

The deterministic `navigation` criterion awards 1 for `talk_elinor`, `talk_oswin`
or `talk_rowan`, and 0 otherwise. Any of the three advances the requested
confrontation; no uniquely identified spokesman was established. Following someone
does not initiate that exchange. Waiting, abandoning the task, claiming completion
or approaching unrelated people earns no credit. This measures the intended game
outcome: `unable` may be reasonable given the incomplete input, so a low score
does not by itself establish a model reasoning error.

Concrete command objects were not captured. They are reconstructed from the offered
IDs/descriptions using the existing GameAction conventions: talk/follow target the
named actor, enter targets a room, door actions target the door, and item inspection
targets Corvin. Paths are empty because the eval resolves but does not execute a
command. These objects add no model evidence. The captured request supplies the
pre-decision state directly; no world is cloned or later wait seeded into it.

The raw dump, other runs, provider response metadata and credentials remain outside
the repository. No production context, transcript policy or disclosure behavior is
changed. This fixed-input baseline reproduces action selection, not progressive
disclosure, movement, the subsequent conversation or the entire wait loop. Future
prompt-builder changes will not automatically alter its frozen input. A candidate
context strategy requires a separate agreed experiment.

## Running

Set `OPENROUTER_API_KEY`, then run:

```sh
npm run eval:navigation -- --experiments corvin-nine-furrows --repeats 3 --concurrency 1
```

`--list` needs no credentials. The existing navigation runner and `workspace:eval`
CI task include this case with the shared game action strategy and no variants.
Provider errors remain execution errors and score zero.

## Recorded baseline

On 10 October 2026, three serial trials at revision `1720510` with
`typesafe/jev-1.13` all selected `unable`: 0/3 advancing actions, zero execution
or grading errors. Each recorded AI input matches the captured state and questions.
Local artifacts: `eval-output/2026-10-10T09-04-05.944Z-6b4dc237/`.
This is a small fixed-input reproduction, not a general action-selection accuracy
estimate or evidence that a full transcript is the appropriate remedy.

An initial launch before dependency installation failed before any model calls;
it is not included in these three trials.
