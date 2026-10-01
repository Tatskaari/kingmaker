import type { Scenario, TilePosition } from "../../../packages/contracts/src/index.js";
import { courtRoomAt } from "./court-map.js";

/** Upgrade the original one-sided palace without resetting story or inventories. */
export function migratePalaceWings(saved: Scenario, authored: Scenario): void {
  const world = saved.world, target = authored.world;
  if (!world || !target || saved.id !== authored.id
    || world.rooms.some(room => room.id === "west_wing")
    || !target.rooms.some(room => room.id === "west_wing")) return;

  const western = new Set(["ironmark_salon", "ironmark_back_hall", "greenweald_solar", "greenweald_back_hall",
    ...["mara", "hadrik", "tessa", "elinor", "oswin", "rowan"].map(id => `${id}_chamber`)]);
  const eastern = new Set(["saltmere_drawing_room", "saltmere_back_hall",
    ...["lucan", "sabine", "rook"].map(id => `${id}_chamber`)]);
  const move = (point: TilePosition | undefined, roomId: string) => {
    if (!point) return;
    if (western.has(roomId)) point.x = 77 - point.x;
    else if (eastern.has(roomId)) { point.x += 46; point.y -= 30; }
    else if (roomId === "palace_back_hall" && point.x >= 35) {
      if (point.y < 30) point.x = 77 - point.x;
      else { point.x += 46; point.y -= 30; }
    } else {
      point.x += 46;
      // The former east passage continued down to Saltmere's old floor.
      if (roomId === "palace_back_hall") point.y = Math.min(point.y, 30);
    }
  };
  for (const actor of world.actors) {
    move(actor.position, actor.roomId);
    if (actor.position) actor.roomId = courtRoomAt(actor.position)?.id ?? actor.roomId;
  }
  for (const placement of saved.courtArrivalPlacements) move(placement.position, placement.roomId);
  for (const fixture of world.fixtures) {
    move(fixture.position, fixture.roomId); move(fixture.interactionSpot, fixture.roomId);
    if (fixture.position) fixture.roomId = courtRoomAt(fixture.position)?.id ?? fixture.roomId;
  }
  for (const door of world.doors) {
    const current = target.doors.find(item => item.id === door.id);
    if (!current) continue;
    door.tiles = structuredClone(current.tiles);
    door.interactionSpots = structuredClone(current.interactionSpots);
    door.roomIds = [...current.roomIds];
  }
  for (const current of target.rooms) {
    const existing = world.rooms.find(room => room.id === current.id);
    if (existing) { existing.name = current.name; existing.exitRoomIds = [...current.exitRoomIds]; }
    else world.rooms.push(structuredClone(current));
  }
  world.revision++;
}
