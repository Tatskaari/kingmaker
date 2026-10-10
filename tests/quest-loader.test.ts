import assert from "node:assert/strict";
import test from "node:test";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { MapStateSchema } from "../packages/contracts/src/index.js";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { worldState } from "../packages/lore/src/world-state.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";

const root = "Scenarios/Test/Quests/Delivery/";
const note = (metadata: object, body = "Description") => `---\n${JSON.stringify({ visibility: "gm", ...metadata })}\n---\n${body}`;
function fixture() {
  return new Map([
    ["Scenarios/Test/scenario.md", "Briefing"], ["Scenarios/Test/index.md", "Navigation"],
    [root + "index.md", note({ id: "delivery", title: "Delivery" })],
    [root + "020_stage_done.md", note({ id: "done", title: "Done" })],
    [root + "010_stage_blocked.md", note({ id: "blocked", title: "Blocked", initial: true, transitions: ["[[./transitions/clear]]"] })],
    [root + "transitions/clear.md", note({ id: "clear", trigger: "discretionary", to: "done", condition: "The entrance is physically clear." })],
  ]);
}
const build = (notes = fixture()) => worldState(create(MapStateSchema), notes, "Test");

test("loads ordered scenario quest data and resumes saved progress without reseeding", async () => {
  const notes = fixture();
  for (const [path, source] of fixture()) notes.set(path.replace("Scenarios/Test/", "Scenarios/Other/"), source);
  const services = createScenarioServices(build(notes));
  assert.equal(services.quests.list().length, 1);
  const state = services.quests.read("delivery");
  assert.deepEqual(state.quest!.stages.map(stage => stage.id), ["blocked", "done"]);
  assert.equal(state.currentStageId, "blocked");
  assert.equal(state.active, false);
  assert.deepEqual(services.quests.listActive(), []);
  assert.equal(state.quest!.transitions[0]!.condition, "The entrance is physically clear.");
  await services.quests.transition("delivery", "clear", 0, "Observed clearance");
  const saved = fromJson(WorldStateSchema, toJson(WorldStateSchema, services.currentWorld()));
  saved.docs[root + "010_stage_blocked.md"]!.frontmatter!.initial = false;
  const resumed = createScenarioServices(saved).quests.read("delivery");
  assert.equal(resumed.currentStageId, "done");
  assert.equal(resumed.revision, 1);
  assert.equal(resumed.history[0]!.evidence, "Observed clearance");
});

test("rejects invalid authored graphs with source context", () => {
  for (const [path, metadata, expected] of [
    ["020_stage_done.md", { id: "done", title: "Done", initial: true }, /exactly one/],
    ["010_stage_blocked.md", { id: "blocked", title: "Blocked" }, /exactly one/],
    ["020_stage_done.md", { id: "blocked", title: "Done" }, /duplicate stage/],
    ["transitions/clear.md", { id: "clear", trigger: "discretionary", to: "missing", condition: "Clear" }, /unknown stage/],
    ["transitions/clear.md", { id: "clear", trigger: "automatic", to: "done", condition: "Clear" }, /unsupported transition trigger/],
    ["transitions/clear.md", { id: "clear", trigger: "discretionary", to: "done" }, /condition must/],
    ["transitions/clear.md", { id: "clear", trigger: "discretionary", to: "done", condition: "[[Missing]]" }, /No matching/],
    ["020_stage_done.md", { id: "done", title: "Done", visibility: "public" }, /visibility: gm/],
    ["010_stage_blocked.md", { id: "blocked", title: "Blocked", initial: "true" }, /initial must/],
    ["010_stage_blocked.md", { id: "blocked", title: "Blocked", initial: true, transitions: ["[[./transitions/missing]]"] }, /No matching/],
  ] as const) {
    const notes = fixture(); notes.set(root + path, note(metadata));
    assert.throws(() => build(notes), expected);
  }
  const notes = fixture();
  for (const [path, source] of fixture()) if (path.startsWith(root)) notes.set(path.replace("/Delivery/", "/Duplicate/"), source);
  assert.throws(() => build(notes), /duplicate quest ID/);
});

test("the playable Assembly Programme loads with three remedy routes", () => {
  const world = loadPlayableWorld();
  const quests = createScenarioServices(world).quests;
  assert.equal(quests.read("assembly_programme").quest!.stages.length, 6);
  assert.deepEqual(quests.availableTransitions("assembly_programme").map(edge => edge.id),
    ["agree_to_back_out", "begin_dismantling", "begin_repair"]);
  assert.equal(quests.read("assembly_programme").currentStageId, "delivery_delayed");
});


test("loads active conversation predicates and completed stages with strict metadata", () => {
  const notes = fixture();
  notes.set("Scenarios/Test/Characters/aldren/character.md", note({}));
  notes.set(root + "index.md", note({ id: "delivery", title: "Delivery", active: true }));
  notes.set(root + "020_stage_done.md", note({ id: "done", title: "Done", completed: true }));
  notes.set(root + "transitions/clear.md", note({ id: "clear", trigger: "predicate", player_talked_to: "aldren", to: "done", condition: "Player talked to Aldren." }));
  const state = build(notes).quests.delivery!;
  assert.equal(state.active, true);
  assert.equal(state.quest!.stages[1]!.completed, true);
  assert.equal(state.quest!.transitions[0]!.playerTalkedTo, "aldren");
  notes.delete("Scenarios/Test/Characters/aldren/character.md");
  assert.throws(() => build(notes), /unknown conversation character/);
  notes.set(root + "transitions/clear.md", note({ id: "clear", trigger: "predicate", to: "done", condition: "Talk." }));
  assert.throws(() => build(notes), /player_talked_to must/);
  for (const [path, metadata, expected] of [
    ["index.md", { id: "delivery", title: "Delivery", active: "true" }, /active must be a boolean/],
    ["020_stage_done.md", { id: "done", title: "Done", completed: "true" }, /completed must be a boolean/],
  ] as const) {
    const invalid = fixture(); invalid.set(root + path, note(metadata));
    assert.throws(() => build(invalid), expected);
  }
});


test("fresh games start with the Aldren introduction active", () => {
  const quests = createScenarioServices(loadPlayableWorld()).quests;
  assert.deepEqual(quests.listActive().map(state => state.quest!.id), ["talk_to_aldren"]);
  const introduction = quests.read("talk_to_aldren");
  assert.equal(introduction.quest!.title, "Talk to King Aldren");
  assert.equal(introduction.currentStageId, "arrived");
  assert.equal(introduction.quest!.transitions[0]!.playerTalkedTo, "aldren");
  assert.equal(introduction.quest!.stages.find(stage => stage.id === "completed")!.completed, true);
});
