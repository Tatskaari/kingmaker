import { test } from "node:test";
import assert from "node:assert/strict";
import { streamReplyArgs } from "./ai.ts";
import { idempotencyKey, keyParts } from "./keys.ts";
import { andList, refusal, refusalIn } from "./refusals.ts";

test("refusals say what v0-design §3.4 says", () => {
  assert.equal(refusal("not_controller", { name: "Wren Ashdown" }).text, "(Wren Ashdown has the lead here: you're watching.)");
  assert.equal(refusal("no_build", { build: "bard", builds: andList(["ranger", "rogue", "wizard"]) }).text, "(There's no ready-made build called bard: there's ranger, rogue and wizard.)");
  assert.equal(refusal("too_long").text, "(That's too much for one turn: 2,000 characters at most.)");
  assert.equal(refusal("unknown", { what: "turn" }).text, "(There's no such turn.)");
  assert.equal(refusal("unknown", { what: "game" }).text, "(There's no such game here.)");
  assert.equal(refusal("not_admin").text, "Only the database's owner may install a campaign.");
  assert.equal(refusal("not_built").text, "(That isn't built yet.)");
});

test("a refusal comes back out of an error's message, and nothing else does", () => {
  const sent = refusal("turn_in_flight");

  assert.deepEqual(refusalIn(JSON.stringify(sent)), sent);
  assert.equal(refusalIn("The instance encountered a fatal error."), undefined);
  assert.equal(refusalIn(JSON.stringify({ code: "nope", text: "x" })), undefined);
});

test("a think's key holds its game, scene, turn and step", () => {
  const key = idempotencyKey("5f0c-uid", 1n, 3, "reply");

  assert.equal(key, "5f0c-uid:s1:t3:reply");
  assert.deepEqual(keyParts(key), { game: "5f0c-uid", scene: "1", turn: 3, step: "reply" });
  assert.equal(keyParts("not a key"), undefined);
});

test("stream_reply's arguments are named as the reducer's, the markup in SpacetimeDB's option", () => {
  const args = streamReplyArgs({ turn: "812", attempt: 2, seq: 5, speaker: "gm", text: "Kell looks up.", markup: { speech: [], marks: [] }, done: false });

  assert.deepEqual(args, { turnId: 812, attempt: 2, seq: 5, speaker: "gm", text: "Kell looks up.", markup: { some: '{"speech":[],"marks":[]}' }, done: false });
  assert.deepEqual(streamReplyArgs({ turn: "1", attempt: 1, seq: 1, speaker: "gm", text: "", done: true }).markup, { none: [] });
});
