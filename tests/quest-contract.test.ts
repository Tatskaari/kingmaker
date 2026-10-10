import assert from "node:assert/strict";
import test from "node:test";
import { create, fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";

test("quest graph and playthrough progress survive world save formats", () => {
  const world = create(WorldStateSchema, { quests: { delivery: {
    quest: {
      id: "delivery", title: "Pillow delivery", description: "Clear the entrance",
      initialStageId: "blocked",
      stages: [
        { id: "blocked", title: "Blocked", description: "The cart blocks the door" },
        { id: "unloading", title: "Unloading", description: "Helpers unload" },
      ],
      transitions: ["repair", "back_out"].map(id => ({
        id, fromStageId: "blocked", toStageId: "unloading",
        description: `Clear by ${id}`, condition: "Entrance has physically cleared",
      })),
    },
    currentStageId: "unloading", revision: 1,
    history: [{ transitionId: "back_out", revision: 1, evidence: "Cart moved outside" }],
  } } });
  assert.deepEqual(fromBinary(WorldStateSchema, toBinary(WorldStateSchema, world)), world);
  assert.deepEqual(fromJson(WorldStateSchema, toJson(WorldStateSchema, world)), world);
});
