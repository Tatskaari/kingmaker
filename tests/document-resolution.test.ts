import { commitReview } from "./fixtures.js";
import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../packages/contracts/src/index.js";
import { worldState } from "../packages/lore/src/world-state.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { documentResolutionHooks } from "../packages/conversation/src/document-resolution.js";
import { runResolution } from "../packages/conversation/src/resolution.js";

const entry = (id: string) => `Scenarios/Test/Characters/${id}/character.md`;
function fixture() {
  const notes = new Map([["Scenarios/Test/index.md", "Index"], ["Scenarios/Test/scenario.md", ["alice", "bob"].map(id => `[[${entry(id)}]]`).join("\n")]]);
  for (const id of ["alice", "bob"]) {
    const access = `---\nvisibility: private\nreaders: ["character:${id}"]\n---\n`;
    notes.set(entry(id), access + `[[Cast/Test/${id}/private.md]]`);
    notes.set(`Cast/Test/${id}/private.md`, access + `${id.toUpperCase()}_PRIVATE`);
  }
  return createScenarioServices(worldState(create(WorldStateSchema), notes, "Test"));
}
test("v2 exchange isolates speakers and reviews each participant through document writes", async () => {
  const services = fixture(); let calls = 0;
  const runtime = new ConversationRuntime({ services: { ...services, ai: { responses: async request => {
    const prompt = JSON.stringify(request); calls++;
    if (calls === 1) { assert.match(prompt, /ALICE_PRIVATE/); assert.ok(!prompt.includes("BOB_PRIVATE")); return { role: "assistant", content: "Will you help?" }; }
    if (calls === 2) { assert.match(prompt, /BOB_PRIVATE/); assert.ok(!prompt.includes("ALICE_PRIVATE")); assert.ok(!prompt.includes("SECRET_INTENT")); return { role: "assistant", content: "I refuse." }; }
    return commitReview({ summary: "Refused", newNotes: ["Bob refused to help."], activeGoal: null });
  } } }, hooks: { resolution: documentResolutionHooks } });
  const result = await runResolution({ kind: "npc_exchange", characterId: "alice", targetId: "bob", goal: "SECRET_INTENT" }, runtime);
  assert.match(result.summary, /I refuse/); assert.equal(calls, 4);
  for (const id of ["alice", "bob"]) assert.match((await services.docs.read(entry(id))).text, /Bob refused/);
});
test("ignored events do not write; processed events use only their limited perception", async () => {
  for (const react of [false, true]) {
    const services = fixture(); let calls = 0;
    const runtime = new ConversationRuntime({ services: { ...services, ai: {
      decisions: async () => ({ reaction: { choice: react ? "process" : "ignore", probabilities: {} } }),
      responses: async request => { calls++; assert.match(JSON.stringify(request), /Indistinct voices/);
        return commitReview({ summary: "Heard voices", newNotes: ["Indistinct voices."], activeGoal: null }); },
    } }, hooks: { resolution: documentResolutionHooks } });
    await runResolution({ kind: "world_event", characterId: "alice", eventId: "event", perception: "Indistinct voices." }, runtime);
    assert.equal(calls, react ? 1 : 0);
    assert.equal((await services.docs.read(entry("alice"))).text.includes("Indistinct voices"), react);
  }
});
