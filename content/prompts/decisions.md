# Jev action policy

`courtAgentObservation` supplies the character's lore, relationships, objectives,
immediate goal, available notes, current surroundings and reachable actions.
`court-instructions.ts` contains the actual shared planner instructions.

Each Decisions API criterion is an action ID and description. Move actions target
named waypoints. Door, container and talk actions combine walking to an interaction
spot with the effect. Closed doors and fixtures block A* paths; illegal ownership
or room-access actions remain available and explicitly labelled.

Jev must choose an offered ID, complete, or unable. The runtime revalidates the
world revision, current goal, path and target before applying any action. After
termination, a separate model review uses the actual actions and outcome to choose
a concrete follow-up or leave the NPC idle.

There are no wake, room-search, give-item or night-turn actions. Searching means
interacting with live containers. Dialogue alone never changes physical state.
