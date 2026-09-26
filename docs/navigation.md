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
animation is visual; arrival/action commits increment the world revision. Stale
plans, unreachable approaches and cancelled model calls cannot apply effects.

NPCs use reachable named waypoints plus combined door, container, take and talk
actions. Talking to another NPC walks to an adjacent point, generates the
initiator's request, then asks the GM to resolve both participants' memories and
goals atomically. This does not simulate the player or transfer items by narration.

One NPC runs at a time. Planner runs and automatic handoffs are bounded. Reloaded
active tasks and pending outcome reviews have explicit resume/review controls.
The debug inspector exposes the current state and recent model transcripts.
