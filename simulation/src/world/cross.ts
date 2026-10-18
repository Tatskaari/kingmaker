// carriedFrom is the prototype's src/runtime/engine.ts:1423-1430 at 44c6d4a (carriedBy, copied whole) and :174 (each thing put in with its parent, or the player's hands); owedInto is owed.ts:213-233 (placeOwedThings) over the rows: a thing owed is its entity, found by its key, its copy's `at` dropped as trace (owed.ts:90-95) drops it, and it moves with its ids kept rather than being copied.

import type { OwedRow } from "../../../shared/gm/state.ts";
import { keysFor, localKey, pcKey, rowsToWorld, type Keys } from "../../../shared/world/rows.ts";
import type { Entity, SceneWorld } from "../../../shared/world/scene-world.ts";
import type { TxCtx } from "../context.ts";
import type { RowOf } from "../rows.ts";
import { placeRows } from "./rows-io.ts";

/**
 * The world across places (story-design §4.3, v3-design §3.7): a game's entities keep their keys
 * unique, so whoever and whatever goes on from one scene's place to the next moves there, its ids
 * kept, rather than being made again. Who moves: the player's character with what they carry (as the
 * prototype's next world gets `carried`), the recurring cast (Kell, Cob), and the things the story
 * still owes the player, with whoever holds them (the page in Cob's boot). A thing is re-keyed to
 * its new place (granary-yard/boots is drowned-rat/boots), since a thing's key is its place's.
 * Whatever a person leaving held that doesn't go with them stays where they stood.
 */

type EntityRow = RowOf<"entity">;
type Plain = Record<string, unknown>;

/** Every table that keeps a row per entity with its place copied in: each moves with the entity. */
const BY_ENTITY = ["position", "area", "material", "health", "stack", "surface", "creature", "playerCharacter", "gear", "narrative", "gmNote", "look"] as const;

interface ByEntity { entityId: { find(id: bigint): Plain | null; update(row: Plain): unknown; delete(id: bigint): boolean } }

const byEntity = (tx: TxCtx, t: (typeof BY_ENTITY)[number]) => tx.db[t] as unknown as ByEntity;

/**
 * An entity moves into another of its game's places, as `key` there: its row and every row kept by
 * it, their ids kept; what it's called is the new scene's word for it, when it has one (Cob is
 * "the pot-boy" at the Rat). What it held that isn't moving too stays behind (leaveBehind). The old
 * place's rev goes up.
 */
export function moveEntity(tx: TxCtx, entityId: bigint, to: { placeId: bigint; key: string; called?: string }, moving: ReadonlySet<bigint>): void {
  const e = tx.db.entity.id.find(entityId);
  if (!e) throw new Error(`no entity ${entityId} to move`);
  if (e.placeId === to.placeId && e.key === to.key) return;

  leaveBehind(tx, e, moving);
  tx.db.entity.id.update({ ...e, placeId: to.placeId, key: to.key, called: to.called ?? e.called });
  for (const t of BY_ENTITY) {
    const row = byEntity(tx, t).entityId.find(entityId);
    if (row && row.placeId !== to.placeId) byEntity(tx, t).entityId.update({ ...row, placeId: to.placeId });
  }
  const from = tx.db.place.id.find(e.placeId);
  if (from && from.id !== to.placeId) tx.db.place.id.update({ ...from, rev: from.rev + 1 });
}

/** An entity gone from the game, every row kept by it with it (a place's own thing a carried one of the same id replaces). */
export function dropEntity(tx: TxCtx, entityId: bigint): void {
  tx.db.entity.id.delete(entityId);
  for (const t of BY_ENTITY) byEntity(tx, t).entityId.delete(entityId);
  tx.db.onStage.entityId.delete(entityId);
}

/**
 * What someone (or something) leaving a place held that isn't going with them stays there, where
 * they stood (v3-design §3.7): with whatever held them that stays (the area they stood in), at their
 * spot. Cob's gutter stones stay in the yard when the page goes on in his boots.
 */
function leaveBehind(tx: TxCtx, from: EntityRow, moving: ReadonlySet<bigint>): void {
  const stays = [...tx.db.entity.placeId.filter(from.placeId)].filter(e => e.parentId === from.id && !moving.has(e.id));
  if (!stays.length) return;

  let holder = parentOf(tx, from);
  for (let n = 0; holder && moving.has(holder.id) && n < 12; n++) holder = parentOf(tx, holder);
  const parentId = holder?.id ?? tx.db.place.id.find(from.placeId)?.rootId;
  const spot = spotOf(tx, from, moving);

  for (const e of stays) {
    tx.db.entity.id.update({ ...e, parentId });
    if (!spot) continue;
    const at = { entityId: e.id, placeId: e.placeId, x: spot.x, y: spot.y };
    if (tx.db.position.entityId.find(e.id)) tx.db.position.entityId.update(at);
    else tx.db.position.insert(at);
  }
}

/** Where someone stood (or, held, whoever held them): their position row's spot. */
function spotOf(tx: TxCtx, e: EntityRow, moving: ReadonlySet<bigint>): { x: number; y: number } | undefined {
  for (let at: EntityRow | undefined = e, n = 0; at && n < 12; at = moving.has(at.id) ? parentOf(tx, at) : undefined, n++) {
    const position = tx.db.position.entityId.find(at.id);
    if (position) return { x: position.x, y: position.y };
  }
  return undefined;
}

const parentOf = (tx: TxCtx, e: EntityRow): EntityRow | undefined => (e.parentId === undefined ? undefined : (tx.db.entity.id.find(e.parentId) ?? undefined));

// ---------------------------------------------------------------------------------------------
// What goes on into the next place.

/** A world's things that come from elsewhere in the game: each one's entity, by the key it has in the new place. */
export type Moving = Map<string, bigint>;

/** Things moving into a place: their entities by their new keys, the keys they leave behind (old to new), and their names. */
export interface Going { moving: Moving; renamed: Map<string, string>; names: string[] }

/**
 * What the player carries, from the place their character is in now, into the world of the place
 * they're going to (engine.ts:174): everything they hold and what those hold, but what's gone, each
 * with its last two notes, put in with its holder, or in their hands; a clash with the new place's
 * own thing of that id is the carried one's (the prototype's object overwrite: `replaced`, the place's
 * own thing's keys). Their entities move in with their ids.
 */
export function carriedFrom(tx: TxCtx, controller: { id: bigint; placeId?: bigint; characterId?: bigint }, world: SceneWorld, keys: Keys): Going & { replaced: string[] } {
  const going: Going & { replaced: string[] } = { moving: new Map(), renamed: new Map(), names: [], replaced: [] };
  const from = placeWorld(tx, characterPlace(tx, controller), controller.id);
  if (!from?.world.entities.player || from.place === keys.placeKey) return going;

  const carried = carriedBy(from.world.entities, "player");
  for (const e of carried) {
    const key = `${keys.placeKey}/${e.id}`;
    if (world.entities[e.id]) going.replaced.push(key);
    world.entities[e.id] = { ...e, parent: e.parent && carried.some(c => c.id === e.parent) ? e.parent : "player" };
    const old = from.byLocal.get(e.id);
    if (!old) continue;
    going.moving.set(key, old.id);
    going.renamed.set(old.key, key);
    going.names.push(e.name);
  }
  return going;
}

/**
 * The things of what's owed go with whoever has them (owed.ts:213-233): into this world, when their
 * holder is someone here who isn't the player, as they were (the page still in the boot), with no
 * spot of their own (they're where their holder is), each with its last two notes. Something already
 * here by the same id stays as it is. Their entities move in with their ids, and each owed row's keys
 * follow them (`renamed`).
 */
export function owedInto(tx: TxCtx, gameId: bigint, world: SceneWorld, owed: OwedRow[], keys: Keys, controllerId: bigint): Going {
  const going: Going = { moving: new Map(), renamed: new Map(), names: [] };
  for (const o of owed) {
    const rows = o.things.map(key => entityByKey(tx, gameId, key)).filter((e): e is EntityRow => !!e);
    const ids = new Set(rows.map(r => r.id));
    for (const outer of rows.filter(r => r.parentId === undefined || !ids.has(r.parentId))) {
      const holder = parentOf(tx, outer);
      if (!holder || tx.db.playerCharacter.entityId.find(holder.id) || (holder.kind !== "person" && holder.kind !== "creature")) continue;
      const from = placeWorld(tx, outer.placeId, controllerId);
      if (!from || from.place === keys.placeKey) continue;
      const here = world.entities[localKey(holder.key, from.keys)];
      if (!here || here.player) continue;

      // The outer thing and everything in it, as they were.
      const things = [outer];
      for (let i = 0; i < things.length; i++) things.push(...rows.filter(r => r.parentId === things[i]!.id && !things.includes(r)));
      const locals = things.map(t => localKey(t.key, from.keys));
      if (locals.some(l => world.entities[l] || !from.world.entities[l])) continue;

      for (const [i, t] of things.entries()) {
        const { at: _at, ...copy } = from.world.entities[locals[i]!]!;
        world.entities[locals[i]!] = { ...copy, notes: copy.notes.slice(-2) };
        const key = `${keys.placeKey}/${locals[i]}`;
        going.moving.set(key, t.id);
        going.renamed.set(t.key, key);
      }
      going.names.push(outer.name);
    }
  }
  return going;
}

/** What's owed, its things' keys as they are now that they've moved. */
export function rekeyOwed(owed: OwedRow[], renamed: ReadonlyMap<string, string>): OwedRow[] {
  return owed.map(o => ({ ...o, things: o.things.map(k => renamed.get(k) ?? k) }));
}

/** Every seat in the game follows the story into a place and scene (the host's, and each spectator's): my_seat swaps their subscriptions. */
export function moveSeats(tx: TxCtx, gameId: bigint, placeId: bigint, sceneId: bigint | undefined): void {
  for (const p of [...tx.db.player.gameId.filter(gameId)]) {
    if (p.placeId !== placeId || p.sceneId !== sceneId) tx.db.player.id.update({ ...p, placeId, sceneId });
  }
}

// ---------------------------------------------------------------------------------------------

/** Everything someone holds, and what those things hold. */
export function carriedBy(entities: Record<string, Entity>, holder: string): Entity[] {
  const out: Entity[] = [];
  // Each once: a loop in the tree (something inside what it holds) mustn't go round for ever.
  const seen = new Set<string>([holder]);
  const walk = (id: string) => { for (const e of Object.values(entities).filter(x => x.parent === id && !x.states.includes("gone") && !seen.has(x.id))) { seen.add(e.id); out.push({ ...e, notes: e.notes.slice(-2) }); walk(e.id); } };
  walk(holder);
  return out;
}

/**
 * The place the player's character is in: their entity's. On a map that's the last scene's place,
 * where the character stays until the next scene opens (V3, as the map's take and pockets have it),
 * while their seat is on the map's own place, which has no world; their seat's when they have no
 * character in the world yet.
 */
function characterPlace(tx: TxCtx, controller: { placeId?: bigint; characterId?: bigint }): bigint | undefined {
  const me = controller.characterId === undefined ? undefined : tx.db.entity.id.find(controller.characterId);
  return me?.placeId ?? controller.placeId;
}

/** An entity of the game by its key, wherever it is. */
function entityByKey(tx: TxCtx, gameId: bigint, key: string): EntityRow | undefined {
  return [...tx.db.entity.byGameKey.filter([gameId, key])][0];
}

/**
 * A place's world as its rows have it, and its entities by their local ids (the controller's
 * character as "player"): its scene's key names its root, or its own key when no scene is played there.
 */
function placeWorld(tx: TxCtx, placeId: bigint | undefined, controllerId: bigint): { place: string; world: SceneWorld; keys: Keys; byLocal: Map<string, EntityRow> } | undefined {
  const place = placeId === undefined ? undefined : tx.db.place.id.find(placeId);
  if (!place) return undefined;
  const scene = place.sceneId === undefined ? undefined : tx.db.scene.id.find(place.sceneId);
  const keys = keysFor(place.key, scene?.sceneKey ?? place.key, pcKey(controllerId));
  const byLocal = new Map([...tx.db.entity.placeId.filter(place.id)].map(e => [localKey(e.key, keys), e] as const));
  return { place: place.key, world: rowsToWorld(placeRows(tx, place.id), keys), keys, byLocal };
}
