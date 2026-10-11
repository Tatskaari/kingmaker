import assert from "node:assert/strict";
import test from "node:test";
import { scoreDialogueLocation } from "../packages/evals/src/dialogue-locations-experiment.js";

test("dialogue location grading accepts the authored and map room names", () => {
  assert.equal(scoreDialogueLocation("Holt is in the Entrance Hall.").score, 1);
  assert.equal(scoreDialogueLocation("Try the palace service entrance, mate.").score, 1);
  assert.equal(scoreDialogueLocation("No idea where he is.").score, 0);
});
