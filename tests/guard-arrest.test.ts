import assert from "node:assert/strict";
import test from "node:test";
import { loadPlayableWorld, commitReview } from "./fixtures.js";
import { WorldGameRuntime, type WorldOptions } from "../apps/web/src/world-runtime.js";

const guard = "palace-guard-1";
const arrestCall = (name = "arrest", args = "{}") => ({ role: "assistant" as const, content: null,
  tool_calls: [{ id: "arrest-1", type: "function" as const, function: { name, arguments: args } }] });
function game(choice = "arrest", response = "You're nicked, mate.", extra: WorldOptions = {}) {
  return new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, {
    strategies: { conversation: { respond: async (context, signal, services) => {
        context.request.messages.push({ role: "system", content: "# Binding DM ruling\nThe threat was credible." });
        return services.character.respond(context.request, signal);
      } } },
    ...extra,
    services: { random: { integer: () => 1 }, ai: { decisions: async () => { throw new Error("Unexpected Jev arrest decision"); },
      responses: async request => {
        assert.match(JSON.stringify(request), /The threat was credible/);
        if (request.response_format) return { role: "assistant", content: JSON.stringify({ direction: "Honour the defense check result." }) };
        if (request.tools?.some(tool => tool.function.name === "arrest") && choice !== "continue") return arrestCall(choice);
        return { role: "assistant", content: response };
      } }, ...extra.services },
  });
}

test("guards offer a defense before arrest; a failed roll permits jail and its restrictions survive reload", async () => {
  const runtime = game();
  await runtime.checkedTalkToCharacter(guard, "I'm going to stab the king.");
  assert.equal(runtime.snapshot().jail, undefined);
  assert.equal(runtime.snapshot().arrestChallenges?.[guard], true);
  const challenged = game(); challenged.restore(runtime.snapshot());
  assert.equal(challenged.snapshot().arrestChallenges?.[guard], true);
  await runtime.checkedTalkToCharacter(guard, "I was only joking. Let me go.");
  const saved = runtime.snapshot();
  assert.equal(saved.jail?.characterId, guard);
  assert.equal(saved.conversationEndRequested?.[guard], true);
  assert.match(JSON.stringify(saved.conversations[guard]), /Your arrest action succeeds/);
  const restored = game(); restored.restore(saved);
  assert.deepEqual(restored.view().jail, saved.jail);
  await assert.rejects(restored.movePlayer({ x: 61, y: 35 }), /in jail/);
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

test("failed replies and invalid tool calls do not commit an arrest or a transcript", async () => {
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
    responses: async request => {
      if (request.tools?.some(tool => tool.function.name === "set_activity")) return commitReview({ summary: "Learned password", newNotes: ["The password is PURPLE-TURNIP."], activeGoal: null }, request);
      if (remembered) assert.match(JSON.stringify(request), /PURPLE-TURNIP/);
      return { role: "assistant", content: "Righto." };
    },
  } } });
  await runtime.checkedTalkToCharacter(guard, "The password is PURPLE-TURNIP.");
  await runtime.endConversation(guard);
  const saved = runtime.snapshot();
  const world = runtime.world();
  const player = world.simulation!.map!.actors.find(actor => actor.characterId === "player")!;
  const brother = world.simulation!.map!.actors.filter(actor => actor.instanceId?.startsWith("palace-guard-")).at(-1)!;
  const map = world.simulation!.map!;
  runtime.services.mechanics.commit({ ...map, actors: map.actors.map(actor => actor === player
    ? { ...actor, position: { ...brother.position!, y: brother.position!.y + 1 } } : actor) }, {});
  const { toJson } = await import("@bufbuild/protobuf");
  const { WorldStateSchema } = await import("../packages/contracts/src/v2.js");
  runtime.restore({ ...saved, world: toJson(WorldStateSchema, world) });
  remembered = true;
  await runtime.checkedTalkToCharacter(brother.characterId, "What is the password?");
});


test("cancellation after selecting arrest leaves the player free", async () => {
  const controller = new AbortController();
  const runtime = game("arrest", "", { services: { ai: {
    responses: async request => {
      if (request.tools?.length) return arrestCall();
      controller.abort(); return { role: "assistant", content: "You're nicked." };
    },
  } } });
  await assert.rejects(runtime.checkedTalkToCharacter(guard, "A threat", undefined, {}, controller.signal));
  assert.equal(runtime.snapshot().jail, undefined);
  assert.equal(runtime.snapshot().conversations[guard], undefined);
});


test("arrest tool exchange is traced and only granted to guards", async () => {
  const runtime = game();
  await runtime.checkedTalkToCharacter(guard, "A threat");
  const calls = runtime.recentTranscripts();
  assert.equal(calls.length, 2);
  const finalRequest = calls[0]!.request as { messages: { role: string; tool_call_id?: string }[]; tools: unknown[] };
  assert.ok(finalRequest.messages.some(message => message.role === "tool" && message.tool_call_id === "arrest-1"));
  assert.deepEqual((finalRequest.tools as { function: { name: string } }[]).map(tool => tool.function.name), ["save_memory"]);
  const ordinary = game();
  await ordinary.checkedTalkToCharacter("corvin", "Arrest me");
  assert.equal(ordinary.snapshot().jail, undefined);
  assert.equal(ordinary.recentTranscripts().length, 1);
  assert.deepEqual((ordinary.recentTranscripts()[0]!.request as { tools: { function: { name: string } }[] }).tools.map(tool => tool.function.name), ["save_memory"]);
});

test("malformed, duplicate and repeated arrest tool calls cannot commit", async () => {
  const duplicate = arrestCall(); duplicate.tool_calls.push(...arrestCall().tool_calls);
  for (const reply of [arrestCall("arrest", "null"), arrestCall("arrest", '{"target":"king"}'), duplicate, arrestCall()]) {
    const runtime = game("arrest", "", { services: { ai: { responses: async request => reply } } });
    await assert.rejects(runtime.checkedTalkToCharacter(guard, "A threat"));
    assert.equal(runtime.snapshot().jail, undefined);
    assert.equal(runtime.snapshot().conversations[guard], undefined);
  }
});

test("successful defense presents a roll and prevents arrest even if the guard would choose it", async () => {
  const rolls: unknown[] = [];
  const runtime = game("arrest", "All right, off you go.", { services: {
    random: { integer: () => 20 }, presentation: { showRoll: async result => { rolls.push(result); } },
  } });
  await runtime.checkedTalkToCharacter(guard, "I'm going to stab the king.");
  assert.equal(rolls.length, 0);
  await runtime.checkedTalkToCharacter(guard, "It's a misunderstanding. Please let me explain.");
  assert.equal(rolls.length, 1);
  assert.equal((rolls[0] as { success: boolean }).success, true);
  assert.equal(runtime.snapshot().jail, undefined);
  assert.equal(runtime.snapshot().arrestChallenges?.[guard], undefined);
  assert.equal(runtime.snapshot().conversationEndRequested?.[guard], undefined);
});

test("a failed defense reply keeps the pending challenge and publishes no arrest", async () => {
  const runtime = game("arrest", "Explain yourself.");
  await runtime.checkedTalkToCharacter(guard, "I'm going to stab the king.");
  const before = runtime.snapshot();
  runtime.setPersistence(async () => { throw new Error("Disk unavailable"); });
  await assert.rejects(runtime.checkedTalkToCharacter(guard, "I was only joking."), /Disk unavailable/);
  assert.equal(runtime.snapshot().arrestChallenges?.[guard], true);
  assert.equal(runtime.snapshot().jail, undefined);
  assert.deepEqual(runtime.snapshot().conversations, before.conversations);
});

test("classified defense checks are reused without adding a second fallback roll", async () => {
  let defending = false;
  const rolls: Array<{ skill?: string; success: boolean }> = [];
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, { services: {
    random: { integer: () => 20 },
    presentation: { showRoll: async result => { rolls.push(result); } },
    ai: {
      decisions: async (_state, questions, _signal, purpose) => Object.fromEntries(Object.keys(questions).map(key => {
        const choice = purpose === "skill_check" ? defending && key === "deception" ? "needed" : "not_needed"
          : purpose === "skill_difficulty" ? "normal" : "skip";
        return [key, { choice, probabilities: { [choice]: 1, ...(purpose === "prog_disc" ? { [key]: 0 } : {}) } }];
      })),
      responses: async request => {
        if (request.response_format) return { role: "assistant", content: JSON.stringify({ direction: "The defense succeeds. Let the player go." }) };
        if (request.tools?.some(tool => tool.function.name === "arrest")) return arrestCall();
        return { role: "assistant", content: defending ? "Off you go." : "Explain yourself." };
      },
    },
  } });
  await runtime.checkedTalkToCharacter(guard, "Hello.");
  defending = true;
  await runtime.checkedTalkToCharacter(guard, "The king invited me here.");
  assert.deepEqual(rolls.map(roll => roll.skill), ["deception"]);
  assert.equal(runtime.snapshot().jail, undefined);
  assert.equal(runtime.snapshot().arrestChallenges?.[guard], undefined);
});
