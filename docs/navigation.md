# Palace navigation and interactions

The main game is the only browser entry point. `palace-map.ts` authors the tiled
floor mask, wall sprites and room regions; `palace-navigation.ts` supplies named
waypoints. These are shared map assets, not a separate prototype.

`court-agent.ts` enumerates currently reachable actions from the actor's saved
position. `court-map.ts` uses A* over walkable tiles, blocked by closed doors and
authored fixtures. There is no second graph or separate prototype object state.

Left-click walks and can redirect a walk. Right-click gathers ordered actions
from the tile's ground, doors, fixtures and characters. Ordinary actions are grey;
illegal actions are red. An interaction walks to its approach point before the
worker validates and applies the effect. Player doors choose the closest reachable
side; Jev receives explicit inside/outside choices. Closing an occupied doorway
is rejected.

Positions, doors, fixtures and item locations live in the saved scenario. Renderer
animation is visual; player arrivals, NPC tile steps and interactions increment
the world revision. Each NPC step rechecks its route against current doors and
fixtures. Stale plans, unreachable approaches and cancelled model calls cannot
apply effects.

NPCs use reachable named waypoints plus combined door, container, take and talk
actions. Talking to another NPC walks to an adjacent point, generates the
initiator's request, then asks the GM to resolve both participants' memories and
goals atomically. NPCs can also approach the player and open an interactive
conversation with their own first line and optional player replies. This does not
simulate the player or transfer items by narration.

One NPC runner executes in the Web Worker independently of player controls. Model
requests and outcome reviews do not block player movement or interactions. The map
receives incremental actor updates without rebuilding the screen. Choosing Talk
pauses the target before approaching it; paused goals can be resumed explicitly.
Completed tile steps remain saved when activity is paused.

Planner runs and automatic handoffs are bounded. Reloaded
active tasks and pending outcome reviews have explicit resume/review controls.
The debug inspector exposes the current state and recent model transcripts.

The Great Hall’s main floor is 12 × 13 tiles, with the entrance six rows farther
south than the original layout. New arrivals use the wider-spaced court placements
authored in the scenario. Use the existing `resetWorld()` development command to
apply the updated physical layout and placements to an existing save.

Activity review receives `npc_locations`, a Mustache template parameter in
`lore/gm_prompts/conversation/review/review-activity.md`. It lists every other
on-map NPC's current room and the shortest sequence of room-entry actions from
the reviewing character, for example `Marshal Garran Holt (holt): Entrance Hall
(walk via enter_entrance_hall)`. Shared cast instances retain their runtime IDs.
Jev receives the same `npc_locations` parameter in `world-action-instructions.md`.
Both callers build it from live world state. Jev uses the same projected actor
rooms as its observed map, including movement in progress. Every planning call refreshes the
locations and routes alongside the observed map, including retries after feedback;
execution does not depend on routes having been copied into `current_goal`.

Routes use authored room exits and assume open doors; they are room-level guidance,
not tile paths or permission to bypass locks, fixtures or access rules. Execution
still handles doors and replans on obstruction or changed NPC locations. Same-room
and disconnected targets are explicit. Location disclosure is unrestricted within
the current map for now; future visibility policy can filter this context at its
host-owned construction point in `activityNpcLocations`.
