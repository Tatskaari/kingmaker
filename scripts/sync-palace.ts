import { fromJson, toJson } from "@bufbuild/protobuf";
import { WorldStateSchema, MapFixtureSchema } from "../packages/contracts/src/index.js";
import { palaceFurniture } from "../apps/web/src/palace-furniture.js";
import { inventoryOwners } from "../packages/core/src/inventory.js";
import { characterDocuments } from "../packages/lore/src/character-id.js";
import { loadPlayableWorld } from "./lib/playable-world.js";
import { readFileSync, writeFileSync } from "node:fs";
import { palaceLayout } from "../apps/web/src/palace-layout.js";

// Derive geometry from the shared layout; character inventories come from documents.
const path = new URL("../content/palace-map.json", import.meta.url);
const map = JSON.parse(readFileSync(path, "utf8"));
palaceLayout.validateDoorBoundaries(map.doors);
map.rooms = palaceLayout.worldRooms().map(room => ({
  ...map.rooms.find((existing: { id: string }) => existing.id === room.id), ...room,
}));
map.fixtures = map.fixtures.filter((fixture: { id: string }) => !fixture.id.startsWith("furn_"));
const world = loadPlayableWorld(), physical = fromJson(WorldStateSchema, map);
const characters = characterDocuments(world).map(({ id, document }) => ({ id, inventory: document.characterProperties?.inventory }));
const additions = palaceFurniture(physical, inventoryOwners(characters, physical));
map.fixtures.push(...additions.map(fixture => toJson(MapFixtureSchema, fixture)));
writeFileSync(path, JSON.stringify(map, null, 2) + "\n");
console.log("Synchronized palace room ownership, access, exits and furniture.");
