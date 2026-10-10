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
scripts, expose character knowledge, or coordinate physical/document
effects. Those integrations must establish their own successful outcomes before
recording progress; this API is not an atomic boundary for multi-service effects.

## Lore loading

Fresh worlds load quest folders directly beneath `Scenarios/<scenario>/Quests/`
that contain `NNN_stage_*.md` notes. The folder's `index.md` supplies `id`, `title`
and the overview body. Each stage supplies `id`, `title`, its description body,
and optional `transitions` (a list of Markdown or wiki note links). Exactly one
stage must declare `initial: true`; filename sorting determines display order.
Transition links resolve using the vault's existing rules and must stay in that
quest's `transitions/` folder. Each transition supplies `id`, `to` (a stage ID),
`trigger: discretionary`, a nonempty `condition`, and an outcome description body.
All definitions require `visibility: gm`. Condition note links are validated.

Loading validates the graph through the same validator as service registration.
It seeds revision zero only during fresh-world construction; resume retains the
saved graph and progress. Existing flat quest sketches are not loaded as graphs.
The Assembly Programme is the first authored graph. Its alternative delivery
routes and failure/retry edges remain unfinished authoring work.

This loader accepts data, not executable scripts: predicates, TypeScript modules,
declared input execution and GM invocation are not supported. The caller must
establish physical outcomes before recording a transition. Start a fresh game to
pick up changed baseline quest definitions.
