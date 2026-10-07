import assert from "node:assert/strict";
import test from "node:test";
import { WorldHeadlessGame } from "../packages/headless/src/world.js";
import { loadPlayableWorld } from "./fixtures.js";

function game() {
  const game = new WorldHeadlessGame(loadPlayableWorld());
  return game;
}

test("player actions use real door mechanics and Jev's room rendering", async () => {
  const live = game();
  assert.match(live.observe(), /Great Hall/);
  assert.match(JSON.stringify(live.overview()), /Aldren/);
  const before = live.snapshot();
  await assert.rejects(live.act("invented"), /Unavailable/);
  assert.deepEqual(live.snapshot(), before);
  await live.act(live.actions().find(action => action.id.startsWith("open_treasury_door"))!.id);
  await live.act("enter_treasury");
  await live.act(live.actions().find(action => action.id.startsWith("close_treasury_door"))!.id);
  const state = live.inspect();
  assert.equal(state.simulation!.map!.actors.find(actor => actor.characterId === "player")!.roomId, "treasury");
  assert.equal(state.simulation!.map!.doors.find(door => door.id === "treasury_door")!.open, false);
  live.load(before);
  assert.match(live.observe(), /^Great Hall/);
});

test("inspection and console edits use live state without rollback", () => {
  const live = game();
  live.inspect().simulation!.map!.day = 99;
  assert.equal(live.inspect().simulation!.map!.day, 99);
  const saved = live.snapshot();
  live.edit(state => { state.simulation!.map!.day = 7; });
  assert.equal(live.inspect().simulation!.map!.day, 7);
  assert.throws(() => live.edit(state => { state.simulation!.map!.day = 8; throw new Error("stop"); }), /stop/);
  assert.equal(live.inspect().simulation!.map!.day, 8);
  assert.equal(new WorldHeadlessGame(saved).inspect().simulation!.map!.day, 99);
  assert.equal(new WorldHeadlessGame(live.snapshot()).inspect().simulation!.map!.day, 8);
});

test("enter actions return trespass events for explicit guard perception", async () => {
  const live = game();
  assert.deepEqual(await live.act("enter_royal_council_chamber"), { done: true });
  await live.act(live.actions().find(action => action.id.startsWith("open_hall_door"))!.id);
  const hall = await live.act("enter_north_corridor");
  assert.ok("worldEvent" in hall && hall.worldEvent);
  assert.equal(hall.worldEvent.kind, "entering Royal Back Hall");
  await live.act(live.actions().find(action => action.id.startsWith("open_royal_door"))!.id);
  const bedroom = await live.act("enter_royal_bedchamber");
  assert.ok("worldEvent" in bedroom && bedroom.worldEvent);
  assert.equal(bedroom.done, true);
  assert.equal(bedroom.worldEvent.summary, "The player entered Royal Bedchamber without permission.");
  assert.deepEqual(bedroom.worldEvent.participantIds, ["player"]);
  assert.deepEqual(bedroom.worldEvent.position, live.inspect().simulation!.map!.actors.find(actor => actor.characterId === "player")!.position);

  // Make distant hearing deterministic; no model or seeded arrest is needed.
  live.runtime.options.services = { random: { integer: min => min } };
  const perception = await live.runtime.assessWorldEvent(bedroom.worldEvent, new AbortController().signal);
  assert.ok(perception.reactions.some(reaction => reaction.characterId === "palace-guard-9"));
  assert.equal(perception.playerPerception, bedroom.worldEvent.summary);
});

test("talk approaches a character and delegates to real player dialogue methods", async t => {
  const live = game();
  const talk = t.mock.method(live.runtime, "checkedTalkToCharacter", async () => "Welcome, envoy.");
  const end = t.mock.method(live.runtime, "endConversation", async () => undefined);
  assert.deepEqual(await live.act("talk_rowan"), { characterId: "rowan" });
  assert.equal(await live.talk("rowan", "Hello"), "Welcome, envoy.");
  assert.deepEqual(talk.mock.calls[0]!.arguments, ["rowan", "Hello"]);
  await live.endConversation("rowan");
  assert.deepEqual(end.mock.calls[0]!.arguments, ["rowan", undefined]);
});
