import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime, type WorldOptions } from "../apps/web/src/world-runtime.js";
import { CheckDegree } from "../packages/core/src/ability-checks.js";
import type { RollResult } from "../packages/conversation/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";

function game(options: WorldOptions) {
  return new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, options);
}
const decisions: NonNullable<NonNullable<WorldOptions["services"]>["ai"]>["decisions"] = async (_state, questions) =>
  Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, {
    choice: id.startsWith("open_") ? "skip" : "normal" in question.criteria ? "normal" : id === "persuasion" ? "needed" : "not_needed",
    probabilities: { [id]: 0 },
  }]));

test("v2 check hooks use injected mechanics once and preserve their result through presentation and narration", async () => {
  const result: RollResult = { characterId: "player", skill: "persuasion", difficulty: "normal",
    natural: 2, modifier: 40, total: 42, success: false, outcome: CheckDegree.MinorFailure };
  let rolls = 0, shown = 0, rulings = 0, replies = 0;
  const runtime = game({ services: {
    random: { integer: () => assert.fail("Injected mechanics own randomness") },
    character: { rollCheck: async (request, signal) => {
      signal.throwIfAborted(); rolls++;
      assert.deepEqual(request, { characterId: "player", skill: "persuasion", difficulty: "normal" });
      return result;
    } },
    presentation: { showRoll: async value => { shown++; assert.deepEqual(value, result); } },
    ai: { decisions, responses: async request => {
      if ((JSON.stringify(request.response_format) ?? "").includes("conversation_roll_ruling")) {
        rulings++;
        assert.deepEqual(JSON.parse(request.messages.at(-1)!.content!).resolvedChecks, [result]);
        return { role: "assistant", content: JSON.stringify({ direction: "Refuse the request." }) };
      }
      replies++;
      assert.match(JSON.stringify(request.messages), /minor_failure/);
      return { role: "assistant", content: "No." };
    } },
  } });
  assert.equal(await runtime.checkedTalkToCharacter("rowan", "Help me."), "No.");
  assert.deepEqual([rolls, shown, rulings, replies], [1, 1, 1, 1]);
});

test("v2 turn mechanics overrides preserve host character methods and propagate failure without committing", async () => {
  let replies = 0;
  const runtime = game({ services: {
    ai: { decisions, responses: async () => assert.fail("No narration after mechanics fail") },
    character: { rollCheck: async () => assert.fail("Turn override must win"), respond: async () => { replies++; return { role: "assistant", content: "Hi" }; } },
  } });
  const before = runtime.snapshot();
  await assert.rejects(runtime.checkedTalkToCharacter("rowan", "Help me.", undefined, { services: {
    character: { rollCheck: async () => { throw new Error("Mechanics unavailable"); } },
  } }), /Mechanics unavailable/);
  assert.equal(replies, 0);
  assert.deepEqual(runtime.snapshot(), before);
});
