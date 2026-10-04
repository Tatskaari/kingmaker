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
