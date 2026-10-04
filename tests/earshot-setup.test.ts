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
  const runtime = new ConversationRuntime({ hooks: { setup: setupWorldAgent }, services: {
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
