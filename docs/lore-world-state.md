# Document-based world state

`kingmaker.v2.WorldState` is a mutable, protobuf-serializable document graph for a
playthrough. It contains AI-owned documents alongside a separate `SimulationState` protobuf.
The simulation owns the physical map and runtime characters; documents contain no
character sheets or inventories.

```ts
import { toJson } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { worldState } from "../packages/lore/src/world-state.js";

// Supplied by the caller: vault-relative paths mapped to raw Markdown text.
const markdown = new Map([
  ["Scenarios/Example/index.md", "# Example\n[[Scenarios/Example/scenario]]"],
  ["Scenarios/Example/scenario.md", "# Opening\nThis is a stub."],
  ["Players/player.md", "# Player"],
]);
const state = worldState(existingMapState, markdown, "Example", "Players/player.md");
const json = toJson(WorldStateSchema, state);
```

The map input is the `kingmaker.v1.MapState` physical simulation state,
adopted as `state.simulation.map`. Pass a fresh map owned by this playthrough. This does not regenerate geometry or reconcile old actor IDs
with the selected scenario's cast. The caller supplies the desired map baseline.

`docs` maps vault-relative Markdown paths to bodies, parsed frontmatter and resolved
document links. All notes are retained, including other scenarios and author
navigation; their presence does not make them active entities or character context.
`scenario` selects `Scenarios/<scenarioID>/scenario.md`. `characters` contains its
directly linked `Characters/<id>/character.md` entrypoints, in first-link order.
No prose is interpreted, no stats are inferred and stubs are valid input.

`scenarioIndex` points to `Scenarios/<scenarioID>/index.md`, which must exist.
The optional fourth argument supplies `player`, a document path that must exist
in `docs`. Omit it before character creation; the GM can add the document and set
this reference later. A player need not be in the initial scenario cast list.

Construction is synchronous and has no filesystem or runtime-service dependency.
The caller supplies raw Markdown; loading files, reading stat-sheet sidecars,
retrieving documents and applying GM edits belong to the runtime services.
`CharacterProperties` remains available in the API for typed D&D/inventory data,
as authored creation input. Loaders assign its D&D sheet and inventory to each
`state.simulation.runtimeCharacters[id]`, independently for bodies sharing lore.
Those mechanics are not part of a document or its SHA.

Link bodies retain their original Markdown, including labels and embeds. Link
records preserve the original destination (including heading fragments) and the
resolved document path. External URLs and ordinary non-Markdown assets are not
document edges. Missing or ambiguous note references and invalid YAML fail with
the source path. The builder shares parsing and resolution with the lore audit.

This is authoritative GM data, not a ready-to-send character prompt. Progressive
disclosure should load an entry body, let Jev select links, then check the target's
access policy before retrieving it. Frontmatter remains available for those checks;
this builder does not implement runtime retrieval or grant access through links.

## Scenario and document services

`createScenarioServices(state)` in `packages/lore/src/services.ts` creates a pair
of injectable interfaces sharing an owned, deep copy of the playthrough state:

- `scenario.info()` returns scenario, index, player and character references.
- `scenario.read()` returns live authority state for trusted reads, without copying. Callers must publish changes through the owning services. Save serialization belongs to the game host.
- `scenario.getDocument(path)` and `docs.read(path)` return detached snapshots
  containing `path`, `sha`, canonical Markdown `text` and the protobuf `document`.
  Reads take no expected SHA and return the state captured when the read starts.
- `docs.create(path, text)` requires an absent path.
- `docs.replace(path, expectedSha, oldText, newText)` requires exactly one match.
- `docs.insert(path, expectedSha, afterLine, text)` inserts after a 1-based line
  in the returned text; line 0 means the beginning.
- `docs.delete(path, expectedSha)` removes an unreferenced document.

```ts
const { scenario, docs } = createScenarioServices(state);
const current = await docs.read("Scenarios/Example/scenario.md");
const edited = await docs.replace(current.path, current.sha, "This is a stub.", "The gates open.");
const currentWorld = scenario.read(); // read-only use; no whole-world copy
```

Every command returns a promise; create, replace and insert return the new
snapshot. SHA-256 covers the full document, including frontmatter
and derived links, with stable object-key ordering. This is a content revision,
not an edit counter. Equivalent contents have the same SHA. Frontmatter is
rendered as canonical YAML; original YAML formatting and comments are not retained
by the world model. Match text against the latest returned `text`.

Writes are serialized within the service pair, check the SHA and validate a
private draft before publishing it. Stale edits throw `DocumentConflictError`
with expected and actual hashes; the caller must reread and reconsider the edit.
Invalid edits leave state unchanged. All links and scenario character references
are rebuilt, catching missing or ambiguous targets even in other documents.
Scenario, index and player documents cannot be deleted while referenced. Simulation character mechanics and physical map data survive Markdown edits unchanged.

These are GM services, with no character visibility filtering, filesystem writes
or model calls. Runtime wiring and GM tool adapters are separate work. Save and
restore the complete snapshot with protobuf JSON serialization.

### GM editing tools

Document-backed GM reviews expose `read_document`, `create_document`,
`replace_document`, `insert_document`, and `delete_document` over the document
service. Each call returns a result before the GM chooses its next tool. Reads
and successful writes return canonical Markdown and a SHA; edits and deletion
require that SHA. Conflicts return the current snapshot for reconciliation, and
validation errors return feedback without publishing the failed edit.

Each successful document write saves immediately, including when a later review
step fails or is cancelled. Automatic access and link validation applies to every
write. The GM must preserve who knows what and use appropriate access metadata.

The GM finishes with a plain-text summary. The host then publishes staged
activity/wait pointers in one SHA-checked batch and returns that summary.
Memories are written exclusively through document edit tools. It does not publish or roll back preceding
document-tool edits. An edit/read of the reviewed character refreshes the snapshot
used by this final write, preserving edits made earlier in the tool loop.

See [Character activities and waits](activity-waits.md) for the document-backed intent contract and live treasury eval.

## Simulation ownership

`SimulationState` contains `map` (the existing physical map protobuf) and
`runtimeCharacters`. Each runtime character owns its `dnd` sheet and `inventory`,
alongside its identity and document/intent references. The references are opaque
paths: document bodies, frontmatter and links stay in the AI document world.
Room and fixture inventories remain on their physical owners under `map`.

The GM calls `read_inventory(actorId)` to obtain an inventory and its SHA, then
`update_inventories` with `{ actorId, expectedSha, inventoryJson }` changes. A
transfer commits all affected owners together. Inventory versions are independent
of document versions; document edits neither overwrite nor invalidate mechanics.
Duplicate item ownership is validated across runtime characters, rooms and fixtures.

Saved-game format 6 requires a fresh game. There are no old-save migrations. This
is a state ownership change; boardgame.io and simulation move functions are not
introduced here. Host conversation/jail state still awaits the subsequent mutation
API work.

`WorldState.simulation.map.layout` owns the authored tile grid (`WorldMap`), including dimensions, layers, solidity, and room regions. Fresh-game creation supplies it; saves retain it and the map service reads it from the current simulation. AI physical summaries omit the tile grid.
