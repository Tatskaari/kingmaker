// New (M5: problem reports): restore_game, a reported game made a new game in this database, for its owner (npm run report -- restore).
import { Identity, TimeDuration, Timestamp } from "spacetimedb";
import { isGameId } from "../../../shared/protocol/keys.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { rowsFromJson, type RowsByTable } from "../../../shared/report/rows.ts";
import { isAdmin } from "../access.ts";
import { Refused, type TxCtx } from "../context.ts";
import { restoreJob, type JobPlan } from "../jobs.ts";
import { seatPlayer } from "../rows.ts";
import { TABLES, type TableName } from "../tables.ts";
import { GAME_TABLES, type GameTable, type IdKind, type Row } from "./tables.ts";

/**
 * restore_game (V16, M5: docs/migration-log.md): the game a report of a problem holds, made a new
 * game here as it was reported, for the database's owner (`npm run report -- restore`), so the
 * player it's restored for carries on from that moment. Its rows (shared/report/rows.ts) are written
 * table by table (games/tables.ts) with new ids where the table gives them, every id column pointing
 * at the new rows, and the player's character's key (pc:<player id>) and their lines' speaker
 * (player:<player id>) wherever they're written with the new player's id. The game takes a new uid
 * (the AI service's folder for it, which the restore fills with the report's docs). Its host is
 * played by `identity`, seated in it now; whoever only watched it is left out. Each job it had in
 * flight is made again from the rows as they are now (jobs.ts restoreJob): a failed turn can be
 * retried, a turn under way thinks again. The game it came from, if this database has it, is never
 * touched.
 */

export interface RestoreArgs {
  /** The report's rows (GameReport.rows), as rows.ts writes them. */
  rows: string;
  /** The identity (hex) that plays the restored game: a session's. */
  identity: string;
  /** The new game's uid. */
  uid: string;
}

/** The SDK's classes a row may hold, for the rows' JSON. */
const SDK_CLASSES = { Identity, Timestamp, TimeDuration };

/** Each kind of id the game's rows point by: each old id to its new one. */
type IdMaps = Record<IdKind, Map<bigint, bigint>>;

/** A table's handle as the restore writes it: a row in, and a row changed by its primary key. */
interface Writable { insert(row: Row): Row }

export function restoreGameReducer(tx: TxCtx, sender: Identity, args: RestoreArgs): void {
  if (!isAdmin(tx, sender)) throw new Refused(refusal("not_admin", { what: "restore a game from a report" }));
  const rows = readRows(args.rows);
  const { game, host } = theGame(tx, rows, args.uid);
  const player = identityOf(args.identity);

  const ids = newIds();
  const kept = withoutSpectators(rows, host);

  writeOwnRows(tx, kept, ids, { uid: args.uid, player });
  pointOwnRows(tx, kept, ids);
  writeOtherRows(tx, kept, ids, { uid: args.uid, player });
  const jobs = rebuildJobs(tx, rows.job ?? [], ids);
  seatTheRestorer(tx, player, ids.player.get(host.id as bigint)!);

  tx.log(`[restore] game ${String(game.id)} ${String(game.uid)} as game ${String(ids.game.get(game.id as bigint))} ${args.uid}: ${countOf(kept)} rows, ${jobs} jobs made again`);
}

// ---------------------------------------------------------------------------------------------
// What's restored.

/** The report's rows, read: a refusal when they aren't rows.ts's JSON. */
function readRows(text: string): RowsByTable {
  try {
    const rows = rowsFromJson<RowsByTable>(text, SDK_CLASSES);
    if (rows && typeof rows === "object" && !Array.isArray(rows)) return rows;
  } catch { /* below */ }
  throw new Refused(refusal("bad_report", { why: "its rows aren't JSON" }));
}

/** The report's game and its host: one game, of a campaign version installed here, and a new uid no game here has. */
function theGame(tx: TxCtx, rows: RowsByTable, uid: string): { game: Row; host: Row } {
  const game = rows.game?.length === 1 ? rows.game[0]! : undefined;
  if (!game) throw new Refused(refusal("bad_report", { why: "it has no game in it" }));
  const campaign = `${String(game.campaign)}@${String(game.campaignVersion)}`;
  if (!tx.db.campaign.id.find(campaign)) {
    const here = [...tx.db.campaign.iter()].map(c => c.id).join(", ") || "none";
    throw new Refused(refusal("bad_report", { why: `it's a game of ${campaign}, and this stack has ${here} installed` }));
  }
  if (!isGameId(uid) || tx.db.game.uid.find(uid)) throw new Refused(refusal("bad_report", { why: `"${uid}" won't do as its uid (a game's id, and no game's here)` }));
  const host = (rows.player ?? []).find(p => p.id === game.hostId);
  if (!host) throw new Refused(refusal("bad_report", { why: "its host's player isn't in it" }));
  return { game, host };
}

function identityOf(hex: string): Identity {
  try {
    return Identity.fromString(hex);
  } catch {
    throw new Refused(refusal("bad_report", { why: `"${hex}" isn't an identity to restore it for` }));
  }
}

const newIds = (): IdMaps => ({ game: new Map(), player: new Map(), scene: new Map(), place: new Map(), entity: new Map(), turn: new Map(), fight: new Map() });

/** The rows to write: but whoever only watched the game (another player's rows, with what points at them), its seats (the restorer is seated), and its jobs (made again). */
function withoutSpectators(rows: RowsByTable, host: Row): RowsByTable {
  const players = (rows.player ?? []).filter(p => p.id === host.id);
  return { ...rows, player: players, seat: [], job: [], jobDispatch: [] };
}

const countOf = (rows: RowsByTable) => Object.values(rows).reduce((n, list) => n + list.length, 0);

// ---------------------------------------------------------------------------------------------
// Writing them.

/**
 * The rows others point at (the game, its players, places, scenes, entities, turns and fights),
 * written first, each with a new id, which its map keeps: their own pointers are put right after
 * (pointOwnRows). The game takes its new uid; its host, the restorer's identity, offline until they
 * connect.
 */
function writeOwnRows(tx: TxCtx, rows: RowsByTable, ids: IdMaps, made: { uid: string; player: Identity }): void {
  for (const table of GAME_TABLES.filter(t => t.own)) {
    for (const row of rows[table.table] ?? []) {
      const changes = table.table === "game" ? { uid: made.uid } : table.table === "player" ? { identity: made.player, online: false } : {};
      const written = handle(tx, table.table).insert(filled(table.table, { ...row, ...changes, id: 0n }));
      ids[table.own!].set(row.id as bigint, written.id as bigint);
    }
  }
}

/** The rows written first, each pointing at the new rows now (and the player's keys rewritten); one pointing at a row left out goes again. */
function pointOwnRows(tx: TxCtx, rows: RowsByTable, ids: IdMaps): void {
  for (const table of GAME_TABLES.filter(t => t.own)) {
    const byId = (tx.db[table.table] as unknown as { id: ById }).id;
    for (const row of rows[table.table] ?? []) {
      const id = ids[table.own!].get(row.id as bigint)!;
      const pointed = pointedRow(table, row, ids);
      if (!pointed) { byId.delete(id); continue; }
      byId.update(filled(table.table, { ...rewritten(pointed, ids), id, ...kept(table.table, byId.find(id)!) }));
    }
  }
}

/** A table's rows by their id, as the restore reads, changes and deletes them. */
interface ById { find(id: bigint): Row | null; update(row: Row): Row; delete(id: bigint): boolean }

/** What the first write set that a row's report doesn't: the game's new uid, its host's identity. */
function kept(table: TableName, now: Row): Row {
  if (table === "game") return { uid: now.uid };
  if (table === "player") return { identity: now.identity, online: now.online };
  return {};
}

/**
 * Every other table's rows, each pointing at the new rows, its own id new where the table gives
 * them; one pointing at a row left out (another player's) is left out with it. The game's creation,
 * if it's still on its sheet, becomes the restorer's, unless they're making a character already.
 */
function writeOtherRows(tx: TxCtx, rows: RowsByTable, ids: IdMaps, made: { uid: string; player: Identity }): void {
  for (const table of GAME_TABLES.filter(t => !t.own && !t.rebuilt)) {
    for (const row of rows[table.table] ?? []) {
      const pointed = pointedRow(table, row, ids);
      const mine = table.table === "creation" ? creationOf(tx, made) : {};
      if (!pointed || !mine) continue;
      const fresh = TABLES[table.table].autoInc ? { [TABLES[table.table].primaryKey]: 0n } : {};
      handle(tx, table.table).insert(filled(table.table, { ...rewritten(pointed, ids), ...fresh, ...mine }));
    }
  }
}

/** A creation row's identity and uid: the restorer's, and the new game's; none when the restorer is making a character of their own. */
function creationOf(tx: TxCtx, made: { uid: string; player: Identity }): Row | undefined {
  return tx.db.creation.identity.find(made.player) ? undefined : { identity: made.player, uid: made.uid };
}

/** A row pointing at the new rows: each id column's new id; an option pointing at a row left out is none; anything else pointing at one leaves the row out (undefined). */
function pointedRow(table: GameTable, row: Row, ids: IdMaps): Row | undefined {
  const out: Row = { ...row };
  for (const [column, kind] of Object.entries(table.refs ?? {})) {
    const old = row[column];
    if (old === undefined || old === null) continue;
    const id = ids[kind].get(old as bigint);
    if (id !== undefined) out[column] = id;
    else if (table.options?.includes(column)) out[column] = undefined;
    else return undefined;
  }
  return out;
}

/** The player's keys, rewritten: pc:<player id> (their character's) and player:<player id> (their lines' speaker), with the new ids, in every text of the row (JSON's too). */
function rewritten(row: Row, ids: IdMaps): Row {
  const players = ids.player;
  const swap = (text: string) => text.replace(/\b(pc|player):(\d+)\b/g, (whole, kind: string, id: string) => {
    const to = players.get(BigInt(id));
    return to === undefined ? whole : `${kind}:${to}`;
  });
  return walked(row, swap) as Row;
}

/** A value with each string in it passed through `swap`: arrays and plain objects walked, a class's instance (an Identity, a Timestamp) kept as it is. */
function walked(value: unknown, swap: (text: string) => string): unknown {
  if (typeof value === "string") return swap(value);
  if (Array.isArray(value)) return value.map(v => walked(v, swap));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walked(v, swap)]));
  }
  return value;
}

/** A row with each column it lacks that has a default taking it (a report from before the column was added), as a publish fills it. */
function filled(table: TableName, row: Row): Row {
  return { ...(TABLES[table] as { defaults?: Row }).defaults, ...row };
}

const handle = (tx: TxCtx, table: TableName) => tx.db[table] as unknown as Writable;

// ---------------------------------------------------------------------------------------------
// The jobs, and the restorer.

/**
 * Each job the game had in flight, made again from the rows as they are now: its plan's ids the new
 * ones (the game, the scene, the turn, the player, a look's things), its state as it was. One whose
 * ids aren't all the game's, or whose request can't be made again, is said in the log and left out.
 */
function rebuildJobs(tx: TxCtx, jobs: Row[], ids: IdMaps): number {
  let made = 0;
  for (const job of [...jobs].sort((a, b) => ((a.id as bigint) < (b.id as bigint) ? -1 : 1))) {
    const plan = planOf(job, ids);
    if (!plan) { tx.log(`[restore] job ${String(job.key)} left out: its plan names what isn't the game's`); continue; }
    try {
      restoreJob(tx, String(job.move), plan, job.state === "failed" ? String(job.error ?? "it had failed") : undefined);
      made++;
    } catch (e) {
      tx.log(`[restore] job ${String(job.key)} couldn't be made again: ${String(e)}`);
    }
  }
  return made;
}

/** A job's plan with the new ids, or none when one of its ids isn't the game's. */
function planOf(job: Row, ids: IdMaps): JobPlan | undefined {
  const plan = JSON.parse(String(job.plan)) as JobPlan & { player?: string; things?: Array<{ entityId: string }> };
  const newId = (kind: IdKind, old: string | undefined) => (old === undefined ? undefined : ids[kind].get(BigInt(old))?.toString());
  const out = { ...plan, game: newId("game", plan.game), scene: newId("scene", plan.scene), turn: newId("turn", plan.turn), player: newId("player", plan.player) };
  const things = plan.things?.map(t => ({ ...t, entityId: newId("entity", t.entityId) }));
  const lost = (["game", "scene", "turn", "player"] as const).some(k => plan[k] !== undefined && out[k] === undefined) || things?.some(t => t.entityId === undefined);
  if (lost) return undefined;
  return JSON.parse(JSON.stringify({ ...out, ...(things ? { things } : {}) })) as JobPlan;
}

/** The restorer seated in the new game as its host, played now: it's the one the title's Continue offers first. */
function seatTheRestorer(tx: TxCtx, player: Identity, hostId: bigint): void {
  seatPlayer(tx, player, hostId);
  const host = tx.db.player.id.find(hostId)!;
  tx.db.player.id.update({ ...host, lastPlayedAt: tx.now });
}
