import { clone, create } from "@bufbuild/protobuf";
import { InventorySchema, ItemInstanceSchema, type Inventory, type ItemInstance, type WorldState } from "../../contracts/src/index.js";

export interface InventoryOwner {
  id: string;
  inventory?: Inventory | undefined;
}

/** Inventories own items. Location is computed only for read models and guards. */
export function inventoryOwners(characters: readonly InventoryOwner[], map?: Pick<WorldState, "fixtures" | "rooms">) {
  return [...characters, ...(map?.fixtures ?? []), ...(map?.rooms ?? [])].map(owner => ({
    id: owner.id, inventory: owner.inventory && clone(InventorySchema, owner.inventory),
  }));
}

export function inventoryFor(owners: readonly InventoryOwner[], ownerId: string): Inventory {
  const owner = owners.find(owner => owner.id === ownerId);
  if (!owner) throw new Error(`Unknown inventory owner ${ownerId}`);
  return owner.inventory ? clone(InventorySchema, owner.inventory) : create(InventorySchema);
}

export function itemsFor(owners: readonly InventoryOwner[], ownerId: string): ItemInstance[] {
  return (owners.find(owner => owner.id === ownerId)?.inventory?.items ?? []).map(item => clone(ItemInstanceSchema, item));
}

export function locatedItems(owners: readonly InventoryOwner[]) {
  return owners.flatMap(owner => (owner.inventory?.items ?? []).map(item => ({ ...clone(ItemInstanceSchema, item), locationId: owner.id })));
}

export function findItem(owners: readonly InventoryOwner[], itemId: string): ItemInstance | undefined {
  const item = owners.flatMap(owner => owner.inventory?.items ?? []).find(item => item.id === itemId);
  return item && clone(ItemInstanceSchema, item);
}

export function validateInventories(owners: readonly InventoryOwner[]): void {
  const ids = new Set<string>();
  for (const owner of owners) {
    const inventory = owner.inventory;
    if (!inventory) continue;
    for (const item of inventory.items) {
      if (!item.id || ids.has(item.id)) throw new Error(`Duplicate or empty item ID: ${item.id}`);
      ids.add(item.id);
      if (item.quantity !== undefined && item.quantity < 1) throw new Error(`Invalid quantity for ${item.id}`);
    }
    const equipment = inventory.equipment;
    if (!equipment) continue;
    for (const id of [equipment.mainHandItemId, equipment.offHandItemId, equipment.armorItemId,
      equipment.shieldItemId, ...equipment.attunedItemIds].filter(Boolean)) {
      if (!inventory.items.some(item => item.id === id)) throw new Error(`Equipment ${id} is not carried by ${owner.id}`);
    }
    if (new Set(equipment.attunedItemIds).size !== equipment.attunedItemIds.length || equipment.attunedItemIds.length > 3) {
      throw new Error(`Invalid attunement for ${owner.id}`);
    }
  }
}
