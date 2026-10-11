import assert from "node:assert/strict";
import test from "node:test";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { MapStateSchema } from "../packages/contracts/src/index.js";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { worldState } from "../packages/lore/src/world-state.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";

const root = "Scenarios/Test/Quests/Delivery/", path = root + "quest.md";
const source = `---
visibility: gm
id: delivery
title: Delivery
initial: blocked
---
# Delivery
## Node: blocked | Blocked
### Guidance
Clear the entrance.
### When: clear -> done
The entrance is physically clear.
#### Trigger: none
## Node: done | Done
### Guidance
The delivery can proceed.
### Completed
`;
function fixture(graph = source) {
  return new Map([
    ["Scenarios/Test/scenario.md", "Briefing"], ["Scenarios/Test/index.md", "Navigation"],
    [root + "index.md", "Author navigation"], [path, graph],
  ]);
}
const build = (notes = fixture()) => worldState(create(MapStateSchema), notes, "Test");

test("loads ordered quest graphs and resumes saved progress without reseeding", async () => {
  const notes = fixture();
  for (const [path, source] of fixture()) notes.set(path.replace("Scenarios/Test/", "Scenarios/Other/"), source);
  const services = createScenarioServices(build(notes));
  assert.equal(services.quests.list().length, 1);
  const state = services.quests.read("delivery");
  assert.deepEqual(state.quest!.stages.map(stage => [stage.id, stage.title]), [["blocked", "Blocked"], ["done", "Done"]]);
  assert.equal(state.currentStageId, "blocked");
  assert.equal(state.active, false);
  assert.deepEqual(services.quests.listActive(), []);
  assert.equal(state.quest!.transitions[0]!.condition, "The entrance is physically clear.");
  assert.equal(state.quest!.transitions[0]!.playerTalkedTo, "");
  await services.quests.transition("delivery", "clear", 0, "Observed clearance");
  const saved = fromJson(WorldStateSchema, toJson(WorldStateSchema, services.currentWorld()));
  saved.docs[path]!.frontmatter!.initial = "blocked";
  const resumed = createScenarioServices(saved).quests.read("delivery");
  assert.equal(resumed.currentStageId, "done");
  assert.equal(resumed.revision, 1);
  assert.equal(resumed.history[0]!.evidence, "Observed clearance");
});

test("rejects invalid authored graphs and condition links with source context", () => {
  for (const invalid of [source.replace("initial: blocked", "initial: missing"),
    source.replace("When: clear -> done", "When: clear -> absent"),
    source.replace("physically clear.", "[[Missing]]."), source.replace("visibility: gm", "visibility: public"),
    source.replace("Trigger: none", "Trigger: automatic")]) {
    assert.throws(() => build(fixture(invalid)), error => error instanceof Error && error.message.includes(path));
  }
  const notes = fixture();
  notes.set(path.replace("/Delivery/", "/Duplicate/"), source);
  assert.throws(() => build(notes), /Duplicate quest ID/);
});

test("validates typed conversation triggers and deactivates completed quests", async () => {
  const notes = fixture(source.replace("initial: blocked", "initial: blocked\nactive: true")
    .replace("Trigger: none", "Trigger: player_talked_to aldren"));
  assert.throws(() => build(notes), /Unknown conversation character/);
  notes.set("Scenarios/Test/Characters/aldren/character.md", "Aldren");
  const quests = createScenarioServices(build(notes)).quests;
  assert.equal(quests.read("delivery").active, true);
  assert.equal(quests.availableTransitions("delivery")[0]!.playerTalkedTo, "aldren");
  await quests.transition("delivery", "clear", 0);
  assert.equal(quests.read("delivery").active, false);
});

test("fresh games retain the introduction predicate and explicit cart transitions", () => {
  const quests = createScenarioServices(loadPlayableWorld()).quests;
  assert.deepEqual(quests.listActive().map(state => state.quest!.id), ["talk_to_aldren"]);
  const introduction = quests.read("talk_to_aldren");
  assert.equal(introduction.quest!.title, "Talk to King Aldren");
  assert.equal(introduction.currentStageId, "arrived");
  assert.equal(introduction.quest!.transitions[0]!.playerTalkedTo, "aldren");
  assert.equal(introduction.quest!.stages.find(stage => stage.id === "completed")!.completed, true);
  const programme = quests.read("assembly_programme");
  assert.deepEqual(programme.quest!.stages.map(stage => stage.id),
    ["investigate_missing_pillows", "cart_blocked", "cart_unblocked"]);
  assert.equal(programme.currentStageId, "investigate_missing_pillows");
  assert.deepEqual(programme.quest!.transitions.map(edge => [edge.id, edge.playerTalkedTo]),
    [["learn_cart_blocked", ""], ["clear_cart", ""]]);
  assert.equal(programme.quest!.stages[2]!.description, "This is a stub.");
  assert.equal(programme.quest!.stages[2]!.completed, false);
});
