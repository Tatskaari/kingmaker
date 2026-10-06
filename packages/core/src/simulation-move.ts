import type { INVALID_MOVE } from "boardgame.io/core";
import type { SimulationState } from "../../contracts/src/v2.js";

/** The subset of boardgame.io's move context used by simulation rules. */
export type SimulationMoveContext = { G: SimulationState };
export type SimulationMove<Args extends unknown[]> = (
  context: SimulationMoveContext, ...args: Args
) => void | typeof INVALID_MOVE;
