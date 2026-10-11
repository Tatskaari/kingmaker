import { toBinary } from "@bufbuild/protobuf";
import { INVALID_MOVE } from "boardgame.io/core";
import { MapFixtureSchema, type MapFixture } from "../../contracts/src/index.js";
import { inventoryError, inventoryOwners } from "./inventory.js";
import type { SimulationMoveContext } from "./simulation-move.js";

export type FixtureUpdate = (fixture: MapFixture) => void;

/** Trusted synchronous callbacks only. INVALID_MOVE discards even pre-validation edits. */
export function updateFixture({ G }: SimulationMoveContext, id: string, update: FixtureUpdate) {
  const map = G.map, fixture = map?.fixtures.find(candidate => candidate.id === id);
  if (!map || !fixture || typeof update !== "function") return INVALID_MOVE;
  const result: unknown = update(fixture);
  if (result && (typeof result === "object" || typeof result === "function") && "then" in result) {
    // Consume a rejected continuation (including a revoked-draft access) without committing it.
    void Promise.resolve(result).catch(() => undefined);
    return INVALID_MOVE;
  }
  if (result !== undefined || fixture.id !== id) return INVALID_MOVE;
  try { toBinary(MapFixtureSchema, fixture); } catch { return INVALID_MOVE; }
  for (const point of [fixture.position, fixture.interactionSpot]) {
    if (point && (!Number.isInteger(point.x) || !Number.isInteger(point.y))) return INVALID_MOVE;
  }
  if (inventoryError(inventoryOwners(Object.values(G.runtimeCharacters), map))) return INVALID_MOVE;
  map.revision++;
}
