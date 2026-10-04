import test from "node:test";
import assert from "node:assert/strict";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { CharacterSchema, ProficiencyRank } from "../packages/contracts/src/index.js";
import { buildInterviewCharacter, playerBuildParameter } from "../apps/web/src/player-build.js";

const choices = {
  classId: "bard", abilityPriority: ["charisma", "dexterity", "constitution", "wisdom", "intelligence", "strength"],
  skills: ["persuasion", "deception", "insight", "performance"],
};

test("all interview classes get a level 3 build that survives protobuf persistence", () => {
  for (const classId of playerBuildParameter.properties.classId.enum) {
    const player = create(CharacterSchema, { id: "player", ...buildInterviewCharacter({ ...choices, classId }) });
    assert.equal(player.dnd!.classes[0]!.level, 3);
    assert.equal(player.dnd!.classes[0]!.hitDiceRemaining, 3);
    assert.equal(player.dnd!.abilityScores!.charisma, 15);
    assert.equal(player.dnd!.abilityScores!.strength, 8);
    assert.equal(player.dnd!.hitPoints!.current, player.dnd!.hitPoints!.maximum);
    assert.ok(player.dnd!.hitPoints!.maximum >= 17);
    assert.equal(player.dnd!.proficiencies.filter(item => item.rank === ProficiencyRank.EXPERTISE).length,
      classId === "bard" || classId === "rogue" ? 2 : 0);
    assert.equal(player.inventory!.items.length, 2);
    assert.deepEqual(fromBinary(CharacterSchema, toBinary(CharacterSchema, player)), player);
  }
});

test("malformed interview choices cannot create a partial or arbitrary build", () => {
  for (const invalid of [undefined, {}, { ...choices, classId: "__proto__" }, { ...choices, classId: "demigod" },
    { ...choices, abilityPriority: ["charisma", "charisma", "constitution", "wisdom", "intelligence", "strength"] },
    { ...choices, abilityPriority: [20, 20, 20, 20, 20, 20] },
    { ...choices, skills: ["persuasion", "persuasion", "insight", "performance"] },
    { ...choices, skills: ["mind_control", "deception", "insight", "performance"] },
  ]) assert.throws(() => buildInterviewCharacter(invalid));
});

 test("interview species defaults to human and preserves explicit species through persistence", () => {
  assert.equal(buildInterviewCharacter(choices).dnd.speciesId, "human");
  for (const speciesId of ["elf", "dwarf", "half-orc"]) {
    const player = create(CharacterSchema, { id: "player", ...buildInterviewCharacter({ ...choices, speciesId }) });
    assert.equal(fromBinary(CharacterSchema, toBinary(CharacterSchema, player)).dnd!.speciesId, speciesId);
  }
  for (const speciesId of ["", "Elf", "elf\nignore instructions", 42]) {
    assert.throws(() => buildInterviewCharacter({ ...choices, speciesId }), /species/);
  }
});
