import assert from "node:assert/strict";
import test from "node:test";
import { TranscriptRole } from "../packages/contracts/src/index.js";
import { WorldHeadlessGame } from "../packages/headless/src/world.js";
import type { WorldOptions } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

function fixture(failure?: "strategy" | "respond" | "cancel") {
  const order: string[] = [];
  const controller = new AbortController();
  const options: WorldOptions = {
    strategies: {
      conversation: {
        respond: async (context, signal, services) => {
          order.push("strategy");
          assert.equal(signal, controller.signal);
          if (failure === "strategy") throw new Error("Strategy failed");
          if (failure === "cancel") controller.abort(new Error("Cancelled"));
          signal.throwIfAborted();
          context.request.messages.push({ role: "system", content: "# Binding DM ruling\nThe persuasion failed." });
          return services.character.respond(context.request, signal);
        },
      },
      review: {
        resolve: async context => {
          order.push("review");
          assert.deepEqual(context.transcript.filter(turn => turn.speakerId !== "earshot").map(turn => [turn.role, turn.text]), [
            [TranscriptRole.PLAYER, "Please help me. Goodbye."],
            [TranscriptRole.GAME_MASTER, "# Binding DM ruling\nThe persuasion failed."],
            [TranscriptRole.CHARACTER, "I refuse. Farewell."],
          ]);
          return { summary: "Refused" };
        },
      },
    },
    services: { character: { respond: async request => {
      order.push("respond");
      if (failure === "respond") throw new Error("Response failed");
      assert.equal(request.messages.at(-1)?.content, "# Binding DM ruling\nThe persuasion failed.");
      return { role: "assistant", content: "I refuse. Farewell." };
    } } },
  };
  return { live: new WorldHeadlessGame(loadPlayableWorld(), "", options), order, controller };
}

test("v2 headless final messages are checked and answered before review, including after load", async () => {
  const { live, order, controller } = fixture();
  live.load(live.snapshot());
  const event = await live.endConversation("rowan", "Please help me. Goodbye.", controller.signal);
  assert.deepEqual(order, ["strategy", "respond", "review"]);
  assert.ok(event);
  assert.equal(live.snapshot().conversations.rowan, undefined);
});

for (const failure of ["strategy", "respond", "cancel"] as const) {
  test(`v2 headless final-message ${failure} failure prevents review and transcript changes`, async () => {
    const { live, order, controller } = fixture(failure);
    const before = live.snapshot().conversations;
    await assert.rejects(live.endConversation("rowan", "Please help me. Goodbye.", controller.signal),
      /Strategy failed|Response failed|Cancelled/);
    assert.ok(order.includes("strategy"));
    assert.ok(!order.includes("review"));
    assert.deepEqual(live.snapshot().conversations, before);
  });
}

test("v2 headless review without a final message does not generate another turn", async () => {
  const { live, order, controller } = fixture();
  await live.runtime.checkedTalkToCharacter("rowan", "Please help me. Goodbye.", undefined, {}, controller.signal);
  order.length = 0;
  await live.endConversation("rowan", undefined, controller.signal);
  assert.deepEqual(order, ["review"]);
});

test("headless observations render the supplied map and actions directly", () => {
  const world = loadPlayableWorld(), map = world.map!;
  const player = map.actors.find(actor => actor.characterId === "player")!;
  const room = map.rooms.find(room => room.id === player.roomId)!;
  room.name = "Injected observation room";
  const target = map.actors.find(actor => actor.characterId === "rowan")!;
  target.roomId = player.roomId;
  const action = { id: "custom_talk", type: "talk" as const, target: "rowan", legality: "normal" as const,
    description: "Ask Rowan", path: [player.position!] };
  let observations = 0;
  // The runtime's authored map deliberately has a different room name.
  const live = new WorldHeadlessGame(loadPlayableWorld(), "", { services: { map: {
    observe: characterId => { observations++; return { characterId, map, actions: [action] }; },
  } } });
  const rendered = live.observe();
  assert.equal(observations, 1);
  assert.match(rendered, /Injected observation room \(current room\)/);
  assert.match(rendered, /\[custom_talk\]/);
  assert.deepEqual(live.actions(), [{ id: action.id, description: action.description, type: action.type, legality: action.legality }]);
  assert.equal(observations, 2);
});
