import { INVALID_MOVE } from "boardgame.io/core";
import type { SimulationMoveContext } from "./simulation-move.js";

/** Remove empty fixtures only; missing IDs make retries harmless. */
export function removeFixtures({ G }: SimulationMoveContext, ids: string[]) {
  if (!G.map || !Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" || !id)) return INVALID_MOVE;
  if (G.map.fixtures.some(f => ids.includes(f.id) && f.inventory?.items.length)) return INVALID_MOVE;
  G.map.fixtures = G.map.fixtures.filter(f => !ids.includes(f.id));
  G.map.revision++;
}
