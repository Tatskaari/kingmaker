import assert from "node:assert/strict";
import test from "node:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { CharacterSchema } from "../packages/contracts/src/index.js";
import { applyObjectiveChange } from "../apps/web/src/objectives.js";

const plan = { action: "set", name: "Gather the court", status: "Garran agreed to help. Invite Lucan next, then verify arrivals.",
  success_criteria: "Everyone is in the Treasury ready to listen.", current_goal: "Talk to Lucan", reason: "Accepted the request" };

test("active objective stores its plan and success criteria across protobuf round trips", () => {
  const character = create(CharacterSchema, { objectives: ["Preserve peace"] });
  applyObjectiveChange(character, plan);
  const restored = fromBinary(CharacterSchema, toBinary(CharacterSchema, character));
  assert.equal(restored.activeObjective?.status, plan.status);
  assert.equal(restored.activeObjective?.successCriteria, plan.success_criteria);
  assert.equal(restored.activeObjective?.currentGoal, restored.currentGoal);
  assert.deepEqual(restored.objectives, ["Preserve peace"]);
  assert.equal(create(CharacterSchema).activeObjective, undefined);
});

test("demote retains an objective; drop and complete remove it; revision keeps the new plan", () => {
  for (const action of ["demote", "drop", "complete"]) {
    const character = create(CharacterSchema, { objectives: ["Preserve peace"] });
    applyObjectiveChange(character, plan);
    applyObjectiveChange(character, { action, reason: "The evidence warrants this transition" });
    assert.equal(character.activeObjective, undefined);
    assert.equal(character.currentGoal, "");
    assert.deepEqual(character.objectives, action === "demote" ? ["Preserve peace", plan.name] : ["Preserve peace"]);
  }
  const character = create(CharacterSchema);
  applyObjectiveChange(character, plan);
  applyObjectiveChange(character, { ...plan, name: "Gather available delegates", status: "Lucan refused; invite Mara instead.", current_goal: "Talk to Mara" });
  assert.equal(character.activeObjective?.name, "Gather available delegates");
  assert.equal(character.currentGoal, "Talk to Mara");
});

test("malformed objective updates do not mutate the character", () => {
  const character = create(CharacterSchema);
  for (const change of [{ ...plan, status: "" }, { ...plan, current_goal: "" }, { ...plan, extra: true }, { action: "demote", reason: "Wait" }]) {
    assert.throws(() => applyObjectiveChange(character, change));
    assert.equal(character.activeObjective, undefined);
  }
});
