import type { Move } from "../moves/move.ts";
import type { BoundaryPlan } from "../moves/plans.ts";

/**
 * The boundary after a scene ends (story-design §4.3): queued by closeScene, never made as a move,
 * its job the game's and the ended scene's, with no turn. Package B makes it here: its owner (its
 * progress on game.onward and onwardNote, its cost on the chapter), its think (the request built
 * in gm/requests.ts) and its commit (the chapter completed, the next scene waiting or, a summons,
 * opened).
 */
export const crossBoundary: Move<void, BoundaryPlan> = {
  name: "crossBoundary",

  resolve() {
    throw new Error("a boundary is queued by a scene's end, never made as a move");
  },

  think() {
    throw new Error("crossBoundary isn't built yet (story-design §5, package B)");
  },

  commit() {
    throw new Error("crossBoundary isn't built yet (story-design §5, package B)");
  },
};
