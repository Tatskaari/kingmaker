// New (docs/combat-gm.md): a fight played in the conversation. The GM rolls for initiative from its
// reply, then narrates every turn in initiative order, each through its tools (perform_action,
// end_turn, end_combat), while the rules decide what the dice decide. What the fight keeps between
// steps (gm_state's combat) and its pure rules: whose turn is next, and whether a side is beaten.

/** The two sides: the player's (the player, and whoever fights beside them) and the other. */
export type Side = "party" | "foes";

/** Someone in the fight, in initiative order: the player is "player", the cast by their ids. `out`: fled or gave up (down is the rules', read each step). */
export interface Fighter { id: string; side: Side; initiative: number; out?: "fled" | "yielded" }

/**
 * A fight in progress (gm_state's combat): the turn it broke out on, the round, everyone in
 * initiative order, whose turn it is (an index into the order), and what it's about.
 * - `pending`: who's here and has no side yet (those the reply left out as it broke out, then
 *   whoever arrives): before the next turn the GM picks each one's side, or has them run (pick_sides).
 * - `fled`: who ran from it as they picked (gone from the scene).
 * - `arrived`: the scene's reinforcements who have come in this fight (or were here as it broke out).
 * - `from`: "settle" when it broke out in the settle (the co-GM's move into an event with a fight),
 *   so its end's settle on the same turn is the turn's second.
 */
export interface CombatState { started: number; round: number; order: Fighter[]; at: number; why: string; pending?: string[]; fled?: string[]; arrived?: string[]; from?: "settle" }

/** A side to pick (pick_sides): with the player, against them, or running from the fight. */
export type SidePick = "with_player" | "against_player" | "flee";
export const SIDE_PICKS: readonly SidePick[] = ["with_player", "against_player", "flee"];

/** How a fight ended: the player's side won, lost, the other side gave up, the player got away, or both sides stopped. */
export type CombatOutcome = "won" | "lost" | "yielded" | "fled" | "stopped";
export const COMBAT_OUTCOMES: readonly CombatOutcome[] = ["won", "lost", "yielded", "fled", "stopped"];

/** What anyone can do on their turn (perform_action's `action`). The player's are the rules' acts on their sheet; the cast's are their statblock's blow, and the rest. */
export type CombatVerb = "attack" | "cast" | "grapple" | "shove" | "feature" | "check" | "move" | "flee" | "surrender" | "other";
export const COMBAT_VERBS: readonly CombatVerb[] = ["attack", "cast", "grapple", "shove", "feature", "check", "move", "flee", "surrender", "other"];

/** The verbs that take a turn's action: one a turn. */
export const ACTION_VERBS: ReadonlySet<CombatVerb> = new Set(["attack", "cast", "grapple", "shove", "check", "flee", "surrender"]);

/** perform_action calls a turn may make before it has to end. */
export const ACTS_A_TURN = 3;

/** Who's still fighting: in the order, not out, and not down by the rules. */
export const standing = (state: CombatState, down: ReadonlySet<string>) => state.order.filter(f => !f.out && !down.has(f.id));

/** The fighter whose turn it is. */
export const whoseTurn = (state: CombatState): Fighter => state.order[state.at]!;

/**
 * The next turn: the next in the order still fighting (a new round when it comes round to the top).
 * Undefined when nobody is.
 */
export function nextTurn(state: CombatState, down: ReadonlySet<string>): CombatState | undefined {
  for (let step = 1; step <= state.order.length; step++) {
    const at = (state.at + step) % state.order.length;
    const f = state.order[at]!;
    if (f.out || down.has(f.id)) continue;
    return { ...state, at, round: state.round + (state.at + step >= state.order.length ? 1 : 0) };
  }
  return undefined;
}

/**
 * Whether the fight is over by the rules: the player down or gone (they lose), or nobody left on the
 * other side (they win, or the other side gave up when the last of them yielded). The GM ends it
 * otherwise (end_combat).
 */
export function overOf(state: CombatState, down: ReadonlySet<string>): { outcome: CombatOutcome; why: string } | undefined {
  const player = state.order.find(f => f.id === "player");
  if (player && (down.has("player") || player.out)) return { outcome: player.out === "fled" ? "fled" : "lost", why: player.out === "fled" ? "the player got away" : "the player is down" };
  const foes = state.order.filter(f => f.side === "foes");
  // Nobody against the player, and nobody left to pick a side: there's no fight to have.
  if (!foes.length && !state.pending?.length) return { outcome: "stopped", why: "nobody here is against the player" };
  if (foes.length && foes.every(f => f.out || down.has(f.id))) {
    const yielded = foes.some(f => f.out === "yielded") && foes.every(f => f.out === "yielded" || f.out === "fled" || down.has(f.id));
    return { outcome: yielded && !foes.some(f => down.has(f.id)) ? "yielded" : "won", why: "nobody on the other side can fight on" };
  }
  return undefined;
}
