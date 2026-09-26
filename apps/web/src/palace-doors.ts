import { palaceEdges, palaceNodes } from "./palace-navigation.js";
import { pointKey, type NavEdge, type NavNode, type Point } from "./navigation.js";

export interface Door {
  id: string;
  name: string;
  tiles: Point[];
  open: boolean;
  sides: [NavNode, NavNode];
  connection: [string, string];
}
function door(id: string, name: string, x: number, y: number, vertical: boolean,
  from: string, to: string, open = false): Door {
  return { id, name, open, connection: [from, to],
    tiles: [{ x, y }, { x: x + (vertical ? 0 : 1), y: y + (vertical ? 1 : 0) }],
    sides: [
      { id: `${id}_outside`, name: `${name} · outside`, x: x + (vertical ? -1 : 0), y: y + (vertical ? 0 : 1) },
      { id: `${id}_inside`, name: `${name} · inside`, x: x + (vertical ? 1 : 0), y: y + (vertical ? 0 : -1) },
    ],
  };
}
export function createDoors(): Door[] {
  return [
    door("merlin_door", "Merlin's door", 5, 9, false, "west_junction", "merlin"),
    door("royal_door", "Royal door", 15, 9, false, "north_junction", "royal"),
    door("lancelot_door", "Lancelot's door", 25, 9, false, "east_junction", "lancelot"),
    door("hall_door", "Great Hall door", 15, 15, false, "great_hall", "north_junction", true),
    door("entrance_door", "Entrance Hall door", 15, 25, false, "entrance", "great_hall", true),
    door("guest_door", "Guest door", 8, 22, true, "guest", "great_hall"),
    door("treasury_door", "Treasury door", 23, 22, true, "great_hall", "treasury"),
  ];
}
export function doorGraph(doors: readonly Door[]): { nodes: NavNode[]; edges: NavEdge[] } {
  const edges = palaceEdges.filter(edge => !doors.some(door =>
    door.connection.includes(edge.from) && door.connection.includes(edge.to)));
  for (const door of doors) {
    const [a, b] = door.sides;
    edges.push({ from: door.connection[0], to: a.id }, { from: a.id, to: b.id }, { from: b.id, to: door.connection[1] });
  }
  return { nodes: [...palaceNodes, ...doors.flatMap(door => door.sides)], edges };
}
export function doorBlockers(doors: readonly Door[]): Set<string> {
  return new Set(doors.filter(door => !door.open).flatMap(door => door.tiles.map(pointKey)));
}
export function canUseDoor(door: Door, position: Point, moving = false): boolean {
  return !moving && door.tiles.some(tile => Math.abs(tile.x - position.x) + Math.abs(tile.y - position.y) === 1)
    && !door.tiles.some(tile => pointKey(tile) === pointKey(position));
}
export function toggleDoor(door: Door, position: Point, moving = false): boolean {
  if (!canUseDoor(door, position, moving)) return false;
  door.open = !door.open;
  return true;
}
