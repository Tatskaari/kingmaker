import type { PalaceAction } from "./palace-agent.js";
import type { NavRoute, Point } from "./navigation.js";
import type { Door } from "./palace-doors.js";
import { furnitureActions, type FurnitureState } from "./palace-furniture.js";

/** Interaction spots are destinations, not separate decisions for the agent. */
export function interactionActions(routes: readonly NavRoute[], doors: readonly Door[], furniture: FurnitureState, position: Point): PalaceAction[] {
  const spots = new Set([...doors.flatMap(door => door.sides.map(side => side.id)),
    ...furniture.furniture.flatMap(item => item.approach ? [item.approach.id] : [])]);
  const stepsTo = (spot: Point & { id: string }): number | undefined => {
    if (spot.x === position.x && spot.y === position.y) return 0;
    const route = routes.find(route => route.node.id === spot.id);
    return route ? route.path.length - 1 : undefined;
  };
  const atSpot = (action: PalaceAction, spot: string, steps: number): PalaceAction => ({
    ...action, interactionSpot: spot,
    description: `${steps ? `Walk ${steps} tiles to the interaction spot, then ` : "At the interaction spot, "}${action.description.charAt(0).toLowerCase()}${action.description.slice(1)}`,
  });
  const actions: PalaceAction[] = routes.filter(route => !spots.has(route.node.id)).map(route => ({
    id: `move_${route.node.id}`, type: "move", target: route.node.id,
    description: `Walk to ${route.node.name} (${route.path.length - 1} tiles).`,
  }));
  for (const door of doors) for (const spot of door.sides) {
    const steps = stepsTo(spot);
    if (steps === undefined) continue;
    const verb = door.open ? "close" : "open";
    actions.push(atSpot({ id: `${verb}_${door.id}_from_${spot.id}`, type: verb, target: door.id,
      description: `${door.open ? "Close" : "Open"} ${door.name} from ${spot.name}, connecting ${door.connection.join(" and ")}.` }, spot.id, steps));
  }
  for (const item of furniture.furniture) {
    if (!item.approach) continue;
    const steps = stepsTo(item.approach);
    if (steps === undefined) continue;
    for (const action of furnitureActions(furniture, item.approach).filter(action => action.target === item.id)) {
      actions.push(atSpot(action, item.approach.id, steps));
    }
  }
  return actions;
}

/** Recheck both before walking and on arrival; cancellation never applies the effect. */
export async function executeInteraction(action: PalaceAction, host: {
  actions(): PalaceAction[];
  at(): string;
  walk(destination: string): Promise<void>;
  apply(action: PalaceAction): void;
}, signal?: AbortSignal): Promise<void> {
  const validate = (): void => {
    signal?.throwIfAborted();
    if (!host.actions().some(candidate => candidate.id === action.id && candidate.interactionSpot === action.interactionSpot)) {
      throw new Error("Interaction is no longer available.");
    }
  };
  validate();
  if (action.interactionSpot && host.at() !== action.interactionSpot) await host.walk(action.interactionSpot);
  validate();
  host.apply(action);
}
