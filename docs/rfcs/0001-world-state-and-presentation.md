# RFC 0001: Direct world mechanics and React/canvas presentation

- Status: Proposed
- Date: 2026-10-04
- Scope: Runtime state ownership, mechanics transactions, worker updates and presentation
- Related work: [service separation #330](https://github.com/Tatskaari/kingmaker/pull/330),
  [incremental document graph #331](https://github.com/Tatskaari/kingmaker/pull/331)

## Problem and evidence

The v2 world owns documents and physical state, but live mechanics still consume
v1 `Scenario`. `WorldHost.projection()` copies state into a temporary
`PalaceMechanics`; `mutate()` serializes its result and copies mechanics back.
Views reconstruct the same representation. Worker persistence, map presentation,
action responses and NPC progress each have paths that build or publish views.
This makes ordinary movement expensive and UI refresh ownership unclear.

Fresh-world headless measurements on 2026-10-03 compared the refactor-only branch
with the incremental-graph branch, using 20 iterations after three warm-ups:

| Operation | Before graph fix, median | After graph fix, median |
| --- | ---: | ---: |
| v2 movement mutation | 133 ms | 40 ms |
| Full headless movement | 200 ms | 102 ms |
| Browser-equivalent CPU sequence | 307 ms | 210 ms |
| Single document body edit | 215 ms | 9 ms |

The browser-equivalent sequence includes rollback/save snapshots, command execution,
map observation and three views. It excludes IndexedDB, transport, DOM rendering
and model calls. These are local diagnostic measurements, not frame-rate guarantees.
The graph fix removes lore parsing from movement; world copying, conversion and
observation costs remain. That fix is separate from this proposed migration.

## Decision

Keep one authoritative v2 world in the game worker. Mechanics operate directly on
its physical state through validated transactions. Documents own narrative content
and incremental link maintenance. React renders panels and controls; an independent
canvas loop renders the map from prepared presentation data.

Gameplay code writes state and returns command results. It never chooses UI
components to refresh. Shared commit infrastructure captures writes and presentation
subscriptions derive the updates. We will not build a custom DOM reactivity system
or adopt Solid solely to decide when a canvas should draw.

## Target state and ownership

The proposed protobuf shape is below. Supporting map and D&D messages are omitted;
this is a design sketch, not a generated contract. Retain existing field numbers
where meanings are unchanged and reserve retired numbers during implementation.

```proto
message WorldState {
  map<string, Document> docs = 1;
  reserved 2, 6; // Old character-path list and player document reference.
  string scenario = 3;
  MapState map = 4;
  string scenario_index = 5;
  map<string, CharacterState> characters = 7; // Keyed by stable character ID.
  optional string player_character_id = 8;
}

message Document {
  google.protobuf.Struct frontmatter = 1;
  string body = 2;
  repeated DocumentLink links = 3;
  reserved 4; // Former character_properties.
}

message CharacterState {
  string document_path = 1;
  DndCharacter dnd = 2;
  Inventory inventory = 3;
}
```

`MapState` names the existing physical simulation concept: actors, rooms, doors,
fixtures, day, phase and physical facts. Static `WorldMap` tile geometry remains
separate. Shared types need not be rewritten simply because their namespace is v1.
The obsolete dependency is the aggregate `Scenario`, not every v1 protobuf type.

Actors reference character IDs and own tile positions. They are not stored inside
tiles. Preserve distinct actor instance IDs for multiple background bodies sharing
one character identity. A derived tile-to-actor-instance index supports occupancy
queries; rebuild it on load and update it atomically with positions. Do not persist
a second authoritative copy of occupancy.

Characters own statistics and inventory; fixtures and rooms retain their inventories.
Documents retain biography, speech style, beliefs, relationships and narrative goals.
Names and sprite metadata can be selected from character documents without copying
their prose into a second character model. Character registration explicitly creates
the ID/document association; deleting its entry document requires deregistration or
reassignment. Scenario document links no longer implicitly redefine mechanical IDs.

Conversation history, NPC execution state, generations and the Stranger interview
remain in the surrounding session snapshot. Character creation publishes its document,
mechanical record, actor and player designation atomically. Moving mechanics out of
documents must not make private statistics visible to a character or the ordinary UI.
Incompatible schema changes require a fresh game; no saved-game migration is added.

## Transactions and concurrency

Expose read-only state and a single write boundary. An illustrative command is:

```ts
world.transaction(expectedGenerations, draft => {
  draft.map.actors[actorId].position = destination;
});
```

The syntax is illustrative, including actor lookup; implementation can retain repeated
protobuf actors with an ID index. The transaction infrastructure captures changed
paths through a draft/patch mechanism. Callers do not declare UI invalidations.
Unchanged records retain identity; no full-world clone or JSON round trip is needed.

A transaction validates command preconditions, stages affected records, checks
resource generations and domain invariants, and commits atomically. On failure it
discards the draft. Incremental document graph updates participate in document
transactions only. Preserve dangling-link, ambiguity and audience-access checks,
including shorthand links whose resolution changes when paths are added or removed.

Keep generations persistent and update affected resources at mutation boundaries,
including dependent resources such as doorway occupancy and item ownership. Preserve
A-to-B-to-A detection and deletion tombstones. Reads and view construction never
advance generations. This dependency logic belongs to mechanics, not individual UI
call sites, and must cover every write path. Document SHAs guard narrative state;
mechanical generations guard the extracted character properties. Operations that
depend on both must check both, preserving conflict detection after the schema split.

Model calls run outside the transaction queue. Their eventual writes check the
resources they observed; unrelated movement survives, stale decisions fail, and
reset/load invalidates work from the previous session. Never keep a writable draft
open across a model call or silently replace stale expected generations.

Initially retain persistence-before-success behavior: serialize commits, persist the
candidate state, then publish it and acknowledge the command. Save failure leaves
the previous committed state visible. Replace whole-world rollback snapshots with
staged changes; serialize a full save only at the persistence boundary. Persistence
must not construct UI views to discover a player name. A reactive notification batch
alone does not supply validation, rollback or durable commit semantics.

## Presentation and worker boundary

```mermaid
flowchart TD
  Commands[Player commands / NPC actions / document edits] --> Transaction[Validate, stage and persist]
  Transaction --> World[Committed worker state]
  World --> Selectors[Presentation selectors]
  Selectors --> Bridge[Revisioned updates]
  Bridge --> Store[Browser presentation store]
  Store --> React[React panels and controls]
  Store --> Canvas[Canvas scene and animation loop]
```

Selectors declare the state they read; dependency tracking and comparison determine
which outputs change. Start with a small set of stable outputs: map scene, player
sheet, visible characters, active conversation and explicitly requested debug data.
The exact selector/draft library is an implementation choice, to be proved in the
first vertical slice. Do not assume React detects arbitrary object mutations.

The worker sends one initial presentation snapshot, then committed output updates
with a session ID and ordered revisions. The bridge batches one commit, preserves
unchanged identities in the browser store, ignores obsolete sessions and requests a
fresh snapshot on revision gaps. Revision numbering must allow commits that do not
change any subscribed output, using explicit base/next revisions or empty advances.
It must not ship the entire document world on every step. Apply visibility and lore
permissions before producing ordinary views; GM/debug subscriptions stay explicit.

React components subscribe to the slices they need using `useSyncExternalStore`
(or a library built on it). Snapshots must be immutable and stable between changes.
Keep canvas animation positions outside React state. The canvas component owns
renderer setup, resize handling and cleanup, not authoritative game state.

The canvas loop reads the latest prepared scene and uses elapsed time to interpolate
movement. It can skip drawing while scene, camera and animation state are unchanged.
Cache static terrain; profile before introducing dirty-region rendering. No frame
may build a `Scenario`, parse lore, call `runtime.view()` or enumerate game actions.
Pause/resume and throttled frames must not affect simulation correctness. The existing
embedded-browser timing workaround requires validation before changing animation timing.

Thinking indicators, streamed dialogue and errors are separate transient updates,
scoped by session and request IDs. They do not republish the map. Remove defensive
refresh calls from persistence, NPC progress and action responses as consumers move
to subscriptions. Commands return results/errors; committed state arrives through
one publication path. Browser input continues to send commands to the worker.

## Migration sequence

Deliver buildable, independently reviewable stack layers, splitting each slice as needed:

1. **State ownership:** introduce character IDs and separate mechanical records;
   update fresh-world loading, character creation and save validation. Require a fresh game.
2. **Transaction foundation and player movement:** implement staged writes and persistent
   generations; move player movement and doors off the `Scenario` round trip. Prove
   rollback, stale-action rejection and occupancy updates with headless tests.
3. **Remaining mechanics:** migrate inventory/fixture operations, NPC actions and events
   to narrow v2 access. Retain existing movement, legality and inventory rules.
4. **Presentation vertical slice:** connect one actor and one React panel through
   worker selectors, revisioned transport and stable browser snapshots. Verify that
   dialogue streaming does not redraw the map and movement does not rebuild unrelated panels.
5. **Remaining presentation and persistence:** migrate views, controls and debug tools;
   remove redundant publications and whole-world rollback copies. Keep canvas rendering
   independent of React render frequency.
6. **Delete legacy paths:** migrate headless entrypoints, tests and eval fixtures;
   remove `projectWorld()`, disposable `PalaceMechanics` state and remaining live
   `Scenario` consumers. Temporary adapters must have named remaining consumers and
   be removed before the migration is complete; do not maintain a compatibility runtime.

## Validation and completion criteria

Preserve collision/access rules, inventory uniqueness and equipment cleanup, character
visibility, document permissions, NPC cancellation and concurrent conversation behavior.
Test failed persistence, stale commands, creation/deletion, reset during async work,
revision gaps, and multiple actor instances. Exercise canvas lifecycle and UI state
preservation: focus, scroll, dialogue drafts and animation must survive ordinary updates.

Repeat the same headless movement and document benchmarks on each relevant layer.
Instrument time spent in mechanics, selectors, serialization, transport and drawing;
report allocations and update counts as well as median/tail latency. In a browser,
check idle drawing and simultaneous NPC movement/dialogue streaming.

Completion means no live `Scenario` projection, no document parsing or full-world
copy inside movement mechanics, read-only views, and one commit-to-presentation path.
React updates subscribed slices and canvas frames consume prepared data. Full saves
remain valid for the current format. Every stack passes the repository checks/build;
performance gains must be measured rather than assumed from the framework choice.

## References

- Current contracts: [v2 world](../../packages/contracts/proto/kingmaker/v2/world.proto),
  [physical map and actors](../../packages/contracts/proto/kingmaker/v1/game.proto).
- Current adapters: [world host](../../apps/web/src/world-host.ts),
  [world projection](../../apps/web/src/world-projection.ts).
- [React: useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)
- [React: useRef](https://react.dev/reference/react/useRef)
