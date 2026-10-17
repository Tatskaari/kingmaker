import { Identity, Timestamp } from "spacetimedb";
import type { ViewCtx } from "spacetimedb/server";
import { rng } from "../../../shared/dice.ts";
import { HEADERS } from "../../../shared/protocol/ai.ts";
import type { Refusal } from "../../../shared/protocol/refusals.ts";
import type { InstallArgs } from "../../../shared/scene/files.ts";
import type { Rules } from "../../../shared/rules/types.ts";
import { NOT_CONFIGURED, outcomeOf, type AiOutcome, type Claim } from "../ai-call.ts";
import { Refused, type Db, type Env, type Schema, type TxCtx } from "../context.ts";
import * as creation from "../creation/moves.ts";
import * as games from "../games/moves.ts";
import { installCampaignReducer } from "../install.ts";
import { claimJob, dispatchWaitingReducer, failJob, finishJob, reapJobs } from "../jobs.ts";
import { initDatabase } from "../lifecycle.ts";
import * as map from "../map/moves.ts";
import { joinGameReducer } from "../moves/join-game.ts";
import { newGameReducer } from "../moves/new-game.ts";
import { retryTurnReducer } from "../moves/retry-turn.ts";
import { sayReducer } from "../moves/say.ts";
import { setSuggestionsReducer } from "../moves/set-suggestions.ts";
import { loadRules } from "../rules/load.ts";
import * as story from "../story/moves.ts";
import { streamReplyReducer } from "../stream.ts";
import { TABLES } from "../tables.ts";
import { myCreationView, myGamesView, myNamesView, mySeatView } from "../views.ts";

/**
 * The simulation without SpacetimeDB (v0-design §4.5): the same moves, job functions and views
 * over tables kept in Maps, for tests and the local host. Each call is a transaction (a throw rolls
 * back every write it made); the clock moves only when told to; the game's seeds and uuids come
 * from a fixed sequence, so a run replays; the rules engine is the module's own, loaded once in the
 * process; and run_job is drain(): each due dispatch claimed, POSTed through the injected `ai`, and
 * committed, exactly as index.ts does it.
 */

/** What a think's POST got back: a status and body, and the headers that matter (x-km-replayed). */
export interface AiReply { status: number; body: string; headers?: Record<string, string> }

/** The AI service as the memory host reaches it. Throwing stands for a refused or reset connection. */
export type AiPost = (endpoint: string, body: string, headers: Record<string, string>) => Promise<AiReply>;

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
}

export type StreamArgs = Parameters<typeof streamReplyReducer>[2];

/** A move's body, as index.ts registers it: the caller and the reducer's arguments. */
type Body<A> = (tx: TxCtx, sender: Identity, args: A) => void;
/** The move, as a caller makes it (with no arguments, when none are needed): the refusal, or nothing when it was made. */
type Made<B> = B extends Body<infer A> ? ({} extends A ? (args?: A) => Refusal | undefined : (args: A) => Refusal | undefined) : never;

/** Character creation's moves, the games' (v1-design §3.3), the map's (map-design §3.2) and the story's between scenes (story-design §4.3), by their bodies' names. */
const MOVES = {
  startCreation: creation.startCreationReducer, creationBack: creation.creationBackReducer, chooseBuild: creation.chooseBuildReducer,
  makeOwn: creation.makeOwnReducer, pickOwn: creation.pickOwnReducer, takeOwn: creation.takeOwnReducer, setBackstory: creation.setBackstoryReducer,
  draftBackstory: creation.draftBackstoryReducer, workInBackstory: creation.workInBackstoryReducer, takeProposal: creation.takeProposalReducer,
  leaveProposal: creation.leaveProposalReducer, finishBackstory: creation.finishBackstoryReducer, acceptFix: creation.acceptFixReducer,
  rewriteIssue: creation.rewriteIssueReducer, skipBackstory: creation.skipBackstoryReducer, chooseAgain: creation.chooseAgainReducer,
  begin: games.beginReducer, continueGame: games.continueGameReducer, deleteGame: games.deleteGameReducer,
  walk: map.walkReducer, interact: map.interactReducer, travel: map.travelReducer,
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
  /** The clock moves on, and the reaper runs. */
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
  const store = newStore();
  const owner = new Identity(0xa11cen), service = new Identity(0x5e7f1cen);
  const env: Env = options.env ?? { AI_URL: "http://ai.memory", AI_TOKEN: "memory-bearer", AI_IDENTITY: service.toHexString() };
  const clock = { now: new Timestamp(BigInt(START) * 1000n) };
  const logs: string[] = [];
  const random = randomness(options.seed ?? 1);
  const uuid = options.uuid ?? random.uuid;
  const database = (options.database ?? new Identity(0xdbn)).toHexString();

  const rules = options.rules ?? loadRules;
  const txNow = (): TxCtx => {
    const began = performance.now();
    return { db: store.db, now: clock.now, env, database: () => database, uuid, seed: random.seed, log: line => logs.push(line), rules, engineCalls: 0, elapsedMs: () => performance.now() - began };
  };
  const transact = <T>(body: (tx: TxCtx) => T): T => inTransaction(store, () => body(txNow()));
  const call = (body: (tx: TxCtx) => void): Refusal | undefined => refusalOf(() => transact(body));

  transact(tx => initDatabase(tx, owner));

  const jobs = jobRunner(transact, () => clock.now, env, options.ai);
  return {
    db: store.db, owner, service, logs, transact,
    as: identity => callerAs(identity, call),
    streamReply: (args, from = service) => call(tx => streamReplyReducer(tx, from, args)),
    drain: jobs.drain,
    advance(ms) {
      clock.now = new Timestamp(clock.now.microsSinceUnixEpoch + BigInt(ms) * 1000n);
      transact(reapJobs);
    },
    view: identity => {
      const ctx = { sender: identity, db: store.db, env } as unknown as ViewCtx<Schema>;
      return { mySeat: () => mySeatView(ctx), myNames: () => myNamesView(ctx), myCreation: () => myCreationView(ctx), myGames: () => myGamesView(ctx) };
    },
    now: () => clock.now,
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
function jobRunner(transact: <T>(body: (tx: TxCtx) => T) => T, now: () => Timestamp, env: Env, ai: AiPost) {
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
      const reply = await ai(claim.endpoint, claim.request, headersOf(env, claim));
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

  return {
    async drain(): Promise<void> {
      for (let n = 0; n < MAX_DISPATCHES; n++) {
        const due = takeDue();
        if (!due) return;
        await runJob(due.jobId);
      }
      throw new Error(`drain: still dispatching after ${MAX_DISPATCHES} jobs`);
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
// The tables: Maps behind the accessors the moves use, with an undo journal per transaction.

type Row = Record<string, unknown>;
type Meta = { primaryKey: string; autoInc?: boolean; unique?: string[]; indexes?: string[]; named?: Record<string, string[]> };
interface Store { db: Db; journal?: Array<() => void> }

function newStore(): Store {
  const store: Store = { db: undefined as unknown as Db };
  const tables = Object.fromEntries(Object.entries(TABLES as Record<string, Meta>).map(([name, meta]) => [name, tableOf(name, meta, store)]));
  store.db = new Proxy(tables, {
    get(target, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      if (!(prop in target)) throw new Error(`the memory host has no table ${prop}`);
      return target[prop];
    },
  }) as unknown as Db;
  return store;
}

/** Runs a body with a fresh journal; a throw undoes every write it made, in reverse. */
function inTransaction<T>(store: Store, body: () => T): T {
  if (store.journal) throw new Error("the memory host doesn't nest transactions");
  const journal: Array<() => void> = [];
  store.journal = journal;
  try {
    return body();
  } catch (e) {
    for (const undo of journal.reverse()) undo();
    throw e;
  } finally {
    store.journal = undefined;
  }
}

/** One table's handle: insert, iter, count, delete, clear, and an accessor per key and index. */
function tableOf(name: string, meta: Meta, store: Store): Record<string, unknown> {
  const rows = new Map<string, Row>();
  const pk = meta.primaryKey;
  let nextId = 1n;

  const journal = (undo: () => void) => {
    if (!store.journal) throw new Error(`${name}: a write outside a transaction`);
    store.journal.push(undo);
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
    journal(() => rows.set(k, old));
  };
  const refuseDuplicates = (row: Row, except?: string) => {
    for (const column of meta.unique ?? []) {
      const clash = all().find(r => keyOf(r[pk]) !== except && keyOf(r[column]) === keyOf(row[column]));
      if (clash) throw new Error(`${name}: ${column} ${String(row[column])} is already taken (a unique violation)`);
    }
  };

  const insert = (row: Row) => {
    const r = copy(row);
    if (meta.autoInc && r[pk] === 0n) r[pk] = nextId++;
    const k = keyOf(r[pk]);
    if (rows.has(k)) throw new Error(`${name}: ${pk} ${String(r[pk])} is already taken (a unique violation)`);
    refuseDuplicates(r);
    rows.set(k, r);
    journal(() => rows.delete(k));
    return copy(r);
  };
  const update = (row: Row) => {
    const k = keyOf(row[pk]);
    const old = rows.get(k);
    if (!old) throw new Error(`${name}: no row with ${pk} ${String(row[pk])} to update`);
    const r = copy(row);
    refuseDuplicates(r, k);
    rows.set(k, r);
    journal(() => rows.set(k, old));
    return copy(r);
  };
  const unique = (column: string) => ({
    find: (value: unknown) => copy(matching([column], value)[0] ?? null),
    delete: (value: unknown) => {
      const hit = matching([column], value)[0];
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

/** A column's value as a Map key: ids, strings, numbers, identities and tuples of them. */
function keyOf(value: unknown): string {
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
