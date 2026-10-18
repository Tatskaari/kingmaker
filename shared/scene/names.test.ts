import { test } from "node:test";
import assert from "node:assert/strict";
import { beingCalled, kindIn } from "./names.ts";

/** What the player calls the place's beings with no card (QA round hobo1-1018: the fight's line-up gave Duchess's name away). */

test("one of the place's beings with a name of their own is what they are until the name is heard; one with no name of their own is what they're called", () => {
  const duchess = { name: "Duchess", kind: "creature", description: "A vast, elderly brindle mastiff, asleep across the threshold." };
  assert.equal(kindIn(duchess.description), "mastiff");
  assert.equal(beingCalled(duchess, { transcript: [] }), "the mastiff");
  assert.equal(beingCalled(duchess, { transcript: [{ kind: "dialogue", text: "Down, Duchess!" }] }), "Duchess", "heard");
  assert.equal(beingCalled(duchess, { transcript: [{ kind: "roll", text: "Duchess bites" }] }), "the mastiff", "the dice aren't heard");
  assert.equal(beingCalled({ name: "the re-sacking gang", kind: "person" }, { transcript: [] }), "the re-sacking gang");
  assert.equal(beingCalled({ name: "Old Bess", kind: "creature" }, { transcript: [] }), "the animal", "nothing said of what she is");
});
