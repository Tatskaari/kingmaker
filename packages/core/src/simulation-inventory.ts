import { clone, create } from "@bufbuild/protobuf";
import { InventorySchema, ItemInstanceSchema, type Inventory, type ItemInstance } from "../../contracts/src/index.js";
import type { SimulationState } from "../../contracts/src/v2.js";
import { validateInventories, type InventoryOwner } from "./inventory.js";

const owners = (G: SimulationState): InventoryOwner[] => [
  ...Object.values(G.runtimeCharacters), ...(G.map?.fixtures ?? []), ...(G.map?.rooms ?? []),
];

function ownerFor(G: SimulationState, id: string): InventoryOwner {
  const matches = owners(G).filter(owner => owner.id === id);
  if (matches.length !== 1) throw new Error(`Unknown or ambiguous inventory owner ${id}`);
  return matches[0]!;
}

function stage(G: SimulationState, id: string): Inventory {
  const inventory = ownerFor(G, id).inventory;
  return inventory ? clone(InventorySchema, inventory) : create(InventorySchema);
}

/** Validate the complete batch before publishing; only changed inventories are copied. */
export function replaceInventories(G: SimulationState, changes: readonly { ownerId: string; inventory: Inventory }[]): void {
  if (!changes.length || new Set(changes.map(change => change.ownerId)).size !== changes.length) {
    throw new Error("Inventory updates require distinct owners");
  }
  const replacements = new Map(changes.map(change => [ownerFor(G, change.ownerId), clone(InventorySchema, change.inventory)]));
  validateInventories(owners(G).map(owner => ({ id: owner.id, inventory: replacements.get(owner) ?? owner.inventory })));
  for (const [owner, inventory] of replacements) owner.inventory = inventory;
}

export function addToInventory(G: SimulationState, ownerId: string, item: ItemInstance): void {
  const inventory = stage(G, ownerId);
  inventory.items.push(clone(ItemInstanceSchema, item));
  replaceInventories(G, [{ ownerId, inventory }]);
}

function remove(inventory: Inventory, itemId: string): ItemInstance {
  const index = inventory.items.findIndex(item => item.id === itemId);
  if (index < 0) throw new Error(`Item ${itemId} is not carried by this owner`);
  const item = inventory.items.splice(index, 1)[0]!;
  const equipment = inventory.equipment;
  if (equipment) {
    for (const slot of ["mainHandItemId", "offHandItemId", "armorItemId", "shieldItemId"] as const) {
      if (equipment[slot] === itemId) equipment[slot] = "";
    }
    equipment.attunedItemIds = equipment.attunedItemIds.filter(id => id !== itemId);
  }
  return item;
}

export function removeFromInventory(G: SimulationState, ownerId: string, itemId: string): void {
  const inventory = stage(G, ownerId);
  remove(inventory, itemId);
  replaceInventories(G, [{ ownerId, inventory }]);
}

/** Transfers a whole item stack. Taking a fixture item also reveals it. */
export function transferBetweenInventories(G: SimulationState, from: string, to: string, itemId: string, options: { reveal?: boolean } = {}): void {
  if (from === to) throw new Error("Inventory transfer requires different owners");
  const source = stage(G, from), destination = stage(G, to);
  const item = remove(source, itemId);
  if (options.reveal) item.concealed = false;
  destination.items.push(item);
  replaceInventories(G, [{ ownerId: from, inventory: source }, { ownerId: to, inventory: destination }]);
}
