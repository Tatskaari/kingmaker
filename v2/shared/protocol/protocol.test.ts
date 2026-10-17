import { test } from "node:test";
import assert from "node:assert/strict";
import { STEP_ENDPOINT, STEP_TIMEOUT_MS, streamReplyArgs } from "./ai.ts";
import { idempotencyKey, keyParts, STEPS } from "./keys.ts";
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

test("a reply's notes have a key of their own, and each ask for its lines another (v5-design §3.6)", () => {
  assert.equal(idempotencyKey("5f0c-uid", 1n, 3, "notes"), "5f0c-uid:s1:t3:notes");
  assert.deepEqual(keyParts("5f0c-uid:s1:t3:notes"), { game: "5f0c-uid", scene: "1", turn: 3, step: "notes" });

  const asks = [1, 2, 3].map(ask => idempotencyKey("5f0c-uid", "1", 0, "suggest", ask));

  assert.deepEqual(asks, ["5f0c-uid:s1:t0:suggest", "5f0c-uid:s1:t0:suggest-2", "5f0c-uid:s1:t0:suggest-3"]);
  assert.deepEqual(asks.map(keyParts), [
    { game: "5f0c-uid", scene: "1", turn: 0, step: "suggest" },
    { game: "5f0c-uid", scene: "1", turn: 0, step: "suggest", ask: 2 },
    { game: "5f0c-uid", scene: "1", turn: 0, step: "suggest", ask: 3 },
  ]);
  assert.equal(idempotencyKey("5f0c-uid", 1n, 3, "notes", 2), "5f0c-uid:s1:t3:notes", "only the suggest step is asked again");
  for (const other of ["5f0c-uid:s1:t3:suggest-1", "5f0c-uid:s1:t3:suggest-02", "5f0c-uid:s1:t3:notes-2", "5f0c-uid:s1:t3:reply-2"]) assert.equal(keyParts(other), undefined, other);
});

test("every step has its endpoint and its timeout: the notes' and the lines' 30 s", () => {
  assert.deepEqual(STEPS.map(step => STEP_ENDPOINT[step]), ["/v1/scenes/open", "/v1/turns/decide", "/v1/turns/reply", "/v1/turns/settle", "/v1/turns/notes", "/v1/turns/suggest"]);
  assert.deepEqual([STEP_TIMEOUT_MS.notes, STEP_TIMEOUT_MS.suggest], [30_000, 30_000]);
});

test("stream_reply's arguments are named as the reducer's, the markup in SpacetimeDB's option", () => {
  const args = streamReplyArgs({ turn: "812", attempt: 2, seq: 5, speaker: "gm", text: "Kell looks up.", markup: { speech: [], marks: [] }, done: false });

  assert.deepEqual(args, { turnId: 812, attempt: 2, seq: 5, speaker: "gm", text: "Kell looks up.", markup: { some: '{"speech":[],"marks":[]}' }, done: false });
  assert.deepEqual(streamReplyArgs({ turn: "1", attempt: 1, seq: 1, speaker: "gm", text: "", done: true }).markup, { none: [] });
});
