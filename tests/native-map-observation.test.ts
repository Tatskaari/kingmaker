import assert from "node:assert/strict";
import test from "node:test";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";

test("map observation uses physical state and document names without reading prose or goals", t => {
  const host = new WorldHost(loadPlayableWorld()), world = host.world();
  for (const [id, x] of [["player", 58], ["rowan", 59]] as const) {
    const actor = world.simulation!.map!.actors.find(actor => actor.characterId === id)!;
    actor.roomId = "great_hall";
    actor.position = { $typeName: "kingmaker.v1.TilePosition", x, y: 24 };
  }
  world.docs[world.characters.find(path => path.includes("/rowan/"))!]!.frontmatter!.name = "Custom Rowan";
  for (const document of Object.values(world.docs)) {
    Object.defineProperty(document, "body", { get() { throw new Error("Unexpected prose read"); } });
    if (document.frontmatter) Object.defineProperty(document.frontmatter, "active_goal", { get() { throw new Error("Unexpected goal read"); } });
  }
  t.mock.method(host, "world", () => world);
  const observed = host.map.observe("player");
  assert.match(observed.actions.find(action => action.id === "talk_rowan")!.description, /Custom Rowan/);
  assert.ok(observed.map.actors.some(actor => actor.characterId === "player"));
  assert.throws(() => host.map.observe("missing"), /not placed/);
});

test("native map observations retain background bodies and choose the nearby interlocutor without changing state", () => {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  const bodies = map.actors.filter(actor => actor.characterId.startsWith("palace-guard-"));
  const player = map.actors.find(actor => actor.characterId === "player")!;
  // A later body is deliberately nearest; the saved array order must remain intact.
  player.position = { ...bodies.at(-1)!.position! };
  player.roomId = bodies.at(-1)!.roomId;
  const host = new WorldHost(world), before = host.snapshot();
  const observed = host.map.observe("player");
  const visibleBodies = observed.map.actors.filter(actor => actor.characterId.startsWith("palace-guard-"));
  assert.equal(visibleBodies.length, bodies.length);
  assert.ok(visibleBodies.some(actor => actor.instanceId === bodies.at(-1)!.instanceId));
  assert.equal(new Set(visibleBodies.map(actor => actor.instanceId)).size, bodies.length);
  assert.ok(observed.actions.some(action => action.id === `talk_${bodies.at(-1)!.characterId}`));
  assert.deepEqual(host.snapshot(), before);
  assert.ok(host.map.observe(bodies.at(-1)!.characterId).actions.length > 0, "Guard bodies act independently");
});
