import { INVALID_MOVE } from "boardgame.io/core";
import type { SimulationMoveContext } from "./simulation-move.js";
import { clone, create } from "@bufbuild/protobuf";
import { InventorySchema, ItemInstanceSchema, type Inventory, type ItemInstance } from "../../contracts/src/index.js";
import type { SimulationState } from "../../contracts/src/v2.js";
import { inventoryError, type InventoryOwner } from "./inventory.js";

const owners = (G: SimulationState): InventoryOwner[] => [
  ...Object.values(G.runtimeCharacters), ...(G.map?.fixtures ?? []), ...(G.map?.rooms ?? []),
];

function ownerFor(G: SimulationState, id: string): InventoryOwner | undefined {
  const matches = owners(G).filter(owner => owner.id === id);
  return matches.length === 1 ? matches[0] : undefined;
}

const validate = (G: SimulationState) => inventoryError(owners(G)) ? INVALID_MOVE : undefined;

/** Moves mutate the supplied draft. The executor owns acceptance and publication. */
export function replaceInventories({ G }: SimulationMoveContext, changes: readonly { ownerId: string; inventory: Inventory }[]) {
  if (!changes.length || new Set(changes.map(change => change.ownerId)).size !== changes.length) return INVALID_MOVE;
  for (const change of changes) {
    const owner = ownerFor(G, change.ownerId);
    if (!owner) return INVALID_MOVE;
    // Copy external input into state; this is not a staged copy of live state.
    owner.inventory = clone(InventorySchema, change.inventory);
  }
  return validate(G);
}

export function addToInventory({ G }: SimulationMoveContext, ownerId: string, item: ItemInstance) {
  const owner = ownerFor(G, ownerId);
  if (!owner) return INVALID_MOVE;
  (owner.inventory ??= create(InventorySchema)).items.push(clone(ItemInstanceSchema, item));
  return validate(G);
}

function remove(inventory: Inventory, itemId: string): ItemInstance | undefined {
  const index = inventory.items.findIndex(item => item.id === itemId);
  if (index < 0) return;
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

export function removeFromInventory({ G }: SimulationMoveContext, ownerId: string, itemId: string) {
  const inventory = ownerFor(G, ownerId)?.inventory;
  if (!inventory || !remove(inventory, itemId)) return INVALID_MOVE;
  return validate(G);
}

/** Transfers a whole item stack. Taking a fixture item also reveals it. */
export function transferBetweenInventories({ G }: SimulationMoveContext, from: string, to: string, itemId: string, options: { reveal?: boolean } = {}) {
  if (from === to) return INVALID_MOVE;
  const source = ownerFor(G, from)?.inventory, destination = ownerFor(G, to);
  if (!source || !destination) return INVALID_MOVE;
  const item = remove(source, itemId);
  if (!item) return INVALID_MOVE;
  if (options.reveal) item.concealed = false;
  (destination.inventory ??= create(InventorySchema)).items.push(item);
  return validate(G);
}
