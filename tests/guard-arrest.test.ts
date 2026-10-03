import assert from "node:assert/strict";
import test from "node:test";
import { loadPlayableWorld, commitReview } from "./fixtures.js";
import { WorldGameRuntime, type WorldOptions } from "../apps/web/src/world-runtime.js";

const guard = "palace-guard";
function game(choice = "arrest", response = "You're nicked, mate.", extra: WorldOptions = {}) {
  return new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, {
    hooks: { conversation: { classify: async () => ({ docs: {} as never, checks: undefined }),
      resolve: async context => {
        context.request.messages.push({ role: "system", content: "# Binding DM ruling\nThe threat was credible." });
        return { reclassify: false };
      } } },
    ...extra,
    services: { ai: { decisions: async (state, questions) => {
      assert.ok(questions.conversation_action);
      assert.match(JSON.stringify(state), /The threat was credible/);
      return { conversation_action: { choice, probabilities: {} } };
    }, responses: async () => ({ role: "assistant", content: response }) }, ...extra.services },
  });
}

test("only an explicit guard action arrests; jail persists and blocks player actions until release", async () => {
  const runtime = game();
  await runtime.checkedTalkToCharacter(guard, "I'm going to stab the king.");
  const saved = runtime.snapshot();
  assert.equal(saved.jail?.characterId, guard);
  assert.equal(saved.conversationEndRequested?.[guard], true);
  assert.match(JSON.stringify(saved.conversations[guard]), /Your arrest action succeeds/);
  const restored = game(); restored.restore(saved);
  assert.deepEqual(restored.view().jail, saved.jail);
  assert.throws(() => restored.movePlayer({ x: 61, y: 35 }), /in jail/);
  assert.throws(() => restored.setDoor("any", true), /in jail/);
  assert.throws(() => restored.interactFixtureWithEvent("any"), /in jail/);
  await assert.rejects(restored.checkedTalkToCharacter("corvin", "Hello"), /in jail/);
  restored.releaseFromJail();
  assert.equal(restored.view().jail, null);
});

test("arrest dialogue alone cannot jail the player, and ordinary characters have no arrest action", async () => {
  const runtime = game("continue", "I could arrest you, you know.");
  await runtime.checkedTalkToCharacter(guard, "Are you identical decuplets?");
  assert.equal(runtime.snapshot().jail, undefined);
  await runtime.checkedTalkToCharacter("corvin", "Arrest me!");
  assert.equal(runtime.snapshot().jail, undefined);
});

test("failed replies and invalid action labels do not commit an arrest or a transcript", async () => {
  for (const runtime of [game("teleport"), game("arrest", "")]) {
    await assert.rejects(runtime.checkedTalkToCharacter(guard, "A threat"));
    assert.equal(runtime.snapshot().jail, undefined);
    assert.equal(runtime.snapshot().conversations[guard], undefined);
  }
  const runtime = game();
  runtime.setPersistence(async () => { throw new Error("Disk unavailable"); });
  await assert.rejects(runtime.checkedTalkToCharacter(guard, "A threat"), /Disk unavailable/);
  assert.equal(runtime.snapshot().jail, undefined);
});

test("a conversation remembered at one post is available to the brothers at another post", async () => {
  let remembered = false;
  const runtime = game("continue", "Righto.", { services: { disclosure: { disclose: async () => [] }, ai: {
    decisions: async () => ({ conversation_action: { choice: "continue", probabilities: {} } }),
    responses: async request => {
      if (request.tools?.some(tool => tool.function.name === "commit_review")) return commitReview({ summary: "Learned password", newNotes: ["The password is PURPLE-TURNIP."], activeGoal: null });
      if (remembered) assert.match(JSON.stringify(request), /PURPLE-TURNIP/);
      return { role: "assistant", content: "Righto." };
    },
  } } });
  await runtime.checkedTalkToCharacter(guard, "The password is PURPLE-TURNIP.");
  await runtime.endConversation(guard);
  const saved = runtime.snapshot();
  const world = runtime.world();
  const player = world.map!.actors.find(actor => actor.characterId === "player")!;
  const brother = world.map!.actors.filter(actor => actor.characterId === guard).at(-1)!;
  player.position = { ...brother.position!, y: brother.position!.y + 1 };
  const { toJson } = await import("@bufbuild/protobuf");
  const { WorldStateSchema } = await import("../packages/contracts/src/v2.js");
  runtime.restore({ ...saved, world: toJson(WorldStateSchema, world) });
  remembered = true;
  await runtime.checkedTalkToCharacter(guard, "What is the password?");
});


test("cancellation after selecting arrest leaves the player free", async () => {
  const controller = new AbortController();
  const runtime = game("arrest", "", { services: { ai: {
    decisions: async () => ({ conversation_action: { choice: "arrest", probabilities: {} } }),
    responses: async () => { controller.abort(); return { role: "assistant", content: "You're nicked." }; },
  } } });
  await assert.rejects(runtime.checkedTalkToCharacter(guard, "A threat", undefined, {}, controller.signal));
  assert.equal(runtime.snapshot().jail, undefined);
  assert.equal(runtime.snapshot().conversations[guard], undefined);
});
