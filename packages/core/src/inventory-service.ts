import { clone, toJson } from "@bufbuild/protobuf";
import { InventorySchema, ItemInstanceSchema, type Inventory, type ItemInstance } from "../../contracts/src/index.js";
import { addToInventory, removeFromInventory, transferBetweenInventories, replaceInventories } from "./simulation-inventory.js";
import { canonical, sha256 } from "./state-version.js";
import type { SimulationState } from "../../contracts/src/v2.js";
import type { SimulationMove } from "./simulation-move.js";

export interface InventorySnapshot { actorId: string; sha: string; inventory: Inventory | undefined }
export class InventoryConflictError extends Error {
  constructor(readonly actorId: string) { super(`${actorId}: inventory changed; read it again before editing`); }
}
export interface InventoryService {
  addToInventory(ownerId: string, item: ItemInstance): Promise<void>;
  removeFromInventory(ownerId: string, itemId: string): Promise<void>;
  transferBetweenInventories(from: string, to: string, itemId: string): Promise<void>;
  read(actorId: string): Promise<InventorySnapshot>;
  commit(changes: readonly { actorId: string; expectedSha: string; inventory: Inventory }[]): Promise<void>;
}

/** Inventory operations need simulation access and execution, never AI documents. */
interface InventoryHost {
  currentSimulation(): SimulationState;
  write<T>(action: () => Promise<T>): Promise<T>;
  executeMove<Args extends unknown[]>(move: SimulationMove<Args>, ...args: Args): void;
}

/** Character inventories are simulation state; document edits never change their versions. */
export function createInventoryService(store: InventoryHost): InventoryService {
  const character = (id: string) => {
    const actor = store.currentSimulation().runtimeCharacters[id];
    if (!actor) throw new Error(`Unknown runtime character: ${id}`);
    return actor;
  };
  const version = (id: string) => JSON.stringify(canonical(character(id).inventory
    ? toJson(InventorySchema, character(id).inventory!) : null));
  return {
    addToInventory: (id, item) => {
      const input = clone(ItemInstanceSchema, item);
      return store.write(async () => store.executeMove(addToInventory, id, input));
    },
    removeFromInventory: (id, itemId) => store.write(async () => store.executeMove(removeFromInventory, id, itemId)),
    transferBetweenInventories: (from, to, itemId) => store.write(async () => store.executeMove(transferBetweenInventories, from, to, itemId)),
    async read(actorId) {
      const inventory = character(actorId).inventory;
      const snapshot = inventory && clone(InventorySchema, inventory);
      const sha = await sha256(version(actorId));
      return { actorId, sha, inventory: snapshot };
    },
    commit: changes => store.write(async () => {
      if (!changes.length || new Set(changes.map(change => change.actorId)).size !== changes.length) throw new Error("Inventory updates require distinct owners");
      const expected = new Map<string, string>();
      for (const change of changes) {
        const current = version(change.actorId);
        if (await sha256(current) !== change.expectedSha) throw new InventoryConflictError(change.actorId);
        expected.set(change.actorId, current);
      }
      // Mechanics can run while hashes await. Recheck before publishing any inventory.
      for (const [id, before] of expected) if (version(id) !== before) throw new InventoryConflictError(id);
      store.executeMove(replaceInventories, changes.map(change => ({ ownerId: change.actorId, inventory: change.inventory })));
    }),
  };
}
