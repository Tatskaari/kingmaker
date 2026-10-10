# Quest data service

`createScenarioServices(world).quests` manages GM-owned quest graphs and progress.
Register a `QuestSchema` message with a stable ID, initial stage ID, ordered stages
and directed transitions. Registration rejects duplicate IDs and missing stage
references. Definitions are fixed after registration; multiple edges may converge
on a stage, and retry edges may return to earlier stages.

`list()` and `read(questId)` return detached `QuestState` snapshots.
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
scripts, load lore, expose character knowledge, or coordinate physical/document
effects. Those integrations must establish their own successful outcomes before
recording progress; this API is not an atomic boundary for multi-service effects.

Transitions require an explicit `QuestTrigger.DISCRETIONARY` or
`QuestTrigger.PREDICATED`; discretionary transitions also require a nonempty
condition. Use fresh definitions rather than migrating older saved quests.
The conversation CLI can inspect discretionary conditions without recording progress.
