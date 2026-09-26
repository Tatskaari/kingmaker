# Palace navigation proof of concept

Open `/palace.html`, then select a waypoint in the sidebar or click its mint marker.
The character starts in the Great Hall. Grey markers are unreachable and are omitted
from the available-action list. The graph overlay follows actual tile paths; the gold
line is the active route. Reset cancels movement and restores the closed gate.

Try Great Hall → Merlin's Chamber → North Junction → Open royal gate → Royal
Bedchamber. Closing the gate from inside removes all outward routes until reopened.
The expandable Agent observation panel previews structured actions for a future
policy; this demo does not call Jev.

`palace-navigation.ts` authors ten logical nodes and their undirected connections.
`navigation.ts` runs four-neighbour A* for each graph edge against tile collision and
current gate blockers. Dijkstra selects the shortest sequence of live edges; movement
follows their tile paths. Actions are recomputed at dispatch as well as after arrival
and gate changes. Movement is exclusive: other commands are disabled until arrival,
except Reset. The same reachable routes populate the UI and observation.

This intentionally stays outside the map protobuf and narrative world engine while
we test the interaction. Actors conservatively occupy a full tile: any intersecting
solid layer blocks that tile. Room permissions do not affect physical walkability.
The royal gate is a temporary dynamic blocker across both passage tiles, operated
from either neighbouring waypoint, not a general door/item system. The PoC assumes
full knowledge of the graph and a single character. Future moving blockers must
invalidate or replan an in-flight path; currently gate changes are disabled in transit.

Tests verify gate-dependent graph reachability, contiguous walkable routes, invalid
endpoints, and A* optimality against an independent breadth-first search.
