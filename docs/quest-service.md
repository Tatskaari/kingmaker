# Quest data service

`createScenarioServices(world).quests` manages GM-owned quest graphs and progress.
Register a `QuestSchema` message with a stable ID, initial stage ID, ordered stages
and directed transitions. Registration rejects duplicate IDs and missing stage
references. Definitions are fixed after registration; multiple edges may converge
on a stage, and retry edges may return to earlier stages.

`list()` and `read(questId)` return detached `QuestState` snapshots.
Newly registered quests start inactive. Lore-loaded quests start inactive unless
the quest index declares `active: true`. `listActive()` returns
only active quests, also as detached snapshots. The GM/host explicitly changes
activation with `setActive(questId, active, expectedRevision)`:

```ts
const quest = quests.read("delivery");
await quests.setActive("delivery", true, quest.revision);
```

Activation is independent of progress: inactive quests can still transition, and
reaching a stage with no outgoing edges does not itself deactivate a quest.
Entering a stage explicitly marked `completed: true` deactivates it in the same
revision as the transition. Deactivation
preserves the current stage and history so a quest can be reactivated later.
Changing activation increments the shared revision and persists in world saves;
a request matching the current flag is a no-op after checking its revision.
Activation does not add transition history records, so their revisions can have
gaps. Concurrent activation and transition writes use the same conflict checks.

`availableTransitions(questId)` returns outgoing edges, without evaluating their
conditions. After the caller adjudicates a condition, advance with:

```ts
const state = quests.read("delivery");
await quests.transition("delivery", "back_out", state.revision, "Cart cleared");
```

The service uses the shared world write queue, checks the expected revision and
current stage, then publishes the new stage, revision and evidence record together.
Stale requests throw `QuestConflictError`, including repeated requests after a
save/resume or a cycle back to an earlier stage. Read the current state before
deciding whether a new request is appropriate. World saves retain `world.quests`;
reads and writes copy only the affected quest data.

This service records quest data only. It does not evaluate conditions, execute
scripts, expose character knowledge, or coordinate physical/document
effects. Those integrations must establish their own successful outcomes before
recording progress; this API is not an atomic boundary for multi-service effects.

## Lore loading

Fresh worlds load `Scenarios/<scenario>/Quests/<quest>/quest.md`. The folder's
`index.md` stays author navigation. Quests and conversations share the Markdown
graph compiler; a quest document supplies flat `id`, `title`, `initial`,
`visibility: gm`, `summary` and optional boolean `active` frontmatter.

```md
## Node: blocked | Entrance blocked
### Guidance
Resolve the obstruction. Agreement to act is not clearance.
### Quest Log
The entrance is blocked. Find a way to clear it.
### When: clear_cart -> clear
The host has cleared the obstruction and assigned helpers.
#### Trigger: none

## Node: clear | Entrance clear
### Guidance
The entrance is clear; delivery remains a separate activity.
```

Node and transition IDs allow hyphens and underscores. File order determines
stage order. `| Title` is optional; otherwise the node ID supplies its title.
Every node requires `Guidance` and `Quest Log`. Guidance is GM-owned and is not
shown to players or injected into character replies. Quest Log is player-facing
journal copy for that stage. Keep it limited to facts the player knows when the
stage is reached. An empty `### Completed` heading on a node deactivates the quest
when that node is entered. A terminal node alone does not complete a quest.
The text before the first node supplies the quest overview; keep longer author
notes and effect contracts in linked supporting documents.

Every quest edge requires one empty trigger heading:
- `#### Trigger: none` requires an explicit conversation or host call.
- `#### Trigger: discretionary` records a caller-adjudicated condition.
- `#### Trigger: player_talked_to aldren` uses the existing typed host predicate.
  The loader verifies that the scenario character exists. Only a successfully
  committed player/character exchange satisfies it; opening a conversation,
  NPC-only dialogue, failed replies and cancelled turns do not.

Conditions document evidence and caller preconditions; this format does not
introduce automatic Jev evaluation. Condition note links and graph references
are validated. Optional `#### Run: <name>.ts` headings compile to separate script
metadata, as in conversation trees. Compilation never imports or executes a file.
Quest callers must explicitly resolve registered hooks and use the host helper
below; raw `quests.transition()` and typed conversation predicates do not run
script metadata. The converted baseline quests declare no `Run` hooks.

Loading seeds revision zero only during fresh-world construction; resume retains
the saved graph and progress. Live graph-document edits retain progress and
invalidate stale revisions. Removing the current node or a live quest is rejected.
Numbered stage notes and linked transition definitions are no longer a graph
format. Start a fresh game after this baseline conversion; no save migration is provided.

Assembly Programme retains `investigate_missing_pillows`, `cart_blocked` and the
unwritten `cart_unblocked` node. Holt's actual disclosure invokes
`learn_cart_blocked`; remedies will invoke `clear_cart` after successful material
effects. The linked clearance contract remains unimplemented. See
[quest authoring guidance](../.agents/skills/kingmaker-quest-authoring/SKILL.md).

## Host transition hooks

Host callers can use `transitionWithHook` from
`packages/conversation/src/quest-transition.ts` to validate an available edge,
run a trusted hook and record progress only on acceptance. The data service's
`quests.transition()` remains a recording API and does not execute hooks.

Hooks return the shared, extensible `TransitionResult` union:

```ts
{ status: "accepted", message: "Item delivered." } // message is optional
{ status: "rejected", message: "The player does not have the requested item." }
```

A rejection is a normal gameplay outcome: it leaves progress, revision and history
unchanged and permits a later retry. Unexpected failures still throw. Validate
prerequisites against live state before applying effects: this helper does not
roll back service calls, and hook effects plus quest recording are not atomic.
The caller owns persistence and supplies any rejection message to its presentation.

## Authored effects and physical predicates

Use `services.hooks.transition(id, edge, revision, evidence, signal)` on the host,
or `services.quests.advance(id, edge, revision, evidence)` inside a conversation
hook, to resolve the live quest document's `Run` binding and execute its saved
`Hooks/<name>.ts` source. The hook receives the transition ID and evidence through
`services.transition`. Rejection retains progress. Raw `quests.transition` is
still data-only. Nested quest advancement from a quest hook is rejected.

`#### Trigger: fixture_absent <fixture-id>` is a generic world-state predicate.
The host calls `hooks.evaluatePredicates(signal)` after physical interactions;
matching edges on active quests execute their authored hooks. No quest IDs or
physical-action prefixes belong in that dispatcher.

Hooks can check `inventory.hasItem`, rename fixtures, remove empty fixtures,
and broadcast a public milestone through `memories.broadcast`. A broadcast ID
is idempotent: it writes one private memory per character entry and a GM-only
`Reviews/<id>.md` job containing author-owned dialogue review instructions and
pending actor IDs. This deliberately informs all characters of the public
milestone. Private negotiations must not be placed in the broadcast text.

Effects use existing service publication boundaries. Hooks must validate before
writing and remain retry-safe; several service calls and progress recording are
not one transaction. Model review runs later, outside the bounded hook VM.
