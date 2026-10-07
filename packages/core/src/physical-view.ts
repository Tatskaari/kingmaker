import { clone, toJson } from "@bufbuild/protobuf";
import { WorldStateSchema, InventorySchema, ItemInstanceSchema, type WorldState } from "../../contracts/src/index.js";
import { locatedItems, type InventoryOwner } from "./inventory.js";

/** Removes concealed container contents and undiscovered fixture details. The game master sees
 * the authoritative world; character models see only this projection. */
export function worldForCharacter(map: WorldState, owners: readonly InventoryOwner[], characterId: string) {
  // Build only the redacted fields. Unchanged physical records remain shared with the live map.
  const view = { ...map, objects: locatedItems(owners),
    fixtures: map.fixtures.map(fixture => ({ ...fixture,
      ...(fixture.inventory ? { inventory: clone(InventorySchema, fixture.inventory) } : {}) })),
    rooms: map.rooms.map(room => ({ ...room,
      ...(room.inventory ? { inventory: clone(InventorySchema, room.inventory) } : {}) })),
  };
  const visibleObjectIds = new Set<string>();

  for (const fixture of view.fixtures) {
    const known = fixture.open || fixture.searchedBy.includes(characterId);
    if (known) for (const item of view.objects) {
      if (item.locationId === fixture.id) visibleObjectIds.add(item.id);
    }
    if (fixture.inventory) fixture.inventory.items = fixture.inventory.items.filter(item => known || !item.concealed);
    if (!fixture.examinedBy.includes(characterId)) {
      fixture.requiredKeyId = "";
      fixture.revealedName = "";
    }
    fixture.examinedBy = fixture.examinedBy.filter(id => id === characterId);
    fixture.searchedBy = fixture.searchedBy.filter(id => id === characterId);
  }

  view.objects = view.objects.filter(object => !object.concealed || object.locationId === characterId || visibleObjectIds.has(object.id));
  for (const room of view.rooms) if (room.inventory) room.inventory.items = room.inventory.items.filter(item => !item.concealed);
  return view;
}

/** Flattened prompt/debug projection only; never persisted as authoritative ownership. */
export function worldViewJson(view: ReturnType<typeof worldForCharacter>) {
  return { ...toJson(WorldStateSchema, view, { alwaysEmitImplicit: true }) as object,
    objects: view.objects.map(item => ({ ...toJson(ItemInstanceSchema, item) as object, locationId: item.locationId })) };
}

