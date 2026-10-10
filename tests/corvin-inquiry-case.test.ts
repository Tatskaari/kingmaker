import assert from "node:assert/strict";
import test from "node:test";
import { corvinInquiryCase } from "../packages/evals/src/corvin-inquiry-case.js";

test("Corvin inquiry starts before review with an authored commitment and no seeded outcome", () => {
  const first = corvinInquiryCase.loadWorld([]), second = corvinInquiryCase.loadWorld([]);
  assert.deepEqual(first, second);
  assert.notEqual(first.docs, second.docs);
  assert.equal(first.simulation!.runtimeCharacters.corvin!.activity, undefined);
  assert.equal(first.simulation!.runtimeCharacters.corvin!.wait, undefined);
  assert.ok(!Object.keys(first.docs).some(path => path.includes("57c6adfc-cfcb-41d2-b29f-856932d475b8")));
  assert.match(corvinInquiryCase.transcript.at(-1)!.text, /Elinor Ash, Professor Oswin, and Doctor Rowan Ash, one by one/);
  assert.ok(Object.values(first.docs).some(doc => doc.body.includes("I do not yet know whether the envoy heard this directly")));
  assert.ok(!Object.values(first.docs).some(doc => doc.body.includes("I will speak to Lady Elinor")));
  const actor = first.simulation!.map!.actors.find(actor => actor.characterId === "corvin")!;
  assert.equal(actor.roomId, "great_hall");
  assert.equal(actor.position!.x, 58); assert.equal(actor.position!.y, 20);
});
