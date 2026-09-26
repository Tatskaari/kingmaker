import type { PalaceAction } from "./palace-agent.js";
import { pointKey, type NavEdge, type NavNode, type Point } from "./navigation.js";

export interface Item { id: string; name: string }
export interface Furniture extends Point {
  id: string; name: string; roomId: string; sprite: number;
  kind: "decoration" | "drawers" | "lockbox";
  open: boolean; searched: boolean; contents: Item[];
  approach?: NavNode;
  requiredKey?: string;
}
export interface FurnitureState { furniture: Furniture[]; inventory: Item[] }
export function createFurniture(): FurnitureState {
  const decoration = (id: string, name: string, roomId: string, x: number, y: number, sprite: number): Furniture =>
    ({ id, name, roomId, x, y, sprite, kind: "decoration", open: false, searched: false, contents: [] });
  return { inventory: [], furniture: [
    { ...decoration("merlin_drawers", "Merlin's chest of drawers", "merlin", 6, 4, 75), kind: "drawers",
      contents: [{ id: "royal_key", name: "Royal lockbox key" }],
      approach: { id: "merlin_drawers_approach", name: "Merlin's chest of drawers", x: 6, y: 5 } },
    { ...decoration("royal_lockbox", "King's lockbox", "royal", 17, 4, 90), kind: "lockbox", requiredKey: "royal_key",
      approach: { id: "royal_lockbox_approach", name: "King's lockbox", x: 17, y: 5 } },
    decoration("merlin_books", "Merlin's bookcase", "merlin", 3, 3, 63),
    decoration("merlin_desk", "Writing desk", "merlin", 3, 6, 72),
    decoration("merlin_stool", "Desk stool", "merlin", 4, 6, 73),
    decoration("royal_cabinet", "Royal cabinet", "royal", 18, 3, 75),
    decoration("royal_table", "Royal table", "royal", 13, 6, 72),
    decoration("royal_stool", "Royal stool", "royal", 14, 6, 73),
    decoration("lancelot_books", "Lancelot's bookcase", "lancelot", 24, 3, 63),
    decoration("lancelot_table", "Lancelot's table", "lancelot", 27, 6, 72),
    decoration("lancelot_stool", "Lancelot's stool", "lancelot", 26, 6, 73),
    decoration("guest_table", "Guest table", "guest", 3, 21, 72),
    decoration("guest_stool", "Guest stool", "guest", 4, 21, 73),
    decoration("guest_cabinet", "Guest cabinet", "guest", 6, 27, 75),
    decoration("treasury_barrel", "Storage barrel", "treasury", 25, 21, 82),
    decoration("treasury_barrel_2", "Storage barrel", "treasury", 28, 27, 82),
    decoration("treasury_shelf", "Treasury shelves", "treasury", 29, 22, 63),
    decoration("hall_table_west", "Hall table", "great_hall", 12, 18, 72),
    decoration("hall_stool_west", "Hall stool", "great_hall", 12, 19, 73),
    decoration("hall_table_east", "Hall table", "great_hall", 19, 18, 72),
    decoration("hall_stool_east", "Hall stool", "great_hall", 19, 19, 73),
    decoration("entrance_table", "Entrance table", "entrance", 12, 28, 72),
    decoration("entrance_table_2", "Entrance table", "entrance", 18, 28, 72),
  ] };
}
export function addFurnitureNodes(graph: { nodes: NavNode[]; edges: NavEdge[] }, state: FurnitureState): void {
  for (const furniture of state.furniture) if (furniture.approach) {
    graph.nodes.push(furniture.approach);
    graph.edges.push({ from: furniture.roomId, to: furniture.approach.id });
  }
}
export function furnitureBlockers(state: FurnitureState): string[] { return state.furniture.map(pointKey); }
export function besideFurniture(furniture: Furniture, position: Point): boolean {
  return Math.abs(furniture.x - position.x) + Math.abs(furniture.y - position.y) === 1;
}
export function furnitureActions(state: FurnitureState, position: Point, moving = false): PalaceAction[] {
  if (moving) return [];
  return state.furniture.flatMap(furniture => {
    if (furniture.kind === "decoration" || !besideFurniture(furniture, position)) return [];
    const actions: PalaceAction[] = [];
    if (furniture.open) {
      actions.push({ id: `close_${furniture.id}`, type: "close_container", target: furniture.id, description: `Close ${furniture.name}.` });
      for (const item of furniture.contents) actions.push({ id: `take_${item.id}`, type: "take_item", target: furniture.id,
        itemId: item.id, description: `Take ${item.name} from ${furniture.name} into your inventory.` });
    } else if (!furniture.requiredKey || state.inventory.some(item => item.id === furniture.requiredKey)) {
      actions.push({ id: `open_${furniture.id}`, type: "open_container", target: furniture.id,
        description: furniture.requiredKey ? `Use your Royal lockbox key to unlock and open ${furniture.name}.` : `Open ${furniture.name} to inspect its contents.` });
    }
    return actions;
  });
}
/** Dispatch is revalidated, including adjacency, container state and key ownership. */
export function applyFurnitureAction(state: FurnitureState, position: Point, actionId: string, moving = false): string {
  const action = furnitureActions(state, position, moving).find(action => action.id === actionId);
  if (!action) throw new Error("That furniture action is unavailable. Stand beside it; the lockbox also requires its key.");
  const furniture = state.furniture.find(furniture => furniture.id === action.target)!;
  if (action.type === "take_item") {
    const index = furniture.contents.findIndex(item => item.id === action.itemId);
    const [item] = furniture.contents.splice(index, 1);
    state.inventory.push(item!);
    return `Picked up ${item!.name}.`;
  }
  furniture.open = action.type === "open_container";
  if (furniture.open) furniture.searched = true;
  return `${furniture.name} ${furniture.open ? "opened" : "closed"}.`;
}
export function observeFurniture(state: FurnitureState): unknown[] {
  return state.furniture.filter(furniture => furniture.kind !== "decoration").map(furniture => ({
    id: furniture.id, name: furniture.name, room: furniture.roomId, approachNode: furniture.approach?.id,
    state: furniture.open ? "open" : furniture.requiredKey ? "locked" : "closed",
    ...(furniture.requiredKey ? { requiresItemToOpen: furniture.requiredKey } : {}),
    searchStatus: furniture.searched ? "inspected" : "unsearched",
    // Contents are unknown before inspection; remembered after closing in this single-actor demo.
    ...(furniture.searched ? { knownContents: furniture.contents } : { knownContents: "Unknown until opened; may contain useful items" }),
  }));
}
