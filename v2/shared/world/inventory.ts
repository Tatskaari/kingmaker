// Copied from the prototype's src/world/inventory.ts at 44c6d4a; dropped node:crypto with the strict read and commit (no callers), and startingPurse (campaign.json has it).

import { areaAt, areaOf, positionOf, spotNear, type Entity, type SceneWorld } from "./scene-world.ts";

/**
 * Inventories, as V1's inventory service had them (packages/core/src/inventory-service.ts): every
 * item belongs to exactly one owner (a person, a container, a room), and it changes hands only
 * through validated, all-or-nothing operations: add, remove, transfer (whole stacks or part of
 * one) and settle. In V2 the owner is simply the item's parent in the scene world, so where a thing
 * is and who has it can't disagree.
 */

export class InventoryError extends Error {}

export interface InventoryService {
  add(ownerId: string, item: { name: string; quantity?: number; description?: string; tags?: string[]; states?: string[]; id?: string }): string;
  remove(ownerId: string, itemId: string, quantity?: number): void;
  /** Hand over an item, or part of a stack ("two of the pennies"). */
  transfer(from: string, to: string, itemId: string, options?: { quantity?: number; reveal?: boolean }): string;
  /**
   * After the fact: the story has already put it in someone's hands (or on the table, or in the
   * sack). Find it wherever it is (anyone's inventory, inside their things, on the floor) and move
   * it there. Refuses only the impossible: what's gone, fixed in place or too big to carry, or a
   * thing put inside itself. Part of a stack moves what's there, up to the amount.
   */
  settle(itemId: string, toId: string, options?: { quantity?: number }): string;
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
  const log = (text: string) => world.log.push({ turn, text, by: "rules" });
  /** A stack (it has a count) moving whole to an owner who already has a stack of the same: it joins that one. */
  const joinStack = (item: Entity, toId: string): string | undefined => {
    if (item.quantity === undefined) return undefined;
    const like = Object.values(world.entities).find(i => i.id !== item.id && i.parent === toId && live(i) && i.name === item.name && i.quantity !== undefined);
    if (!like) return undefined;
    like.quantity = (like.quantity ?? 1) + item.quantity;
    delete world.entities[item.id];
    return like.id;
  };
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
      const joined = move === have ? joinStack(item, toId) : undefined;
      if (joined) { log(`${from.name} gives ${countOf(item.name, move)} to ${to.name}`); return joined; }
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
    settle(itemId, toId, options = {}) {
      const item = world.entities[itemId];
      if (!item || !live(item)) throw new InventoryError(`${itemId} isn't here any more`);
      if (!portable(item)) throw new InventoryError(`${item.name} can't be carried`);
      const to = world.entities[toId];
      if (!to || !live(to)) throw new InventoryError(`Unknown recipient ${toId}`);
      if (to.id === item.id || isWithin(world, to.id, item.id)) throw new InventoryError(`${item.name} can't go inside itself`);
      if (item.parent === to.id) return item.id;
      const from = ownerOf(world, item.id);
      const have = item.quantity ?? 1;
      const move = Math.min(have, options.quantity === undefined ? have : Math.max(1, Math.floor(options.quantity)));
      // A whole stack joins a like one there: a shilling picked up goes in with the shillings.
      const joined = move === have ? joinStack(item, to.id) : undefined;
      if (joined) { log(`${from && from.id !== to.id ? `${from.name} → ` : ""}${to.name}: ${countOf(item.name, move)}`); return joined; }
      let moved = item;
      if (move < have) {
        item.quantity = have - move;
        const like = Object.values(world.entities).find(i => i.parent === to.id && live(i) && i.name === item.name);
        if (like) { like.quantity = (like.quantity ?? 1) + move; log(`${to.name} now has ${move} more ${item.name}`); return like.id; }
        moved = { ...item, id: freshId(item.id), quantity: move, notes: [], created: turn };
        world.entities[moved.id] = moved;
      }
      place(moved, to, from);
      // Handed over, it's out in the open.
      moved.states = moved.states.filter(s => s !== "hidden");
      log(`${from && from.id !== to.id ? `${from.name} → ` : ""}${to.name}: ${move < have ? `${move} ` : ""}${moved.name}`);
      return moved.id;
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

/**
 * So many of a stack, in words: "pennies" and 1 is "a penny", 3 is "3 pennies"; no count is the
 * stack itself. A name that isn't a plural is "one of" it.
 */
export function countOf(name: string, n?: number): string {
  if (!n) return name;
  const bare = name.replace(/^(the|some) /i, "");
  if (n > 1) return `${n} ${bare}`;
  const one = /pennies$/i.test(bare) ? bare.replace(/pennies$/i, "penny") : /[^aeiou]ies$/i.test(bare) ? bare.replace(/ies$/i, "y") : /[^s]s$/i.test(bare) ? bare.slice(0, -1) : undefined;
  return one ? `${/^[aeiou]/i.test(one) ? "an" : "a"} ${one}` : `one of ${name}`;
}
