import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";
import { CRESSIDA_COW_EVENT, CRESSIDA_HUMAN_EVENT, CRESSIDA_HUMAN_MS } from "../packages/core/src/cressida-transformation.js";
import { participantPresentations } from "../packages/conversation/src/participant-presentation.js";
import { WaitScheduler } from "../apps/web/src/wait-scheduler.js";

const signal = new AbortController().signal;
test("solstice changes persist the body, preserve identity and inventory, and reverse", async () => {
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "");
  const inventory = runtime.world().simulation!.runtimeCharacters.cressida!.inventory;
  const other = runtime.world().simulation!.map!.actors.find(actor => actor.characterId === "holt");
  const before = runtime.world().simulation!.map!.revision;
  const event = await runtime.transformCressida(signal);
  assert.equal(event.summary, CRESSIDA_COW_EVENT);
  assert.equal(runtime.world().simulation!.map!.revision, before + 1);
  assert.equal(runtime.world().simulation!.runtimeCharacters.cressida!.inventory, inventory);
  assert.equal(runtime.world().simulation!.map!.actors.find(actor => actor.characterId === "holt"), other);
  assert.match(participantPresentations(runtime.world(), "holt", ["cressida"])[0]!.content!, /cow form/);
  const restored = new WorldGameRuntime(loadPlayableWorld(), "", runtime.snapshot());
  assert.equal(restored.world().simulation!.map!.actors.find(actor => actor.characterId === "cressida")!.physicalForm, "cow");
  assert.equal((await restored.transformCressida(signal)).summary, CRESSIDA_HUMAN_EVENT);
  assert.equal(restored.world().simulation!.map!.actors.find(actor => actor.characterId === "cressida")!.physicalForm, "human");
  const snapshot = restored.snapshot();
  await assert.rejects(restored.transformCressida(AbortSignal.abort()), { name: "AbortError" });
  assert.deepEqual(restored.snapshot(), snapshot);
});

test("everyone nearby perceives the transformation without a luck roll; distant actors do not", async () => {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  map.actors = map.actors.filter(actor => ["cressida", "holt", "player", "rowan"].includes(actor.characterId));
  for (const [id, x] of [["cressida", 58], ["holt", 62], ["player", 60], ["rowan", 80]] as const) {
    map.actors.find(actor => actor.characterId === id)!.position = { $typeName: "kingmaker.v1.TilePosition", x, y: 24 };
  }
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined,
    { services: { random: { integer: () => { throw new Error("Transformations are obvious to nearby witnesses"); } } } });
  const event = await runtime.transformCressida(signal);
  const perceived = await runtime.assessWorldEvent(event, signal);
  assert.equal(perceived.playerPerception, CRESSIDA_COW_EVENT);
  assert.deepEqual(perceived.reactions.map(item => item.characterId), ["holt"]);
  assert.equal(perceived.reactions[0]!.perception, CRESSIDA_COW_EVENT);
  runtime.recordPlayerPerception(event, perceived.playerPerception!);
  assert.equal(runtime.snapshot().playerMessages.at(-1)!.message, CRESSIDA_COW_EVENT);
});

test("human-duration clock toggles both ways and cancellation stops future changes", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "");
  const scheduler = new WaitScheduler({ candidates: () => new Map([["cressida", "game"]]), busy: () => false,
    delayMs: () => CRESSIDA_HUMAN_MS, error: (_id, error) => { throw error; },
    run: async (_id, _elapsed, cancellation) => { await runtime.transformCressida(cancellation); } });
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const form = () => runtime.world().simulation!.map!.actors.find(actor => actor.characterId === "cressida")!.physicalForm;
  scheduler.sync(); t.mock.timers.tick(299_999); await flush(); assert.equal(form(), undefined);
  t.mock.timers.tick(1); await flush(); assert.equal(form(), "cow");
  t.mock.timers.tick(300_000); await flush(); assert.equal(form(), "human");
  scheduler.stop(); t.mock.timers.tick(300_000); await flush(); assert.equal(form(), "human");
});


test("each Cressida dialogue and exchange receives the current form as a system message", async () => {
  const { setupWorldAgent } = await import("../apps/web/src/agent-setup.js");
  const { ConversationRuntime } = await import("../packages/conversation/src/runtime.js");
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  const runtime = new ConversationRuntime({ strategies: { setup: { prepare: setupWorldAgent } }, services: {
    scenario: { read: () => world }, map: { observe: id => ({ characterId: id, map, actions: [] }) },
  } });
  for (const form of [undefined, "cow", "human"]) {
    map.actors.find(actor => actor.characterId === "cressida")!.physicalForm = form;
    for (const agent of ["character", "exchange"] as const) {
      const messages = await runtime.services.agents.prepare({ agent, characterId: "cressida", sources: [],
        participantIds: ["cressida", "player"], messages: [{ role: "user", content: "Hello" }] }, signal);
      assert.ok(messages.some(message => message.role === "system" && message.content?.startsWith(
        `You are currently a ${form === "cow" ? "were-cow" : "human"}.`)));
    }
  }
});
