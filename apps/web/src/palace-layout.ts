import { RoomBuilder, type Region } from "./room-builder.js";

export const palaceLayout = new RoomBuilder(124, 49);
const room = (id: string, name: string, regions: Region[], residents: string[] = []) =>
  palaceLayout.room({ id, name, regions, residents });

// The royal household forms the central block between the two wings.
room("corvin_chamber", "Corvin's Chamber", [
  { x: 49, y: 3, width: 5, height: 5 },
  { x: 51, y: 8, width: 2, height: 1 },
], ["corvin"]);
room("royal_bedchamber", "Royal Bedchamber", [
  { x: 59, y: 3, width: 6, height: 5 },
  { x: 61, y: 8, width: 2, height: 1 },
], ["aldren"]);
room("garran_chamber", "Holt's Chamber", [
  { x: 70, y: 3, width: 5, height: 5 },
  { x: 71, y: 8, width: 2, height: 1 },
], ["holt"]);
room("north_corridor", "Royal Back Hall", [
  { x: 49, y: 11, width: 26, height: 3 },
  { x: 51, y: 9, width: 2, height: 2 },
  { x: 61, y: 9, width: 2, height: 2 },
  { x: 71, y: 9, width: 2, height: 2 },
  { x: 51, y: 14, width: 2, height: 2 },
], ["corvin", "aldren", "holt"]);
room("royal_council_chamber", "Royal Council Chamber", [
  { x: 48, y: 17, width: 6, height: 4 },
  { x: 54, y: 18, width: 1, height: 2 },
  { x: 51, y: 16, width: 2, height: 1 },
], []);
room("great_hall", "Great Hall", [
  { x: 56, y: 17, width: 12, height: 13 },
  { x: 55, y: 18, width: 1, height: 2 },
  { x: 54, y: 25, width: 2, height: 2 },
  { x: 68, y: 22, width: 2, height: 2 },
  { x: 61, y: 30, width: 2, height: 2 },
], []);
room("guest_chamber", "Nobles' Parlour", [
  { x: 48, y: 24, width: 6, height: 9 },
], ["player", "corvin", "holt", "aldren", "gurt", "klog", "bran", "elinor", "oswin", "rowan", "peregrine", "cressida", "abel"]);
room("entrance_hall", "Entrance Hall", [
  { x: 58, y: 33, width: 8, height: 5 },
  { x: 61, y: 32, width: 2, height: 1 },
  { x: 61, y: 37, width: 2, height: 12 },
], []);
room("treasury", "Treasury", [
  { x: 70, y: 21, width: 6, height: 9 },
], []);

room("palace_back_hall", "East Wing", [
  { x: 68, y: 17, width: 13, height: 1 },
  { x: 78, y: 12, width: 3, height: 19 },
  { x: 81, y: 13, width: 1, height: 2 },
  { x: 81, y: 28, width: 2, height: 2 },
]);
room("west_wing", "West Wing", [
  { x: 43, y: 12, width: 3, height: 26 },
  { x: 42, y: 13, width: 1, height: 2 },
  { x: 42, y: 28, width: 1, height: 2 },
  { x: 46, y: 36, width: 12, height: 2 },
]);

/** A public receiving room buffers each private corridor from the wing.
 * Mirroring the complete suite keeps thresholds outside bedroom rectangles. */
function delegation(wing: "west" | "east", y: number, id: string, publicId: string,
  title: string, members: [room: string, resident: string][]) {
  const region = (x: number, dy: number, width: number, height: number): Region => ({
    x: wing === "west" ? 78 - x - width : x + 46, y: y + dy, width, height,
  });
  room(publicId, title, [region(37, 2, 9, 9), region(36, 8, 1, 2)]);
  room(`${id}_back_hall`, `${id[0]!.toUpperCase()}${id.slice(1)} Back Hall`, [
    region(46, 8, 29, 2), ...members.map((_, i) => region(52 + i * 10, 6, 2, 2)),
  ], members.map(([, resident]) => resident));
  members.forEach(([slot, resident], i) => room(`${slot}_chamber`,
    `${resident[0]!.toUpperCase()}${resident.slice(1)}'s Chamber`, [region(50 + i * 10, 0, 7, 5), region(52 + i * 10, 5, 2, 1)], [resident]));
}
delegation("west", 5, "ironmark", "ironmark_salon", "Ironmark Salon", [["mara", "gurt"], ["hadrik", "klog"], ["tessa", "bran"]]);
delegation("west", 20, "greenweald", "greenweald_solar", "Greenweald Solar", [["elinor", "elinor"], ["oswin", "oswin"], ["rowan", "rowan"]]);
delegation("east", 5, "saltmere", "saltmere_drawing_room", "Saltmere Drawing Room", [["lucan", "peregrine"], ["sabine", "cressida"], ["rook", "abel"]]);
room("dining_hall", "Long Dining Hall", [{ x: 83, y: 22, width: 40, height: 9 }]);
