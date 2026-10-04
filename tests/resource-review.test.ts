import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { resourceReviewTools, type ResourceReviewContext } from "../apps/web/src/resource-review.js";
import { ACTIVE_OBJECTIVE_GUIDANCE } from "../apps/web/src/objectives.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";

const context: ResourceReviewContext = { kind: "conversation_review", participants: ["corvin"], allowNextGoal: true };
const changes = { append_notes: [], relationships: [] };

const objective = { action: "set", name: "Gather the court", status: "Garran agreed. Invite Lucan, then verify arrivals.",
  success_criteria: "All delegates are in the Treasury ready to listen.", current_goal: "Talk to Lucan", reason: "Accepted the request" };

test("resource tools have explicit single generation IDs, not a batch commit", () => {
  const tools = resourceReviewTools();
  assert.ok(!tools.some(t => t.function.name === "commit_review"));
  for (const tool of tools.filter(t => !["read_state", "finish_review"].includes(t.function.name))) {
    assert.ok((tool.function.parameters.required as string[]).includes("generation_id"));
    assert.ok(!("generations" in (tool.function.parameters.properties as object)));
  }
});

const call = (name: string, args: unknown) => ({ role: "assistant" as const, content: null, tool_calls: [
  { id: name, type: "function" as const, function: { name, arguments: JSON.stringify(args) } },
] });
const synchronousCommit = async <T>(work: () => T) => work();
function world(input: any): any {
  return input.messages.map((m: any) => { try { return JSON.parse(m.content); } catch { return {}; } }).find((v: any) => v.world_state).world_state;
}

test("agent-visible write descriptions document ID source, patch semantics, and error recovery", () => {
  const tools = resourceReviewTools();
  for (const tool of tools.filter(t => (t.function.parameters.required as string[]).includes("generation_id"))) {
    assert.match(tool.function.description, /generation_id/);
    assert.match(tool.function.description, /Generation ID out of date/);
    assert.match(tool.function.description, /Earlier successful calls remain saved/);
  }
  const character = tools.find(t => t.function.name === "update_character")!;
  assert.match(character.function.description, /Omitted fields stay unchanged/);
  assert.match(character.function.description, /dialogue_objectives/);
  assert.match(character.function.description, /no standalone goal field exists/);
  assert.match(character.function.description, /Example:/);
});

test("active objective guidance includes a concrete plan and definition-of-done example", () => {
  const instructions = resourceReviewTools().find(tool => tool.function.name === "update_character")!.function.description
    + JSON.stringify(resourceReviewTools().find(tool => tool.function.name === "update_character")!.function.parameters);
  assert.match(instructions, /status must describe current knowledge, progress and the remaining execution plan/);
  assert.match(instructions, /requires waiting for another character to initiate a conversation/);
  assert.match(ACTIVE_OBJECTIVE_GUIDANCE, /Waiting for another character to act is not an executable current goal/);
  assert.match(ACTIVE_OBJECTIVE_GUIDANCE, /set the objective active again/);
  assert.match(ACTIVE_OBJECTIVE_GUIDANCE, /Find out who stole my ring/);
  assert.match(ACTIVE_OBJECTIVE_GUIDANCE, /credible evidence identifying who removed the ring/);
  assert.match(ACTIVE_OBJECTIVE_GUIDANCE, /Talk to Malcom/);
});
