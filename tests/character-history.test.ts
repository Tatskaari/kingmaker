import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { EventSchema } from "../packages/contracts/src/index.js";
import { recordCharacterHistory, type CharacterHistory } from "../packages/core/src/character-history.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { characterIntent } from "../packages/lore/src/activity.js";
import { loadPlayableWorld, assignActivity } from "./fixtures.js";

test("history retains chronological actions and events, deduplicates events and bounds storage", () => {
  const state: CharacterHistory = {};
  const event = { kind: "event" as const, id: "exit", text: "Player left through the parlor door." };
  recordCharacterHistory(state, "oswin", { kind: "action", id: "follow_player", text: "Started following" });
  recordCharacterHistory(state, "oswin", event); recordCharacterHistory(state, "oswin", event);
  recordCharacterHistory(state, "oswin", { kind: "action", id: "follow_player", text: "Started following again" });
  assert.deepEqual(state.characterHistory!.oswin!.map(entry => entry.kind), ["action", "event", "action"]);
  assert.equal(state.characterHistory!.aldren, undefined);
  for (let i = 0; i < 70; i++) recordCharacterHistory(state, "oswin", { ...event, id: `event-${i}` });
  assert.equal(state.characterHistory!.oswin!.length, 64);
  assert.equal(state.characterHistory!.oswin![0]!.id, "event-6");
});

test("planning and waits receive interleaved perceived history across intent changes and reload", async () => {
  const world = loadPlayableWorld(), goal = "Follow the player.";
  assignActivity(world, "corvin", goal);
  const actor = world.simulation!.map!.actors.find(actor => actor.characterId === "corvin")!;
  const player = world.simulation!.map!.actors.find(actor => actor.characterId === "player")!;
  player.roomId = actor.roomId; player.position = { ...actor.position!, x: actor.position!.x + 1 };
  const activity = characterIntent(world, "corvin").activity!;
  const requests: string[] = [];
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, {
    strategies: { resolution: { classify: async () => ({}), resolve: async () => ({ summary: "Remembered" }) } },
    services: { disclosure: { disclose: async () => [] }, ai: { decisions: async (state, questions) => {
      requests.push(JSON.stringify(state));
      return questions.waiting ? { waiting: { choice: `set_activity:${activity}`, probabilities: {} } }
        : { next: { choice: "wait", probabilities: {} } };
    } } },
  });
  await game.stepNpcAction("corvin", "follow_player", goal);
  await game.processPerceivedEvent("corvin", create(EventSchema, { id: "exit" }), "The player left by the east door.");
  await game.checkWait("corvin", 15);
  assert.match(requests[0]!, /Started follow_player.*The player left by the east door/s);
  const inspect = game.map.observe("corvin").actions.find(action => action.type === "fixture" && action.target === "corvin")!;
  await game.stepNpcAction("corvin", inspect.id, goal);
  await game.planNpc("corvin", new AbortController().signal);
  const prompt = requests.at(-1)!;
  assert.ok(prompt.indexOf("Started follow_player") < prompt.indexOf("The player left by the east door"));
  assert.ok(prompt.indexOf("The player left by the east door") < prompt.lastIndexOf(`Completed action: ${inspect.id}`));
  const history = game.map.observe("corvin").recentHistory;
  const restored = new WorldGameRuntime(world, "", game.snapshot());
  assert.deepEqual(restored.map.observe("corvin").recentHistory, history);
  assert.deepEqual(restored.map.observe("oswin").recentHistory, []);
  assert.equal(game.snapshot().npcActivities!.corvin!.actionIds!.length, 1, "Events do not consume the action budget");
});
