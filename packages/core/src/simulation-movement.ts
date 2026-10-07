import { create } from "@bufbuild/protobuf";
import { INVALID_MOVE } from "boardgame.io/core";
import { isDraft, original } from "immer";
import { ActorMovementSchema, TilePositionSchema } from "../../contracts/src/index.js";
import type { SimulationState } from "../../contracts/src/v2.js";
import type { Point } from "./navigation.js";
import { createPathfindingService, roomAt, type RouteConstraints } from "./pathfinding.js";
import type { SimulationMoveContext } from "./simulation-move.js";

export function movementActor(G: SimulationState, actorId: string) {
  const actors = G.map?.actors ?? [];
  const exact = actors.filter(actor => actor.instanceId === actorId);
  const matches = exact.length ? exact : actors.filter(actor => actor.characterId === actorId);
  return matches.length === 1 ? matches[0] : undefined;
}
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const pathDistance = (path: readonly Point[]) => path.slice(1).reduce((sum, point, i) => sum + distance(path[i]!, point), 0);

/** Grid coordinates; integer positions are tile centres. Never performs pathfinding. */
export function getActorPosition(G: SimulationState, actorId: string, atMs: number): Point | undefined {
  const actor = movementActor(G, actorId);
  if (!actor?.position) return;
  const movement = actor.movement;
  if (!movement?.path.length) return { x: actor.position.x, y: actor.position.y };
  const path = movement.path;
  let remaining = pathDistance(path) * Math.max(0, Math.min(1, (atMs - movement.startedAtMs) / movement.durationMs));
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!, to = path[i]!, length = distance(from, to);
    if (remaining < length) return { x: from.x + (to.x - from.x) * remaining / length, y: from.y + (to.y - from.y) * remaining / length };
    remaining -= length;
  }
  const last = path.at(-1)!;
  return { x: last.x, y: last.y };
}
export const actorTile = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) });

export interface StartMovement {
  id: string;
  to: Point;
  startedAtMs: number;
  msPerTile: number;
  allowedRoomIds?: RouteConstraints["allowedRoomIds"];
  thresholds?: RouteConstraints["thresholds"];
}

export function startMove({ G }: SimulationMoveContext, actorId: string, request: StartMovement) {
  const actor = movementActor(G, actorId), map = G.map;
  if (!actor || !map?.layout || !request.id || actor.movement?.id === request.id
    || !Number.isFinite(request.startedAtMs) || !Number.isFinite(request.msPerTile) || request.msPerTile <= 0
    || (actor.movement && request.startedAtMs < actor.movement.startedAtMs)) return INVALID_MOVE;
  const from = getActorPosition(G, actorId, request.startedAtMs);
  if (!from) return INVALID_MOVE;
  // Movement never edits tile geometry. Read it directly without drafting the map.
  const layout = isDraft(map.layout) ? original(map.layout)! : map.layout;
  const path = createPathfindingService(layout).findPath(from, request.to, {
    doors: map.doors, fixtures: map.fixtures,
    ...(request.allowedRoomIds ? { allowedRoomIds: request.allowedRoomIds } : {}),
    ...(request.thresholds ? { thresholds: request.thresholds } : {}),
  });
  if (!path || path.length < 2) return INVALID_MOVE;
  actor.position = create(TilePositionSchema, from);
  actor.movement = create(ActorMovementSchema, { id: request.id, path, startedAtMs: request.startedAtMs,
    durationMs: pathDistance(path) * request.msPerTile });
  map.revision++;
}

function finish(G: SimulationState, actorId: string, id: string, atMs: number, complete: boolean) {
  const actor = movementActor(G, actorId), movement = actor?.movement;
  if (!actor || !movement || movement.id !== id || !Number.isFinite(atMs) || atMs < movement.startedAtMs
    || (complete && atMs < movement.startedAtMs + movement.durationMs)) return INVALID_MOVE;
  const point = getActorPosition(G, actorId, atMs)!;
  actor.position = create(TilePositionSchema, point);
  actor.roomId = roomAt(G.map!.layout!, actorTile(point))?.id ?? actor.roomId;
  actor.movement = undefined;
  G.map!.revision++;
}
export function completeMove({ G }: SimulationMoveContext, actorId: string, id: string, completedAtMs: number) {
  return finish(G, actorId, id, completedAtMs, true);
}
export function cancelMove({ G }: SimulationMoveContext, actorId: string, id: string, cancelledAtMs: number) {
  return finish(G, actorId, id, cancelledAtMs, false);
}
