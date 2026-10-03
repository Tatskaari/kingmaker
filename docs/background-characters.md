# Background characters

A scenario character entry with `background: true` is a reusable identity with multiple stationary bodies. Its `placements` list contains palace tile coordinates. Fresh-game construction validates the tiles and gives each body a stable `instanceId`; every body keeps the entry's character ID. The map targets individual bodies, while transcripts, private lore, reviewed memories and permissions use the shared identity.

The palace guard template is `Scenarios/Centennial Assembly/Characters/palace-guard/character.md`. It places ten identical brothers in pairs at the Entrance Hall, Great Hall, West Wing, East Wing and Royal Back Hall. The Great Hall pair stands behind and to either side of the king along the back wall. The hallway pairs flank doorway approaches, leaving thresholds and corridor centres clear. Voice and enduring characterization live in `Cast/Caerwyn/Palace Guards/private.md`. Add placements to the scenario entry to create more bodies; start a fresh game to load authored changes.

Background bodies stay at their posts. They do not run autonomous movement goals. Existing single-character observations select the body nearest the observer; player dialogue uses the nearby brother the player walked to. Paired bodies offer one talk action per shared identity to NPC planners, and hearing is deduplicated after checking each body's reachability. Actor resource generations cover all bodies in stable instance order.

## Arrest

`conversation_actions: [arrest]` grants the character the arrest action. After disclosure and skill-check resolution, a separate decision chooses `continue` or `arrest`. Dialogue mentioning jail never executes the action. The resolver supplies a binding ruling; the host saves the jail state and completed transcript together only after a successful character reply.

Jail is a popup prototype, not a prison map. While jailed, player movement, doors, fixtures and new dialogue are blocked. The saved popup survives reloads. “Serve your time and return to the palace” clears jail and lets the normal conversation review preserve the guards' shared memory. Failed replies, cancellation and failed persistence do not leave a partial arrest.
