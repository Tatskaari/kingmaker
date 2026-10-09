import { INVALID_MOVE } from "boardgame.io/core";
import { GamePhase } from "../../contracts/src/index.js";
import type { SimulationMoveContext } from "./simulation-move.js";

// Temporary one-minute cadence for playtesting.
export const CRESSIDA_TRANSFORMATION_MS = 60_000;
export const CRESSIDA_COW_EVENT = "You can’t believe it. Lady Cressida has vanished. In her place stands a cow. A rather overweight one at that. And ugly.";
export const CRESSIDA_HUMAN_EVENT = "The cow has vanished. Lady Cressida stands in its place, looking mortified and furiously daring anyone to comment.";

/** The solstice scheduler owns the cadence; this move publishes only the affected body. */
export function transformCressida({ G }: SimulationMoveContext) {
  const actor = G.map?.actors.find(actor => actor.characterId === "cressida");
  if (!actor?.position || G.map?.phase !== GamePhase.CONVERSATIONS) return INVALID_MOVE;
  actor.physicalForm = actor.physicalForm === "cow" ? "human" : "cow";
  G.map.revision++;
}
