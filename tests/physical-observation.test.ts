import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { MapStateSchema } from "../packages/contracts/src/index.js";
import { inventoryOwners } from "../packages/core/src/inventory.js";
import { worldForCharacter } from "../packages/core/src/physical-view.js";
import type { GameAction } from "../packages/core/src/actions.js";
import { physicalCharacterObservation } from "../apps/web/src/physical-observation.js";
import { renderJevRoomView } from "../apps/web/src/jev-room-view.js";

test("physical observations render supplied actions without a narrative character model", () => {
  const map = create(MapStateSchema, { revision: 17,
    rooms: [{ id: "hall", name: "Hall" }],
    actors: [{ characterId: "visitor", roomId: "hall", position: { x: 1, y: 1 } }, { characterId: "guard", roomId: "hall" }],
    fixtures: [{ id: "chest", name: "Chest", roomId: "hall", container: true,
      inventory: { items: [{ id: "letter", name: "Hidden letter", concealed: true }] } }],
  });
  const visible = worldForCharacter(map, inventoryOwners([], map), "visitor");
  const actions: GameAction[] = [{ id: "custom_talk", type: "talk", target: "guard", legality: "normal",
    description: "Talk to Guard", path: [{ x: 1, y: 1 }] }];
  const observation = physicalCharacterObservation(visible, "visitor", "Ask the guard", actions);
  assert.equal(observation.characterId, "visitor");
  assert.equal(observation.revision, 17);
  assert.equal(observation.goal, "Ask the guard");
  assert.equal(observation.actions, actions);
  assert.ok(!("characterContext" in observation));
  const rendered = renderJevRoomView(visible, [{ id: "guard", name: "Guard" }], observation);
  assert.match(rendered, /Hall \(current room\)/);
  assert.match(rendered, /\[custom_talk\]/);
  assert.match(rendered, /Contents: Unknown until opened/);
  assert.doesNotMatch(rendered, /Hidden letter|\[visitor\]/);
  assert.throws(() => physicalCharacterObservation(visible, "missing", "", []), /not placed/);
});
