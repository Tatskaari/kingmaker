import type { Identity } from "spacetimedb";
import { OWNER_MOVES, PLAYER_MOVES, PROTOCOL, type Rejection, type ToServer } from "../../shared/protocol/port.ts";
import type { Refusal } from "../../shared/protocol/refusals.ts";
import type { MemoryHost } from "../../simulation/src/host/memory.ts";
import { markOnline } from "../../simulation/src/lifecycle.ts";
import type { Push } from "./push.ts";
import type { Duplex } from "./transport.ts";

/**
 * A client served on its duplex (browser-design §3, shared/protocol/port.ts): who it is, its moves,
 * and its rows.
 *
 * - Its connect names a session, whose identity the store keeps (minted the first time it's seen),
 *   so the same session comes back to the same games. It's sent that identity, is online, and is
 *   sent everything it may see (push.ts), then a tx for each commit after.
 * - Each move is made by its name: PLAYER_MOVES as the caller, OWNER_MOVES as the database's owner
 *   where the host allows them (the page's /end, for testing), and nothing else (installCampaign,
 *   dispatchWaiting and streamReply never). Its commit's tx has gone out by the time its answer does,
 *   on the same duplex. A refusal is the answer's rejection; anything else thrown is {code: "error"},
 *   and logged (the move's transaction rolled back).
 * - A disconnect is the client gone: offline, and its duplex closed. (A port has no close event of
 *   its own; a page that goes takes the server worker with it, and the next start marks everyone
 *   offline.)
 */

export interface Served {
  sim: MemoryHost;
  push: Push;
  /** Where each session's identity is kept (the SimStore). */
  sessions: { session(name: string): Identity };
  /** OWNER_MOVES made as the owner (the page allows /end); otherwise refused. */
  ownerMoves: boolean;
  log(line: string): void;
}

/** The session a client that names none is: the page's client is "default" too. */
export const DEFAULT_SESSION = "default";

/** What a client from another build is told, for good: the two halves of the page don't speak the same wire. */
const WRONG_BUILD = "(The game and its page are from different builds: reload the page.)";

/** A client, once it has connected: who it is, and its leaving the fan-out. */
interface Connected { identity: Identity; leave(): void }

export function serveClient(duplex: Duplex, served: Served): void {
  let client: Connected | undefined;
  duplex.onMessage(message => {
    if (message.kind === "connect") client ??= connect(duplex, served, message);
    else if (message.kind === "move") answer(duplex, served, client, message);
    else if (message.kind === "disconnect") client = disconnect(duplex, served, client);
  });
}

/** Its identity sent, online, then its snapshot (and its txs from then on); a client from another build is cut off instead. */
function connect(duplex: Duplex, served: Served, { protocol, session }: ToServer & { kind: "connect" }): Connected | undefined {
  if (protocol !== PROTOCOL) {
    duplex.send({ kind: "status", cutOff: WRONG_BUILD });
    return undefined;
  }
  const identity = served.sessions.session(session ?? DEFAULT_SESSION);
  duplex.send({ kind: "connected", identity: identity.toHexString() });
  served.sim.transact(tx => markOnline(tx, identity, true));
  return { identity, leave: served.push.join(identity, message => duplex.send(message)) };
}

/** The move made, its tx already out (pushed as it committed), then its answer. */
function answer(duplex: Duplex, served: Served, client: Connected | undefined, { id, name, args }: ToServer & { kind: "move" }): void {
  const rejection = client ? made(served, client.identity, name, args) : { code: "error" as const, text: "(Not connected yet: the move wasn't made.)" };
  duplex.send({ kind: "answer", id, ...(rejection ? { rejection } : {}) });
}

/** A move by its name, as whoever may make it: the refusal, or what went wrong, or nothing when it was made. */
function made(served: Served, identity: Identity, name: string, args: unknown): Rejection | undefined {
  const caller = callerFor(served, identity, name);
  if (!caller) return { code: "error", text: `(There's no move ${name} here.)` };
  try {
    return (caller[name] as (args: unknown) => Refusal | undefined)(args);
  } catch (error) {
    served.log(`[move] ${name} threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return { code: "error", text: error instanceof Error ? error.message : String(error) };
  }
}

/** Whose moves a move is made among: the caller's own, the owner's where the host allows it, or none. */
function callerFor(served: Served, identity: Identity, name: string): Record<string, unknown> | undefined {
  if ((PLAYER_MOVES as readonly string[]).includes(name)) return served.sim.as(identity);
  if ((OWNER_MOVES as readonly string[]).includes(name) && served.ownerMoves) return served.sim.as(served.sim.owner);
  return undefined;
}

/** The client gone: no more txs, offline, and its duplex closed. */
function disconnect(duplex: Duplex, served: Served, client: Connected | undefined): undefined {
  duplex.close();
  if (!client) return undefined;
  client.leave();
  served.sim.transact(tx => markOnline(tx, client.identity, false));
  return undefined;
}
