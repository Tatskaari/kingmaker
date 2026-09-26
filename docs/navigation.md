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
is in memory and resets on reload. Doors have no locks or permissions; the furniture lockbox requires a key.
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
capabilities are movement, opening/closing doors and containers, and taking items. Combat and conversation are not yet implemented. Jev can choose `unable` for an unachievable or unclear goal.

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


## Furniture and the key

Merlin's chest of drawers contains the Royal lockbox key. The King's lockbox is in
the Royal Bedchamber. Both have adjacent navigation points. Use the Nearby furniture
buttons or right-click the fixture: a closed container opens; an open drawer with
an item transfers that item; an empty open container closes. Opening the lockbox
requires carrying the matching key, which is retained. Remote/in-transit actions
are rejected. Contents are unknown until inspection, then remembered after closing.
Reset restores the key to the drawers, empties inventory and closes both containers.

Tables, stools, bookcases, cabinets and barrels use the existing Kenney sprites.
Every furniture tile blocks navigation. Tests ensure all waypoints remain reachable
with doors open and exercise the full key/lockbox sequence with a scripted policy.

The Last Jev request panel shows the exact JSON body sent to the API, excluding
credentials. Last Jev choice probabilities shows the validated answer, including
the distribution over offered actions. The role instruction frames one character
in a palace, and action descriptions state immediate effects. There is no scripted
search strategy: Jev chooses how to pursue the goal. `unable` is displayed as a
model decision, never an engine proof of impossibility.

Prompt design references: TypeSafe's [state guide](https://docs.typesafe.ai/concepts/state),
[structured questions](https://docs.typesafe.ai/primitives/advanced), and
[known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13). The current
observation still exposes the known logical graph; a more compact character-centred
projection and separate completion judgment are follow-up design considerations,
not claims that arbitrary planning reliability has been demonstrated.

## Merlin's character context

The palace agent uses Merlin from `content/scenarios/last-night.json`. Dialogue
and physical decisions share `characterContextFor`, including event visibility.
Every Jev request includes the authored premise, Merlin's lore and relationships,
his original motivation, and his visible public/private events. The goal input
supplies his current task without mutating the source character sheet. The
Character context panel displays this exact projection before any request.

Merlin's authored lore already says he knows the key is in his study drawer;
this is legitimate character knowledge, not a search hint invented for the model.
The physical lockbox still checks actual key possession. Dialogue-specific output
instructions are not copied into the Decisions API. The prototype loads the shared
starting scenario; it does not yet import character edits from a separate saved
conversation. Merlin's sprite now uses the existing Kenney wizard tile.
