import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import type { ConversationRuntimeOptions } from "../packages/conversation/src/runtime.js";
import { HeadlessGame } from "../packages/headless/src/index.js";

function game(review: ConversationRuntimeOptions) {
  const game = new HeadlessGame(fromJsonString(ScenarioSchema,
    readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")), "", undefined, review);
  game.runtime.createDevelopmentPlayer();
  game.runtime.endConversationAsPlayer("corvin", "I promise to return.");
  return game;
}
const commit = async <T>(work: () => T) => work();

test("headless review uses injected labels and AI after reload and commits GM memories", async () => {
  const order: string[] = [];
  const controller = new AbortController();
  const headless = game({ hooks: { review: { classify: async (context, signal, services) => {
    order.push("classify");
    assert.equal(signal, controller.signal);
    assert.deepEqual(context.participants, ["corvin", "player"]);
    assert.equal(context.transcript[0]!.text, "I promise to return.");
    context.transcript[0]!.text = "Should not reach GM";
    await services.ai.decisions(context, {}, signal);
    return { promises: ["return"] };
  } } }, services: { ai: { decisions: async (_state, _questions, signal) => {
    assert.equal(signal, controller.signal); order.push("jev"); return {};
  }, responses: async (request, signal) => {
    order.push("gm");
    assert.equal(signal, controller.signal);
    assert.ok(request.messages.some(message => message.content?.includes('"reviewLabels":{"promises":["return"]}')));
    assert.ok(request.messages.some(message => message.content?.includes("I promise to return.")));
    assert.ok(!request.messages.some(message => message.content?.includes("Should not reach GM")));
    return { role: "assistant", content: JSON.stringify({ newNotes: ["The player promised to return."],
      relationships: [], goalUpdate: null, lore: null }) };
  } } } });
  headless.load(headless.snapshot());
  await headless.endConversation("corvin", undefined, controller.signal);
  assert.deepEqual(order, ["classify", "jev", "gm"]);
  assert.equal(headless.snapshot().conversations.corvin, undefined);
  assert.ok(headless.inspect().notes.some(note => note.text === "The player promised to return."));
  assert.ok(Object.values(headless.runtime.transcriptRuns()).some(run => run.kind === "conversation_review" && run.calls.length === 1));
});

test("default empty classification reaches a replaceable resolver through both fork types", async () => {
  for (const live of [false, true]) {
    let resolutions = 0;
    const headless = game({ services: { ai: { decisions: async () => assert.fail("Stub must not call Jev") } },
      hooks: { review: { resolve: async (context, labels) => {
        resolutions++;
        assert.deepEqual(labels, {});
        assert.equal(context.transcript[0]!.text, "I promise to return.");
        return { summary: "Reviewed without a model." };
      } } } });
    const fork = live ? headless.runtime.forkForResourceReview(commit) : headless.runtime.forkForNpc();
    await fork.endConversation("corvin");
    assert.equal(resolutions, 1);
    assert.equal((live ? headless.runtime : fork).snapshot().conversations.corvin, undefined);
    if (!live) assert.ok(headless.snapshot().conversations.corvin?.length);
  }
});

test("failed or cancelled review retains evidence, and successful custom review cannot clear newer turns", async () => {
  for (const mode of ["classify", "resolve", "cancel", "newer"]) {
    const controller = new AbortController();
    const headless = game({ hooks: { review: {
      classify: async () => {
        if (mode === "classify") throw new Error("classification failed");
        return {};
      },
      resolve: async () => {
        if (mode === "resolve") throw new Error("resolution failed");
        if (mode === "cancel") controller.abort();
        if (mode === "newer") {
          const snapshot = headless.snapshot();
          snapshot.conversations.corvin = [...snapshot.conversations.corvin!, { ...snapshot.conversations.corvin![0] as object, text: "One more thing." }];
          headless.runtime.restore(snapshot);
        }
        return { summary: "Reviewed" };
      },
    } } });
    const fork = headless.runtime.forkForResourceReview(commit);
    await assert.rejects(fork.endConversation("corvin", controller.signal), /failed|abort|Conversation changed/i);
    assert.ok(headless.snapshot().conversations.corvin?.length);
    if (mode === "newer") assert.equal(headless.snapshot().conversations.corvin!.length, 2);
  }
});
