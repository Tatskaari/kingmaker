import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime, type WorldOptions } from "../apps/web/src/world-runtime.js";
import { CheckDegree } from "../packages/core/src/ability-checks.js";
import type { RollResult } from "../packages/conversation/src/services.js";
import { commitReview, loadPlayableWorld } from "./fixtures.js";

function game(options: WorldOptions) {
  return new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, options);
}
const decisions: NonNullable<NonNullable<WorldOptions["services"]>["ai"]>["decisions"] = async (_state, questions) =>
  Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, {
    choice: id.startsWith("open_") ? "skip" : "normal" in question.criteria ? "normal" : id === "persuasion" ? "needed" : "not_needed",
    probabilities: { [id]: 0 },
  }]));

test("v2 check strategies use injected mechanics once and preserve their result through presentation and narration", async () => {
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

test("successive dialogue turns persist only new rulings, including identical results after reload", async () => {
  let needsCheck = true, expectedRulings = 0, failReply = false;
  const runtime = game({ services: {
    random: { integer: () => 10 },
    ai: {
      decisions: async (...args) => {
        const answers = await decisions(...args);
        if (!needsCheck && answers.persuasion) answers.persuasion.choice = "not_needed";
        return answers;
      },
      responses: async request => {
        if ((JSON.stringify(request.response_format) ?? "").includes("conversation_roll_ruling")) {
          return { role: "assistant", content: '{"direction":"Consider the offer."}' };
        }
        if (request.tools) return commitReview({ summary: "Discussed the cart", newNotes: [], activeGoal: null });
        assert.equal(request.messages.filter(message => message.role === "system"
          && message.content?.startsWith("# Binding DM ruling")).length, expectedRulings);
        if (failReply) throw new Error("Reply failed");
        return { role: "assistant", content: "Tell me more about the cart." };
      },
    },
  } });
  const savedRulings = () => runtime.snapshot().conversations.rowan!.filter(turn =>
    String(turn.text).startsWith("# Binding DM ruling"));
  for (let turn = 0; turn < 8; turn++) {
    needsCheck = turn % 2 === 0;
    if (needsCheck) expectedRulings++;
    await runtime.checkedTalkToCharacter("rowan", needsCheck ? "Buy my cart." : "It has four wheels.");
    assert.equal(savedRulings().length, expectedRulings, `Saved rulings after turn ${turn + 1}`);
    if (turn === 3) runtime.restore(JSON.parse(JSON.stringify(runtime.snapshot())));
  }
  assert.equal(new Set(savedRulings().map(turn => turn.text)).size, 1, "Identical new rulings remain distinct turns");
  const before = runtime.snapshot().conversations.rowan;
  needsCheck = true; expectedRulings++; failReply = true;
  await assert.rejects(runtime.checkedTalkToCharacter("rowan", "One last offer."), /Reply failed/);
  assert.deepEqual(runtime.snapshot().conversations.rowan, before, "Failed replies do not append rulings");
  failReply = false;
  await runtime.checkedTalkToCharacter("rowan", "One last offer.");
  assert.equal(savedRulings().length, expectedRulings);
  await runtime.endConversation("rowan");
  assert.equal(runtime.snapshot().conversations.rowan, undefined, "Review can finish the conversation");
});

test("v2 dialogue honors scoped lore overrides, progressive disclosure and per-turn precedence", async () => {
  let opened = 0, linked = 0;
  const runtime = game({ services: {
    scenario: { getDocument: async () => assert.fail("Complete injected lore must not load document lore") },
    lore: {
      initial: [{ path: "injected.md", markdown: "HOST_LORE" }],
      links: () => { linked++; return [{ from: "injected.md", path: "detail.md" }]; },
      open: async (link, signal) => { signal.throwIfAborted(); opened++; return { path: link.path, markdown: "OPENED_LORE" }; },
    },
    ai: { decisions: async (_state, questions) => Object.fromEntries(Object.keys(questions).map(id => [id, {
      choice: id.startsWith("open_") ? id : "not_needed", probabilities: { [id]: 1 },
    }])), responses: async request => {
      const prompt = JSON.stringify(request);
      assert.match(prompt, /TURN_LORE/); assert.match(prompt, /OPENED_LORE/);
      assert.doesNotMatch(prompt, /HOST_LORE/);
      return { role: "assistant", content: "I know." };
    } },
  } });
  await runtime.checkedTalkToCharacter("rowan", "What do you know?", undefined, { services: {
    lore: { initial: [{ path: "injected.md", markdown: "TURN_LORE" }] },
  } });
  assert.equal(opened, 1); assert.ok(linked >= 2);
});

test("v2 review and planning use fresh character-scoped injected lore", async () => {
  const scopes: string[] = [];
  const runtime = game({ services: {
    lore: { forCharacter: async (id, signal) => {
      signal.throwIfAborted(); scopes.push(id);
      return { initial: [{ path: "injected.md", markdown: `SCOPED_${id}` }], links: () => [], open: async () => assert.fail() };
    } },
    ai: { responses: async request => {
      assert.match(JSON.stringify(request), /SCOPED_rowan/);
      return commitReview({ summary: "Agreed", newNotes: [], activeGoal: "Go to the hall" });
    }, decisions: async state => {
      assert.match(String(state), /SCOPED_rowan/);
      return { next: { choice: "wait", probabilities: {} } };
    } },
  } });
  runtime.endConversationAsPlayer("rowan", "Go to the hall.");
  await runtime.endConversation("rowan");
  await runtime.planNpc("rowan", new AbortController().signal);
  assert.deepEqual(scopes, ["rowan", "rowan"]);
});

test("v2 lore failures abort dialogue before AI or transcript publication", async () => {
  const runtime = game({ services: {
    lore: { forCharacter: async () => { throw new Error("Lore unavailable"); } },
    ai: { responses: async () => assert.fail(), decisions: async () => assert.fail() },
  } });
  const before = runtime.snapshot();
  await assert.rejects(runtime.checkedTalkToCharacter("rowan", "Hello"), /Lore unavailable/);
  assert.deepEqual(runtime.snapshot(), before);
});

test("live world roll rulings can edit another NPC through the shared GM tools", async () => {
  let rounds = 0;
  const target = "Scenarios/Centennial Assembly/Characters/corvin/character.md";
  const runtime = game({ services: {
    ai: { decisions, responses: async request => {
      if (!(JSON.stringify(request.response_format) ?? "").includes("conversation_roll_ruling")) return { role: "assistant", content: "Agreed." };
      assert.ok(request.tools?.some(tool => tool.function.name === "replace_document"));
      assert.ok(request.tools?.some(tool => tool.function.name === "set_activity"));
      const call = (name: string, args: unknown) => ({ role: "assistant" as const, content: null, tool_calls: [
        { id: `gm-${rounds}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } },
      ] });
      if (++rounds === 1) return call("read_document", { path: target });
      if (rounds === 2) {
        const read = JSON.parse(request.messages.at(-1)!.content!).current;
        return call("replace_document", { path: target, expectedSha: read.sha, oldText: read.text, newText: read.text + "\nA messenger reported the player's arrival.\n" });
      }
      return { role: "assistant", content: '{"direction":"Agree to help."}' };
    } },
  } });
  await runtime.checkedTalkToCharacter("rowan", "Help me.");
  assert.equal(rounds, 3);
  assert.match(runtime.world().docs[target]!.body, /messenger reported/);
});
