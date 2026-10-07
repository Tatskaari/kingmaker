import { INVALID_MOVE } from "boardgame.io/core";
import { Immer } from "immer";
import type { SimulationState } from "../../contracts/src/v2.js";
import type { SimulationMove } from "./simulation-move.js";

// Temporary host adapter. Remove when boardgame.io owns execution.
// Other simulation services still mutate live state, so disable auto-freezing only
// on this Immer instance until those services also dispatch moves.
const immer = new Immer({ autoFreeze: false });

export function executeLocalMove<Args extends unknown[]>(G: SimulationState, move: SimulationMove<Args>, ...args: Args): SimulationState {
  let invalid = false;
  const next = immer.produce<SimulationState, SimulationState>(G, draft => {
    invalid = move({ G: draft }, ...args) === INVALID_MOVE;
  });
  if (invalid) throw new Error("Invalid simulation move");
  return next;
}
