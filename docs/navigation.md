# Palace navigation and doors

Open `/palace.html`, then select a waypoint in the sidebar or click its mint marker.
The character starts in the Great Hall. Grey markers are unreachable and omitted
from available actions. The graph overlay follows actual tile paths; gold shows
the active route. Reset cancels movement and restores the initial door states.

Seven two-tile doors guard the chambers, treasury, guest room, and hall connections.
Hall doors start open; private-room doors start closed. Each threshold has a waypoint
on either side. Walk to one, then right-click either door tile or use the Nearby doors
button to open/close it. Closed doors block both threshold tiles. Door interaction is
permitted only one cardinal tile away, never remotely, while moving, or from inside
the threshold itself. Closing a door inside a room removes routes out until reopened.

Try Royal door · outside → Open Royal door → Royal Bedchamber. To close the door
behind you, visit Royal door · inside and close it. The Agent observation panel shows
current door states and reachable move/open/close actions; no Jev calls are made.

`palace-navigation.ts` authors room/junction nodes. `palace-doors.ts` defines door
state and footprints, splits the relevant graph edges with approach nodes, derives
dynamic blockers, and validates interactions. `navigation.ts` runs four-neighbour
A* for each graph edge against tile collision plus closed-door blockers. Dijkstra
selects the shortest sequence of live edges. UI actions are regenerated after every
arrival or door change and revalidated at dispatch. Door rendering and hit-testing
use the same footprints as collision. Keyboard users can use the sidebar buttons.

The demo remains outside the map protobuf and narrative world engine. Door state
is in memory, resets on reload, and has no locks, keys, permissions or persistence.
Actors occupy a full tile: any intersecting solid layer blocks it. The PoC assumes
full graph knowledge and one character. Movement is exclusive except Reset;
future concurrent actors/blockers will require in-flight path invalidation.

Tests verify every threshold blocks traversal, operation from either side, rejection
of remote/in-transit/occupied-threshold interactions, reachable approach nodes,
route filtering/restoration, path continuity, and A* optimality against BFS.
