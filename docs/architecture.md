# Runtime architecture

The browser UI sends commands to `game.worker.ts`. `BrowserGameRuntime` owns the
current protobuf scenario, conversations and NPC activities. The worker persists
snapshots in IndexedDB and restores the previous snapshot if a mutation or save
fails. NPC planning, dialogue and reviews wait outside that mutation queue; they
merge affected character state from a snapshot only if it has not changed. Player
movement, inventory and unrelated conversations survive those merges. Resetting
or switching games cancels background execution and rejects late results.
Credentials and recent model transcripts are kept outside save snapshots.

The GM interviews the player and proposes an editable character. Saving enters
the palace with authored actor positions. Walking and object interactions operate
on that same world state; there is no separate demo or night-turn engine.

`FullContextBuilder` combines authored character context, objectives, immediate
intent, visible events, known fixture contents and dialogue history. Spoken turns
return dialogue, reply suggestions and an optional conversation-ending flag.
A separate review commits durable memories, relationships, biography and a goal.
A non-null goal activates Jev; null leaves the NPC idle.

`courtAgentObservation` enumerates physically reachable movement and interaction
actions. Jev chooses one supplied ID. The runtime rechecks revision, goal and
availability before committing movement or interactions. The worker advances NPC
movement one tile at a time and publishes state updates; the player can keep
walking and interacting during planning, movement and outcome reviews. Illegal actions remain
mechanically available but are labelled for the character to judge.

Planner termination triggers an outcome review, which can assign another concrete
task. NPC-to-NPC conversations use an initiating request and a GM resolution,
with both participants' private updates committed atomically. Physical changes
still require engine actions.

GPT-6 Luna handles spoken dialogue without reasoning. GPT-6 Sol uses medium
reasoning for the GM, reviews and NPC conversation resolution. The OpenRouter
Responses adapter preserves tool-call continuity. Jev uses its Decisions API.

The palace renderer consumes map geometry and saved fixtures/actors. It animates
walks but does not own game state. Debug transcript summaries are views of actual
model responses, not evidence that a proposed update was committed.

Current limits: one active NPC runner; no give-item action, autonomous player
speech, visibility simulation, time progression or formal recognition resolution. The
centennial assembly remains narrative context, not a working scheduler or vote engine.
