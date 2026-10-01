import { create } from "@bufbuild/protobuf";
import { InventorySchema, type Inventory, type ItemInstance, type Scenario } from "../../contracts/src/index.js";

/** Inventories own items. Location is computed only for read models and guards. */
export function inventoryOwners(scenario: Scenario) {
  return [...scenario.characters, ...(scenario.world?.fixtures ?? []), ...(scenario.world?.rooms ?? [])];
}

export function inventoryFor(scenario: Scenario, ownerId: string): Inventory {
  const owner = inventoryOwners(scenario).find(owner => owner.id === ownerId);
  if (!owner) throw new Error(`Unknown inventory owner ${ownerId}`);
  return owner.inventory ??= create(InventorySchema);
}

export function itemsFor(scenario: Scenario, ownerId: string): ItemInstance[] {
  return inventoryOwners(scenario).find(owner => owner.id === ownerId)?.inventory?.items ?? [];
}

export function locatedItems(scenario: Scenario) {
  return inventoryOwners(scenario).flatMap(owner => (owner.inventory?.items ?? []).map(item => ({ ...item, locationId: owner.id })));
}

export function findItem(scenario: Scenario, itemId: string): ItemInstance | undefined {
  return inventoryOwners(scenario).flatMap(owner => owner.inventory?.items ?? []).find(item => item.id === itemId);
}

/** Removes worn/attuned references before an item leaves its inventory. */
export function removeItem(scenario: Scenario, itemId: string): ItemInstance {
  const owner = inventoryOwners(scenario).find(owner => owner.inventory?.items.some(item => item.id === itemId));
  if (!owner?.inventory) throw new Error(`Unknown item ${itemId}`);
  const inventory = owner.inventory;
  const item = inventory.items.splice(inventory.items.findIndex(item => item.id === itemId), 1)[0]!;
  const equipment = inventory.equipment;
  if (equipment) {
    for (const slot of ["mainHandItemId", "offHandItemId", "armorItemId", "shieldItemId"] as const) {
      if (equipment[slot] === itemId) equipment[slot] = "";
    }
    equipment.attunedItemIds = equipment.attunedItemIds.filter(id => id !== itemId);
  }
  return item;
}

export function transferItem(scenario: Scenario, itemId: string, destinationId: string): ItemInstance {
  const destination = inventoryFor(scenario, destinationId);
  if (destination.items.some(item => item.id === itemId)) return destination.items.find(item => item.id === itemId)!;
  const item = removeItem(scenario, itemId);
  destination.items.push(item);
  return item;
}

export function validateInventories(scenario: Scenario): void {
  const ids = new Set<string>();
  for (const owner of inventoryOwners(scenario)) {
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
