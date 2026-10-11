import assert from "node:assert/strict";
import test from "node:test";
import { corvinInquiryCase } from "../packages/evals/src/corvin-inquiry-case.js";

test("Corvin inquiry starts before review with an authored commitment and no seeded outcome", () => {
  const first = corvinInquiryCase.loadWorld([]), second = corvinInquiryCase.loadWorld([]);
  assert.deepEqual(first, second);
  assert.notEqual(first.docs, second.docs);
  assert.equal(first.simulation!.runtimeCharacters.corvin!.activity, undefined);
  assert.equal(first.simulation!.runtimeCharacters.corvin!.wait, undefined);
  assert.ok(!Object.keys(first.docs).some(path => path.includes("57c6adfc-cfcb-41d2-b29f-856932d475b8")));
  assert.match(corvinInquiryCase.transcript.at(-1)!.text, /Elinor Ash, Professor Oswin, and Doctor Rowan Ash, one by one/);
  assert.ok(Object.values(first.docs).some(doc => doc.body.includes("I do not yet know whether the envoy heard this directly")));
  assert.ok(!Object.values(first.docs).some(doc => doc.body.includes("I will speak to Lady Elinor")));
  const actor = first.simulation!.map!.actors.find(actor => actor.characterId === "corvin")!;
  assert.equal(actor.roomId, "great_hall");
  assert.equal(actor.position!.x, 58); assert.equal(actor.position!.y, 20);
});

test("recorded disclosure opens scoped linked documents and rejects inaccessible paths", async () => {
  const { documentLore } = await import("../packages/conversation/src/document-lore.js");
  const { createScenarioServices } = await import("../packages/lore/src/services.js");
  const { openFixtureDocuments } = await import("../packages/evals/src/transcript-fixture.js");
  const services = createScenarioServices(corvinInquiryCase.loadWorld([]));
  const lore = await documentLore(services.scenario, "corvin"), signal = new AbortController().signal;
  const path = "Scenarios/Centennial Assembly/court_briefing.md";
  const opened = await openFixtureDocuments(lore, [path], signal);
  assert.equal(opened.at(-1)!.path, path);
  assert.equal(lore.initial.length + 1, opened.length);
  await assert.rejects(openFixtureDocuments(lore, ["Cast/Saltmere/Lady Cressida Pinchbeck/gm.md"], signal), /not reachable/);
});

test("fixture replay uses character setup without rerunning progressive disclosure", async () => {
  const { createCorvinInquiryExperiment } = await import("../packages/evals/src/corvin-inquiry-case.js");
  const { runExperiment } = await import("../packages/evals/src/experiment.js");
  const { commitReview } = await import("./fixtures.js");
  const experiment = createCorvinInquiryExperiment(() => ({
    responses: async request => commitReview({ summary: "Assigned", newNotes: [], activeGoal: "Talk to Elinor" }, request),
    decisions: async (_state, questions, _signal, purpose) => {
      assert.notEqual(purpose, "prog_disc");
      return Object.fromEntries(Object.keys(questions).map(name => [name, { choice: name === "immediate_commitment" ? "flagged" : "not_flagged", probabilities: {} }]));
    },
  }), { decisions: async (_state, questions) => Object.fromEntries(Object.keys(questions).map(name => [name, { choice: "complete", probabilities: { complete: 1 } }])) });
  const [trial] = await runExperiment(experiment, { repeats: 1 });
  assert.equal(trial!.recording.error, undefined, JSON.stringify(trial!.recording.error));
  assert.equal(trial!.scoringError, undefined, JSON.stringify(trial!.scoringError));
});
