# Background characters

A scenario character entry with `background: true` is shared lore with multiple independent runtime characters. Its `placements` list contains palace tile coordinates. Fresh-game construction validates the tiles and gives each body a stable `instanceId`; each body uses that instance ID as its runtime and map character ID. Transcripts, activities and waits are per instance; private lore, reviewed memories and audience permissions use the shared character identity.

The palace guard template is `Scenarios/Centennial Assembly/Characters/palace-guard/character.md`. It places ten identical brothers in pairs at the Entrance Hall, Great Hall, West Wing, East Wing and Royal Back Hall. The Great Hall pair stands behind and to either side of the king along the back wall. The hallway pairs flank doorway approaches, leaving thresholds and corridor centres clear. Voice and enduring characterization live in `Cast/Caerwyn/Palace Guards/private.md`. Add placements to the scenario entry to create more bodies; start a fresh game to load authored changes.

Each palace guard starts with a generated post activity and a per-instance routine in the saved world. Guards hold their assigned posts while things are quiet and can leave to investigate observed trouble. Movement, talk targets, hearing and action scheduling distinguish individual bodies. Guards may enter private rooms in the course of their duty. Unauthorized player entry into a private room emits an event; nearby guards receive only the detail their perception permits.

## Arrest

`conversation_actions: [arrest]` grants the character an `arrest` tool during player dialogue and guard-initiated conversation openings, after applicable disclosure and skill-check resolution. The character can reply normally or call the tool with empty arguments; there is no separate Jev arrest decision. Dialogue mentioning jail never executes the action. A tool call supplies a successful tool result and binding ruling before the character gives their final arrest line. Both model calls and the tool exchange appear in the dialogue debug trace; the host saves the jail state and completed transcript together only after a successful character reply.

Jail is a popup prototype, not a prison map. While jailed, player movement, doors, fixtures and new dialogue are blocked. The saved popup survives reloads. “Serve your time and return to the palace” clears jail and lets the normal conversation review preserve the guards' shared memory. Failed replies, cancellation and failed persistence do not leave a partial arrest.

## Headless QA

Use `game.act(...)` to open doors and `game.move(...)` to enter the Royal Bedchamber; `move` returns the resulting world event. Assess that event with `game.runtime.assessWorldEvent`, pass each reaction to `processPerceivedEvent`, then call `await game.advanceNpc("palace-guard-9")`. This explicitly drives the same planning, movement, review and conversation methods used by the browser worker. Inspect the returned actions, opening and jail state. Perception and model decisions remain live; do not seed an arrest activity or jail state when testing the break-in response.
