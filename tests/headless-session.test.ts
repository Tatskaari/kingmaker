import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { HeadlessGame } from "../packages/headless/src/index.js";

function game() {
  const game = new HeadlessGame(fromJsonString(ScenarioSchema,
    readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")));
  game.runtime.createDevelopmentPlayer();
  return game;
}

test("player actions use real door mechanics and Jev's room rendering", () => {
  const live = game();
  assert.match(live.observe(), /Great Hall/);
  assert.match(live.overview(), /King Aldren/);
  const before = live.snapshot();
  assert.throws(() => live.act("invented"), /Unavailable/);
  assert.deepEqual(live.snapshot(), before);
  live.act(live.actions().find(action => action.id.startsWith("open_treasury_door"))!.id);
  live.act("enter_treasury");
  live.act(live.actions().find(action => action.id.startsWith("close_treasury_door"))!.id);
  const state = live.inspect();
  assert.equal(state.world!.actors.find(actor => actor.characterId === state.playerCharacterId)!.roomId, "treasury");
  assert.equal(state.world!.doors.find(door => door.id === "treasury_door")!.open, false);
  live.load(before);
  assert.match(live.observe(), /^Great Hall/);
});

test("inspection is detached, live edits persist, failed edits leave state intact", () => {
  const live = game();
  live.inspect().world!.day = 99;
  assert.notEqual(live.inspect().world!.day, 99);
  live.edit(state => { state.world!.day = 7; });
  assert.equal(live.inspect().world!.day, 7);
  assert.throws(() => live.edit(state => { state.world!.day = 8; throw new Error("stop"); }), /stop/);
  assert.equal(live.inspect().world!.day, 7);
  assert.equal(new HeadlessGame(live.snapshot()).inspect().world!.day, 7);
});

test("talk approaches a character and delegates to real player dialogue methods", async t => {
  const live = game();
  const talk = t.mock.method(live.runtime, "checkedTalkToCharacter", async () => "Welcome, envoy.");
  const end = t.mock.method(live.runtime, "endConversation", async () => undefined);
  assert.equal(await live.talk("rowan", "Hello"), "Welcome, envoy.");
  assert.deepEqual(talk.mock.calls[0]!.arguments, ["rowan", "Hello"]);
  await live.endConversation("rowan");
  assert.deepEqual(end.mock.calls[0]!.arguments, ["rowan"]);
});

test("headless conversations run injected classification, resolution and response after load", async () => {
  const order: string[] = [];
  const live = new HeadlessGame(fromJsonString(ScenarioSchema,
    readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")), "", {
    hooks: { conversation: {
      classify: async () => {
        order.push("classify");
        return { checks: { needsCheck: false, checks: [], decisions: {} as never } };
      },
      resolve: async (context, labels) => {
        order.push("resolve");
        assert.equal(labels.checks.needsCheck, false);
        context.request.messages.splice(1, 0, { role: "system", content: "OPENED_LORE" });
        context.request.messages.push({ role: "system", content: "HEADLESS_RULING" });
        return { reclassify: false };
      },
    } },
    services: { character: { respond: async request => {
      order.push("respond");
      assert.equal(request.messages.at(-1)?.content, "HEADLESS_RULING");
      assert.ok(request.messages.some(message => message.content === "OPENED_LORE"));
      return { role: "assistant", content: JSON.stringify({ utterance: "Headless reply.", replyOptions: [], endConversation: false }) };
    } } },
  });
  live.runtime.createDevelopmentPlayer();
  live.load(live.snapshot());
  assert.equal(await live.talk("rowan", "Hello"), "Headless reply.");
  assert.deepEqual(order, ["classify", "resolve", "respond"]);
  assert.match(JSON.stringify(live.snapshot().conversations), /HEADLESS_RULING/);
  assert.match(JSON.stringify(live.snapshot().conversations), /Headless reply/);
});

test("headless resolver failure saves no partial conversation and never responds", async () => {
  const live = new HeadlessGame(fromJsonString(ScenarioSchema,
    readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")), "", {
    hooks: { conversation: {
      classify: async () => ({ checks: { needsCheck: false, checks: [], decisions: {} as never } }),
      resolve: async () => { throw new Error("Resolution failed"); },
    } },
    services: { character: { respond: async () => { assert.fail("Must not respond"); } } },
  });
  live.runtime.createDevelopmentPlayer();
  const before = live.snapshot().conversations;
  await assert.rejects(live.talk("rowan", "Hello"), /Resolution failed/);
  assert.deepEqual(live.snapshot().conversations, before);
});
