import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeOf } from "./ai-call.ts";

/** How run_job reads what its POST came to (v0-design §3.5 step 2, §5.1's statuses). */

test("200 is an answer, or a retry when it isn't JSON", () => {
  assert.deepEqual(outcomeOf({ status: 200, body: '{"usage":{"calls":1}}', replayed: true }), { kind: "answer", status: 200, answer: { usage: { calls: 1 } }, replayed: true });
  assert.equal(outcomeOf({ status: 200, body: "<html>" }).kind, "retry");
});

test("429, a 5xx and a request that threw are tried again", () => {
  assert.deepEqual(outcomeOf({ status: 500, body: '{"error":{"code":"model_failed","message":"OpenRouter 502"}}' }), { kind: "retry", status: 500, reason: "500 model_failed: OpenRouter 502" });
  assert.equal(outcomeOf({ status: 503, body: '{"error":{"code":"not_ready","message":"shutting down"}}' }).kind, "retry");
  assert.equal(outcomeOf({ status: 429, body: "" }).kind, "retry");
  assert.deepEqual(outcomeOf({ error: "HttpError: tcp connect error: Connection refused" }), { kind: "retry", reason: "HttpError: tcp connect error: Connection refused" });
});

test("any other status fails the turn", () => {
  assert.deepEqual(outcomeOf({ status: 401, body: '{"error":{"code":"unauthorised","message":"bad bearer"}}' }), { kind: "fatal", status: 401, reason: "401 unauthorised: bad bearer" });
  assert.equal(outcomeOf({ status: 409, body: '{"error":{"code":"key_reused","message":"…"}}' }).kind, "fatal");
  assert.equal(outcomeOf({ status: 404, body: "Not Found" }).kind, "fatal");
});
