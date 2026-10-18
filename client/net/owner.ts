import { readFileSync } from "node:fs";
import { join } from "node:path";
import { refusalIn } from "../../shared/protocol/refusals.ts";
import type { Rejection } from "../backend.ts";

/**
 * The dev stack's owner, for the testing moves only the database's owner may make (story-design
 * §4.5: /end and play end call end_scene). The dev host writes the stack's address and its owner's
 * token into <stack>/stack.json (hosts/dev/stack-file.ts), private to the user; the client reads
 * them from there and calls the reducer over SpacetimeDB's HTTP API as the owner. Nothing here is
 * a player's move: a player's go through their own connection.
 */

export interface Owner {
  /** SpacetimeDB from the host: http://127.0.0.1:<port>. */
  http: string;
  db: string;
  /** The owner's token: the bearer. */
  token: string;
}

/** The owner of the dev stack whose folder is `stack` (runs/dev), when it has a stack.json with one. */
export function ownerAt(stack: string): Owner | undefined {
  try {
    const file = JSON.parse(readFileSync(join(stack, "stack.json"), "utf8")) as { http?: unknown; db?: unknown; owner?: { token?: unknown } };
    const { http, db } = file, token = file.owner?.token;
    return typeof http === "string" && typeof db === "string" && typeof token === "string" ? { http, db, token } : undefined;
  } catch {
    return undefined;
  }
}

/** The owner, when it's the owner of the server the client plays on (the same host, port and database): else none. */
export function ownerFor(owner: Owner | undefined, server: { url: string; db: string }): Owner | undefined {
  const where = (url: string) => { try { return new URL(url.replace(/^ws/, "http")).host; } catch { return url; } };
  return owner && owner.db === server.db && where(owner.http) === where(server.url) ? owner : undefined;
}

/** Why a testing move can't be made from here: no dev stack's owner to make it as. */
export const NOT_OWNER: Rejection = { code: "error", text: "(Only the dev stack's owner may end a scene for testing, and there's no dev stack's stack.json here to call as them: is npm run dev up?)" };

/**
 * end_scene as the owner: the game's scene ends through `exit` now, with no closing reply (with
 * `thorough`, its discoveries reached first). An empty exit asks for the endings (the refusal lists
 * them). Undefined when it was made; else the simulation's refusal (an HTTP 530 whose body is the
 * refusal), or what went wrong on the way.
 */
export async function endSceneAs(owner: Owner | undefined, args: { game: bigint; exit: string; thorough?: boolean | undefined }, fetchFn: typeof fetch = fetch): Promise<Rejection | undefined> {
  if (!owner) return NOT_OWNER;
  // The game's id written as it is: a u64, which JSON.stringify can't take as a bigint; thorough as SpacetimeDB's option.
  const body = `{"game":${args.game},"exit":${JSON.stringify(args.exit)},"thorough":${args.thorough ? '{"some":true}' : '{"none":[]}'}}`;
  try {
    const answer = await fetchFn(`${owner.http.replace(/\/+$/, "")}/v1/database/${encodeURIComponent(owner.db)}/call/end_scene`, {
      method: "POST", headers: { authorization: `Bearer ${owner.token}`, "content-type": "application/json" }, body, signal: AbortSignal.timeout(10_000),
    });
    if (answer.ok) return undefined;
    const text = await answer.text();
    return refusalIn(text) ?? { code: "error", text: `(The game couldn't do that: ${answer.status} ${text.trim() || answer.statusText})` };
  } catch (error) {
    return { code: "error", text: `(The game's server is out of reach: ${error instanceof Error ? error.message : String(error)})` };
  }
}
