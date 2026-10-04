import assert from "node:assert/strict";
import test from "node:test";
import { Recording } from "../packages/service-tools/src/recording.js";

test("recorders preserve private receivers, sync returns, errors and detached evidence", async () => {
  class Service {
    #value = 3;
    read(input: { value: number }) { return { value: this.#value + input.value }; }
    fail() { throw error; }
    async reject() { throw error; }
  }
  const error = new Error("failure"), recording = new Recording();
  const service = recording.wrap("test", new Service()), input = { value: 2 };
  const result = service.read(input);
  input.value = 100; result.value = 100;
  assert.throws(() => service.fail(), value => value === error);
  await assert.rejects(service.reject(), value => value === error);
  const calls = recording.getServiceRecord("test");
  assert.deepEqual(calls[0]!.args, [{ value: 2 }]);
  assert.deepEqual(calls[0]!.outcome, { status: "returned", value: { value: 5 } });
  assert.equal(calls[1]!.outcome?.status, "threw");
  assert.equal(calls[2]!.outcome?.status, "threw");
  calls[0]!.method = "mutated";
  assert.equal(recording.getCalls()[0]!.method, "read");
  assert.equal(recording.wrap("test", service), service);
});

test("composed services record nested AI calls with concurrent parentage and redacted evidence", async () => {
  const recording = new Recording(["secret-key"]);
  const ai = recording.wrap("ai", { async respond(value: string) { await Promise.resolve(); return value; } });
  const disclosure = recording.wrap("disclosure", { async run(value: string) { return ai.respond(value); } });
  await Promise.all([disclosure.run("first"), disclosure.run("secret-key")]);
  const calls = recording.getCalls(), aiCalls = recording.getServiceRecord("ai");
  assert.equal(aiCalls.length, 2);
  for (const call of aiCalls) assert.equal(calls.find(parent => parent.id === call.parentId)!.service, "disclosure");
  assert.notEqual(aiCalls[0]!.parentId, aiCalls[1]!.parentId);
  assert.doesNotMatch(JSON.stringify(calls), /secret-key/);
  assert.deepEqual(recording.snapshot({ apiKey: "other-key", authorization: "Bearer another" }),
    { apiKey: "[redacted]", authorization: "[redacted]" });
});
