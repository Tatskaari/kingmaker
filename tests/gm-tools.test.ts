import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
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
  assert.equal(services.scenario.read().docs[path], undefined);
});

test("activity calls commit immediately while preserving GM document edits", async () => {
  const services = fixture(), gm = new GameMasterTools(services, "oswin");
  await gm.begin();
  for (const characterId of ["oswin", "corvin"]) await gm.call("set_activity", {
    characterId, name: "Meeting", status: "Promised", success_criteria: "Arrive in the parlour", current_goal: "Go to the parlour",
  });
  assert.equal(activityGoal(services.scenario.read(), "corvin"), "Go to the parlour");
  await writeMemory(services, gm, "oswin", "I promised to meet the player.");
  await gm.commit();
  for (const id of ["oswin", "corvin"]) assert.equal(activityGoal(services.scenario.read(), id), "Go to the parlour");
  assert.match((await services.docs.read(characterEntry(services.scenario.info(), "oswin"))).text, /promised to meet/);
  assert.doesNotMatch((await services.docs.read(characterEntry(services.scenario.info(), "corvin"))).text, /promised to meet/);
});

test("GM rulings and reviews expose the identical tool registry and execute document calls", async () => {
  for (const review of [false, true]) {
    const services = fixture(); let calls = 0;
    services.ai.responses = async request => {
      assert.deepEqual(request.tools, gameMasterTools);
      assert.match(request.messages[0]!.content!, /^You are a game master/);
      if (++calls === 1) return { role: "assistant", content: null, tool_calls: [{ id: "read", type: "function", function: {
        name: "read_document", arguments: JSON.stringify({ path: services.scenario.info().scenario }),
      } }] };
      assert.equal(request.messages.at(-1)!.role, "tool");
      assert.ok(!request.tools?.some(tool => tool.function.name === "commit_review"));
      return { role: "assistant", content: "Reviewed." };
    };
    await runGameMaster({ model: "test", messages: [] }, services, new AbortController().signal, { characterId: "oswin", review });
    assert.equal(calls, 2);
  }
});

test("GM assignments to two guard bodies share memories but keep separate activity pointers", async () => {
  const services = fixture(), gm = new GameMasterTools(services, "palace-guard-1");
  await gm.begin();
  const untouched = activityGoal(services.scenario.read(), "palace-guard-3");
  for (const [characterId, goal] of [["palace-guard-1", "Watch the west door"], ["palace-guard-2", "Watch the east door"]]) {
    await gm.call("set_activity", { characterId, name: goal, status: "Assigned", success_criteria: goal, current_goal: goal });
  }
  await writeMemory(services, gm, "palace-guard", "We agreed to watch the doors.");
  await gm.commit();
  assert.equal(activityGoal(services.scenario.read(), "palace-guard-1"), "Watch the west door");
  assert.equal(activityGoal(services.scenario.read(), "palace-guard-2"), "Watch the east door");
  assert.equal(activityGoal(services.scenario.read(), "palace-guard-3"), untouched);
  const doc = await services.docs.read(characterEntry(services.scenario.info(), "palace-guard"));
  assert.match(doc.document.body, /We agreed to watch the doors/);
  assert.equal(doc.document.frontmatter?.activity, undefined);
});

const toolReply = (name: string, input: unknown) => ({ role: "assistant" as const, content: null,
  tool_calls: [{ id: crypto.randomUUID(), type: "function" as const, function: { name, arguments: JSON.stringify(input) } }] });

test("activity is committed before the GM finishes without appending its final reply as memory", async () => {
  const services = fixture(), path = characterEntry(services.scenario.info(), "oswin"); let calls = 0;
  services.ai.responses = async () => {
    assert.equal(activityGoal(services.scenario.read(), "oswin"), calls === 0 ? null : "Go to the hall");
    if (++calls === 1) return toolReply("set_activity", { name: "Meeting", status: "Pending", success_criteria: "Arrive", current_goal: "Go to the hall" });
    return { role: "assistant", content: "A final summary, not a memory." };
  };
  const reply = await runGameMaster({ model: "test", messages: [] }, services, new AbortController().signal, { characterId: "oswin", review: true });
  assert.equal(reply.content, "A final summary, not a memory.");
  assert.equal(activityGoal(services.scenario.read(), "oswin"), "Go to the hall");
  assert.doesNotMatch((await services.docs.read(path)).text, /A final summary/);
});

test("activity commit conflicts return to the GM for reconciliation", async () => {
  const services = fixture(), path = characterEntry(services.scenario.info(), "oswin"); let calls = 0;
  const commit = services.docs.commit.bind(services.docs);
  let conflict = true;
  services.docs.commit = async (writes, intents) => {
    if (conflict) {
      conflict = false;
      const current = await services.docs.read(path);
      await commit([{ path, expectedSha: current.sha, text: current.text + "\nConcurrent memory.\n" }]);
    }
    return commit(writes, intents);
  };
  services.ai.responses = async request => {
    switch (++calls) {
      case 1: return toolReply("set_activity", { name: "Old", status: "Pending", success_criteria: "Arrive", current_goal: "Old goal" });
      case 2:
        assert.equal(request.messages.at(-1)!.role, "tool");
        assert.match(request.messages.at(-1)!.content!, /document_conflict/);
        assert.equal(activityGoal(services.scenario.read(), "oswin"), null);
        return toolReply("set_activity", { name: "New", status: "Pending", success_criteria: "Arrive", current_goal: "Reconciled goal" });
      default: return { role: "assistant", content: "Reconciled." };
    }
  };
  await runGameMaster({ model: "test", messages: [] }, services, new AbortController().signal, { characterId: "oswin", review: true });
  assert.equal(calls, 3);
  assert.equal(activityGoal(services.scenario.read(), "oswin"), "Reconciled goal");
  assert.match((await services.docs.read(path)).text, /Concurrent memory/);
});

test("failed or cancelled GM completion preserves earlier committed activities", async () => {
  for (const cancelled of [false, true]) {
    const services = fixture(), controller = new AbortController(); let calls = 0;
    services.ai.responses = async () => {
      if (++calls === 1) return toolReply("set_activity", { name: "Meeting", status: "Pending", success_criteria: "Arrive", current_goal: "Go to the hall" });
      if (!cancelled) throw new Error("offline");
      controller.abort();
      return { role: "assistant", content: "Done." };
    };
    await assert.rejects(runGameMaster({ model: "test", messages: [] }, services, controller.signal,
      { characterId: "oswin", review: true }), /offline|abort/i);
    assert.equal(activityGoal(services.scenario.read(), "oswin"), "Go to the hall");
  }
});

async function writeMemory(services: ReturnType<typeof fixture>, gm: GameMasterTools, id: string, note: string) {
  const before = await services.docs.read(characterEntry(services.scenario.info(), id));
  await gm.call("replace_document", { path: before.path, expectedSha: before.sha, oldText: before.document.body,
    newText: before.document.body + "\n" + note });
}
