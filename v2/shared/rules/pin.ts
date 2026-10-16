import { rng } from "../dice.ts";
import { pinned } from "./shim.ts";

/**
 * The pin a call to the rules engine runs under in the simulation (v1-design §3.6): its ids drawn
 * from the game's dice, its clock at the transaction's time, so what it writes is a pure function
 * of the rows. The simulation computes the seed (dice.seed + 104729 × (dice.rolls + 1) +
 * tx.engineCalls), which the ids draw on without advancing the dice. The AI service pins nothing.
 *
 * Its own file, and not re-exported by index.ts: loading it loads the shim, which gives the global
 * object a `window` (ulid's crypto). The simulation and the AI service load the shim anyway; the
 * client loads index.ts and must not get one (the SpacetimeDB SDK takes a `window` for a browser's
 * and listens on it).
 */

/** Runs fn with the engine's ids drawn from rng(seed) and its clock at nowMs (shim.ts pinned); restores both after. */
export function withEngine<T>(pin: { seed: number; nowMs: number }, fn: () => T): T {
  const next = rng(pin.seed);
  return pinned({ fill: bytes => bytes.forEach((_, i) => { bytes[i] = Math.floor(next() * 256); }), nowMs: pin.nowMs }, fn);
}
