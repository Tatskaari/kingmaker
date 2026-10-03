import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { DndCharacterSchema, InventorySchema } from "../packages/contracts/src/index.js";
import { readVault } from "../scripts/lib/lore-access.js";

const vault = new URL("../lore/", import.meta.url);
const entries = [...readVault(fileURLToPath(vault)).keys()]
  .filter(name => /^Scenarios\/.+\/Characters\/[^/]+\/character\.md$/.test(name));

for (const entry of entries) {
  test(`scenario properties match the stats and inventory protobufs: ${entry}`, () => {
    const filename = entry.replace(/character\.md$/, "properties.json");
    const properties = JSON.parse(readFileSync(new URL(filename, vault), "utf8")) as Record<string, JsonValue>;
    assert.deepEqual(Object.keys(properties).sort(), ["dnd", "inventory"]);
    for (const value of Object.values(properties)) {
      assert.ok(value === null || (typeof value === "object" && !Array.isArray(value)),
        "Properties must be an authored object or null (not authored yet)");
    }
    if (properties.dnd !== null) fromJson(DndCharacterSchema, properties.dnd!);
    if (properties.inventory !== null) {
      const inventory = fromJson(InventorySchema, properties.inventory!);
      const ids = new Set(inventory.items.map(item => item.id));
      assert.equal(ids.size, inventory.items.length, "Item IDs must be unique");
      assert.ok(!ids.has(""), "Items must have IDs");
      const equipment = inventory.equipment;
      if (equipment) {
        const equipped = [equipment.mainHandItemId, equipment.offHandItemId,
          equipment.armorItemId, equipment.shieldItemId, ...equipment.attunedItemIds];
        for (const id of equipped.filter(Boolean)) {
          assert.ok(ids.has(id), `Equipped item is missing from inventory: ${id}`);
        }
      }
    }
  });
}
