/**
 * The keys and ids that cross between the simulation and the AI service (v0-design §3.7, v1-design §3.5). Rows
 * keep ids as bigints; requests, plans and keys carry them as strings, since JSON can't hold a
 * bigint (reducer arguments over HTTP take u64s as numbers: ids stay far below 2^53).
 */

/**
 * The steps of a think: the opening, then a turn's own, in a move's order (decide; reactions, on a
 * turn the player's violence drew them: world-bridge-design §3.4; consider, on a turn the GM rules
 * on before replying; reply; settle); the one that runs beside a turn once its reply is in (v5-design
 * §3.4): the lines suggested after it (the notes on its marks went in M2); the two in the background once
 * the turn is over (full-gm-design §4.2): the memory reviews, and the co-GM; the boundary once
 * the scene is over (story-design §4.3), keyed by the scene's last turn; and the looks of what the
 * stage manager made in a turn, beside it (town-design §3.7).
 */
export type Step = "open" | "decide" | "reactions" | "consider" | "reply" | "settle" | "suggest" | "remember" | "repair" | "boundary" | "look";
export const STEPS: readonly Step[] = ["open", "decide", "reactions", "consider", "reply", "settle", "suggest", "remember", "repair", "boundary", "look"];

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
 * keeps it apart from every other database's. A turn's lines can be asked for again (set_suggestions
 * turned back on), and each ask has its own answer: `ask` is the suggest step's k-th ask of the
 * turn, the second on keyed `suggest-<k>`. A scene's boundary is keyed by its last turn: a scene
 * ends once (story-design §4.2).
 */
export const idempotencyKey = (game: string, scene: bigint | string, turn: number, step: Step, ask = 1) =>
  `${game}:s${scene}:t${turn}:${step}${step === "suggest" && ask > 1 ? `-${ask}` : ""}`;

/**
 * A creation step's key: `<creation uid>:c<rev>:<step>`. The creation's rev is the row's when the
 * step was asked for, so a step asked again after the player moved on has a key of its own, and the
 * uid (the game's, once it's made) keeps it apart from every other creation's.
 */
export const creationKey = (uid: string, rev: number, step: CreationStep) => `${uid}:c${rev}:${step}`;

/**
 * Whether a text is a game's id as the AI service takes one: a key's first part and a folder's name
 * in its store. A letter or a digit, then letters, digits, dots, dashes and underscores: 100 at most.
 */
export const isGameId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id);

/** A turn's think, by its key. `ask` is there only on a suggest key's second ask or later. */
export interface TurnKeyParts { game: string; scene: string; turn: number; step: Step; ask?: number }
/** A creation's step, by its key: `game` is the creation's uid. */
export interface CreationKeyParts { game: string; rev: number; step: CreationStep }

/** A key's parts (a turn's think has a turn, a creation's step a rev), or undefined when it isn't one. */
export function keyParts(key: string): TurnKeyParts | CreationKeyParts | undefined {
  const turn = /^(.+):s(\d+):t(\d+):(?:(open|decide|reactions|consider|reply|settle|remember|repair|boundary|look)|suggest(?:-([1-9]\d*))?)$/.exec(key);
  if (turn) {
    if (turn[5] === "1") return undefined;
    const parts = { game: turn[1]!, scene: turn[2]!, turn: Number(turn[3]) };
    if (turn[4]) return { ...parts, step: turn[4] as Step };
    return { ...parts, step: "suggest", ...(turn[5] ? { ask: Number(turn[5]) } : {}) };
  }
  const creation = /^(.+):c(\d+):(offer|pick|own|draft|work|check|traits)$/.exec(key);
  return creation ? { game: creation[1]!, rev: Number(creation[2]), step: creation[3] as CreationStep } : undefined;
}

/** Whether a key's parts are a turn's think (else a creation's step). */
export const isTurnKey = (parts: TurnKeyParts | CreationKeyParts): parts is TurnKeyParts => "turn" in parts;

/** A turn's think's parts, by its key; undefined for a creation's step, or what isn't a key. */
export function turnKeyParts(key: string): TurnKeyParts | undefined {
  const parts = keyParts(key);
  return parts && isTurnKey(parts) ? parts : undefined;
}

/** A row's id as JSON carries it. */
export const idText = (id: bigint) => id.toString();

/** An id from JSON as a row's. */
export const idOf = (text: string) => BigInt(text);

/** A player's lines' speaker in the transcript. */
export const playerSpeaker = (playerId: bigint | string) => `player:${playerId}`;
