import assert from "node:assert/strict";
import test from "node:test";
import { palaceFurniture } from "../apps/web/src/palace-furniture.js";
import { inventoryOwners } from "../packages/core/src/inventory.js";
import { characterDocuments } from "../packages/lore/src/character-id.js";
import { loadPlayableWorld } from "./fixtures.js";

test("regenerating furniture preserves live document owners, names and stable fixture IDs", () => {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  const existing = map.fixtures.filter(fixture => fixture.id.startsWith("furn_"));
  map.fixtures = map.fixtures.filter(fixture => !fixture.id.startsWith("furn_"));
  const characters = characterDocuments(world).map(({ id, document }) => ({ id, inventory: document.characterProperties?.inventory }));
  assert.deepEqual(palaceFurniture(map, inventoryOwners(characters, map)), existing);
});
