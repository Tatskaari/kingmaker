import type { PalaceAction } from "./palace-agent.js";
import { pointKey, type NavEdge, type NavNode, type Point } from "./navigation.js";

export interface Item { id: string; name: string }
export interface Furniture extends Point {
  id: string; name: string; roomId: string; sprite: number;
  kind: "decoration" | "drawers" | "lockbox" | "container";
  open: boolean; searched: boolean; contents: Item[];
  approach?: NavNode;
  requiredKey?: string;
  revealedName?: string;
  examined?: boolean;
}
export interface FurnitureState { furniture: Furniture[]; inventory: Item[] }
export function createFurniture(): FurnitureState {
  const decoration = (id: string, name: string, roomId: string, x: number, y: number, sprite: number): Furniture =>
    ({ id, name, roomId, x, y, sprite, kind: "decoration", open: false, searched: false, contents: [] });
  const container = (id: string, name: string, room: string, x: number, y: number, sprite: number,
    approachX: number, approachY: number, contents: Item[]): Furniture => ({
      ...decoration(id, name, room, x, y, sprite), kind: "container", contents,
      approach: { id: `${id}_approach`, name, x: approachX, y: approachY },
    });
  return { inventory: [], furniture: [
    { ...decoration("merlin_drawers", "Merlin's chest of drawers", "merlin", 6, 4, 75), kind: "drawers",
      contents: [{ id: "royal_key", name: "Royal lockbox key" }],
      approach: { id: "merlin_drawers_approach", name: "Merlin's chest of drawers", x: 6, y: 5 } },
    { ...decoration("coffer_03", "Carved wooden coffer", "royal", 17, 4, 90), kind: "lockbox", requiredKey: "royal_key", revealedName: "King's lockbox",
      contents: [{ id: "royal_seal", name: "Royal signet seal" }, { id: "sealed_decree", name: "Sealed royal decree" }],
      approach: { id: "coffer_03_approach", name: "Carved wooden coffer", x: 17, y: 5 } },
    container("merlin_books", "Merlin's bookcase", "merlin", 3, 3, 63, 4, 3, [{ id: "star_chart", name: "Star chart" }, { id: "spell_notes", name: "Loose spell notes" }]),
    container("merlin_desk", "Writing desk", "merlin", 3, 6, 72, 3, 5, [{ id: "quill", name: "Silver quill" }, { id: "blue_ink", name: "Bottle of blue ink" }]),
    decoration("merlin_stool", "Desk stool", "merlin", 4, 6, 73),
    container("royal_cabinet", "Wardrobe", "royal", 18, 3, 75, 18, 4, [{ id: "velvet_gloves", name: "Velvet gloves" }, { id: "silk_sash", name: "Silk sash" }]),
    decoration("royal_table", "Royal table", "royal", 13, 6, 72),
    decoration("royal_stool", "Royal stool", "royal", 14, 6, 73),
    container("lancelot_books", "Lancelot's bookcase", "lancelot", 24, 3, 63, 25, 3, [{ id: "drill_manual", name: "Sword drill manual" }, { id: "old_letter", name: "Old letter" }]),
    container("lancelot_table", "Lancelot's desk", "lancelot", 27, 6, 72, 27, 5, [{ id: "whetstone", name: "Whetstone" }, { id: "leather_strap", name: "Leather strap" }]),
    decoration("lancelot_stool", "Lancelot's stool", "lancelot", 26, 6, 73),
    decoration("guest_table", "Guest table", "guest", 3, 21, 72),
    decoration("guest_stool", "Guest stool", "guest", 4, 21, 73),
    container("guest_cabinet", "Guest cabinet", "guest", 6, 27, 75, 5, 27, [{ id: "brass_key", name: "Small brass key" }, { id: "travel_cloak", name: "Travel cloak" }]),
    container("treasury_barrel", "West storage barrel", "treasury", 25, 21, 82, 26, 21, [{ id: "copper_coins", name: "Pouch of copper coins" }, { id: "tally_sticks", name: "Bundle of tally sticks" }]),
    container("treasury_barrel_2", "East storage barrel", "treasury", 28, 27, 82, 27, 27, []),
    container("treasury_shelf", "Treasury shelves", "treasury", 29, 22, 63, 28, 22, [{ id: "account_book", name: "Account book" }, { id: "wax_sticks", name: "Sealing wax sticks" }]),
    decoration("hall_table_west", "Hall table", "great_hall", 12, 18, 72),
    decoration("hall_stool_west", "Hall stool", "great_hall", 12, 19, 73),
    decoration("hall_table_east", "Hall table", "great_hall", 19, 18, 72),
    decoration("hall_stool_east", "Hall stool", "great_hall", 19, 19, 73),
    decoration("entrance_table", "Entrance table", "entrance", 12, 28, 72),
    container("hall_cabinet", "Hall sideboard", "great_hall", 20, 22, 75, 20, 21,
      [{ id: "iron_key", name: "Iron storeroom key" }, { id: "silver_spoon", name: "Silver spoon" }]),
    { ...container("coffer_01", "Iron-banded coffer", "entrance", 13, 30, 90, 13, 29,
      [{ id: "gate_ledger", name: "Gatekeeper's ledger" }]), kind: "lockbox", requiredKey: "iron_key", revealedName: "Gatekeeper's strongbox" },
    { ...container("coffer_02", "Polished wooden coffer", "royal", 14, 3, 90, 14, 4,
      [{ id: "pearl_brooch", name: "Pearl brooch" }, { id: "ribbon", name: "Blue ribbon" }]), kind: "lockbox", requiredKey: "brass_key", revealedName: "Jewellery box" },
    decoration("entrance_table_2", "Entrance table", "entrance", 18, 28, 72),
  ] };
}
export function addFurnitureNodes(graph: { nodes: NavNode[]; edges: NavEdge[] }, state: FurnitureState): void {
  for (const furniture of state.furniture) if (furniture.approach) {
    graph.nodes.push(furniture.approach);
    graph.edges.push({ from: furniture.roomId, to: furniture.approach.id });
  }
}
export function furnitureName(furniture: Furniture): string { return furniture.examined && furniture.revealedName ? furniture.revealedName : furniture.name; }
export function furnitureBlockers(state: FurnitureState): string[] { return state.furniture.map(pointKey); }
export function besideFurniture(furniture: Furniture, position: Point): boolean {
  return Math.abs(furniture.x - position.x) + Math.abs(furniture.y - position.y) === 1;
}
export function furnitureActions(state: FurnitureState, position: Point, moving = false): PalaceAction[] {
  if (moving) return [];
  return state.furniture.flatMap(furniture => {
    if (furniture.kind === "decoration" || !besideFurniture(furniture, position)) return [];
    const actions: PalaceAction[] = [];
    const name = furnitureName(furniture);
    if (furniture.revealedName && !furniture.examined) actions.push({ id: `inspect_${furniture.id}`, type: "inspect_container",
      target: furniture.id, description: `Inspect ${name} to identify it and examine its lock. This does not open it or reveal its contents.` });
    if (furniture.open) {
      actions.push({ id: `close_${furniture.id}`, type: "close_container", target: furniture.id, description: `Close ${name}.` });
      for (const item of furniture.contents) actions.push({ id: `take_${item.id}`, type: "take_item", target: furniture.id,
        itemId: item.id, description: `Take ${item.name} from ${name} into your inventory.` });
    } else if (!furniture.requiredKey || state.inventory.some(item => item.id === furniture.requiredKey)) {
      actions.push({ id: `open_${furniture.id}`, type: "open_container", target: furniture.id,
        description: furniture.requiredKey ? `Use the matching key you carry to unlock and open ${name}.` : `Open ${name} to inspect its contents.` });
    }
    return actions;
  });
}
/** Dispatch is revalidated, including adjacency, container state and key ownership. */
export function applyFurnitureAction(state: FurnitureState, position: Point, actionId: string, moving = false): string {
  const action = furnitureActions(state, position, moving).find(action => action.id === actionId);
  if (!action) throw new Error("That furniture action is unavailable. Stand beside it; the lockbox also requires its key.");
  const furniture = state.furniture.find(furniture => furniture.id === action.target)!;
  if (action.type === "inspect_container") {
    furniture.examined = true;
    return `Identified ${furnitureName(furniture)}. Its contents are still concealed.`;
  }
  const name = furnitureName(furniture);
  if (action.type === "take_item") {
    const index = furniture.contents.findIndex(item => item.id === action.itemId);
    const [item] = furniture.contents.splice(index, 1);
    state.inventory.push(item!);
    return `Picked up ${item!.name}.`;
  }
  furniture.open = action.type === "open_container";
  if (furniture.open) { furniture.searched = true; furniture.examined = true; }
  return `${name} ${furniture.open ? "opened" : "closed"}.`;
}
export function observeFurniture(state: FurnitureState): unknown[] {
  return state.furniture.filter(furniture => furniture.kind !== "decoration").map(furniture => ({
    id: furniture.id, name: furnitureName(furniture), room: furniture.roomId, approachNode: furniture.approach?.id,
    state: furniture.open ? "open" : furniture.requiredKey ? "locked" : "closed",
    ...(furniture.requiredKey && furniture.examined ? { requiresItemToOpen: furniture.requiredKey } : {}),
    searchStatus: furniture.searched ? "inspected" : "unsearched",
    // Contents are unknown before inspection; remembered after closing in this single-actor demo.
    ...(furniture.searched ? { knownContents: furniture.contents } : { knownContents: "Unknown until opened; may contain useful items" }),
  }));
}
