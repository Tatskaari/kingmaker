import assert from "node:assert/strict";
import test from "node:test";
import { createCorvinPlannerExperiment, loadCorvinPlannerWorld } from "../packages/evals/src/corvin-planner-experiment.js";
import { runExperiment } from "../packages/evals/src/experiment.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { activityGoal, characterIntent } from "../packages/lore/src/activity.js";
import { plannerMap } from "../packages/evals/src/planner-map.js";

test("planner fixture has only the captured structured handoff; mechanics validate actual arrival", async () => {
  const world = loadCorvinPlannerWorld(), other = loadCorvinPlannerWorld();
  const services = new ConversationRuntime({ services: createScenarioServices(world) }).services;
  const backing = createScenarioServices(other);
  const runtime = new ConversationRuntime({ services: backing });
  const map = plannerMap(runtime.services, backing.mechanics);
  const path = characterIntent(world, "corvin").activity!;
  assert.equal(world.docs[path]!.body, "");
  assert.match(world.docs[path]!.frontmatter!.status as string, /No interviews have happened yet/);
  const before = world.simulation!.map!.actors.find(actor => actor.characterId === "corvin")!;
  const goal = activityGoal(other, "corvin")!;
  const talk = map.observe("corvin").actions.find(action => action.type === "talk" && action.target === "elinor")!;
  assert.ok(talk);
  assert.throws(() => map.interact({ kind: "step", characterId: "corvin", actionId: talk.id, goal: "wrong goal" }), /changed/);
  const result = await map.interact({ kind: "step", characterId: "corvin", actionId: talk.id, goal });
  assert.equal(result.talkTarget, "elinor");
  const actors = runtime.services.scenario.read().simulation!.map!.actors;
  const corvin = actors.find(actor => actor.characterId === "corvin")!, elinor = actors.find(actor => actor.characterId === "elinor")!;
  assert.notDeepEqual(corvin.position, before.position);
  assert.equal(corvin.roomId, elinor.roomId);
  assert.equal(map.observe("corvin", talk.id).actions.find(action => action.id === talk.id)!.path.length, 1);
  assert.equal(corvin.movement, undefined);
  assert.deepEqual(services.scenario.read().simulation!.map!.actors.find(actor => actor.characterId === "corvin")!.position, before.position);
});

test("premature planner completion is scored as missing interviews, not successful execution", async () => {
  const experiment = createCorvinPlannerExperiment(() => ({
    responses: async () => { throw new Error("No review should run before a completed interaction"); },
    decisions: async (_state, questions, _signal, purpose) => purpose === "prog_disc"
      ? Object.fromEntries(Object.keys(questions).map(key => [key, { choice: "skip", probabilities: { [key]: 0, skip: 1 } }]))
      : { next: { choice: "complete", probabilities: { complete: 1 } } },
  }));
  const [trial] = await runExperiment(experiment, { repeats: 1, concurrency: 1 });
  assert.equal(trial!.recording.error, undefined);
  assert.equal(trial!.result!.criteria["interview-coverage"]!.score, 0);
  assert.equal(trial!.result!.criteria["no-repeat-interviews"]!.score, 0);
  assert.equal(trial!.result!.criteria["no-transcript"]!.score, 1);
});
