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
current door states and reachable move/open/close actions. See Jev goals below.

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

## Jev goals

Enter an OpenRouter API key and a free-form goal, then Run goal or Step. For example:
“Visit Merlin's Chamber, return to the Great Hall, then close the hall door.” Goals
are sent verbatim; there is no room classifier or prescribed sequence. The available
capabilities are movement and opening/closing doors. Items, combat and conversation
are not yet implemented. Jev can choose `unable` for an unachievable or unclear goal.

The browser calls `https://openrouter.ai/api/alpha/decisions` with
`typesafe/jev-1.13`, following the [official Decisions example](https://openrouter.ai/blog/tutorials/how-to-use-jev/).
Each request includes current position, full known node layout, only traversable
connections, door states and approaches, legal action candidates, and completed
actions for this goal. A typed Choice question offers those actions plus `complete`
and `unable`. Completion is Jev's assessment, labelled as such, not a deterministic
verification of arbitrary natural-language goals. No model-generated code executes.

The engine validates choices and world revision before dispatch. Movement finishes
before the next request. Run allows up to 24 actions per goal; Step performs one.
Pause aborts a pending request and prevents its answer from acting; an active walk
finishes and is recorded for resumption. Reset cancels the walk and clears history.
Manual actions are disabled during a run. API failures stop the loop without retrying.

Keys use the existing tab-scoped `kingmaker.openrouter-api-key` session storage;
they go only in Authorization headers, never observation/log/save data. Browser
fetch retains its Window receiver. A 401 triggers a read-only `/api/v1/key` check
to distinguish rejected credentials from Decisions-specific access. Provider errors
are displayed with credential redaction. The Decisions endpoint is an alpha API;
live operation requires an accepted key and endpoint access.
