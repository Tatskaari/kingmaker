import { test } from "node:test";
import assert from "node:assert/strict";
import type { FightNewcomer } from "../../shared/protocol/ai.ts";
import { withoutComers } from "./sides.ts";

/**
 * The sides' narration (sides.ts): whoever's coming later is the board's surprise, so a sentence that
 * names one of them goes, whatever the model wrote (smoke5-1018, smoke6-1018).
 */

const COMING: FightNewcomer[] = [
  { id: "porters", name: "the granary porters", about: "", coming: { after: 2, why: "The shouting carries round to the loading dock." } },
  { id: "wat", name: "Old Wat", called: "the old porter", about: "", coming: { after: 2, why: "Old Wat comes in with the porters." } },
  { id: "moll", name: "Moll", called: "the girl in the shawl", about: "" },
];

test("a sentence naming someone still to come goes (by name, by what they're called, by a group's plural); the rest stays as it was", () => {
  assert.equal(
    withoutComers("Kell squares up to you, truncheon raised. Cob bolts for the gap behind the water butt. At the far gate, the porters will come in at the shouting and take the Sarge’s side; the old porter will be among them.", COMING),
    "Kell squares up to you, truncheon raised. Cob bolts for the gap behind the water butt.",
  );
  assert.equal(withoutComers("Kell squares up. “Wat! Get the lads!” she bellows.", COMING), "Kell squares up.");
  assert.equal(withoutComers("The girl in the shawl drops from the wall and runs.", COMING), "The girl in the shawl drops from the wall and runs.", "someone here is told of");
  assert.equal(withoutComers("Kell squares up.", COMING.filter(p => !p.coming)), "Kell squares up.", "nobody coming, nothing to drop");
});
