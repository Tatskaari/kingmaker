import { toJson, create } from "@bufbuild/protobuf";
import { WorldStateSchema, RoomSchema } from "../packages/contracts/src/index.js";
import { inventoryOwners } from "../packages/core/src/inventory.js";
import { characterDocuments } from "../packages/lore/src/character-id.js";
import { loadPlayableWorld } from "./lib/playable-world.js";
import { palaceFurniture } from "../apps/web/src/palace-furniture.js";
import { writeFileSync } from "node:fs";
import { palaceLayout } from "../apps/web/src/palace-layout.js";

const world = loadPlayableWorld(), map = world.map!;
palaceLayout.validateDoorBoundaries(map.doors);
map.rooms = palaceLayout.worldRooms().map(room => Object.assign(create(RoomSchema),
  map.rooms.find(existing => existing.id === room.id), room));
map.fixtures = map.fixtures.filter(fixture => !fixture.id.startsWith("furn_"));
const characters = characterDocuments(world).map(({ id, document }) => ({ id, inventory: document.characterProperties?.inventory }));
map.fixtures.push(...palaceFurniture(map, inventoryOwners(characters, map)));
// Background bodies are placed from document metadata when a game starts.
map.actors = map.actors.filter(actor => !actor.instanceId);
writeFileSync(new URL("../content/palace-map.json", import.meta.url), JSON.stringify(toJson(WorldStateSchema, map), null, 2) + "\n");
console.log("Synchronized palace room ownership, access, exits and furniture.");
