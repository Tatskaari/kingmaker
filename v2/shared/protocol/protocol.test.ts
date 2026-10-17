import { test } from "node:test";
import assert from "node:assert/strict";
import { tooLong } from "../creation/story.ts";
import { STEP_ENDPOINT, STEP_TIMEOUT_MS, streamReplyArgs } from "./ai.ts";
import { creationKey, CREATION_STEPS, idempotencyKey, isTurnKey, keyParts, STEPS } from "./keys.ts";
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
  assert.deepEqual(STEPS.map(step => STEP_ENDPOINT[step]), [
    "/v1/scenes/open", "/v1/turns/decide", "/v1/turns/consider", "/v1/turns/reply", "/v1/turns/settle", "/v1/turns/notes", "/v1/turns/suggest", "/v1/turns/remember", "/v1/turns/repair",
  ]);
  assert.deepEqual([STEP_TIMEOUT_MS.notes, STEP_TIMEOUT_MS.suggest], [30_000, 30_000]);
});

test("a ruling before the reply, and the memory reviews and the co-GM after a turn, have keys of their own (full-gm-design §4.2)", () => {
  for (const step of ["consider", "remember", "repair"] as const) {
    const key = idempotencyKey("5f0c-uid", 1n, 3, step);
    assert.equal(key, `5f0c-uid:s1:t3:${step}`);
    assert.deepEqual(keyParts(key), { game: "5f0c-uid", scene: "1", turn: 3, step });
  }
  assert.equal(keyParts("5f0c-uid:c4:repair"), undefined, "a turn's step isn't a creation's");
  assert.deepEqual([STEP_TIMEOUT_MS.consider, STEP_TIMEOUT_MS.remember, STEP_TIMEOUT_MS.repair], [20_000, 170_000, 170_000]);
});

test("stream_reply's arguments are named as the reducer's, the markup in SpacetimeDB's option", () => {
  const args = streamReplyArgs({ turn: "812", attempt: 2, seq: 5, speaker: "gm", text: "Kell looks up.", markup: { speech: [], marks: [] }, done: false });

  assert.deepEqual(args, { turnId: 812, attempt: 2, seq: 5, speaker: "gm", text: "Kell looks up.", markup: { some: '{"speech":[],"marks":[]}' }, done: false });
  assert.deepEqual(streamReplyArgs({ turn: "1", attempt: 1, seq: 1, speaker: "gm", text: "", done: true }).markup, { none: [] });
});

test("a creation step's key holds its uid, rev and step; a turn's key is still a turn's", () => {
  const key = creationKey("5f0c-uid", 4, "check");
  const parts = keyParts(key)!;

  assert.equal(key, "5f0c-uid:c4:check");
  assert.deepEqual(parts, { game: "5f0c-uid", rev: 4, step: "check" });
  assert.equal(isTurnKey(parts), false);
  assert.equal(isTurnKey(keyParts(idempotencyKey("5f0c-uid", 1n, 3, "reply"))!), true);
  assert.equal(keyParts("5f0c-uid:c4:open"), undefined, "a turn's step isn't a creation's");
  assert.equal(keyParts("5f0c-uid:c4:notes"), undefined, "nor a step beside a turn");
  assert.equal(keyParts("5f0c-uid:s1:t3:check"), undefined, "nor the other way");
  assert.equal(isTurnKey(keyParts(idempotencyKey("5f0c-uid", 1n, 3, "suggest", 2))!), true, "a turn's later ask for its lines is a turn's");
});

test("each creation step goes to its endpoint, and waits as long as v1-design §3.5 says", () => {
  assert.deepEqual(CREATION_STEPS.map(step => STEP_ENDPOINT[step]), ["/v1/characters", "/v1/characters", "/v1/characters", "/v1/backstories", "/v1/backstories", "/v1/backstories", "/v1/backstories"]);
  assert.deepEqual(CREATION_STEPS.map(step => STEP_TIMEOUT_MS[step] / 1000), [60, 60, 30, 60, 60, 60, 60]);
});

test("character creation's refusals say what v1-design §3.4 says; a story too long says its length as tooLong does", () => {
  assert.equal(refusal("not_creating").text, "(You're not making a character: New game starts one.)");
  assert.equal(refusal("creation_busy").text, "(The GM is still working on it.)");
  assert.equal(refusal("not_offered").text, "(That isn't one of the builds on offer.)");
  assert.equal(refusal("still_making").text, "(The rules engine is still making it.)");
  assert.equal(refusal("not_now").text, "(That doesn't apply just now.)");
  assert.equal(refusal("bad_concept").text, "(Your character's concept needs to be 300 characters or fewer.)", "new_game's (V0's review) and start_creation's alike");
  assert.equal(refusal("bad_how").text, "(That isn't a way to make a character: three, model, or own:<species>,<class>,<subclass>,<background>.)");
  assert.equal(refusal("nothing_to_work_in").text, "There's nothing in the box to work in yet: write a few notes first, or Draft one.");
  assert.equal(refusal("story_too_long", { words: "2345" }).text, "It's 2,345 words, and the GM reads all of it every turn: cut it to 2,000 or fewer.");
  assert.equal(refusal("story_too_long", { words: "2345" }).text, tooLong("word ".repeat(2345)));
  assert.equal(refusal("story_too_big").text, "(That's more than the box can keep.)");
  assert.equal(refusal("already_begun").text, "(The story has already begun.)");
  assert.equal(refusal("not_yours").text, "(That isn't one of your games.)");
  assert.equal(refusal("not_begun").text, "(That game hasn't begun: its player is still making their character.)");
});
