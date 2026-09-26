# MVP architecture

## Dialogue turn

`FullContextBuilder` creates separate system messages containing, in order: the
game instructions, scenario premise, character lore and current goal,
relationships, visible events, and the character's known world state. The existing
conversation follows as normal messages.

The authoritative world contains hidden search spots and their contents. Character
contexts redact undiscovered spots and concealed objects. Searching a room reveals
several interaction choices; investigating one reveals its contents. The game
master retains the complete state.

The dialogue model returns:

- what the character says;
- events worth retaining;
- an optional replacement free-text goal.

The browser worker validates IDs and appends the result. Social events have no
bespoke reducers. Their meaning remains available to later model calls as prose.

## Player creation

The game master introduces the crown law and the player's arrival with an embassy
from an allied kingdom. It interviews rather than selects: the player may define
their homeland, place in the embassy, public mission, private agenda, and history.
Once sufficient, `PlayerSetup` adds the player character and a player relationship
to each NPC. That diplomatic role explains why all three accept private meetings.

## Autonomous turn

`ActionSource` reads the authoritative world and produces concrete candidates,
such as `move:hall`, `talk:lancelot`, or `take:brass_key`. Candidates are already
bound to targets and currently legal. It should enumerate broadly so game design
does not quietly force a preferred solution.

`ActionPolicy` converts the decision request into one Jev Choice. Each criterion
maps an action ID to its description. The selected ID must exist in the request.
`WorldEngine` revalidates and applies it, then emits events.

Physical grounding is the only hard boundary: dialogue may invent intentions and
strategies, but cannot move items, unlock boxes, or relocate characters by prose.

## What is intentionally absent

- Quest and outcome models.
- Agreement, commitment, and promise state machines.
- Numeric personality or relationship dimensions.
- Separate belief and memory graphs.
- Symbolic goal predicates and GOAP search.
- Partial context retrieval and model tools.
- Rendering, persistence, and live provider implementations.

The world uses `google.protobuf.Struct` for MVP flexibility. Once behaviour exposes
important invariants, those specific fields can become typed protobuf messages.

## First measurement

Record the dialogue input/output, goal changes, Jev input/distribution, selected
action, and resulting event. We want to see whether agents pursue multi-step social
goals, revise them coherently, exploit unexpected combinations of ordinary actions,
and recover after another character disrupts their intention.
