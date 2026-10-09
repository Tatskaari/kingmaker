Palace authoring
===============

Author rooms in `apps/web/src/palace-layout.ts` through `RoomBuilder.room`.
Each rectangle claims its floor tiles exclusively; hallway overlaps throw with
both room IDs and the offending coordinate. Door thresholds must belong to one
of their adjacent rooms. Residents define private access; empty lists are public.

Run `node --import tsx scripts/sync-palace.ts` to regenerate room access and reciprocal exits in
`content/palace-map.json` from the actual shared floor edges. Narrative descriptions
and inventory are preserved. Place actors, furniture and doors inside their
claimed rooms, and run the workspace checks to validate them.

Run `node --import tsx scripts/preview-palace.ts /tmp/palace.svg` to inspect the
layout. Each colour is one room's floor ownership, dark areas are solid walls,
and hovering shows the room name and allowed residents. Red door tiles are closed;
gold door tiles are open. White dots mark interaction spots, with expected and
actual room ownership in their hover text. Synchronization rejects mismatched
approach ownership and disconnected room floors when all doors are closed.

Furniture additions are authored in `apps/web/src/palace-furniture.ts` using
`FurnitureBuilder.add(roomId, localX, localY, furnishing)`. Private bedrooms
inherit their resident as owner. Contents have stable IDs and inspection text.
The builder protects door tiles, approaches, actor positions and navigation
waypoints; the furniture tests check connectivity with every door closed.
`sync-palace.ts` regenerates the `furn_` additions while retaining the original
fixtures and evidence. The ownership preview also renders furniture sprites;
hovering a fixture reveals its authored contents for inspection.

Room and fixture IDs are stable layout keys; resident/owner IDs refer to the
document roster. A bedroom can retain its historical room ID while housing a
character with a different ID.

AI battle-map reference
----------------------

Run `node --import tsx scripts/palace-art-reference.ts /tmp/palace-reference`
(with ImageMagick's `magick` installed) to export a full-level control image for
an image-editing model. `reference.png` includes the authoritative grid, distinct
room colours and room IDs, letters for every furnishing, doorway footprints,
coordinate ticks and an external legend. `map-only.png` has the identical grid
without the surrounding key. Editable SVG copies are included.

Use both images with `image-edit-prompt.txt`; `legend.json` records exact room
polygons, wall cells, object coordinates and the map crop rectangle. The prompt
requests one continuous hand-drawn PNG, flat lighting, no labels or grid, and
clear thresholds for runtime doors. Colours identify rooms rather than prescribe
floor finishes. Adjacent H/F cells form one bed; adjacent T cells form one table.
The generator fails on unknown furniture types instead of silently omitting them.
Inspect the result against the control grid before wiring it into the game:
image generation cannot guarantee that collision boundaries stay pixel-aligned.
This exporter does not change the game's renderer or saved-world state.
