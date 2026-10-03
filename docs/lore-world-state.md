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

GM edits belong to this independent playthrough copy. Recompute derived `links`
using `links` and `resolveLink` after body edits; renaming a document also requires
updating incoming references. A GM editing API and prompt integration are separate
work. Save and restore the complete result with protobuf JSON serialization.
