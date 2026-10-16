/**
 * The keys and ids that cross between the simulation and the AI service (v0-design §3.7). Rows
 * keep ids as bigints; requests, plans and keys carry them as strings, since JSON can't hold a
 * bigint (reducer arguments over HTTP take u64s as numbers: ids stay far below 2^53).
 */

/**
 * The steps of a think: the opening, then a turn's three, in a move's order; and the two that run
 * beside a turn once its reply is in (v5-design §3.4): the notes on its marks, and the lines
 * suggested after it.
 */
export type Step = "open" | "decide" | "reply" | "settle" | "notes" | "suggest";
export const STEPS: readonly Step[] = ["open", "decide", "reply", "settle", "notes", "suggest"];

/**
 * A think's idempotency key: `<game uid>:s<scene id>:t<turn n>:<step>`. The same step of the same
 * turn always has the same key, across retries, re-dispatches and retry_turn, and the game's uid
 * keeps it apart from every other database's. A turn's lines can be asked for again (set_suggestions
 * turned back on), and each ask has its own answer: `ask` is the suggest step's k-th ask of the
 * turn, the second on keyed `suggest-<k>`.
 */
export const idempotencyKey = (game: string, scene: bigint | string, turn: number, step: Step, ask = 1) =>
  `${game}:s${scene}:t${turn}:${step}${step === "suggest" && ask > 1 ? `-${ask}` : ""}`;

/**
 * Whether a text is a game's id as the AI service takes one: a key's first part and a folder's name
 * in its store. A letter or a digit, then letters, digits, dots, dashes and underscores: 100 at most.
 */
export const isGameId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id);

/** A key's parts, or undefined when it isn't one. `ask` is there only on a suggest key's second ask or later. */
export function keyParts(key: string): { game: string; scene: string; turn: number; step: Step; ask?: number } | undefined {
  const m = /^(.+):s(\d+):t(\d+):(?:(open|decide|reply|settle|notes)|suggest(?:-([1-9]\d*))?)$/.exec(key);
  if (!m || m[5] === "1") return undefined;
  const parts = { game: m[1]!, scene: m[2]!, turn: Number(m[3]) };
  if (m[4]) return { ...parts, step: m[4] as Step };
  return { ...parts, step: "suggest", ...(m[5] ? { ask: Number(m[5]) } : {}) };
}

/** A row's id as JSON carries it. */
export const idText = (id: bigint) => id.toString();

/** An id from JSON as a row's. */
export const idOf = (text: string) => BigInt(text);

/** A player's lines' speaker in the transcript. */
export const playerSpeaker = (playerId: bigint | string) => `player:${playerId}`;
