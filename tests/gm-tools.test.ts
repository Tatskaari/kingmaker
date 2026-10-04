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
  await gm.call("insert_document", { path: other, expectedSha: before.sha, afterLine: before.text.trimEnd().split("\n").length, text: "\nThe player told me about the delay.\n" });
  assert.match((await services.docs.read(other)).text, /told me about the delay/);
  assert.match(JSON.stringify(await gm.call("replace_document", { path: other, expectedSha: before.sha, oldText: "delay", newText: "meeting" })), /document_conflict/);
  const path = "Quests/review-test.md";
  await gm.call("create_document", { path, text: "---\nsummary: GM quest progress.\nvisibility: gm\n---\nPending." });
  const created = await services.docs.read(path);
  await gm.call("replace_document", { path, expectedSha: created.sha, oldText: "Pending.", newText: "The player accepted the quest." });
  const updated = await services.docs.read(path);
  assert.match(updated.text, /accepted the quest/);
  const listed = await gm.call("list_documents", { prefix: "Quests/" });
  assert.ok(JSON.stringify(listed).includes(path));
  await gm.call("delete_document", { path, expectedSha: updated.sha });
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

test("GM assignments to two guard bodies share memories but keep separate activity pointers", async () => {
  const services = fixture(), gm = new GameMasterTools(services, "palace-guard-1");
  await gm.begin();
  const untouched = activityGoal(services.scenario.snapshot(), "palace-guard-3");
  for (const [characterId, goal] of [["palace-guard-1", "Watch the west door"], ["palace-guard-2", "Watch the east door"]]) {
    await gm.call("set_activity", { characterId, name: goal, status: "Assigned", success_criteria: goal, current_goal: goal });
  }
  await gm.call("commit_review", { summary: "Assign posts", newNotes: ["We agreed to watch the doors."] });
  assert.equal(activityGoal(services.scenario.snapshot(), "palace-guard-1"), "Watch the west door");
  assert.equal(activityGoal(services.scenario.snapshot(), "palace-guard-2"), "Watch the east door");
  assert.equal(activityGoal(services.scenario.snapshot(), "palace-guard-3"), untouched);
  const doc = await services.docs.read(characterEntry(services.scenario.info(), "palace-guard"));
  assert.match(doc.document.body, /We agreed to watch the doors/);
  assert.equal(doc.document.frontmatter?.activity, undefined);
});

const toolReply = (name: string, input: unknown) => ({ role: "assistant" as const, content: null,
  tool_calls: [{ id: crypto.randomUUID(), type: "function" as const, function: { name, arguments: JSON.stringify(input) } }] });

test("review corrects the dump's extra commit characterId without publishing rejected notes", async () => {
  const services = fixture(), path = characterEntry(services.scenario.info(), "oswin");
  const before = await services.docs.read(path); let calls = 0;
  services.ai.responses = async request => {
    if (++calls === 1) return toolReply("commit_review", { characterId: "corvin", summary: "Reviewed", newNotes: ["Rejected note."] });
    assert.equal((await services.docs.read(path)).sha, before.sha);
    assert.match(request.messages.at(-1)!.content!, /invalid_tool_arguments.*Do not include characterId/);
    return toolReply("commit_review", { summary: "Corrected", newNotes: ["Corrected note."] });
  };
  await runGameMaster({ model: "test", messages: [] }, services, new AbortController().signal, { characterId: "oswin", requireCommit: true });
  assert.equal(calls, 2);
  const after = await services.docs.read(path);
  assert.match(after.text, /Corrected note/); assert.doesNotMatch(after.text, /Rejected note/);
});

test("review recovers after a conflict followed by an uncommitted prose reply", async () => {
  const services = fixture(), path = characterEntry(services.scenario.info(), "oswin"); let calls = 0;
  services.ai.responses = async request => {
    switch (++calls) {
      case 1: return toolReply("set_activity", { name: "Old", status: "Pending", success_criteria: "Arrive", current_goal: "Old goal" });
      case 2: {
        const current = await services.docs.read(path);
        await services.docs.commit([{ path, expectedSha: current.sha, text: current.text + "\nConcurrent memory.\n" }]);
        return toolReply("commit_review", { summary: "Reviewed", newNotes: [] });
      }
      case 3:
        assert.match(request.messages.at(-1)!.content!, /document_conflict/);
        return { role: "assistant", content: "I could not publish because the character document changed." };
      case 4:
        assert.match(request.messages.at(-1)!.content!, /No review was committed/);
        assert.equal(activityGoal(services.scenario.snapshot(), "oswin"), null);
        return toolReply("set_activity", { name: "New", status: "Pending", success_criteria: "Arrive", current_goal: "Reconciled goal" });
      default: return toolReply("commit_review", { summary: "Reconciled", newNotes: ["Reconciled memory."] });
    }
  };
  await runGameMaster({ model: "test", messages: [] }, services, new AbortController().signal, { characterId: "oswin", requireCommit: true });
  assert.equal(calls, 5);
  assert.equal(activityGoal(services.scenario.snapshot(), "oswin"), "Reconciled goal");
  assert.match((await services.docs.read(path)).text, /Concurrent memory[\s\S]*Reconciled memory/);
});

test("review protocol correction is bounded and never treats prose as a commit", async () => {
  const services = fixture(), before = services.scenario.snapshot(); let calls = 0;
  services.ai.responses = async () => { calls++; return { role: "assistant", content: "Done." }; };
  await assert.rejects(runGameMaster({ model: "test", messages: [] }, services, new AbortController().signal,
    { characterId: "oswin", requireCommit: true }), /must call a tool/);
  assert.equal(calls, 3); assert.deepEqual(services.scenario.snapshot(), before);
});
