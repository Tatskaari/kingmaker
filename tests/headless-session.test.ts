import assert from "node:assert/strict";
import test from "node:test";
import { guestIds, inviteGuests, jevWorldEvalScenarios, silkScarf } from "../evals/jev/scenarios.js";
import { HeadlessSession } from "../packages/headless/src/index.js";

test("TypeScript controls the treasury eval without a model or browser", () => {
  const session = new HeadlessSession(jevWorldEvalScenarios[0]!);
  const initial = session.observe();
  assert.throws(() => session.result(), /Finish/);
  assert.throws(() => session.act("invented_action"), /Unavailable/);
  assert.equal(session.turns, 0);
  assert.deepEqual(session.observe(), initial);
  session.act("open_treasury_door_0");
  session.act("enter_treasury");
  const inside = session.observe();
  const close = Object.keys(inside.choices).find(id => id.startsWith("close_treasury_door"));
  assert.ok(close);
  session.act(close);
  assert.equal(session.act("wait").observation, null);
  assert.equal(session.result().success, true);
  assert.throws(() => session.act("wait"), /ended/);
  assert.throws(() => session.observe(), /ended/);
});

test("mock conversations preserve the eval semantics and action log", () => {
  const session = new HeadlessSession(inviteGuests, { level: 1, includeRecentResults: true });
  for (const id of guestIds) session.act(`talk_${id}`);
  assert.match(String(session.observe().state), /talk_mara/);
  session.act("complete");
  assert.equal(session.result().success, true);
  assert.equal(session.result().score, 9);
  const fresh = new HeadlessSession(inviteGuests);
  assert.doesNotMatch(String(fresh.observe().state), /Action log[^]*\ntalk_mara/);
});

test("unmocked talks yield a conversation boundary rather than inventing dialogue", () => {
  const session = new HeadlessSession(silkScarf);
  assert.equal(session.act("talk_rowan").status, "requires_conversation");
  assert.equal(session.result().success, true);
});

test("turn budget stops further actions", () => {
  const session = new HeadlessSession({ ...inviteGuests, maxTurns: 1 });
  assert.equal(session.act("talk_mara").status, "limit");
  assert.equal(session.result().success, false);
  assert.throws(() => session.act("talk_hadrik"), /ended/);
});
