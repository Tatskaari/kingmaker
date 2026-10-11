import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../evals/actions/corvin-nine-furrows/fixture.json" with { type: "json" };
import { createCorvinNineFurrowsExperiment, loadCorvinNineFurrowsWorld } from "../packages/evals/src/corvin-nine-furrows-case.js";
import { runExperiment } from "../packages/evals/src/experiment.js";
import { activityGoal } from "../packages/lore/src/activity.js";

test("Corvin fixture loads captured notes and positions over a fresh game", () => {
  const world = loadCorvinNineFurrowsWorld();
  assert.match(activityGoal(world, "corvin")!, /Nine Furrows delegation/);
  assert.match(world.docs["Scenarios/Centennial Assembly/Characters/corvin/situation.md"]!.body, /Their answer is still outstanding/);
  const corvin = world.simulation!.map!.actors.find(actor => actor.characterId === "corvin")!;
  assert.deepEqual([corvin.roomId, corvin.position!.x, corvin.position!.y], ["great_hall", 58, 20]);
  assert.equal(world.simulation!.runtimeCharacters.corvin!.wait, undefined);
});

test("Corvin action eval accepts each delegate but rejects abandonment and unrelated targets", async () => {
  for (const choice of ["talk_elinor", "talk_oswin", "talk_rowan", fixture.observed, "follow_elinor", "talk_gurt", "wait", "complete"]) {
    let prompt = "";
    const experiment = createCorvinNineFurrowsExperiment(() => ({
      responses: async () => { throw Error("No dialogue should be generated"); },
      decisions: async (state, questions, _signal, purpose) => {
        if (purpose === "prog_disc") return Object.fromEntries(Object.keys(questions).map(key => [key, { choice: "skip", probabilities: { [key]: 0, skip: 1 } }]));
        prompt = String(state);
        assert.ok(Object.hasOwn(questions.next!.criteria, choice), `${choice} should be offered`);
        return { next: { choice, probabilities: { [choice]: 1 } } };
      },
    }));
    const [trial] = await runExperiment(experiment, { repeats: 1, concurrency: 1 });
    assert.equal(trial!.recording.error, undefined);
    assert.match(prompt, /obtain their answer/);
    assert.equal(trial!.result!.criteria.navigation!.score, Number(fixture.expectedTalkTargets.some(id => choice === `talk_${id}`)), choice);
  }
});
