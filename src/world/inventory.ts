import { createHash } from "node:crypto";
import { areaAt, areaOf, positionOf, spotNear, type Entity, type SceneWorld } from "./scene-world.ts";

/**
 * Inventories, as V1's inventory service had them (packages/core/src/inventory-service.ts): every
 * item belongs to exactly one owner (a person, a container, a room), and it changes hands only
 * through validated, all-or-nothing operations: add, remove, transfer (whole stacks or part of
 * one), and commit (several owners rearranged at once, against the versions read). In V2 the owner
 * is simply the item's parent in the scene world, so where a thing is and who has it can't disagree.
 */

export class InventoryError extends Error {}
export class InventoryConflictError extends InventoryError {
  ownerId: string;
  constructor(ownerId: string) { super(`${ownerId}: inventory changed; read it again before editing`); this.ownerId = ownerId; }
}

export interface ItemView { id: string; name: string; quantity: number; states: string[]; concealed: boolean; gear?: string }
export interface InventorySnapshot { ownerId: string; version: string; items: ItemView[] }

export interface InventoryService {
  read(ownerId: string): InventorySnapshot;
  add(ownerId: string, item: { name: string; quantity?: number; description?: string; tags?: string[]; states?: string[]; id?: string }): string;
  remove(ownerId: string, itemId: string, quantity?: number): void;
  /** Hand over an item, or part of a stack ("two of the pennies"). */
  transfer(from: string, to: string, itemId: string, options?: { quantity?: number; reveal?: boolean }): string;
  /** Rearrange several owners' items at once, if nobody's inventory changed since it was read. */
  commit(changes: Array<{ ownerId: string; expectedVersion: string; items: string[] }>): void;
}

const OWNER_KINDS = new Set(["person", "creature", "area", "place"]);
const isOwner = (e: Entity) => OWNER_KINDS.has(e.kind) || e.tags.includes("container");
/** The owner has it: in hand, or inside something of theirs that isn't an owner itself (a page sewn into the boots he wears). */
function holds(world: SceneWorld, ownerId: string, item: Entity): boolean {
  for (let p = item.parent, n = 0; p && n < 20; n++) {
    if (p === ownerId) return true;
    const e = world.entities[p];
    if (!e || isOwner(e)) return false;
    p = e.parent;
  }
  return false;
}
const portable = (e: Entity) => e.kind === "item" || (e.kind === "object" && !e.tags.includes("fixed") && e.size !== "huge" && e.size !== "gargantuan");
const live = (e: Entity) => !e.states.includes("gone");

export function inventory(world: SceneWorld, turn: number): InventoryService {
  const owner = (id: string): Entity => {
    const e = world.entities[id];
    if (!e || !live(e)) throw new InventoryError(`Unknown owner ${id}`);
    if (!isOwner(e)) throw new InventoryError(`${e.name} can't hold things`);
    return e;
  };
  const itemsOf = (ownerId: string) => Object.values(world.entities).filter(e => e.parent === ownerId && live(e) && portable(e));
  const view = (e: Entity): ItemView => ({ id: e.id, name: e.name, quantity: e.quantity ?? 1, states: e.states, concealed: e.states.includes("hidden") || e.tags.includes("hidden"), ...(e.gear ? { gear: e.gear } : {}) });
  const version = (ownerId: string) => createHash("sha256").update(JSON.stringify(itemsOf(ownerId).map(view).sort((a, b) => a.id.localeCompare(b.id)))).digest("hex").slice(0, 16);
  const log = (text: string) => world.log.push({ turn, text, by: "rules" });
  const freshId = (base: string) => { let id = base; for (let n = 2; world.entities[id]; n++) id = `${base}-${n}`; return id; };
  // An item put down in a room sits near whoever put it there.
  const place = (item: Entity, to: Entity, from?: Entity) => {
    item.parent = to.id;
    if (to.kind === "area" || to.kind === "place") {
      item.at = from && positionOf(world, from.id) ? spotNear(world, from.id, 3) : positionOf(world, to.id) ?? { x: 0, y: 0 };
      item.parent = areaAt(world, item.at).id;
    } else delete item.at;
  };

  return {
    read(ownerId) {
      owner(ownerId);
      return { ownerId, version: version(ownerId), items: itemsOf(ownerId).map(view) };
    },
    add(ownerId, spec) {
      const to = owner(ownerId);
      const quantity = Math.max(1, Math.floor(spec.quantity ?? 1));
      // Like goes with like: more pennies join the pennies already in the purse.
      const same = itemsOf(ownerId).find(i => i.name === spec.name && (i.quantity ?? 1) >= 1 && !spec.id);
      if (same && spec.quantity !== undefined) { same.quantity = (same.quantity ?? 1) + quantity; log(`${to.name} gains ${quantity} ${spec.name}`); return same.id; }
      const id = freshId(spec.id ?? (spec.name.toLowerCase().replace(/^(a|an|the|some) /, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "item"));
      const item: Entity = { id, name: spec.name, kind: "item", parent: null, tags: spec.tags ?? [], states: spec.states ?? [], notes: [], ...(spec.description ? { description: spec.description } : {}), ...(quantity > 1 || spec.quantity !== undefined ? { quantity } : {}), created: turn };
      world.entities[id] = item;
      place(item, to);
      log(`${to.name} now has ${quantity > 1 ? `${quantity} ` : ""}${spec.name}`);
      return id;
    },
    remove(ownerId, itemId, quantity) {
      const from = owner(ownerId);
      const item = world.entities[itemId];
      if (!item || item.parent !== ownerId || !live(item)) throw new InventoryError(`${from.name} doesn't have ${itemId}`);
      const have = item.quantity ?? 1;
      const take = quantity === undefined ? have : Math.floor(quantity);
      if (take < 1 || take > have) throw new InventoryError(`${from.name} has ${have} of ${item.name}, not ${take}`);
      if (take < have) item.quantity = have - take;
      else item.states = [...item.states, "gone"];
      log(`${from.name} uses up ${take < have ? `${take} of ` : ""}${item.name}`);
    },
    transfer(fromId, toId, itemId, options = {}) {
      if (fromId === toId) throw new InventoryError("An item can't be transferred to the owner who already has it");
      const from = owner(fromId), to = owner(toId);
      const item = world.entities[itemId];
      if (!item || !live(item)) throw new InventoryError(`No item ${itemId}`);
      if (!holds(world, fromId, item)) throw new InventoryError(`${from.name} doesn't have ${item.name}${item.parent ? ` (${world.entities[item.parent]?.name ?? item.parent} does)` : ""}`);
      if (!portable(item)) throw new InventoryError(`${item.name} can't be carried`);
      if (to.id === item.id || isWithin(world, to.id, item.id)) throw new InventoryError(`${item.name} can't go inside itself`);
      const have = item.quantity ?? 1;
      const move = options.quantity === undefined ? have : Math.floor(options.quantity);
      if (move < 1 || move > have) throw new InventoryError(`${from.name} has ${have} of ${item.name}, not ${move}`);
      let moved = item;
      if (move < have) {
        // Part of a stack: the rest stays, the part moves (joining a like stack if there is one).
        item.quantity = have - move;
        const like = itemsOf(toId).find(i => i.name === item.name);
        if (like) { like.quantity = (like.quantity ?? 1) + move; log(`${from.name} gives ${move} ${item.name} to ${to.name}`); return like.id; }
        moved = { ...item, id: freshId(item.id), quantity: move, notes: [], created: turn };
        world.entities[moved.id] = moved;
      }
      place(moved, to, from);
      if (options.reveal) moved.states = moved.states.filter(s => s !== "hidden");
      log(`${from.name} gives ${move < have ? `${move} ` : ""}${moved.name} to ${to.name}`);
      return moved.id;
    },
    commit(changes) {
      if (!changes.length || new Set(changes.map(c => c.ownerId)).size !== changes.length) throw new InventoryError("Inventory updates need distinct owners");
      for (const c of changes) { owner(c.ownerId); if (version(c.ownerId) !== c.expectedVersion) throw new InventoryConflictError(c.ownerId); }
      // Nothing appears or vanishes: the same items, shared out differently among these owners.
      const before = new Set(changes.flatMap(c => itemsOf(c.ownerId).map(i => i.id)));
      const after = changes.flatMap(c => c.items);
      if (after.length !== new Set(after).size) throw new InventoryError("An item can't have two owners");
      if (after.length !== before.size || after.some(id => !before.has(id))) throw new InventoryError("A commit can only rearrange the items these owners already hold");
      for (const c of changes) for (const id of c.items) {
        const item = world.entities[id]!;
        if (item.parent !== c.ownerId) { const from = world.entities[item.parent ?? ""]; place(item, world.entities[c.ownerId]!, from); log(`${item.name} goes to ${world.entities[c.ownerId]!.name}`); }
      }
    },
  };
}

function isWithin(world: SceneWorld, id: string, ancestor: string): boolean {
  for (let e = world.entities[id], n = 0; e && n < 20; e = e.parent ? world.entities[e.parent] : undefined, n++) if (e.id === ancestor) return true;
  return false;
}

/** Who has an item, following the tree up to the nearest owner (a person, a container, a room). */
export function ownerOf(world: SceneWorld, itemId: string): Entity | undefined {
  const parent = world.entities[itemId]?.parent;
  for (let e = parent ? world.entities[parent] : undefined, n = 0; e && n < 20; e = e.parent ? world.entities[e.parent] : undefined, n++) if (isOwner(e)) return e;
  return areaOf(world, itemId);
}

/** A starting purse in Caerwyn's coin: crowns, shillings and pennies (twelve pennies to the shilling, five shillings to the crown). */
export function startingPurse(): Array<{ name: string; quantity: number; description: string }> {
  return [
    { name: "silver crowns", quantity: 2, description: "Heavy silver with the King's face, a little worn." },
    { name: "shillings", quantity: 6, description: "Silver, five to the crown." },
    { name: "pennies", quantity: 12, description: "Copper, twelve to the shilling, and the currency of the Drowned Rat." },
  ];
}
