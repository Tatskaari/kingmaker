import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { initialModelResourceIds, modelResourceOverview } from "../apps/web/src/model-resources.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";

const load = () => fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
const call = (name: string, args: unknown) => ({ role: "assistant" as const, content: null,
  tool_calls: [{ id: name, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }] });

test("initial model resources retain exact participant versions and omit remote furniture payloads", () => {
  const scenario = load(), runtime = new BrowserGameRuntime(scenario, "test");
  const all = runtime.readResources();
  const ids = initialModelResourceIds(scenario, ["rook"]), selected = runtime.readResources(ids);
  assert.ok(ids.includes("character:rook") && ids.includes("inventory:rook"));
  assert.ok(ids.includes("item:rook_tomas_letter"));
  assert.ok(!ids.includes("character:corvin"));
  const remote = scenario.world!.fixtures.find(fixture => fixture.roomId === "corvin_chamber")!;
  assert.ok(!ids.includes(`fixture:${remote.id}`));
  assert.ok(modelResourceOverview(scenario).includes(remote.id));
  for (const id of ids) assert.deepEqual(selected[id], all[id], "preloading never changes exact resource data or versions");
  assert.ok(JSON.stringify(selected).length < JSON.stringify(all).length / 3);
});

test("live reviews can read omitted resources with their exact generation and state", async t => {
  const runtime = new BrowserGameRuntime(load(), "test"); runtime.createDevelopmentPlayer();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: JSON.stringify({ utterance: "Goodbye.", replyOptions: [], endConversation: true }) }));
  await runtime.talkToCharacter("corvin", "Goodbye.");
  const fork = runtime.forkForResourceReview(async work => work());
  let rounds = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    rounds++;
    if (rounds === 1) {
      const initial = request.messages.map((message: any) => { try { return JSON.parse(message.content); } catch { return {}; } }).find((value: any) => value.world_state).world_state;
      assert.ok(initial["character:corvin"].generation_id);
      assert.ok(initial["inventory:player"].generation_id);
      assert.equal(initial["character:rook"], undefined);
      assert.match(initial.overview, /Admiral Rook Fen \[rook\]/);
      return call("read_state", { resource_id: "character:rook" });
    }
    if (rounds === 3) {
      assert.equal(JSON.parse(request.messages.at(-1).content).commit_result, "success");
      return call("finish_review", { summary: "Conversation ended; no immediate task remains." });
    }
    const result = JSON.parse(request.messages.at(-1).content).new_state;
    const exact = runtime.readResources(["character:rook"])["character:rook"]!;
    assert.deepEqual(result, { resource_id: "character:rook", generation_id: exact.generationId, data: JSON.parse(JSON.stringify(exact.state)) });
    return call("update_character", { character_id: "corvin",
      generation_id: runtime.readResources(["character:corvin"])["character:corvin"]!.generationId,
      changes: { active_objective: { action: "demote", reason: "No immediate task remains after goodbye." } } });
  });
  await fork.endConversation("corvin");
  assert.equal(rounds, 3);
});
