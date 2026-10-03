# Document-based world state

`kingmaker.v2.WorldState` is a mutable, protobuf-serializable document graph for a
playthrough. It is separate from the v1 character/prompt API; the existing game
loader is not switched over yet.

```ts
import { toJson } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { readVault } from "../packages/lore/src/vault.js";
import { worldState } from "../packages/lore/src/world-state.js";

const state = worldState(existingMapState, readVault("lore"), "Centennial Assembly");
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
