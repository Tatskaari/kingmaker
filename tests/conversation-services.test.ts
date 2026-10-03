import assert from "node:assert/strict";
import test from "node:test";
import { CheckDegree } from "../packages/core/src/ability-checks.js";
import { ConversationRuntime, UnimplementedServiceError } from "../packages/conversation/src/runtime.js";
import type { RollResult } from "../packages/conversation/src/services.js";

test("unused runtime constructs headlessly and every default service fails explicitly", async () => {
  const runtime = new ConversationRuntime(), { services } = runtime;
  const signal = new AbortController().signal;
  const result: RollResult = { characterId: "player", natural: 20, modifier: 0, total: 20,
    difficulty: "impossible", success: true, outcome: CheckDegree.CriticalSuccess };
  const calls: Array<[string, () => unknown]> = [
    ["ai.decisions", () => services.ai.decisions("context", {}, signal)],
    ["ai.responses", () => services.ai.responses({ model: "test", messages: [] }, signal)],
    ["lore.initial", () => services.lore.initial],
    ["lore.links", () => services.lore.links([])],
    ["lore.open", () => services.lore.open({ path: "note.md", from: "character.md" }, signal)],
    ["character.rollCheck", () => runtime.character.rollCheck({ characterId: "player", skill: "persuasion", difficulty: "hard" }, signal)],
    ["character.rollSave", () => runtime.character.rollSave({ characterId: "player", ability: "wisdom", difficulty: "normal" }, signal)],
    ["character.respond", () => runtime.character.respond({ model: "test", messages: [] }, signal)],
    ["presentation.showRoll", () => services.presentation.showRoll(result, signal)],
    ["presentation.setPortrait", () => services.presentation.setPortrait("corvin", "neutral", signal)],
    ["random.integer", () => services.random.integer(1, 20)],
    ["debug.record", () => services.debug.record({ turn: 1, pass: 1, source: "test", stage: "classify", status: "started" })],
  ];
  assert.equal(runtime.character, services.character);
  for (const [operation, call] of calls) {
    await assert.rejects(async () => call(), error => {
      assert.ok(error instanceof UnimplementedServiceError);
      assert.equal(error.operation, operation);
      assert.equal(error.message, `Unimplemented service: ${operation}`);
      return true;
    });
  }
});

test("individual operations can be injected without implementing sibling services", async () => {
  const signal = new AbortController().signal;
  const request = { model: "test", messages: [] };
  class Responses {
    #content = "Injected reply";
    async responses(actualRequest: typeof request, actualSignal?: AbortSignal) {
      assert.equal(actualRequest, request);
      assert.equal(actualSignal, signal);
      return { role: "assistant" as const, content: this.#content };
    }
  }
  const runtime = new ConversationRuntime({ services: {
    ai: new Responses(), random: { integer: () => 20 }, lore: { initial: [] },
  } });
  assert.equal((await runtime.services.ai.responses(request, signal)).content, "Injected reply");
  assert.equal(runtime.services.random.integer(1, 20), 20);
  assert.deepEqual(runtime.services.lore.initial, []);
  await assert.rejects(runtime.services.ai.decisions("context", {}, signal), UnimplementedServiceError);
  assert.throws(() => new ConversationRuntime().services.random.integer(1, 20), UnimplementedServiceError);
});
