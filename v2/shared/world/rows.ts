// Copied from the scratchpad's tools/world-rows-check.mts (keys, worldToRows, rowsToWorld); the rows take the tables' TypeScript names, sort by entity.ord, and new entities get provisional ids.

import type { Entity, Note, SceneWorld, WorldEvent, WorldOp } from "./scene-world.ts";

/**
 * The world as rows, and back: the place's rows table by table, as the simulation reads them in
 * one transaction (v0-design §3.1, content-world B2), and the prototype's SceneWorld that the copied
 * world code runs on. The simulation rebuilds the world from rows, applies the stage manager's
 * operations, and writes it back; the AI service rebuilds it to render it. Round trips are exact:
 * every tag and state word stays in `narrative`, in order (`gone` is `entity.gone`).
 *
 * Ids are strings here, since they travel in JSON. An entity this world has that `prev` didn't
 * gets a provisional id, `new:<ord>`, which the simulation's writer swaps for the one SpacetimeDB
 * gives it.
 */

type Id = string;

export interface WorldNote { text: string; turn: number; by: Note["by"] }

export interface EntityRow {
  id: Id; placeId: Id;
  /** Insertion order: the order the copied renderers list things in. */
  ord: number;
  /** The entity's key in the game (`kell`, `pc:1`, `granary-yard/elm`): see fullKey. */
  key: string;
  parentId?: Id;
  name: string;
  /** What players call it until they've heard its name (a cast member's `called`): the simulation's, kept as it was. */
  called?: string;
  kind: string;
  prefab?: string;
  createdTurn?: number;
  gone: boolean;
}

/** A place's rows (the log's last lines, not all of them, when sent to the AI service). */
export interface PlaceRows {
  place: { id: Id; key: string; name: string; rootId: Id; sizeW: number; sizeH: number; round: number; rev: number };
  entity: EntityRow[];
  position: Array<{ entityId: Id; placeId: Id; x: number; y: number }>;
  area: Array<{ entityId: Id; placeId: Id; x: number; y: number; w: number; h: number }>;
  material: Array<{ entityId: Id; placeId: Id; material?: string; size?: string }>;
  health: Array<{ entityId: Id; placeId: Id; hp: number; maxHp: number; ac?: number }>;
  stack: Array<{ entityId: Id; placeId: Id; quantity: number }>;
  surface: Array<{ entityId: Id; placeId: Id; radiusFt?: number; roundsLeft?: number }>;
  creature: Array<{ entityId: Id; placeId: Id; castKey?: string; statblock?: string; weapon?: string }>;
  playerCharacter: Array<{ entityId: Id; placeId: Id; playerId: Id }>;
  gear: Array<{ entityId: Id; placeId: Id; engineItem: string }>;
  narrative: Array<{ entityId: Id; placeId: Id; states: string[]; tags: string[]; notes: WorldNote[] }>;
  gmNote: Array<{ entityId: Id; placeId: Id; description: string }>;
  worldLog: Array<{ placeId: Id; seq: number; round: number; text: string; by: string; cause?: string }>;
}

/**
 * How a game's keys and the world's local ids meet. Prompts and applyOps see the prototype's ids:
 * the controller's character is `player`, the place's root is `<scene key>:place`, everything else
 * its bare id.
 */
export interface Keys {
  placeKey: string;
  sceneKey: string;
  /** Each player character's key (`pc:<player id>`) and the player it belongs to. */
  players: Record<string, Id>;
  /** The key of the character that is `player` here: the scene's controller's. */
  controller: string;
}

/** A player's character's key in the game. */
export const pcKey = (playerId: Id | bigint) => `pc:${playerId}`;

/**
 * The keys for a place's rows in a scene, its controller's character (`pc`, "pc:<player id>") as
 * `player`: what the simulation and the AI service both build them from (PlaceRows.place.key, the
 * scene's key, TurnContext.pc), so the two map keys alike.
 */
export function keysFor(placeKey: string, sceneKey: string, pc: string): Keys {
  return { placeKey, sceneKey, players: { [pc]: pc.replace(/^pc:/, "") }, controller: pc };
}

/** Is this an id the simulation hasn't given out yet (an entity new since the rows were read)? */
export const isNewId = (id: Id) => id.startsWith("new:");

/** A world entity's key in the game: the controller's character, the root as the place, cast and other players' characters as they are, the rest under the place. */
export const fullKey = (local: string, e: Pick<Entity, "cast" | "player"> | undefined, k: Keys) =>
  local === "player" ? k.controller : local === `${k.sceneKey}:place` ? k.placeKey : e?.cast || e?.player ? local : `${k.placeKey}/${local}`;

/** A game key as the world names it locally. */
export const localKey = (key: string, k: Keys) =>
  key === k.controller ? "player" : key === k.placeKey ? `${k.sceneKey}:place` : key.startsWith(`${k.placeKey}/`) ? key.slice(k.placeKey.length + 1) : key;

/**
 * A world as rows. `prev`, when there is one, is the rows the world was rebuilt from
 * (rowsToWorld(prev)): entities keep the ids and order they had there (by key), and new ones get
 * the next places in order and provisional ids; the log keeps prev's lines and appends the world's
 * since. Without it, every id is provisional.
 */
export function worldToRows(world: SceneWorld, k: Keys, prev?: PlaceRows): PlaceRows {
  const ids = idsByKey(world, k, prev);
  const placeId = prev?.place.id ?? "new:place";
  const root = world.entities[world.root]!;
  const rows: PlaceRows = {
    place: { id: placeId, key: k.placeKey, name: root.name, rootId: ids.of(world.root).id, sizeW: root.rect!.w, sizeH: root.rect!.h, round: prev?.place.round ?? 0, rev: (prev?.place.rev ?? 0) + 1 },
    entity: [], position: [], area: [], material: [], health: [], stack: [], surface: [], creature: [], playerCharacter: [], gear: [], narrative: [], gmNote: [],
    worldLog: logRows(world, placeId, prev),
  };

  for (const [local, e] of Object.entries(world.entities)) addEntity(rows, k, ids, local, e);

  rows.entity.sort((a, b) => a.ord - b.ord);
  return rows;
}

/** Rows back into the prototype's SceneWorld (the AI service's read, and the simulation's before it applies operations). */
export function rowsToWorld(rows: PlaceRows, k: Keys): SceneWorld {
  const local = new Map(rows.entity.map(e => [e.id, localKey(e.key, k)]));
  const parts = componentsById(rows);
  const entities: Record<string, Entity> = {};

  for (const r of [...rows.entity].sort((a, b) => a.ord - b.ord)) entities[local.get(r.id)!] = entityOf(r, local, parts);

  const log = rows.worldLog.map(l => ({ turn: l.round, text: l.text, by: l.by as WorldEvent["by"] }));
  return { scene: k.sceneKey, root: `${k.sceneKey}:place`, entities, log };
}

/** A stage manager's operation with the world's local ids swapped for the game's keys (the AI service's answer). */
export function opToGame(op: WorldOp, world: SceneWorld, k: Keys): WorldOp {
  const key = (sel: string) => (world.entities[sel] ? fullKey(sel, world.entities[sel], k) : sel);
  return { ...op, what: key(op.what), to: key(op.to) };
}

/** An operation from the AI service with the game's keys swapped back for the world's local ids (the simulation's, before applyOps). */
export function opToLocal(op: WorldOp, k: Keys): WorldOp {
  return { ...op, what: localKey(op.what, k), to: localKey(op.to, k) };
}

// ---------------------------------------------------------------------------------------------
// worldToRows's parts.

/** Each local id's row id and order: kept from `prev` by key, the next ones (in insertion order) for the rest. */
function idsByKey(world: SceneWorld, k: Keys, prev?: PlaceRows) {
  const kept = new Map(prev?.entity.map(e => [e.key, e]) ?? []);
  const given = new Map<string, { id: Id; ord: number; key: string }>();
  let next = Math.max(0, ...[...kept.values()].map(e => e.ord)) + 1;
  for (const local of Object.keys(world.entities)) {
    const key = fullKey(local, world.entities[local], k);
    const before = kept.get(key);
    given.set(local, before ? { id: before.id, ord: before.ord, key } : { id: `new:${next}`, ord: next++, key });
  }
  const of = (local: string) => given.get(local)!;
  const parentOf = (local: string, parent: string) => {
    if (!given.has(parent)) throw new Error(`${local} is held by ${parent}, which isn't in the world`);
    return of(parent);
  };
  return { of, parentOf, prev: (key: string) => kept.get(key) };
}

/** `prev`'s log lines, then the world's lines since (numbered on from the last). */
function logRows(world: SceneWorld, placeId: Id, prev?: PlaceRows): PlaceRows["worldLog"] {
  const before = prev?.worldLog ?? [];
  const last = Math.max(0, ...before.map(l => l.seq));
  const fresh = world.log.slice(before.length).map((l, i) => ({ placeId, seq: last + i + 1, round: l.turn, text: l.text, by: l.by }));
  return [...before.map(l => ({ ...l })), ...fresh];
}

/** One entity's rows: a component row only where its field is present; every word in `narrative`. */
function addEntity(rows: PlaceRows, k: Keys, ids: ReturnType<typeof idsByKey>, local: string, e: Entity): void {
  const { id, ord, key } = ids.of(local);
  const at = { entityId: id, placeId: rows.place.id };
  const before = ids.prev(key);
  rows.entity.push({
    id, placeId: rows.place.id, ord, key, name: e.name, kind: e.kind, gone: e.states.includes("gone"),
    ...(e.parent ? { parentId: ids.parentOf(local, e.parent).id } : {}),
    ...(before?.called !== undefined ? { called: before.called } : {}), ...(before?.prefab !== undefined ? { prefab: before.prefab } : {}),
    ...(e.created !== undefined ? { createdTurn: e.created } : {}),
  });
  if (e.at) rows.position.push({ ...at, x: e.at.x, y: e.at.y });
  if (e.rect) rows.area.push({ ...at, ...e.rect });
  if (e.material !== undefined || e.size !== undefined) rows.material.push({ ...at, ...(e.material !== undefined ? { material: e.material } : {}), ...(e.size !== undefined ? { size: e.size } : {}) });
  if (e.hp) rows.health.push({ ...at, hp: e.hp.current, maxHp: e.hp.max, ...(e.ac !== undefined ? { ac: e.ac } : {}) });
  else if (e.ac !== undefined) throw new Error(`${local}: AC without HP`);
  if (e.quantity !== undefined) rows.stack.push({ ...at, quantity: e.quantity });
  if (e.radius !== undefined || e.ttl !== undefined) rows.surface.push({ ...at, ...(e.radius !== undefined ? { radiusFt: e.radius } : {}), ...(e.ttl !== undefined ? { roundsLeft: e.ttl } : {}) });
  if (e.cast !== undefined || e.stats) rows.creature.push({ ...at, ...(e.cast !== undefined ? { castKey: e.cast } : {}), ...(e.stats ? { statblock: e.stats.statblock, ...(e.stats.weapon !== undefined ? { weapon: e.stats.weapon } : {}) } : {}) });
  if (e.player) rows.playerCharacter.push({ ...at, playerId: playerOf(k, key) });
  if (e.gear) rows.gear.push({ ...at, engineItem: e.gear });
  rows.narrative.push({ ...at, states: e.states.filter(s => s !== "gone"), tags: [...e.tags], notes: e.notes.map(n => ({ ...n })) });
  if (e.description !== undefined) rows.gmNote.push({ ...at, description: e.description });
}

function playerOf(k: Keys, key: string): Id {
  const player = k.players[key];
  if (player === undefined) throw new Error(`${key} is a player's character, but Keys.players doesn't name its player`);
  return player;
}

// ---------------------------------------------------------------------------------------------
// rowsToWorld's parts.

function componentsById(rows: PlaceRows) {
  const by = <T extends { entityId: Id }>(list: T[]) => new Map(list.map(r => [r.entityId, r]));
  return {
    position: by(rows.position), area: by(rows.area), material: by(rows.material), health: by(rows.health), stack: by(rows.stack), surface: by(rows.surface),
    creature: by(rows.creature), playerCharacter: by(rows.playerCharacter), gear: by(rows.gear), narrative: by(rows.narrative), gmNote: by(rows.gmNote),
  };
}

/** An entity as the prototype has it, its fields in the order its builders write them. */
function entityOf(r: EntityRow, local: Map<Id, string>, parts: ReturnType<typeof componentsById>): Entity {
  const words = parts.narrative.get(r.id), m = parts.material.get(r.id), h = parts.health.get(r.id), s = parts.surface.get(r.id), c = parts.creature.get(r.id);
  const pos = parts.position.get(r.id), area = parts.area.get(r.id), note = parts.gmNote.get(r.id), stack = parts.stack.get(r.id), gear = parts.gear.get(r.id);
  return {
    id: local.get(r.id)!, name: r.name, kind: r.kind as Entity["kind"], parent: r.parentId !== undefined ? local.get(r.parentId)! : null,
    ...(pos ? { at: { x: pos.x, y: pos.y } } : {}),
    ...(area ? { rect: { x: area.x, y: area.y, w: area.w, h: area.h } } : {}),
    ...(m?.size != null ? { size: m.size as Entity["size"] } : {}), ...(m?.material != null ? { material: m.material as Entity["material"] } : {}),
    ...(h?.ac != null ? { ac: h.ac } : {}), ...(h ? { hp: { current: h.hp, max: h.maxHp } } : {}),
    tags: [...(words?.tags ?? [])], states: [...(words?.states ?? []), ...(r.gone ? ["gone"] : [])], notes: (words?.notes ?? []).map(n => ({ ...n })),
    ...(note ? { description: note.description } : {}),
    ...(c?.castKey != null ? { cast: c.castKey } : {}),
    ...(stack ? { quantity: stack.quantity } : {}),
    ...(s?.radiusFt != null ? { radius: s.radiusFt } : {}), ...(s?.roundsLeft != null ? { ttl: s.roundsLeft } : {}),
    ...(gear ? { gear: gear.engineItem } : {}),
    ...(c?.statblock != null ? { stats: { statblock: c.statblock, ...(c.weapon != null ? { weapon: c.weapon } : {}) } } : {}),
    ...(parts.playerCharacter.has(r.id) ? { player: true } : {}),
    ...(r.createdTurn != null ? { created: r.createdTurn } : {}),
  };
}
