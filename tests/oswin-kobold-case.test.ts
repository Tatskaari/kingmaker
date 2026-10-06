import assert from "node:assert/strict";
import test from "node:test";
import { TranscriptRole } from "../packages/contracts/src/index.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { oswinKoboldCase } from "../packages/evals/src/oswin-kobold-case.js";
import observed from "../evals/reviews/oswin-kobold-city/observed.json" with { type: "json" };

test("Kobold City replay preserves pre-review acceptance without seeding the failed journey", async () => {
  const world = oswinKoboldCase.loadWorld([]), oswin = world.simulation!.runtimeCharacters.oswin!;
  const services = createScenarioServices(world);
  const entry = await services.docs.read(oswin.document);
  assert.match(entry.document.body, /agreed to accompany/);
  assert.doesNotMatch(entry.document.body, /alternated|action limit|trip and consultation remain/);
  assert.equal(oswin.activity, undefined); assert.equal(oswin.wait, undefined);
  assert.equal(world.docs[world.player!]!.frontmatter!.name, "Berz");
  assert.deepEqual(world.simulation!.map!.actors.find(actor => actor.characterId === "oswin")!.position,
    { $typeName: "kingmaker.v1.TilePosition", x: 62, y: 26 });
  assert.ok(!world.simulation!.map!.rooms.some(room => /kobold/i.test(room.name)));
  assert.equal(oswinKoboldCase.transcript.length, 19);
  const rulings = oswinKoboldCase.transcript.filter(turn => turn.role === TranscriptRole.GAME_MASTER && turn.speakerId === "GM");
  assert.equal(rulings.length, 8);
  assert.ok(rulings.every(turn => turn.text.includes('"outcome":"major_success"')));
  assert.equal(observed.recordedPlannerChoices.length, 24);
  const second = oswinKoboldCase.loadWorld([]);
  await services.docs.replace(entry.path, entry.sha, "Oswin has no established impression of Berz.", "Changed for this trial.");
  assert.doesNotMatch(second.docs[oswin.document]!.body, /Changed for this trial/);
});
