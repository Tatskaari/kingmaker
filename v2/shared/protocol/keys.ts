/**
 * The keys and ids that cross between the simulation and the AI service (v0-design §3.7, v1-design §3.5). Rows
 * keep ids as bigints; requests, plans and keys carry them as strings, since JSON can't hold a
 * bigint (reducer arguments over HTTP take u64s as numbers: ids stay far below 2^53).
 */

/** The steps of a think, in a move's order: the opening, then a turn's three. */
export type Step = "open" | "decide" | "reply" | "settle";
export const STEPS: readonly Step[] = ["open", "decide", "reply", "settle"];

/**
 * Character creation's steps (v1-design §3.5), each an AI call of its own: the three builds offered,
 * the model's one pick, the player's own made legal, and the backstory's draft, notes worked in, lore
 * check and traits.
 */
export type CreationStep = "offer" | "pick" | "own" | "draft" | "work" | "check" | "traits";
export const CREATION_STEPS: readonly CreationStep[] = ["offer", "pick", "own", "draft", "work", "check", "traits"];

/**
 * A think's idempotency key: `<game uid>:s<scene id>:t<turn n>:<step>`. The same step of the same
 * turn always has the same key, across retries, re-dispatches and retry_turn, and the game's uid
 * keeps it apart from every other database's.
 */
export const idempotencyKey = (game: string, scene: bigint | string, turn: number, step: Step) => `${game}:s${scene}:t${turn}:${step}`;

/**
 * A creation step's key: `<creation uid>:c<rev>:<step>`. The creation's rev is the row's when the
 * step was asked for, so a step asked again after the player moved on has a key of its own, and the
 * uid (the game's, once it's made) keeps it apart from every other creation's.
 */
export const creationKey = (uid: string, rev: number, step: CreationStep) => `${uid}:c${rev}:${step}`;

/** A turn's think, by its key. */
export interface TurnKeyParts { game: string; scene: string; turn: number; step: Step }
/** A creation's step, by its key: `game` is the creation's uid. */
export interface CreationKeyParts { game: string; rev: number; step: CreationStep }

/** A key's parts (a turn's think has a turn, a creation's step a rev), or undefined when it isn't one. */
export function keyParts(key: string): TurnKeyParts | CreationKeyParts | undefined {
  const turn = /^(.+):s(\d+):t(\d+):(open|decide|reply|settle)$/.exec(key);
  if (turn) return { game: turn[1]!, scene: turn[2]!, turn: Number(turn[3]), step: turn[4] as Step };
  const creation = /^(.+):c(\d+):(offer|pick|own|draft|work|check|traits)$/.exec(key);
  return creation ? { game: creation[1]!, rev: Number(creation[2]), step: creation[3] as CreationStep } : undefined;
}

/** Whether a key's parts are a turn's think (else a creation's step). */
export const isTurnKey = (parts: TurnKeyParts | CreationKeyParts): parts is TurnKeyParts => "turn" in parts;

/** A row's id as JSON carries it. */
export const idText = (id: bigint) => id.toString();

/** An id from JSON as a row's. */
export const idOf = (text: string) => BigInt(text);

/** A player's lines' speaker in the transcript. */
export const playerSpeaker = (playerId: bigint | string) => `player:${playerId}`;
