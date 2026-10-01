# Runtime architecture

The browser UI sends commands to `game.worker.ts`. `BrowserGameRuntime` owns the
current protobuf scenario, conversations and NPC activities. The worker persists
snapshots in IndexedDB and restores the previous snapshot if a mutation or save
fails. NPC planning, dialogue and reviews wait outside that mutation queue; they
merge affected character state from a snapshot only if it has not changed. Player
movement, inventory and unrelated conversations survive those merges. Resetting
or switching games cancels background execution and rejects late results.
Credentials and recent model transcripts are kept outside save snapshots.

The introduction saves the player’s delegation, name, gender and sprite before
the Stranger interview. Once the player is ready, character creation prepares an editable review draft.
Explicitly saving the reviewed character enters the palace with the confirmed
identity and authored actor positions. Walking and object interactions operate
on that same world state; there is no separate demo or night-turn engine.

`FullContextBuilder` combines authored character context, objectives, immediate
intent, available notes, known fixture contents and dialogue history. Spoken turns
return dialogue, reply suggestions and an optional conversation-ending flag.
A separate review commits durable free-form notes, relationships, biography and a goal.
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

Completed conversations, door use and object interactions emit transient world
events. Eligible listeners make independent Clear/Moderate/Distant perception
rolls. Jev then decides whether a perceived event is objective-relevant or demands
an immediate character reaction. A positive decision interrupts that character's
runner and invokes a character review, which must append a note and may revise both
active and parked objectives before background execution resumes.

GPT-6 Luna handles spoken dialogue without reasoning and uses low reasoning for
the GM, reviews and NPC conversation resolution. The OpenRouter
Responses adapter preserves tool-call continuity. Jev uses its Decisions API.

The palace renderer consumes map geometry and saved fixtures/actors. It animates
walks but does not own game state. Debug transcript summaries are views of actual
model responses, not evidence that a proposed update was committed.

Current limits: one active NPC runner; no give-item action, autonomous player
speech, visibility simulation, time progression or formal recognition resolution. The
centennial assembly remains narrative context, not a working scheduler or vote engine.

## Character mechanics and inventories

`Character.dnd` holds optional typed build inputs (abilities, class levels, feats,
explicit proficiencies and choices) and mechanical resources. Derived sheet
bonuses are not persisted. The external D&D engine is not integrated yet;
its content IDs are references for a future adapter, not executable rules.

Characters, fixtures and rooms own `Inventory.items`. An item has no persisted
location field and occurs in exactly one inventory. Equipment and attunement
reference carried item IDs; transfers clear those references at the source.
`locatedItems` provides a computed location only for observations and generation
guards. Character memory and inventory retain separate generation IDs, so
background reviews preserve unrelated inventory edits. Room inventories support
ground storage; new ground-item interaction UI remains future work.

The flat `WorldState.objects` format is removed. Start a fresh game after this
change; old saves are deliberately not migrated. World reset restores authored
inventories, while character reset preserves the current physical inventory.

### Authored court builds

The twelve courtiers have modest level 1–3 human NPC builds. Garran, Hadrik and
Tessa are veteran fighter archetypes; Aldren and Mara have lighter martial
training. Corvin is a level 3 wizard and Oswin a level 3 cleric. Elinor, Lucan,
Sabine and Rowan use rogue mechanics for mundane social/technical competence;
Rook is the stronger sailor/rogue. These are tailored NPC builds, not strict
point-buy player builds. Scores range from 8–16 and HP uses the class's maximum
first hit die plus average later hit dice and Constitution.

Personal mundane arms, clothes and work tools use starter-pack item IDs. Existing
plot evidence is preserved. Equipped slots point to those carried items, with no
second ownership record. No enchanted equipment or new combat actions are added.
Corvin and Oswin have modest spell selections; spells are stored data until rules
execution is integrated. The rest of the court has no authored spellcasting.

`kingmaker-courtier`, `kingmaker-merchant`, `kingmaker-artisan` and
`kingmaker-sailor` are custom background references, requiring definitions in the
future Kingmaker rules pack. `kingmaker-role` proficiency grants are explicit NPC
customizations; automatic class/background grants must not be copied and counted
again. An adapter must validate choices and resolve those content references
before using these builds with `dnd-srd-engine`. This change does not install that
engine or assign a build to the player during the Stranger interview.


Player starting builds: the Stranger's `create_player` tool selects a class,
orders the six abilities, and selects four skills using interview evidence.
`player-build.ts` validates those choices and creates a level 3 human traveller
with the final standard array (15/14/13/12/10/8), average HP, class saving throws,
and basic clothes and a dagger. Bard/rogue builds grant expertise to the first
two skills. `kingmaker-traveller` is a prototype background package; these are
not complete rules-legal class sheets (feats, spells and other class features
remain future work). Review shows the assigned build and allows prototype edits to level, all six
ability scores (including above 20), and current/maximum HP. Saved stats also
appear in the right-hand character sheet with ability modifiers. Conversation context includes the player's
build, but automatic skill-roll adjudication remains separate work.
