import type { Refusal } from "./refusals.ts";

/**
 * The wire between a client and a host of the simulation that isn't SpacetimeDB (browser-design §3):
 * the page's two workers joined by a MessagePort, or a test's MessageChannel. Messages, not calls, so
 * any channel can carry, log and replay them. Structured clone carries them as they are (bigints and
 * undefined kept), but leaves the SDK's classes only their fields: revive() puts the classes back,
 * handed in by whoever imports the SDK, since shared imports nothing outside itself.
 *
 *   client → server   connect {protocol, session?} first, a move {id, name, args} for each move, a
 *                     call {id, name, args} for each procedure (a report's game: M5), and
 *                     disconnect when the client goes (a port has no close event of its own)
 *   server → client   connected {identity}, a snapshot {tables} once, then a tx {changes} for each
 *                     committed transaction, an answer {id, rejection?, value?} for each move and
 *                     call (a call's value its procedure's text), and a status {trouble?, cutOff?}
 *                     while the server is in trouble
 *
 * What a server keeps to (the client and the e2e rely on it):
 * 1. Full push, not subscriptions: the snapshot and the txs carry every row of the public tables and
 *    the caller's own views, and the client filters, as it does over SpacetimeDB. One browser holds
 *    one player's games; a host on a network would filter by subscription instead.
 * 2. One tx for each committed transaction (a move, a job's claim or finish, a streamed reply, the
 *    reaper), with the net change for each primary key: an insert, an update (the final row, when the
 *    key was there before and after) or a delete (the row as it was), and the views' changes by their
 *    keys. A row the same before and after isn't sent. These are the SDK's own ops: the e2e's checks
 *    read them (a transcript row's insert and updates, each reply_draft event, each turn phase).
 * 3. A move's tx goes out before its answer, on the same port: the move's rows are in when it resolves.
 * 4. Private tables never cross: only CLIENT_TABLES do.
 * 5. The moves are PLAYER_MOVES, made as the caller, and OWNER_MOVES, made as the database's owner
 *    when the host allows them (testing). A refusal comes back as the rejection, any other throw as
 *    {code: "error", text}.
 * 6. connect's session names the caller's identity: the server mints one the first time it sees the
 *    name, and keeps it, so the same session comes back to the same games. No tokens: a port is the
 *    page's own.
 */

/** The wire's version, in connect: a server that doesn't speak it cuts the client off, saying so. (2: calls, M5.) */
export const PROTOCOL = 2;

/**
 * The caller's own views, by their SQL names, each with its accessor in the bindings and its primary
 * key: a server makes them for each caller (the memory host's view(identity)).
 */
export const CLIENT_VIEWS = {
  my_seat: { accessor: "mySeat", key: "playerId" },
  my_names: { accessor: "myNames", key: "entityId" },
  my_games: { accessor: "myGames", key: "gameId" },
  my_creation: { accessor: "myCreation", key: "identity" },
} as const;

/**
 * The public tables a client reads, by their SQL names, each with its accessor in the bindings and
 * its primary key: the campaigns, the games and their scenes, the story's, the places with their
 * worlds' rows, the map's, and a fight's (M6).
 */
export const PUBLIC_TABLES = {
  campaign: { accessor: "campaign", key: "id" },
  game: { accessor: "game", key: "id" },
  player: { accessor: "player", key: "id" },
  sheet: { accessor: "sheet", key: "playerId" },
  scene: { accessor: "scene", key: "id" },
  transcript: { accessor: "transcript", key: "id" },
  reply_draft: { accessor: "replyDraft", key: "turnId" },
  turn: { accessor: "turn", key: "id" },
  on_stage: { accessor: "onStage", key: "entityId" },
  look: { accessor: "look", key: "entityId" },
  scene_suggestion: { accessor: "sceneSuggestion", key: "id" },
  chapter: { accessor: "chapter", key: "sceneId" },
  quest: { accessor: "quest", key: "id" },
  flag: { accessor: "flag", key: "id" },
  journal: { accessor: "journal", key: "id" },
  attitude: { accessor: "attitude", key: "id" },
  follower: { accessor: "follower", key: "id" },
  place: { accessor: "place", key: "id" },
  entity: { accessor: "entity", key: "id" },
  position: { accessor: "position", key: "entityId" },
  area: { accessor: "area", key: "entityId" },
  material: { accessor: "material", key: "entityId" },
  health: { accessor: "health", key: "entityId" },
  stack: { accessor: "stack", key: "entityId" },
  surface: { accessor: "surface", key: "entityId" },
  creature: { accessor: "creature", key: "entityId" },
  player_character: { accessor: "playerCharacter", key: "entityId" },
  gear: { accessor: "gear", key: "entityId" },
  narrative: { accessor: "narrative", key: "entityId" },
  world_log: { accessor: "worldLog", key: "id" },
  map_def: { accessor: "mapDef", key: "id" },
  explore: { accessor: "explore", key: "playerId" },
  fight: { accessor: "fight", key: "id" },
  fight_event: { accessor: "fightEvent", key: "id" },
} as const;

/** Every table and view a client watches (the client's Watched): the only ones that cross. */
export const CLIENT_TABLES = { ...CLIENT_VIEWS, ...PUBLIC_TABLES } as const;

export type ClientView = keyof typeof CLIENT_VIEWS;
export type PublicTable = keyof typeof PUBLIC_TABLES;
export type ClientTable = keyof typeof CLIENT_TABLES;

/** A row as the wire carries it: its columns by the bindings' names (camelCase). */
export type Row = Record<string, unknown>;
export type RowOp = "insert" | "update" | "delete";

/** One row's net change in a transaction: an insert's or update's row as it is now, a delete's as it was; an update's old row, when the server sends it. */
export interface RowChange { table: ClientTable; op: RowOp; row: Row; old?: Row }

/** Why a move wasn't made: the simulation's refusal, in the game's words, or what went wrong (the client's Rejection, client/backend.ts). */
export type Rejection = Refusal | { code: "error"; text: string };

/**
 * The moves a client makes as itself, by their names in the bindings (and the memory host's Caller):
 * a scene's, the map's (its action menu's too: town-design §3.2), character creation's, the games',
 * the story's between scenes, and a fight's (M6: a zoo ring started, the fight's own acts). Never
 * installCampaign, dispatchWaiting, setDiceSeed or streamReply, which aren't a player's.
 */
export const PLAYER_MOVES = [
  "newGame", "joinGame", "say", "retryTurn", "setSuggestions",
  "walk", "interact", "travel",
  "cast", "attack", "useFeature", "leap", "hide", "rest", "useItem",
  "startCreation", "creationBack", "chooseBuild", "makeOwn", "pickOwn", "takeOwn", "setBackstory", "draftBackstory", "workInBackstory",
  "takeProposal", "leaveProposal", "finishBackstory", "acceptFix", "rewriteIssue", "skipBackstory", "chooseAgain",
  "begin", "continueGame", "deleteGame", "carryOn", "fightItOut",
  "startRing", "fightTurn", "fightSay", "visitZoo", "openExhibit",
] as const;

/** The moves only the database's owner may make, for testing (story-design §4.5: /end): a host makes them as the owner, when it allows them. */
export const OWNER_MOVES = ["endScene"] as const;

/** A move's name on the wire. */
export type MoveWire = (typeof PLAYER_MOVES)[number] | (typeof OWNER_MOVES)[number];

/** The procedures a client calls as itself, by their names in the bindings: report_game, a report's game (V16, M5), which only the game's owner may ask for. */
export const PLAYER_CALLS = ["reportGame"] as const;

/** A procedure's name on the wire. */
export type CallWire = (typeof PLAYER_CALLS)[number];

/** What a client sends: who it is first, then its moves, each with an id its answer comes back with. */
export type ToServer =
  | { kind: "connect"; protocol: typeof PROTOCOL; session?: string }
  | { kind: "move"; id: number; name: MoveWire; args: unknown }
  | { kind: "call"; id: number; name: CallWire; args: unknown }
  | { kind: "disconnect" };

/** What a server sends: who the client is, everything it may see, each transaction's changes, each move's answer, and its own trouble. */
export type ToClient =
  /** The caller's identity, as hex. */
  | { kind: "connected"; identity: string }
  /** Every row of every client table, once, after connected: the views made for the caller. */
  | { kind: "snapshot"; tables: Record<ClientTable, Row[]> }
  /** One committed transaction's net changes, in order. */
  | { kind: "tx"; changes: RowChange[] }
  /** A move's answer, after its tx: no rejection when it was made. A call's: its procedure's text (value), or why not. */
  | { kind: "answer"; id: number; rejection?: Rejection; value?: string }
  /** The server's trouble, in words for the status line: while it lasts (trouble), or for good (cutOff: every move is refused with it). */
  | { kind: "status"; trouble?: string; cutOff?: string };

/**
 * A primary key's value as a Map key, the same on both sides of the wire: a u64, a string, or an
 * identity (an Identity, or what structured clone leaves of one: its __identity__).
 */
export function keyOf(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "string") return JSON.stringify(value);
  const identity = typeof value === "object" && value !== null ? (value as { __identity__?: unknown }).__identity__ : undefined;
  if (typeof identity === "bigint") return `identity:${identity}`;
  throw new Error(`A client table's key is a u64, a string or an identity, not a ${typeof value}.`);
}

/** A row's key in its table: its primary key's value, keyed. */
export function rowKey(table: ClientTable, row: Row): string {
  return keyOf(row[CLIENT_TABLES[table].key]);
}

/** The SDK's classes a row may hold, each made from the bigint it keeps: handed to revive by whoever imports the SDK. */
export interface SdkClasses {
  Identity: new (value: bigint) => object;
  Timestamp: new (micros: bigint) => object;
  TimeDuration: new (micros: bigint) => object;
}

/** Each class by the one field structured clone leaves of it: the SDK's own names for them. */
const MARKS = new Map<string, keyof SdkClasses>([
  ["__identity__", "Identity"],
  ["__timestamp_micros_since_unix_epoch__", "Timestamp"],
  ["__time_duration_micros__", "TimeDuration"],
]);

/**
 * A value as structured clone left it (a row from a port, or from IndexedDB) with the SDK's classes
 * put back: {__identity__: n} is an Identity again, {__timestamp_micros_since_unix_epoch__: n} a
 * Timestamp, {__time_duration_micros__: n} a TimeDuration (a ScheduleAt's interval). Arrays and plain
 * objects are walked, and copied; anything else (a class's instance, a bigint, undefined) is kept.
 */
export function revive<T>(value: T, classes: SdkClasses): T {
  return revived(value, classes) as T;
}

function revived(value: unknown, classes: SdkClasses): unknown {
  if (Array.isArray(value)) return value.map(item => revived(item, classes));
  if (!isPlainObject(value)) return value;

  const fields = Object.entries(value);
  const kind = fields.length === 1 ? classOf(fields[0]!) : undefined;
  if (kind) return new classes[kind](fields[0]![1] as bigint);

  return Object.fromEntries(fields.map(([name, field]) => [name, revived(field, classes)]));
}

/** The SDK class a lone field is what's left of: its name is the class's, and it holds a bigint. */
function classOf([name, field]: [string, unknown]): keyof SdkClasses | undefined {
  return typeof field === "bigint" ? MARKS.get(name) : undefined;
}

/** An object of fields alone, from any realm (its prototype is an Object.prototype, or none): not a class's instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}
