import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * A session: the SpacetimeDB identity a terminal plays as, kept between runs (v0-design §7).
 * runs/play/<name>.json holds its token, so `--session wren` is the same player in every
 * process; the simulation keeps the game itself. And where the game's server is: what was asked
 * for, else the dev stack's (the stack.json npm run dev writes in its folder, runs/dev), else the
 * dev stack's own defaults. The hosts read the env and the arguments and hand them in.
 */

export interface Session {
  name: string;
  /** The file it's kept in. */
  path: string;
  /** The identity's token, once a connection has been given one. */
  token?: string;
}

export interface Server { url: string; db: string }

/** The dev stack's defaults (v0-design §9.1). */
export const DEFAULT_SERVER: Server = { url: "ws://127.0.0.1:3300", db: "kingmaker" };

/** The session called `name` under `runs` (runs/play/<name>.json), with its token if it has one. */
export function sessionAt(runs: string, name: string): Session {
  if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) throw new Error(`A session's name is letters, digits, dots, dashes and underscores: not "${name}".`);
  const path = join(runs, "play", `${name}.json`);
  const token = tokenIn(path);
  return { name, path, ...(token ? { token } : {}) };
}

/** Keeps the identity's token with the session, for the next process to connect as. */
export function keepToken(session: Session, identity: string, token: string): void {
  mkdirSync(dirname(session.path), { recursive: true });
  writeFileSync(session.path, `${JSON.stringify({ identity, token }, null, 2)}\n`, { mode: 0o600 });
  session.token = token;
}

/** Where the game's server is: what was asked for, else the dev stack's (its folder, `stack`: runs/dev), else its defaults. */
export function serverFor(asked: Partial<Server>, stack: string): Server {
  const running = devStack(join(stack, "stack.json"));
  return { url: asked.url ?? running.url ?? DEFAULT_SERVER.url, db: asked.db ?? running.db ?? DEFAULT_SERVER.db };
}

function tokenIn(path: string): string | undefined {
  const kept = jsonIn(path);
  return typeof kept?.token === "string" ? kept.token : undefined;
}

/** The running dev stack's address, from its stack.json (its WebSocket URL, or its HTTP one), if there is one. */
function devStack(path: string): Partial<Server> {
  const stack = jsonIn(path);
  const url = [stack?.ws, stack?.http].find(u => typeof u === "string");
  return { ...(typeof url === "string" ? { url } : {}), ...(typeof stack?.db === "string" ? { db: stack.db } : {}) };
}

function jsonIn(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
