import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices, DocumentConflictError } from "../packages/lore/src/services.js";
import { characterEntry } from "../packages/lore/src/active-goal.js";
import { activityGoal } from "../packages/lore/src/activity.js";
import { GameMasterTools, gameMasterTools } from "../packages/conversation/src/gm-tools.js";
import { runGameMaster } from "../packages/conversation/src/game-master.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

function fixture() {
  return new ConversationRuntime({ services: createScenarioServices(loadPlayableWorld()) }).services;
}
test("GM tools edit other characters and quest documents, preserving SHA conflict checks", async () => {
  const services = fixture(), gm = new GameMasterTools(services, "oswin");
  const other = characterEntry(services.scenario.info(), "corvin");
  const before = await services.docs.read(other);
  await gm.call("insert_document", { path: other, sha: before.sha, afterLine: before.text.trimEnd().split("\n").length, text: "\nThe player told me about the delay.\n" });
  assert.match((await services.docs.read(other)).text, /told me about the delay/);
  await assert.rejects(gm.call("replace_document", { path: other, sha: before.sha, oldText: "delay", newText: "meeting" }), DocumentConflictError);
  const path = "Quests/review-test.md";
  await gm.call("create_document", { path, text: "---\nsummary: GM quest progress.\nvisibility: gm\n---\nPending." });
  const created = await services.docs.read(path);
  await gm.call("replace_document", { path, sha: created.sha, oldText: "Pending.", newText: "The player accepted the quest." });
  const updated = await services.docs.read(path);
  assert.match(updated.text, /accepted the quest/);
  const listed = await gm.call("list_documents", {});
  assert.ok(JSON.stringify(listed).includes(path));
  await gm.call("delete_document", { path, sha: updated.sha });
  assert.equal(services.scenario.snapshot().docs[path], undefined);
});

test("GM commits activities for multiple NPCs atomically with the reviewed memory", async () => {
  const services = fixture(), gm = new GameMasterTools(services, "oswin");
  await gm.begin();
  for (const characterId of ["oswin", "corvin"]) await gm.call("set_activity", {
    characterId, name: "Meeting", status: "Promised", success_criteria: "Arrive in the parlour", current_goal: "Go to the parlour",
  });
  assert.equal(activityGoal(services.scenario.snapshot(), "corvin"), null);
  await gm.call("commit_review", { summary: "Arrange meeting", newNotes: ["I promised to meet the player."] });
  for (const id of ["oswin", "corvin"]) assert.equal(activityGoal(services.scenario.snapshot(), id), "Go to the parlour");
  assert.match((await services.docs.read(characterEntry(services.scenario.info(), "oswin"))).text, /promised to meet/);
  assert.doesNotMatch((await services.docs.read(characterEntry(services.scenario.info(), "corvin"))).text, /promised to meet/);
});

test("GM rulings and reviews expose the identical tool registry and execute document calls", async () => {
  for (const requireCommit of [false, true]) {
    const services = fixture(); let calls = 0;
    services.ai.responses = async request => {
      assert.deepEqual(request.tools, gameMasterTools);
      assert.match(request.messages[0]!.content!, /^You are a game master/);
      if (++calls === 1) return { role: "assistant", content: null, tool_calls: [{ id: "read", type: "function", function: {
        name: "read_document", arguments: JSON.stringify({ path: services.scenario.info().scenario }),
      } }] };
      assert.equal(request.messages.at(-1)!.role, "tool");
      return requireCommit ? { role: "assistant", content: null, tool_calls: [{ id: "finish", type: "function", function: {
        name: "commit_review", arguments: JSON.stringify({ summary: "Reviewed", newNotes: [] }),
      } }] } : { role: "assistant", content: '{"direction":"Honour the agreement."}' };
    };
    await runGameMaster({ model: "test", messages: [] }, services, new AbortController().signal, { characterId: "oswin", requireCommit });
    assert.equal(calls, 2);
  }
});
