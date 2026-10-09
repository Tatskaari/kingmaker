import { INVALID_MOVE } from "boardgame.io/core";
import { GamePhase } from "../../contracts/src/index.js";
import type { SimulationMoveContext } from "./simulation-move.js";
import { movementActor, actorPosition } from "./simulation-movement.js";
import { inventoryOwners } from "./inventory.js";
import { applyFixtureAction, fixtureActions } from "./fixtures.js";

/** Validate the physical approach on the same state that receives the interaction. */
export function interactWithFixture({ G }: SimulationMoveContext, actorId: string, actionId: string, atMs: number, natural?: number) {
  const map = G.map, actor = movementActor(G, actorId);
  if (!map || map.phase !== GamePhase.CONVERSATIONS || !actor || !Number.isFinite(atMs)) return INVALID_MOVE;
  const owners = inventoryOwners(Object.values(G.runtimeCharacters), map);
  const action = fixtureActions(map.fixtures, owners, actorId).find(action => action.id === actionId);
  if (!action) return INVALID_MOVE;
  if (action.verb === "smash" && (!Number.isInteger(natural) || natural! < 1 || natural! > 20)) return INVALID_MOVE;
  if (!(action.target === actorId && action.itemId)) {
    const fixture = map.fixtures.find(item => item.id === action.target), position = actorPosition(actor, atMs);
    if (!fixture?.position || !position) return INVALID_MOVE;
    const spot = fixture.interactionSpot;
    if (spot ? position.x !== spot.x || position.y !== spot.y
      : Math.abs(position.x - fixture.position.x) + Math.abs(position.y - fixture.position.y) !== 1) return INVALID_MOVE;
  }
  applyFixtureAction(G, actorId, actionId, natural);
  map.revision++;
}
