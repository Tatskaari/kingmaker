/**
 * The keys and ids that cross between the simulation and the AI service (v0-design §3.7). Rows
 * keep ids as bigints; requests, plans and keys carry them as strings, since JSON can't hold a
 * bigint (reducer arguments over HTTP take u64s as numbers: ids stay far below 2^53).
 */

/** The steps of a think, in a move's order: the opening, then a turn's three. */
export type Step = "open" | "decide" | "reply" | "settle";
export const STEPS: readonly Step[] = ["open", "decide", "reply", "settle"];

/**
 * A think's idempotency key: `<game uid>:s<scene id>:t<turn n>:<step>`. The same step of the same
 * turn always has the same key, across retries, re-dispatches and retry_turn, and the game's uid
 * keeps it apart from every other database's.
 */
export const idempotencyKey = (game: string, scene: bigint | string, turn: number, step: Step) => `${game}:s${scene}:t${turn}:${step}`;

/** A key's parts, or undefined when it isn't one. */
export function keyParts(key: string): { game: string; scene: string; turn: number; step: Step } | undefined {
  const m = /^(.+):s(\d+):t(\d+):(open|decide|reply|settle)$/.exec(key);
  return m ? { game: m[1]!, scene: m[2]!, turn: Number(m[3]), step: m[4] as Step } : undefined;
}

/** A row's id as JSON carries it. */
export const idText = (id: bigint) => id.toString();

/** An id from JSON as a row's. */
export const idOf = (text: string) => BigInt(text);

/** A player's lines' speaker in the transcript. */
export const playerSpeaker = (playerId: bigint | string) => `player:${playerId}`;
