Palace authoring
===============

Author rooms in `apps/web/src/palace-layout.ts` through `RoomBuilder.room`.
Each rectangle claims its floor tiles exclusively; hallway overlaps throw with
both room IDs and the offending coordinate. Door thresholds must belong to one
of their adjacent rooms. Residents define private access; empty lists are public.

Run `node --import tsx scripts/sync-palace.ts` to regenerate scenario room access
and reciprocal exits from the actual shared floor edges. Narrative descriptions
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
The builder protects door tiles, approaches, arrival positions and navigation
waypoints; the furniture tests check connectivity with every door closed.
`sync-palace.ts` regenerates the `furn_` additions while retaining the original
fixtures and evidence. The ownership preview also renders furniture sprites;
hovering a fixture reveals its authored contents for inspection.
