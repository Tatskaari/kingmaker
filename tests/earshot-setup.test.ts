import assert from "node:assert/strict";
import test from "node:test";
import { setupWorldAgent } from "../apps/web/src/agent-setup.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

function fixture() {
  const world = loadPlayableWorld(), map = world.map!;
  map.actors = map.actors.filter(actor => ["rowan", "corvin", "holt", "player"].includes(actor.characterId));
  const actor = (id: string) => map.actors.find(actor => actor.characterId === id)!;
  for (const [id, x] of [["rowan", 58], ["player", 59], ["corvin", 62], ["holt", 60]] as const) {
    actor(id).position = { $typeName: "kingmaker.v1.TilePosition", x, y: 24 };
  }
  let observations = 0;
  const runtime = new ConversationRuntime({ strategies: { setup: { prepare: setupWorldAgent } }, services: {
    scenario: { snapshot: () => world }, map: { observe: id => {
      observations++; assert.equal(id, "rowan"); return { characterId: id, map, actions: [] };
    } },
  } });
  const prepare = (agent: "character" | "exchange" = "character", participantIds = ["rowan", "player"]) =>
    runtime.services.agents.prepare({ agent, characterId: "rowan", participantIds, sources: [],
      messages: [{ role: "user", content: "Hello" }] }, new AbortController().signal);
  const warning = async (...args: Parameters<typeof prepare>) => (await prepare(...args)).find(message => message.content?.startsWith("# Current conversation earshot"))!.content!;
  return { world, map, actor, runtime, warning, observations: () => observations };
}

test("conversation setup groups nearby bystanders, excludes participants and refreshes positions", async () => {
  const { actor, warning, observations } = fixture();
  const first = await warning();
  assert.match(first, /Clear:.*\n- .*\(holt\)/);
  assert.match(first, /Moderate:.*\n- .*\(corvin\)/);
  assert.doesNotMatch(first, /\(rowan\)|\(player\)/);
  actor("holt").position!.x = 66;
  assert.match(await warning(), /Distant:.*\n- .*\(holt\)/);
  actor("holt").position!.x = 80;
  actor("corvin").position!.x = 80;
  assert.match(await warning(), /No one else is within earshot/);
  assert.equal(observations(), 3);
});

test("NPC exchanges exclude both speakers and can warn about the player", async () => {
  const { warning } = fixture();
  const content = await warning("exchange", ["rowan", "corvin"]);
  assert.doesNotMatch(content, /\(rowan\)|\(corvin\)/);
  assert.match(content, /\(player\)/);
  assert.match(content, /not proof they heard or learned anything/);
});

test("closed doors prevent an earshot warning until they open", async () => {
  const { map, actor, warning } = fixture();
  const door = map.doors.find(door => door.id === "corvin_door")!;
  actor("rowan").position = { ...door.interactionSpots[0]! };
  actor("holt").position = { ...door.interactionSpots[1]! };
  actor("corvin").position!.x = 80;
  door.open = false;
  assert.doesNotMatch(await warning(), /\(holt\)/);
  door.open = true;
  assert.match(await warning(), /\(holt\)/);
});

test("GM setup does not query a physical conversation audience", async () => {
  const { runtime, observations } = fixture();
  await runtime.services.agents.prepare({ agent: "game_master", messages: [] }, new AbortController().signal);
  assert.equal(observations(), 0);
});

test("headless turns retain one audience note across reloads and only commit changed audiences after success", async () => {
  const { WorldHeadlessGame } = await import("../packages/headless/src/world.js");
  const { world } = fixture();
  let fail = false;
  const counts: number[] = [];
  const game = new WorldHeadlessGame(world, "", {
    strategies: { conversation: {
      classify: async () => ({ docs: {} as never, checks: undefined }),
      resolve: async () => ({ reclassify: false }),
    }, review: { resolve: async () => ({ summary: "Reviewed" }) } },
    services: { ai: { responses: async request => {
      counts.push(request.messages.filter(message => message.role === "system" && message.content?.startsWith("# Current conversation earshot")).length);
      if (fail) throw new Error("Intentional response failure");
      return { role: "assistant", content: "Hello." };
    } } },
  });
  const notes = () => game.snapshot().conversations.rowan!.filter(turn => (turn as { speakerId?: string }).speakerId === "earshot");
  await game.talk("rowan", "Hello");
  assert.equal(notes().length, 1);
  game.load(game.snapshot());
  game.edit(state => { state.map!.actors.find(actor => actor.characterId === "holt")!.position!.x = 61; });
  await game.talk("rowan", "Still here");
  assert.equal(notes().length, 1, "Movement within the same hearing level does not add a note");
  game.edit(state => { state.map!.actors.find(actor => actor.characterId === "holt")!.position!.x = 66; });
  fail = true;
  await assert.rejects(game.talk("rowan", "A failed turn"), /Intentional response failure/);
  assert.equal(notes().length, 1);
  fail = false;
  await game.talk("rowan", "Try again");
  assert.equal(notes().length, 2);
  assert.deepEqual(counts, [1, 1, 2, 2]);
  assert.equal((game.overview().conversations as Record<string, unknown[]>).rowan!.length, 6, "Context notes stay out of visible dialogue");
  await game.endConversation("rowan");
  await game.talk("rowan", "A new conversation");
  assert.equal(notes().length, 1);
});
