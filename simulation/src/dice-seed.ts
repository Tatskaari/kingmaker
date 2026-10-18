import type { Identity } from "spacetimedb";
import { refusal } from "../../shared/protocol/refusals.ts";
import { isAdmin } from "./access.ts";
import { Refused, type Db, type TxCtx } from "./context.ts";

/**
 * The owner's fixed dice, for a test against a real database (the e2e). A game's dice are its seed's
 * sequence (dice-row.ts, rules/session.ts), and its seed is tx.seed(): SpacetimeDB's randomness, so
 * no two runs roll alike. Once the owner has set a seed (set_dice_seed), tx.seed() is that seed plus
 * how many games it has seeded since, so a run that makes the same games and moves rolls the same.
 * The memory host draws on its own fixed sequence, and honours this the same. Only the owner sets
 * it or takes it away; a player never can.
 */

/** Seeds go 0 to 999,999,999 (TxCtx.seed): one past the last. */
const SEEDS = 1_000_000_000;

/**
 * set_dice_seed, the owner's: from a seed, the next game made gets it, the one after it the seed
 * plus one, and so on; none hands the dice back to the transaction's randomness.
 */
export function setDiceSeedReducer(tx: TxCtx, sender: Identity, { seed }: { seed?: number }): void {
  if (!isAdmin(tx, sender)) throw new Refused(refusal("not_admin", { what: "fix the dice" }));

  tx.db.diceSeed.id.delete(0);
  if (seed !== undefined) tx.db.diceSeed.insert({ id: 0, seed, given: 0 });
}

/** A new game's dice seed (tx.seed()): the fixed seed's next while the owner has set one, counted; else the host's randomness. */
export function seedOf(db: Db, random: () => number): number {
  const fixed = db.diceSeed.id.find(0);
  if (!fixed) return random();

  db.diceSeed.id.update({ ...fixed, given: fixed.given + 1 });
  return (fixed.seed + fixed.given) % SEEDS;
}
