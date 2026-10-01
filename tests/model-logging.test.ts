import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ModelTranscripts } from "../apps/web/src/model-transcripts.js";
import { logPath } from "../scripts/test-logging.js";

test("model logs correlate calls and redact credentials on success and failure", async () => {
  const secret = "custom-test-credential";
  const transcripts = new ModelTranscripts(secret);
  const characterId = "logging-character";
  await transcripts.record("jev", characterId, { text: secret }, async () => ({ choice: "ignore", text: "sk-test-secret" }));
  await assert.rejects(transcripts.record("jev", characterId, {}, async () => { throw new Error(`rejected ${secret}`); }));
  const records = readFileSync(logPath, "utf8").trim().split("\n").map(line => JSON.parse(line))
    .filter(record => record.properties.characterId === characterId);
  assert.equal(records.length, 4);
  assert.doesNotMatch(JSON.stringify(records), /custom-test-credential|sk-test-secret/);
  assert.equal(records[0].properties.request.text, "[redacted]");
  assert.equal(records[1].properties.response.text, "[redacted]");
  assert.equal(records[0].properties.runKey, records[1].properties.runKey);
  assert.equal(records[0].properties.callId, records[1].properties.callId);
  assert.notEqual(records[0].properties.runKey, records[2].properties.runKey);
  assert.equal(records[3].message, "Model call failed");
  assert.equal(records[3].properties.error, "rejected [redacted]");
  assert.ok(records[3].properties.durationMs >= 0);
});
