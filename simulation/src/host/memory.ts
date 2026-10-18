import { Identity, Timestamp } from "spacetimedb";
import type { ViewCtx } from "spacetimedb/server";
import { rng } from "../../../shared/dice.ts";
import { HEADERS } from "../../../shared/protocol/ai.ts";
import type { Refusal } from "../../../shared/protocol/refusals.ts";
import type { InstallArgs } from "../../../shared/scene/files.ts";
import type { Rules } from "../../../shared/rules/types.ts";
import { isService } from "../access.ts";
import { NOT_CONFIGURED, outcomeOf, type AiOutcome, type Claim } from "../ai-call.ts";
import { Refused, type Db, type Env, type Schema, type TxCtx } from "../context.ts";
import { seedOf, setDiceSeedReducer } from "../dice-seed.ts";
import * as creation from "../creation/moves.ts";
import * as games from "../games/moves.ts";
import { installCampaignReducer } from "../install.ts";
import { claimJob, dispatchWaitingReducer, failJob, finishJob, reapJobs } from "../jobs.ts";
import { initDatabase } from "../lifecycle.ts";
import * as acts from "../map/acts.ts";
import * as map from "../map/moves.ts";
import { tickPlace } from "../map/tick.ts";
import { joinGameReducer } from "../moves/join-game.ts";
import { newGameReducer } from "../moves/new-game.ts";
import { retryTurnReducer } from "../moves/retry-turn.ts";
import { sayReducer } from "../moves/say.ts";
import { setSuggestionsReducer } from "../moves/set-suggestions.ts";
import { loadRules } from "../rules/load.ts";
import * as story from "../story/moves.ts";
import { streamReplyReducer } from "../stream.ts";
import { TABLES, type TableName } from "../tables.ts";
import { myCreationView, myGamesView, myNamesView, mySeatView } from "../views.ts";

/**
 * The simulation without SpacetimeDB (v0-design §4.5): the same moves, job functions and views
 * over tables kept in Maps, for tests and the local host. Each call is a transaction (a throw rolls
 * back every write it made); the clock moves only when told to; the game's seeds and uuids come
 * from a fixed sequence, so a run replays (the owner's set_dice_seed fixes the seeds as it does on
 * SpacetimeDB: dice-seed.ts); the rules engine is the module's own, loaded once in the
 * process; and run_job is drain(): each due dispatch claimed, POSTed through the injected `ai`, and
 * committed, exactly as index.ts does it.
 *
 * A host for real play (the page's, in a browser worker: browser-design §4.2) injects the rest of
 * what SpacetimeDB would be: a real clock; a listener told each commit's net change to the rows, as
 * SpacetimeDB tells a subscriber, to keep and to push; the rows a previous run committed, to start
 * from; a log; and the AI service's identity. It runs the jobs as SpacetimeDB's scheduler does:
 * dispatchDue() after a commit that dispatched, and reap() on the reaper's interval.
 */

/** What a think's POST got back: a status and body, and the headers that matter (x-km-replayed). */
export interface AiReply { status: number; body: string; headers?: Record<string, string> }

/**
 * The AI service as the memory host reaches it. Throwing stands for a refused or reset connection.
 * `timeoutMs` is the claim's, which index.ts gives SpacetimeDB's fetch: a host that makes real POSTs
 * gives up on one that takes longer (the memory host only passes it on).
 */
export type AiPost = (endpoint: string, body: string, headers: Record<string, string>, options?: { timeoutMs: number }) => Promise<AiReply>;

export interface MemoryHostOptions {
  ai: AiPost;
  /** The game's randomness: dice seeds and uuids. */
  seed?: number;
  /** Where tx.uuid() comes from, in place of the seeded sequence: a source that repeats, as SpacetimeDB's generator does for about 3% of transactions. */
  uuid?: () => string;
  /** The database's own identity (tx.database()): another host may stand for another database. */
  database?: Identity;
  /** AI_URL, AI_TOKEN, AI_IDENTITY: the defaults reach `ai` as the service below. */
  env?: Env;
  /** The rules engine: the module's (simulation/src/rules/load.ts) unless a test hands in its own. */
  rules?: () => Rules;
  /** Each transaction's time, read as it begins (a real clock, for real play); else the manual clock, from a fixed start, that only advance() moves. */
  clock?: () => Timestamp;
  /**
   * Told each committed transaction's net change, once the transaction has closed (so it may start
   * another): init's too, as memoryHost() makes a new database, before it returns. A transaction
   * that threw, or left every row and counter as it found them, tells it nothing. A throw from it is
   * logged: the commit stands.
   */
  onCommit?: (changes: ChangeSet) => void;
  /** The rows a previous run committed, to start from: put in before init runs (which then finds its owner and reaper there). */
  restore?: Restore;
  /** Where tx.log's lines go, in place of `logs` (which then stays empty), so a host that runs for hours keeps none. */
  log?: (line: string) => void;
  /** The AI service's identity (stream_reply's caller), in place of the memory host's own: the default env's AI_IDENTITY, and an env given with it must name it. */
  service?: Identity;
}

/**
 * A previous run's rows, by table: Identities and Timestamps as their classes (revived from a
 * structured clone), in any order. They're kept in their primary keys' order (an autoInc table's is
 * the order they were inserted in), and a column added since a row was saved takes its default
 * (tables.ts), as a publish fills it. Each autoInc counter carries on from its saved value (a
 * ChangeSet's sequences), or past the table's highest id when that's further on.
 */
export interface Restore {
  rows: Partial<Record<TableName, Row[]>>;
  sequences?: Partial<Record<TableName, bigint>>;
}

/** A row as the memory host keeps it: the columns by their TypeScript names. */
export type Row = Record<string, unknown>;

/**
 * One row's net change in a committed transaction, as SpacetimeDB tells a subscriber of it: an
 * insert; an update, when the key was there before and after (`old` is the row as it was); or a
 * delete, with the row as it was. A row inserted and deleted in one transaction, or written back
 * as it was, is no change; one deleted and inserted again with its key is an update.
 */
export interface RowChange {
  /** The table's accessor (jobDispatch); its SQL name (job_dispatch) is the snake_case of it. */
  table: TableName;
  /** The row's primary key as the memory host keys it (keyOf): the same row's, whatever the change. */
  key: string;
  op: "insert" | "update" | "delete";
  row: Row;
  old?: Row;
}

/**
 * A committed transaction's net change: each row's, in the order the transaction first wrote it
 * (copies, as every row handed out is), and the next id of each autoInc table it inserted into,
 * for a host that keeps them (its counter never goes back, so `changes` may be empty when a row was
 * inserted and deleted again).
 */
export interface ChangeSet {
  changes: RowChange[];
  sequences: Partial<Record<TableName, bigint>>;
}

export type StreamArgs = Parameters<typeof streamReplyReducer>[2];

/** A move's body, as index.ts registers it: the caller and the reducer's arguments. */
type Body<A> = (tx: TxCtx, sender: Identity, args: A) => void;
/** The move, as a caller makes it (with no arguments, when none are needed): the refusal, or nothing when it was made. */
type Made<B> = B extends Body<infer A> ? ({} extends A ? (args?: A) => Refusal | undefined : (args: A) => Refusal | undefined) : never;

/** Character creation's moves, the games' (v1-design §3.3), the map's (map-design §3.2) and its action menu's (town-design §3.2), and the story's between scenes (story-design §4.3), by their bodies' names. */
const MOVES = {
  startCreation: creation.startCreationReducer, creationBack: creation.creationBackReducer, chooseBuild: creation.chooseBuildReducer,
  makeOwn: creation.makeOwnReducer, pickOwn: creation.pickOwnReducer, takeOwn: creation.takeOwnReducer, setBackstory: creation.setBackstoryReducer,
  draftBackstory: creation.draftBackstoryReducer, workInBackstory: creation.workInBackstoryReducer, takeProposal: creation.takeProposalReducer,
  leaveProposal: creation.leaveProposalReducer, finishBackstory: creation.finishBackstoryReducer, acceptFix: creation.acceptFixReducer,
  rewriteIssue: creation.rewriteIssueReducer, skipBackstory: creation.skipBackstoryReducer, chooseAgain: creation.chooseAgainReducer,
  begin: games.beginReducer, continueGame: games.continueGameReducer, deleteGame: games.deleteGameReducer,
  walk: map.walkReducer, interact: map.interactReducer, travel: map.travelReducer,
  cast: acts.castReducer, attack: acts.attackReducer, useFeature: acts.useFeatureReducer, leap: acts.leapReducer, hide: acts.hideReducer, rest: acts.restReducer, useItem: acts.useItemReducer,
  carryOn: story.carryOnReducer, fightItOut: story.fightItOutReducer, endScene: story.endSceneReducer,
};

/** A caller's moves: each returns the refusal, or nothing when it was made. */
export type Caller = { [M in keyof typeof MOVES]: Made<(typeof MOVES)[M]> } & {
  newGame(args: Parameters<typeof newGameReducer>[2]): Refusal | undefined;
  joinGame(args: Parameters<typeof joinGameReducer>[2]): Refusal | undefined;
  say(args: Parameters<typeof sayReducer>[2]): Refusal | undefined;
  retryTurn(args: Parameters<typeof retryTurnReducer>[2]): Refusal | undefined;
  setSuggestions(args: Parameters<typeof setSuggestionsReducer>[2]): Refusal | undefined;
  installCampaign(args: InstallArgs): Refusal | undefined;
  dispatchWaiting(): Refusal | undefined;
  setDiceSeed(args: Parameters<typeof setDiceSeedReducer>[2]): Refusal | undefined;
};

export interface MemoryHost {
  db: Db;
  /** The database's owner (init's publisher) and the AI service (AI_IDENTITY). */
  owner: Identity;
  service: Identity;
  logs: string[];
  as(identity: Identity): Caller;
  /** stream_reply, as the AI service unless `from` says otherwise. */
  streamReply(args: StreamArgs, from?: Identity): Refusal | undefined;
  /** run_job for every dispatch that's due, until none is. Several drains may run at once. */
  drain(): Promise<void>;
  /**
   * run_job for every dispatch that's due now, each started at once and none awaited, as
   * SpacetimeDB's scheduler runs them: the claims commit in order, the POSTs overlap, and each
   * answer commits as it lands. Each promise settles once its run is over; a run that throws (a bug)
   * is logged, as a procedure's panic is, never rejected.
   */
  dispatchDue(): Array<Promise<void>>;
  /** reap_jobs, once, at the clock's time: what a real-time host runs on the reaper row's interval. */
  reap(): void;
  /**
   * tick_place (town-design §3.5) for every place_tick row, each in a transaction of its own, at the
   * clock's time: what a real-time host runs every 6 s (the rows' interval), and a test when it likes.
   * A tick that throws is logged, as a scheduled reducer's panic is, and the rest still run.
   */
  tickPlaces(): void;
  /** The manual clock moves on, and the reaper runs (refused on an injected clock: its time isn't the host's to move). */
  advance(ms: number): void;
  view(identity: Identity): { mySeat(): ReturnType<typeof mySeatView>; myNames(): ReturnType<typeof myNamesView>; myCreation(): ReturnType<typeof myCreationView>; myGames(): ReturnType<typeof myGamesView> };
  /** A body in a transaction of its own: a test's way to read rows, or to change one. */
  transact<T>(body: (tx: TxCtx) => T): T;
  now(): Timestamp;
}

/** A fixed start, so logs and times replay. */
const START = Date.UTC(2026, 9, 16, 9, 0, 0);
/** drain()'s guard against a job loop that never settles. */
const MAX_DISPATCHES = 500;

export function memoryHost(options: MemoryHostOptions): MemoryHost {
  const owner = new Identity(0xa11cen), service = options.service ?? new Identity(0x5e7f1cen);
  const env: Env = options.env ?? { AI_URL: "http://ai.memory", AI_TOKEN: "memory-bearer", AI_IDENTITY: service.toHexString() };
  if (options.service && !isService(env, service)) throw new Error(`memoryHost: env.AI_IDENTITY (${env.AI_IDENTITY ?? "unset"}) isn't the service, ${service.toHexString()}: its stream_reply would be refused`);
  const manual = { now: new Timestamp(BigInt(START) * 1000n) };
  const now = options.clock ?? (() => manual.now);
  const logs: string[] = [];
  const log = options.log ?? ((line: string) => { logs.push(line); });
  const random = randomness(options.seed ?? 1);
  const uuid = options.uuid ?? random.uuid;
  const database = (options.database ?? new Identity(0xdbn)).toHexString();

  const store = newStore(options.onCommit, log);
  if (options.restore) restoreRows(store, options.restore);

  const rules = options.rules ?? loadRules;
  const txNow = (): TxCtx => {
    const began = performance.now();
    return { db: store.db, now: now(), env, database: () => database, uuid, seed: () => seedOf(store.db, random.seed), log, rules, engineCalls: 0, elapsedMs: () => performance.now() - began };
  };
  const transact = <T>(body: (tx: TxCtx) => T): T => inTransaction(store, () => body(txNow()));
  const call = (body: (tx: TxCtx) => void): Refusal | undefined => refusalOf(() => transact(body));
  const reap = () => transact(reapJobs);
  const tickPlaces = () => {
    for (const row of transact(tx => [...tx.db.placeTick.iter()])) {
      try {
        transact(tx => tickPlace(tx, row));
      } catch (e) {
        log(`[tick_place] place ${row.placeId} stopped: ${String(e)}`);
      }
    }
  };

  transact(tx => initDatabase(tx, owner));

  const jobs = jobRunner(transact, now, env, options.ai, log);
  return {
    db: store.db, owner, service, logs, transact, reap, tickPlaces,
    as: identity => callerAs(identity, call),
    streamReply: (args, from = service) => call(tx => streamReplyReducer(tx, from, args)),
    drain: jobs.drain,
    dispatchDue: jobs.dispatchDue,
    advance(ms) {
      if (options.clock) throw new Error("advance: this memory host's time is its injected clock's");
      manual.now = new Timestamp(manual.now.microsSinceUnixEpoch + BigInt(ms) * 1000n);
      reap();
    },
    view: identity => {
      const ctx = { sender: identity, db: store.db, env } as unknown as ViewCtx<Schema>;
      return { mySeat: () => mySeatView(ctx), myNames: () => myNamesView(ctx), myCreation: () => myCreationView(ctx), myGames: () => myGamesView(ctx) };
    },
    now,
  };
}

// ---------------------------------------------------------------------------------------------
// The moves, and run_job.

function callerAs(identity: Identity, call: (body: (tx: TxCtx) => void) => Refusal | undefined): Caller {
  const moves = Object.fromEntries(Object.entries(MOVES).map(([name, body]) => [name, (args = {}) => call(tx => (body as Body<unknown>)(tx, identity, args))]));
  return {
    ...(moves as unknown as { [M in keyof typeof MOVES]: Made<(typeof MOVES)[M]> }),
    newGame: args => call(tx => newGameReducer(tx, identity, args)),
    joinGame: args => call(tx => joinGameReducer(tx, identity, args)),
    say: args => call(tx => sayReducer(tx, identity, args)),
    retryTurn: args => call(tx => retryTurnReducer(tx, identity, args)),
    setSuggestions: args => call(tx => setSuggestionsReducer(tx, identity, args)),
    installCampaign: args => call(tx => installCampaignReducer(tx, identity, args)),
    dispatchWaiting: () => call(tx => dispatchWaitingReducer(tx, identity)),
    setDiceSeed: args => call(tx => setDiceSeedReducer(tx, identity, args)),
  };
}

/** A refusal comes back as a value, as a SenderError reaches a client; anything else thrown is a bug and stays thrown. */
function refusalOf(body: () => void): Refusal | undefined {
  try {
    body();
    return undefined;
  } catch (e) {
    if (e instanceof Refused) return e.refusal;
    throw e;
  }
}

/** run_job as index.ts runs it: the dispatch consumed, the claim, the POST with nothing locked, then the commit, or the turn failed when the commit throws. */
function jobRunner(transact: <T>(body: (tx: TxCtx) => T) => T, now: () => Timestamp, env: Env, ai: AiPost, log: (line: string) => void) {
  async function runJob(jobId: bigint): Promise<void> {
    const claim = transact(tx => claimJob(tx, jobId));
    if (!claim) return;

    const outcome = await post(claim);

    try {
      transact(tx => finishJob(tx, claim, outcome));
    } catch (e) {
      transact(tx => failJob(tx, claim, `the commit failed: ${String(e)}`));
    }
  }

  async function post(claim: Claim): Promise<AiOutcome> {
    if (!env.AI_URL) return NOT_CONFIGURED;
    try {
      const reply = await ai(claim.endpoint, claim.request, headersOf(env, claim), { timeoutMs: claim.timeoutMs });
      return outcomeOf({ status: reply.status, body: reply.body, replayed: reply.headers?.[HEADERS.replayed] === "1" });
    } catch (e) {
      return outcomeOf({ error: String(e) });
    }
  }

  /** The next due dispatch, taken (its row is gone as the procedure starts, as in SpacetimeDB). */
  const takeDue = () => transact(tx => {
    const due = [...tx.db.jobDispatch.iter()].filter(d => d.scheduledAt.tag === "Time" && d.scheduledAt.value.microsSinceUnixEpoch <= now().microsSinceUnixEpoch);
    const first = due.sort((a, b) => (a.scheduledId < b.scheduledId ? -1 : 1))[0];
    if (first) tx.db.jobDispatch.scheduledId.delete(first.scheduledId);
    return first;
  });

  /** A run that throws is a bug: logged, as SpacetimeDB logs a procedure's panic, and the reaper sees to its job. */
  const runLogged = (jobId: bigint) => runJob(jobId).catch((e: unknown) => log(`[run_job] job ${jobId} stopped: ${String(e)}`));

  return {
    async drain(): Promise<void> {
      for (let n = 0; n < MAX_DISPATCHES; n++) {
        const due = takeDue();
        if (!due) return;
        await runJob(due.jobId);
      }
      throw new Error(`drain: still dispatching after ${MAX_DISPATCHES} jobs`);
    },
    dispatchDue(): Array<Promise<void>> {
      const started: Array<Promise<void>> = [];
      for (let due = takeDue(); due; due = takeDue()) started.push(runLogged(due.jobId));
      return started;
    },
  };
}

/** The POST's headers, as index.ts's postToAi sends them. */
function headersOf(env: Env, claim: Claim): Record<string, string> {
  return {
    authorization: `Bearer ${env.AI_TOKEN ?? ""}`,
    "content-type": "application/json",
    [HEADERS.idempotencyKey]: claim.key,
    [HEADERS.attempt]: String(claim.attempt),
  };
}

/** A new game's dice seeds and uuids, from one seeded sequence. */
function randomness(seed: number) {
  const next = rng(seed);
  const hex = (digits: number) => Array.from({ length: digits }, () => Math.floor(next() * 16).toString(16)).join("");
  return {
    seed: () => Math.floor(next() * 1_000_000_000),
    uuid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`,
  };
}

// ---------------------------------------------------------------------------------------------
// The tables: Maps behind the accessors the moves use, with an undo journal per transaction, and,
// for a commit listener, the transaction's writes, folded into its net change once it commits.

type Meta = { primaryKey: string; autoInc?: boolean; unique?: string[]; indexes?: string[]; named?: Record<string, string[]>; defaults?: Row };
/** A table's rows by key and its autoInc counter: what a restore fills, and a commit's sequences read. */
interface TableState { meta: Meta; rows: Map<string, Row>; counter: { next: bigint } }
/** A write as the journal records it beside its undo: the stored rows themselves, which are never changed in place. */
interface Write { table: TableName; key: string; before?: Row; after?: Row }
interface Store {
  db: Db;
  tables: Record<string, TableState>;
  journal?: Array<() => void>;
  /** The open transaction's writes: kept only while there's a listener to tell. */
  writes?: Write[];
  onCommit?: (changes: ChangeSet) => void;
  log: (line: string) => void;
}

function newStore(onCommit: ((changes: ChangeSet) => void) | undefined, log: (line: string) => void): Store {
  const store: Store = { db: undefined as unknown as Db, tables: {}, onCommit, log };
  const handles = Object.fromEntries(Object.entries(TABLES as Record<string, Meta>).map(([name, meta]) => [name, tableOf(name, meta, store)]));
  store.db = new Proxy(handles, {
    get(target, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      if (!(prop in target)) throw new Error(`the memory host has no table ${prop}`);
      return target[prop];
    },
  }) as unknown as Db;
  return store;
}

/** A previous run's rows into the tables, as Restore says, in no transaction: they were committed then. A table with no rows left still has its counter. */
function restoreRows(store: Store, restore: Restore): void {
  const unknown = Object.keys(restore.rows).find(name => !store.tables[name]);
  if (unknown) throw new Error(`restore: the memory host has no table ${unknown}`);

  for (const [name, table] of Object.entries(store.tables)) {
    const rows = restore.rows[name as TableName] ?? [];
    const pk = table.meta.primaryKey;
    for (const row of [...rows].sort(byKey(pk))) table.rows.set(keyOf(row[pk]), withDefaults(row, table.meta.defaults));
    if (table.meta.autoInc) table.counter.next = nextIdAfter(rows, pk, restore.sequences?.[name as TableName]);
  }
}

/** A transaction: its body run on a fresh journal, then, once it has committed, its net change told to the listener. */
function inTransaction<T>(store: Store, body: () => T): T {
  const writes: Write[] | undefined = store.onCommit ? [] : undefined;
  const result = journalled(store, writes, body);
  if (writes?.length) tellCommit(store, changeSetOf(store, writes));
  return result;
}

/** Runs a body with a fresh journal (keeping its writes in `writes`, when given); a throw undoes every write it made, in reverse. */
function journalled<T>(store: Store, writes: Write[] | undefined, body: () => T): T {
  if (store.journal) throw new Error("the memory host doesn't nest transactions");
  const journal: Array<() => void> = [];
  store.journal = journal;
  store.writes = writes;
  try {
    return body();
  } catch (e) {
    for (const undo of journal.reverse()) undo();
    throw e;
  } finally {
    store.journal = undefined;
    store.writes = undefined;
  }
}

/** A commit's net change to the listener, unless it changed nothing. A throw from the listener is logged: the commit stands, as a reducer's does whatever its subscribers make of it. */
function tellCommit(store: Store, commit: ChangeSet): void {
  if (!commit.changes.length && !Object.keys(commit.sequences).length) return;
  try {
    store.onCommit!(commit);
  } catch (e) {
    store.log(`[onCommit] ${String(e)}`);
  }
}

/** A transaction's writes as its net change: each row's first `before` and last `after`, in the order the row was first written, and the counters its inserts moved on. */
function changeSetOf(store: Store, writes: Write[]): ChangeSet {
  const net = new Map<string, Write>();
  for (const write of writes) {
    const id = `${write.table}\u0000${write.key}`;
    const first = net.get(id);
    net.set(id, first ? { ...first, after: write.after } : write);
  }
  return { changes: [...net.values()].flatMap(changeOf), sequences: sequencesOf(store, writes) };
}

/** A row's net write as SpacetimeDB reports it (copies of the rows), or nothing when the row has come back to where it started. */
function changeOf({ table, key, before, after }: Write): RowChange[] {
  if (before && after) return sameRow(before, after) ? [] : [{ table, key, op: "update", row: copy(after), old: copy(before) }];
  if (after) return [{ table, key, op: "insert", row: copy(after) }];
  if (before) return [{ table, key, op: "delete", row: copy(before) }];
  return [];
}

/** The next id of each autoInc table the transaction inserted into. */
function sequencesOf(store: Store, writes: Write[]): ChangeSet["sequences"] {
  const sequences: ChangeSet["sequences"] = {};
  for (const { table, before } of writes) {
    const { meta, counter } = store.tables[table]!;
    if (!before && meta.autoInc) sequences[table] = counter.next;
  }
  return sequences;
}

/** Whether a row was written back as it was: the same values all through (an option left out is undefined). */
function sameRow(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false;
  const columns = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...columns].every(column => sameRow((a as Row)[column], (b as Row)[column]));
}

/** A saved row (copied, as every row kept is) with each column it lacks that has a default taking it, as a publish that adds the column fills it. */
function withDefaults(row: Row, defaults: Row = {}): Row {
  const filled = copy(row);
  for (const [column, value] of Object.entries(defaults)) if (filled[column] === undefined) filled[column] = copy(value);
  return filled;
}

/** An autoInc table's counter after a restore: its saved value, or past its highest id when that's further on. */
function nextIdAfter(rows: Row[], pk: string, saved = 1n): bigint {
  const past = rows.reduce((next, row) => (typeof row[pk] === "bigint" && (row[pk] as bigint) >= next ? (row[pk] as bigint) + 1n : next), 1n);
  return past > saved ? past : saved;
}

/** Rows in their primary keys' order: ids as numbers (an autoInc table's in the order they were inserted), any other key by its text. */
function byKey(pk: string) {
  return (a: Row, b: Row): number => {
    const x = a[pk], y = b[pk];
    if (typeof x === "bigint" && typeof y === "bigint") return x < y ? -1 : x > y ? 1 : 0;
    const [kx, ky] = [keyOf(x), keyOf(y)];
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  };
}

/** One table's handle: insert, iter, count, delete, clear, and an accessor per key and index. */
function tableOf(name: string, meta: Meta, store: Store): Record<string, unknown> {
  const rows = new Map<string, Row>();
  const pk = meta.primaryKey;
  const counter = { next: 1n };
  store.tables[name] = { meta, rows, counter };

  const journal = (undo: () => void, write: Omit<Write, "table">) => {
    if (!store.journal) throw new Error(`${name}: a write outside a transaction`);
    store.journal.push(undo);
    store.writes?.push({ table: name as TableName, ...write });
  };
  const all = () => [...rows.values()];
  const matching = (columns: string[], value: unknown) => {
    const wanted = Array.isArray(value) && columns.length > 1 ? value : [value];
    return all().filter(r => wanted.every((v, i) => keyOf(r[columns[i]!]) === keyOf(v)));
  };
  const remove = (row: Row) => {
    const k = keyOf(row[pk]);
    const old = rows.get(k)!;
    rows.delete(k);
    journal(() => rows.set(k, old), { key: k, before: old });
  };
  const refuseDuplicates = (row: Row, except?: string) => {
    for (const column of meta.unique ?? []) {
      const clash = all().find(r => keyOf(r[pk]) !== except && keyOf(r[column]) === keyOf(row[column]));
      if (clash) throw new Error(`${name}: ${column} ${String(row[column])} is already taken (a unique violation)`);
    }
  };

  const insert = (row: Row) => {
    const r = copy(row);
    if (meta.autoInc && r[pk] === 0n) r[pk] = counter.next++;
    const k = keyOf(r[pk]);
    if (rows.has(k)) throw new Error(`${name}: ${pk} ${String(r[pk])} is already taken (a unique violation)`);
    refuseDuplicates(r);
    rows.set(k, r);
    journal(() => rows.delete(k), { key: k, after: r });
    return copy(r);
  };
  const update = (row: Row) => {
    const k = keyOf(row[pk]);
    const old = rows.get(k);
    if (!old) throw new Error(`${name}: no row with ${pk} ${String(row[pk])} to update`);
    const r = copy(row);
    refuseDuplicates(r, k);
    rows.set(k, r);
    journal(() => rows.set(k, old), { key: k, before: old, after: r });
    return copy(r);
  };
  /** The row a unique column's value finds: the primary key's straight from the map, another column's by a scan (the same answer either way). */
  const lookup = (column: string, value: unknown): Row | undefined => (column === pk ? rows.get(keyOf(value)) : matching([column], value)[0]);
  const unique = (column: string) => ({
    find: (value: unknown) => copy(lookup(column, value) ?? null),
    delete: (value: unknown) => {
      const hit = lookup(column, value);
      if (hit) remove(hit);
      return !!hit;
    },
    ...(column === pk ? { update } : {}),
  });
  const ranged = (columns: string[]) => ({
    filter: (value: unknown) => matching(columns, value).map(copy).values(),
    delete: (value: unknown) => {
      const hits = matching(columns, value);
      hits.forEach(remove);
      return hits.length;
    },
  });

  const handle: Record<string, unknown> = {
    insert,
    iter: () => all().map(copy).values(),
    [Symbol.iterator]: () => all().map(copy).values(),
    count: () => BigInt(rows.size),
    delete: (row: Row) => unique(pk).delete(row[pk]),
    clear: () => {
      const n = BigInt(rows.size);
      all().forEach(remove);
      return n;
    },
    [pk]: unique(pk),
  };
  for (const column of meta.unique ?? []) handle[column] = unique(column);
  for (const column of meta.indexes ?? []) handle[column] = ranged([column]);
  for (const [accessor, columns] of Object.entries(meta.named ?? {})) handle[accessor] = ranged(columns);
  return handle;
}

/** A column's value as a Map key: ids, strings, numbers, identities and tuples of them. A RowChange's key is its primary key's. */
export function keyOf(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined || value === null) return "none";
  if (Array.isArray(value)) return `[${value.map(keyOf).join(",")}]`;
  if (typeof (value as { toHexString?: unknown }).toHexString === "function") return `identity:${(value as Identity).toHexString()}`;
  throw new Error(`the memory host can't key a column by ${String(value)}`);
}

/** A row as SpacetimeDB hands it out: a copy, so changing it changes nothing until it's written. Class instances (Identity, Timestamp, ScheduleAt's values) are immutable and kept. */
function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) as T;
  }
  return value;
}
