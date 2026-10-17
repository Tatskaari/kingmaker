import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadScene } from "../scene/load.ts";
import { initialGm } from "./state.ts";
import { bandOf, defaultRole, openingRoles, rolesNote } from "./two-part.ts";

/** The two-part GM's shared bookkeeping (PR #666's two-part.test.ts, its first test as it was; the roles on the campaign's hanged clerk). */

const clerk = loadScene(readFileSync(join(import.meta.dirname, "..", "..", "campaigns", "caerwyn", "scenes", "hanged-clerk.kmscene"), "utf8"));

test("a roll lands in one of five outcomes by how far it made or missed its DC", () => {
  const at = (total: number, critical: "success" | "failure" | null = null) => bandOf({ total, dc: 13, critical });
  assert.equal(at(8), "major_failure");
  assert.equal(at(12), "minor_failure");
  assert.equal(at(13), "barely_passed");
  assert.equal(at(15), "barely_passed");
  assert.equal(at(16), "minor_success");
  assert.equal(at(20), "major_success");
  assert.equal(at(25, "failure"), "major_failure", "a natural 1 goes badly whatever the total");
  assert.equal(at(9, "success"), "major_success", "a natural 20 goes well whatever the total");
});

test("the roles as the scene opens: each person's start note, else their attitude; the note names them", () => {
  const gm = initialGm(clerk);
  const roles = openingRoles(clerk, gm, clerk.cast.filter(c => !c.enters));
  assert.deepEqual(Object.keys(roles), ["kell", "cob", "moll"]);
  assert.match(roles.cob!.conversation_role, /^Characterise: stones and cheek/);
  assert.deepEqual([roles.kell!.status, roles.kell!.mental_state], ["", ""]);
  const tull = clerk.cast.find(c => c.id === "tull")!;
  assert.equal(defaultRole(clerk, gm, tull).conversation_role, tull.attitude, "no note for him at the start: his attitude");
  assert.match(defaultRole(clerk, { ...gm, reached: ["start", "cart-arrives"], beat: "cart-arrives" }, tull).conversation_role, /^Helmet off to the dead/, "at the dead-cart, its note");

  const note = rolesNote(clerk, { ...roles, cob: { status: "On the water butt", mental_state: "", conversation_role: "Goes quiet." } }, -1);
  assert.match(note, /^Co-GM note, before turn 0\n\nCharacter role for Sergeant Agnes Kell:\nConversation role: Characterise: brief and dry/);
  assert.match(note, /Character role for Cob:\nStatus: On the water butt\nConversation role: Goes quiet\./);
});
