import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { DndCharacterSchema, ProficiencyKind, ProficiencyRank } from "../packages/contracts/src/index.js";
import { resolveDiceCheck, skillModifier } from "../packages/core/src/ability-checks.js";

test("degree boundaries and natural extremes implement the house rules", () => {
  for (const [margin, degree] of [[-5, "major_failure"], [-4, "major_failure"], [-3, "minor_failure"], [-1, "minor_failure"],
    [0, "barely_passes"], [1, "minor_success"], [3, "minor_success"], [4, "major_success"], [5, "major_success"]] as const) {
    const result = resolveDiceCheck(10, 10, margin);
    assert.equal(result.degree, degree); assert.equal(result.margin, margin); assert.equal(result.success, margin >= 0);
  }
  assert.equal(resolveDiceCheck(1, 5, 100).degree, "critical_failure");
  assert.equal(resolveDiceCheck(20, 100, -100).degree, "critical_success");
});

test("skill bonuses use abilities, total class level, proficiency and expertise without double counting", () => {
  const build = create(DndCharacterSchema, { abilityScores: { charisma: 20, wisdom: 8 }, classes: [{ level: 3 }], proficiencies: [
    { kind: ProficiencyKind.SKILL, targetId: "persuasion", rank: ProficiencyRank.PROFICIENT },
    { kind: ProficiencyKind.SKILL, targetId: "persuasion", rank: ProficiencyRank.EXPERTISE },
  ] });
  assert.equal(skillModifier(build, "persuasion"), 9);
  assert.equal(skillModifier(build, "deception"), 5);
  assert.equal(skillModifier(build, "insight"), -1);
  build.classes[0]!.level = 20;
  assert.equal(skillModifier(build, "persuasion"), 17);
  assert.equal(skillModifier(undefined, "persuasion"), 0);
});
