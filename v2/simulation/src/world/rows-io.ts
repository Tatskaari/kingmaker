import { idText } from "../../../shared/protocol/keys.ts";
import { isNewId, type EntityRow, type PlaceRows } from "../../../shared/world/rows.ts";
import type { TxCtx } from "../context.ts";
import { placeRow, type RowOf } from "../rows.ts";

/**
 * A place's rows as shared/world/rows.ts has them (ids as strings, entities in order, the log's last
 * lines), read in one transaction; and a world written back over the rows it was rebuilt from
 * (content-world B2): entities keep their ids by key, new ones are inserted in order and given the
 * ids SpacetimeDB makes, changed rows are updated, a vanished entity's rows deleted, the log
 * appended. Only what changed is written.
 */

/** The world's component tables, by the names PlaceRows and the module both use. */
const COMPONENTS = ["position", "area", "material", "health", "stack", "surface", "creature", "playerCharacter", "gear", "narrative", "gmNote"] as const;
type Component = (typeof COMPONENTS)[number];

/** Each component's option columns: an insert names every column, so the ones PlaceRows leaves out go in as undefined. */
const OPTIONS: Record<Component, string[]> = {
  position: [], area: [], material: ["material", "size"], health: ["ac"], stack: [], surface: ["radiusFt", "roundsLeft"],
  creature: ["castKey", "statblock", "weapon"], playerCharacter: [], gear: [], narrative: [], gmNote: [],
};

/** The log lines a place's rows carry: all that worldView's "Lately" reads, and all the AI service is sent. */
export const LOG_TAIL = 6;

/** What writing a world needs besides its rows: the game it's in, and what a new cast member is called until their name is heard. */
export interface PlaceContext { gameId: bigint; called(key: string): string | undefined }

type Plain = Record<string, unknown>;
/** A component table as the writer drives it: every one has these accessors. */
interface ComponentTable {
  placeId: { filter(id: bigint): Iterable<Plain> };
  entityId: { update(row: Plain): unknown; delete(id: bigint): boolean };
  insert(row: Plain): unknown;
}

export function placeRows(tx: TxCtx, placeId: bigint): PlaceRows {
  const place = placeRow(tx, placeId);
  const components = Object.fromEntries(COMPONENTS.map(c => [c, componentRows(tx, c, placeId)])) as unknown as Pick<PlaceRows, Component>;
  return {
    place: { id: idText(place.id), key: place.key, name: place.name, rootId: idText(place.rootId), sizeW: place.sizeW, sizeH: place.sizeH, round: place.round, rev: place.rev },
    entity: [...tx.db.entity.placeId.filter(placeId)].sort((a, b) => a.ord - b.ord).map(e => plain(withoutGame(e)) as unknown as EntityRow),
    ...components,
    worldLog: logTail(tx, placeId),
  };
}

/**
 * A world written as rows: `after` is shared's worldToRows of the world, rebuilt from this place's
 * rows (or new, the place too, when it has none yet). What's stored now is compared with it row by
 * row, and only the differences are written. Returns the place's id and the id each entity has, by key.
 */
export function writePlace(tx: TxCtx, after: PlaceRows, context: PlaceContext): { placeId: bigint; idOf(key: string): bigint } {
  const placeId = isNewId(after.place.id) ? insertPlace(tx, after, context.gameId) : BigInt(after.place.id);
  const real = insertNewEntities(tx, after, placeId, context);

  writeEntities(tx, after, placeId, real);
  removeVanished(tx, after, placeId, real);
  for (const c of COMPONENTS) writeComponent(tx, c, after[c], placeId, real);
  appendLog(tx, after, placeId);
  updatePlace(tx, after, placeId, real);

  const byKey = new Map(after.entity.map(e => [e.key, real(e.id)]));
  return { placeId, idOf: key => byKey.get(key) ?? fail(`no entity ${key} in place ${placeId}`) };
}

// ---------------------------------------------------------------------------------------------
// Reading.

function componentRows(tx: TxCtx, c: Component, placeId: bigint): Plain[] {
  return [...table(tx, c).placeId.filter(placeId)].sort((a, b) => ((a.entityId as bigint) < (b.entityId as bigint) ? -1 : 1)).map(plain);
}

function logTail(tx: TxCtx, placeId: bigint): PlaceRows["worldLog"] {
  const lines = [...tx.db.worldLog.placeId.filter(placeId)].sort((a, b) => a.seq - b.seq).slice(-LOG_TAIL);
  return lines.map(({ id, ...line }) => { void id; return plain(line) as unknown as PlaceRows["worldLog"][number]; });
}

/** A row as PlaceRows has it: ids as strings, empty options left out. */
function plain(row: Plain): Plain {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "bigint" ? idText(v) : v]));
}

const withoutGame = ({ gameId, ...rest }: RowOf<"entity">): Plain => { void gameId; return rest; };

const table = (tx: TxCtx, c: Component) => tx.db[c] as unknown as ComponentTable;

// ---------------------------------------------------------------------------------------------
// Writing.

/** A new place's row: its root comes once its entities have ids (updatePlace). */
function insertPlace(tx: TxCtx, after: PlaceRows, gameId: bigint): bigint {
  const p = after.place;
  return tx.db.place.insert({
    id: 0n, gameId, key: p.key, name: p.name, rootId: 0n, sizeW: p.sizeW, sizeH: p.sizeH, round: p.round, rev: p.rev, sceneId: undefined,
    mapKey: undefined, region: undefined, origin: undefined, active: false,
  }).id;
}

/** Each new entity inserted, in order (its parent set in writeEntities, which may be newer still); provisional ids resolve to the ones given. */
function insertNewEntities(tx: TxCtx, after: PlaceRows, placeId: bigint, context: PlaceContext): (id: string) => bigint {
  const given = new Map<string, bigint>([[after.place.id, placeId]]);
  for (const e of after.entity.filter(e => isNewId(e.id))) {
    refuseTakenKey(tx, context.gameId, e.key);
    const called = e.called ?? context.called(e.key);
    const row = tx.db.entity.insert({ ...entityIn(e, context.gameId, placeId, id => (isNewId(id) ? given.get(id) : BigInt(id))), id: 0n, called });
    given.set(e.id, row.id);
  }
  return id => (isNewId(id) ? (given.get(id) ?? fail(`no id was given to ${id}`)) : BigInt(id));
}

/** Every entity whose row differs from the stored one, updated (a new one's parent, which may be newer still, among them). Its `called` is the simulation's: kept as it was set. */
function writeEntities(tx: TxCtx, after: PlaceRows, placeId: bigint, real: (id: string) => bigint): void {
  for (const e of after.entity) {
    const stored = tx.db.entity.id.find(real(e.id)) ?? fail(`entity ${e.key} wasn't written`);
    const row = { ...entityIn(e, stored.gameId, placeId, real), called: stored.called };
    if (!same(plain(row), plain(stored))) tx.db.entity.id.update(row);
  }
}

/** An entity that left the world (a stack that joined another): its rows go. */
function removeVanished(tx: TxCtx, after: PlaceRows, placeId: bigint, real: (id: string) => bigint): void {
  const kept = new Set(after.entity.map(e => real(e.id)));
  for (const e of [...tx.db.entity.placeId.filter(placeId)]) {
    if (kept.has(e.id)) continue;
    tx.db.entity.id.delete(e.id);
    for (const c of COMPONENTS) table(tx, c).entityId.delete(e.id);
  }
}

/** One component table: rows inserted, updated or deleted where they differ from the stored ones. */
function writeComponent(tx: TxCtx, c: Component, after: Plain[], placeId: bigint, real: (id: string) => bigint): void {
  const stored = new Map([...table(tx, c).placeId.filter(placeId)].map(r => [r.entityId as bigint, r]));
  const rows = after.map(r => componentIn(c, r, placeId, real));

  for (const row of rows) {
    const old = stored.get(row.entityId as bigint);
    if (!old) table(tx, c).insert(row);
    else if (!same(plain(row), plain(old))) table(tx, c).entityId.update(row);
  }
  const now = new Set(rows.map(r => r.entityId as bigint));
  for (const entityId of stored.keys()) if (!now.has(entityId)) table(tx, c).entityId.delete(entityId);
}

/** The log's new lines: those numbered past the last one stored. */
function appendLog(tx: TxCtx, after: PlaceRows, placeId: bigint): void {
  const last = Math.max(0, ...[...tx.db.worldLog.placeId.filter(placeId)].map(l => l.seq));
  for (const l of after.worldLog.filter(l => l.seq > last)) {
    tx.db.worldLog.insert({ id: 0n, placeId, seq: l.seq, round: l.round, text: l.text, by: l.by, cause: l.cause });
  }
}

function updatePlace(tx: TxCtx, after: PlaceRows, placeId: bigint, real: (id: string) => bigint): void {
  const p = after.place;
  tx.db.place.id.update({ ...placeRow(tx, placeId), name: p.name, rootId: real(p.rootId), sizeW: p.sizeW, sizeH: p.sizeH, round: p.round, rev: p.rev });
}

/** An entity's row, its ids as `real` resolves them (a new one's own id and parent, when they're still to come, as 0 and none). */
function entityIn(e: EntityRow, gameId: bigint, placeId: bigint, real: (id: string) => bigint | undefined): RowOf<"entity"> {
  return {
    id: real(e.id) ?? 0n, gameId, placeId, ord: e.ord, key: e.key,
    parentId: e.parentId === undefined ? undefined : real(e.parentId),
    name: e.name, called: e.called, kind: e.kind, prefab: e.prefab, createdTurn: e.createdTurn, gone: e.gone,
  };
}

function componentIn(c: Component, r: Plain, placeId: bigint, real: (id: string) => bigint): Plain {
  const blanks = Object.fromEntries(OPTIONS[c].map(k => [k, undefined]));
  return { ...blanks, ...r, entityId: real(r.entityId as string), placeId, ...(c === "playerCharacter" ? { playerId: BigInt(r.playerId as string) } : {}) };
}

/** A key is unique in its game (the schema can't say so across two columns: content-world B2). */
function refuseTakenKey(tx: TxCtx, gameId: bigint, key: string): void {
  if ([...tx.db.entity.byGameKey.filter([gameId, key])].length) throw new Error(`game ${gameId} already has an entity ${key}`);
}

/** Two rows alike, whatever order their fields came in. */
function same(a: Plain, b: object): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
}

function fail(message: string): never {
  throw new Error(message);
}
