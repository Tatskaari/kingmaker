# Oswin's unsupported Kobold City journey

Source: `kingmaker-issue-report-2026-10-04T10-23-08-154Z.zip`, generated from preview
PR #394. `observed.json` records the source hash, review timestamp, actual activity
and 24 planner choices. These diagnostics are not injected into the replay.

The player invited Oswin to accompany Berz to Kobold City for fashion advice. A binding
major-success persuasion ruling secured enthusiastic acceptance. Conversation review
then activated a journey to the city, which has no destination or route in the playable
map. Planning alternated Entrance Hall / West Wing 24 times until the action limit.
The later outcome review created a wait for an observable onward route.

## Replay boundary and reconstruction

- `fixture.json` preserves the exact 19-message transcript sent to the first review call,
  including the earshot note and repeated binding GM rulings. Repetition is source evidence;
  it has not been deduplicated or generated afresh.
- Oswin's entry comes from the **first review request**, before review writes. It already
  contains the earlier in-conversation GM consultation's acceptance memory; this belongs
  in the input. The later travel activity, duplicated review notes and outcome wait do not.
- Oswin's presentation and Berz's player document come from the saved world. The recorded
  review reads the same presentation content; neither document is changed by the observed
  review. Derived links are rebuilt by the current document graph.
- Oswin's Great Hall position is recorded in the review request. Berz's Great Hall position
  comes from the final snapshot (assumed unchanged during NPC travel).
- All other documents, actors and map features come from the current authored playable
  world. This is a minimal review reconstruction, not an exact restoration of the whole
  historical save. No save migration or production strategy change is included.

The rubric should reward remembering and honoring the agreement while keeping immediate
intent executable within the current map. Supported local preparation or deferral is valid;
claiming completed travel, inventing a route, or turning acceptance into a direct off-map
journey is not. Lack of a playable destination does not mean the city cannot exist in lore.

Run `OPENROUTER_API_KEY=… npm run eval:review -- --experiments oswin-kobold-city --repeats 3`.
This exercises conversation review and grades its document/intent output. It does **not**
execute the historical 24-step movement loop; use `observed.json` to inspect that evidence.

## Initial baseline findings

Three live baseline repeats on 2026-10-04 all produced active intent involving the
unsupported journey. The original broad intent criterion passed these outputs, so the
criterion now explicitly considers every step of `current_goal` and `success_criteria`:
local preparation cannot excuse a later requirement to set out for an unsupported
destination. The scorer also receives the active activity/wait documents explicitly.

Calibration with the revised rubric rejected the captured bad activity (0.99 fail
probability) and accepted a local conversation with travel explicitly deferred until a
supported route exists (0.98 pass probability). Regrading the same three runtime
recordings then failed intent in all three. These are three generation runs followed by
regrading, not six independent runs; grader probabilities are not statistical confidence.

Working hypothesis: review promotes a future promise into immediate travel without
grounding it in available destinations. A subsequent comparison should test that boundary
while preserving the binding agreement and keeping this fixture and rubric fixed.

## Deferred-promise framing comparison

The user-authored candidate distinguishes immediate commitments from future promises,
asks whether an action is actionable in the world, and encourages remembering future
agreements for later conversations. Its world-editing qualification remains “if it helps
tell a fun and surprising story.” Only spelling and grammar were corrected.

Three fresh repeats per configuration on both cases completed without execution or judge
errors. On Kobold City, both versions scored 57.1%, with coverage passing 3/3 and intent
failing 3/3. The candidate shifted the output toward preparation, but still assigned an
active preparation task in all three runs rather than simply retaining a future objective.
The recorded AI requests confirm that only candidate runs used the changed paragraph.

Across both cases, the baseline scored 71.4% and the candidate 66.7%. Both still assigned
immediate parlour travel in the control case, but the judge failed intent for all six
parlour outputs. That control score warrants inspection before interpreting it as evidence
of a travel regression. These small samples do not establish a general improvement or
regression. No candidate has been promoted. Discuss the next hypothesis with the user.

`deferred-promises-results.json` retains scores and resulting activity definitions for all
12 trials, the source revision and artifact directory name. Complete docs/AI recordings
remain in the ignored `eval-output/deferred-promises/` directory on the machine that ran it.
