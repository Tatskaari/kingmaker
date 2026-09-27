import type { Point } from "./navigation.js";

export interface CourtAction {
  id: string;
  label: string;
  type: "walk" | "talk" | "debug" | "inspect" | "door" | "fixture";
  target: string;
  order: number;
  legality: "normal" | "illegal";
}
export interface CourtInteractionLayer {
  id: string;
  position: Point;
  order: number;
  actions: CourtAction[];
}
/** All matching layers contribute, with stable ordering independent of input order. */
export function actionsAtTile(tile: Point, layers: readonly CourtInteractionLayer[]): CourtAction[] {
  return layers.filter(layer => layer.position.x === tile.x && layer.position.y === tile.y)
    .flatMap(layer => layer.actions.map(action => ({ action, layer })))
    .sort((a, b) => a.action.order - b.action.order || a.layer.order - b.layer.order
      || a.layer.id.localeCompare(b.layer.id) || a.action.id.localeCompare(b.action.id))
    .map(({ action }) => action);
}
