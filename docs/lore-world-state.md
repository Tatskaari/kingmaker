# Document-based world state

`kingmaker.v2.WorldState` is a mutable, protobuf-serializable document graph for a
playthrough. It is separate from the v1 character/prompt API; the existing game
loader is not switched over yet.

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

The map input is the existing `kingmaker.v1.WorldState` physical simulation state,
copied unchanged. This does not regenerate geometry or reconcile old actor IDs
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
but this Markdown constructor does not populate it. Those properties are GM-only
and must not be exposed merely because a document body is readable.

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
- `scenario.snapshot()` returns a deep copy of the full state for saving.
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
const save = toJson(WorldStateSchema, scenario.snapshot());
```

Every command returns a promise; create, replace and insert return the new
snapshot. SHA-256 covers the full document, including frontmatter, GM properties
and derived links, with stable object-key ordering. This is a content revision,
not an edit counter. Equivalent contents have the same SHA. Frontmatter is
rendered as canonical YAML; original YAML formatting and comments are not retained
by the world model. Match text against the latest returned `text`.

Writes are serialized within the service pair, check the SHA and validate a
private draft before publishing it. Stale edits throw `DocumentConflictError`
with expected and actual hashes; the caller must reread and reconsider the edit.
Invalid edits leave state unchanged. All links and scenario character references
are rebuilt, catching missing or ambiguous targets even in other documents.
Scenario, index and player documents cannot be deleted while referenced. Typed
GM character properties and physical map data survive Markdown edits unchanged.

These are GM services, with no character visibility filtering, filesystem writes
or model calls. Runtime wiring and GM tool adapters are separate work. Save and
restore the complete snapshot with protobuf JSON serialization.
