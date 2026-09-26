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
in the bedside chest in the Royal Bedchamber. Only characters who already know those locations see
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

Start the prototype with `proto run npm -- run dev`, then open
`http://127.0.0.1:5173`. Enter an OpenRouter key in the browser; it remains in
tab-scoped session storage across reloads and is excluded from saves and debug
output. Reloading reconnects the worker and opens the save picker. Use **Change
OpenRouter key** to clear the remembered key.

The standalone palace map prototype is available at
`http://127.0.0.1:5173/palace.html`. It renders the layered map protobuf and can
overlay room regions and solid layer bounds without starting a game.
The first paid request occurs when the player clicks **Begin**. Vite hot-reloads
the UI and game worker during development.

The browser worker owns the authoritative game state and stores each game in
IndexedDB. The save picker names a game after its player character once the GM
creates them. Stable internal IDs allow two saved characters to share a name,
and the last-played time distinguishes them.
The top-right debug inspector reads the complete in-memory protobuf scenario and
model histories from the worker; credentials are deliberately omitted.

## GitHub Pages

The production build is a self-contained static site in `dist/web`. Merges to
`main` run `.github/workflows/pages.yml`, which builds that directory and deploys
it to GitHub Pages. The Vite build uses relative URLs so it also works beneath a
repository path such as `/kingmaker/`.

### Reset the palace without recreating a character

With a saved character loaded in the main game, run this in the browser console:

```js
await resetWorld();
```

This resets physical world state to the latest authored scenario: doors,
containers and their contents, inventories, and actor positions (everyone returns
to their court-arrival placement). It saves into the current save. Character
identity, biography, relationships, objectives, goals, events and conversations
remain intact; no character-creation interview or model call is needed. Wait for
any active model request to finish first. Reload the page after authored scenario
changes before resetting.

Right-click furniture to inspect, open, close or take items. The player walks to
the furniture's interaction spot first. Locked coffers require the matching key
in the player's inventory; taking items from someone else's furniture is marked
illegal. Inventory is shown in the character sheet. These prototype containers
retain their original loot; the narrative Crown of Winter remains in its existing
crown box and is not duplicated in the royal coffer.

### NPC activity and planner lifecycle

Every NPC begins **idle**, even though their authored `currentGoal` describes
receiving the player in the Great Hall. That text demonstrates immediate intent;
it does not automatically schedule work. A non-null LLM `goalUpdate` explicitly
assigns a task and makes the NPC **active**. A null update preserves their goal
text without starting the planner.

After conversation review, active NPCs give Jev their reviewed goal, character
context, current surroundings and reachable actions. Jev can navigate, operate
doors and containers, and take items into that NPC's own inventory. Each action
is animated, validated against the current world and goal, and saved.

When Jev completes, cannot progress, encounters an error, or reaches 24 actions,
the result and engine-recorded actions are saved. The NPC's LLM reviews those
alongside current observations, updates private memory and intentions, and either
assigns another task or remains idle. Planner outcome memories are private to
the NPC. Failed reviews can be retried without repeating the physical actions.
Automatic chains stop after three planner runs and their reviews.

For this prototype one NPC runs at a time and map controls pause during the run.
**Stop Jev** cancels an outstanding decision or uncommitted walk; its outcome can
be reviewed explicitly. Switching saves or resetting stops the local runner.
Reloaded active tasks and pending reviews have explicit resume/review controls.
The panel below the map shows the observations and decisions. Waiting goals can
complete at the requested location; the planner cannot initiate dialogue or
compel the player to follow. `resetWorld()` returns all NPCs to idle while keeping
their character data and goal text.

### Recent model transcripts

The debug inspector's **Recent transcripts** tab shows the last 50 model calls
for the loaded game session, newest first: game-master calls, NPC dialogue,
conversation reviews, Jev decisions, and planner-outcome reviews. Expand a call
to see its request, returned response, duration and provider/network errors.
Pending calls are visible and the tab refreshes when calls start or finish.
Logs survive game-state rollback, but are not game-save data: reloading the page
or loading another game starts a fresh log. Authentication headers are never
recorded, and API-key strings are redacted. This displays supplied prompts and
returned responses, not hidden model reasoning.
