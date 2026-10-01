import { readFileSync, writeFileSync } from "node:fs";
import { palaceLayout } from "../apps/web/src/palace-layout.js";

// Preserve narrative/inventory content while deriving geometry-dependent access
// and exits from the same room functions that build the playable map.
const path = new URL("../content/scenarios/last-night.json", import.meta.url);
const scenario = JSON.parse(readFileSync(path, "utf8"));
scenario.world.rooms = palaceLayout.worldRooms().map(room => ({
  ...scenario.world.rooms.find((existing: { id: string }) => existing.id === room.id), ...room,
}));
writeFileSync(path, JSON.stringify(scenario, null, 2) + "\n");
console.log("Synchronized palace room ownership, access and exits.");
