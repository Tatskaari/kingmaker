# Kingmaker

A deliberately small experiment in an improvised political cRPG.

On the last night before the solstice, Merlin knows where the key is, Lancelot
knows where the crown is, and the living king expects to keep it. The player
can talk privately with all three. Conversation may change what each person wants;
Jev chooses what they physically do next.

The scenario owns its premise: by ancient law, whoever physically holds the Crown
of Winter at dawn on the solstice day becomes king.

The player arrives with an embassy from a neighbouring allied kingdom. The game
master interviews them to determine exactly what kind of emissary they are, their
homeland and mission, and any private agenda. Their diplomatic position gives them
credible private access to Merlin, Lancelot, and Aldren.

## MVP hypothesis

Less symbolic social machinery gives the agents more room to surprise us. A
character consists of:

- lore;
- prose relationships;
- one free-text current goal;
- visible events;
- the shared world state.

Promises, agreements, insults, thoughts and conversations are all events. There
are no quests, trust scores, belief graphs, formal commitments, or symbolic plans.

The dialogue LLM may create a new goal in prose. On an autonomous turn, the engine
enumerates concrete actions that are legal now and Jev chooses one using the whole
character, their visible events, their goal, and their known world state.

Day 1 begins with the player and all three NPCs awake in the Great Hall. When the
player ends the day, every NPC retires to their own room. At night they can wake,
sneak through adjacent rooms, search a room to reveal plausible hiding places,
and investigate those places. The spare key is in Merlin's desk; the crown box is
beneath the old chapel altar. Only characters who already know those locations see
them before searching. Other rooms contain enough empty possibilities to make the
useful choice unobvious.

```text
player conversation -> dialogue LLM -> speech + events + optional new goal
                                                    |
world -> enumerate legal actions -> Jev Choice <----+
                                -> apply action -> event
```

Before that loop, the game master interviews the visiting emissary and adds the
resulting player to the cast and to each NPC's relationships. The MVP phases are
player creation, private conversations, night actions, and solstice resolution.

This is reactive goal-oriented action selection. It does not currently search a
graph for a shortest plan. If the experiment reveals short-sighted behaviour, we
can add planning with evidence about the failure we are solving.

## Key files

- `packages/contracts/proto/kingmaker/v1/game.proto` — the entire data contract.
- `packages/core/src/ports.ts` — the few engine and model boundaries.
- `packages/core/src/context.ts` — builds the full dialogue context.
- `content/scenarios/last-night.json` — all initial characters, events and world data.
- `content/prompts/dialogue.md` — dialogue context and output contract.
- `content/prompts/decisions.md` — Jev action-selection contract.
- `content/prompts/game-master.md` — player creation and narration contract.

## Tooling

moonrepo **proto** manages the toolchain; **Protocol Buffers** defines game data.
They are unrelated. `.prototools` pins proto, moon, Node and npm. Buf generates
TypeScript from the protobuf contract.

```sh
proto install
proto run npm -- ci
proto run moon -- run workspace:check
proto run moon -- run workspace:build
```

The OpenRouter key remains outside the repository at
`~/secrets/kingmaker-dev-openrouter.txt`. The server loads it through
`OPENROUTER_API_KEY_FILE` and never sends it to the browser. Start the prototype
with `proto run npm -- run dev`, then open `http://127.0.0.1:5173`. Enter an
OpenRouter key in the browser; it remains in tab memory and is excluded from
saves and debug output. The first paid request occurs when the player clicks
**Begin**. Vite hot-reloads the UI and game worker during development.

The browser worker owns the authoritative game state and stores each game in
IndexedDB. The save picker names a game after its player character once the GM
creates them. Stable internal IDs allow two saved characters to share a name,
and the last-played time distinguishes them.
The top-right debug inspector reads the complete in-memory protobuf scenario and
model histories from `/api/debug`; credentials are deliberately omitted.
