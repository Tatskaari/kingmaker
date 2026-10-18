import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { isDiscovery, isEvent } from "../../shared/scene/beats.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { prepText } from "./prep.ts";
import { campaignAt, endingsOf, gradeOf, playable, sceneOf, skipOrder } from "./scenes.ts";

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const loaded = campaignAt(CAERWYN);

test("the campaign through the AI service's loader: the story's scenes in order, the interludes not to be played", async () => {
  const campaign = await loaded;
  assert.deepEqual(campaign.keys, ["hanged-clerk", "caerwyn-afternoon", "drowned-rat", "wharf-night", "heron-warehouse", "kings-morning"]);
  assert.deepEqual(playable(campaign), ["hanged-clerk", "drowned-rat", "heron-warehouse", "kings-morning"]);
});

test("the hanged clerk's prep as the GM had it: the truth, where it starts, the cards with why they're here, their limits and roles, the discoveries with their paths, the event with its cue, the endings with their result and what their routes need", async () => {
  const text = prepText(sceneOf(await loaded, "hanged-clerk"));
  assert.match(text, /^# The prep: The Hanged Clerk\n\nA palace clerk hanged behind the granary/);
  assert.match(text, /\n## The scene\n\n\*\*Setting\.\*\* Mid-morning on the eve of the Centennial Assembly/);
  assert.match(text, /\n\*\*What really happened \(never told outright: it comes out through the discoveries' paths\)\.\*\* Prout found that King's Road grain wagons/);
  assert.match(text, /\n\*\*The clock\.\*\* The dead-cart is due at the noon bell\./);
  assert.match(text, /\n\*\*What the world can't offer here:\*\*\n- Getting someone to talk to the dead/);

  assert.match(text, /\n## Where it starts: Stones at a hanged man \[start\]\n\nThis scene introduces the story\./);
  assert.match(text, /\n\*\*Each person's part as the scene opens \(the co-GM's first roles\):\*\*\n- Cob \[cob\]: Characterise: stones and cheek\./);
  assert.equal(text.match(/An opening image to use or adapt/g)?.length, 1, "the opening once, as where it starts");

  assert.match(text, /\n### Sergeant Agnes Kell \[kell\]\n- \*\*Look:\*\* Forties/);
  assert.match(text, /\n- \*\*Why they're here, now:\*\* Lent to the King's investigator this morning by the Captain/);
  assert.match(text, /\n- \*\*What never works on them, and what they never do:\*\* She never solves it for the investigator/);
  assert.match(text, /\n- \*\*Their role palette \(the co-GM's\):\*\*\n {2}- How they're characterised: Very still, watching hands\.[^\n]*\n {2}- The inconsistency that invites a question: /);
  assert.match(text, /\n### Cob \[cob\]\nCalled “the boy in the too-big boots” until the player hears the name\./);
  assert.match(text, /\n### Corporal Abner Tull \[tull\]\nCalled “the corporal” until the player hears the name\. Not here as it opens: arrives with The dead-cart arrives \[cart-arrives\]\. A group: /);
  assert.match(text, /\n- \*\*Keeps back:\*\*\n {2}- /);

  assert.match(text, /\n## The discoveries\n\nWhat the player can come to understand here, in any order/);
  assert.match(text, /\n### The victim was murdered \[murder\]\n\n\*\*The revelation\.\*\* Prout didn't hang himself: he was struck and strangled/);
  assert.match(text, /\n- Via the body \(suggestive\): Prout hangs in his stockings: .* A check that suits it: Perception DC 12\.\n/);
  assert.match(text, /\n- Via Cob \[cob\] \(proof\): Sewn into the lining of the left boot Cob is wearing is the page/);
  assert.match(text, /\n### Hobb was spotted at the scene \[hobb\] \(required: the scene can't end well without it\)\n/);
  assert.match(text, /\n\*\*The story needs it later\.\*\* it opens up the Drowned Rat: someone to find and question/);
  assert.match(text, /\n\*\*Settles:\*\*\n- \[killed-not-suicide\] Prout didn't hang himself/);
  assert.match(text, /\n\*\*Routes into it:\*\*\n- \[find-murder\] from Stones at a hanged man \[start\] to The victim was murdered \[murder\]\. When: its revelation has landed with the player\n/);

  assert.match(text, /\n## The events\n\n.*\n\n### The dead-cart arrives \[cart-arrives\]\n\nCorporal Tull arrives with the dead-cart/);
  assert.match(text, /\n\*\*If it stalls here\.\*\* Tull's constables start getting Prout down/);
  assert.match(text, /\n\*\*Who arrives:\*\* Corporal Abner Tull \[tull\]\n/);
  assert.match(text, /\n\*\*Each person's part while the scene is here \(the co-GM's suggested roles\):\*\*\n- Corporal Abner Tull \[tull\]: Helmet off to the dead/);
  assert.match(text, /\n- \[cart-comes\] from Stones at a hanged man \[start\] to The dead-cart arrives \[cart-arrives\]; a cue: bring it about when its moment comes\. When: Once the player has the Hobb lead/);

  assert.match(text, /\n### Murder by persons unknown \[murder-unknown\] \(a good ending; progress; on to caerwyn-afternoon\)\n\n\*\*What's true\.\*\* Kell signs Prout in as a murder/);
  assert.match(text, /\n\*\*How to close it\.\*\* Kell writes one line and underlines it twice/);
  assert.match(text, /\n- \[signed-murder\] from The dead-cart arrives \[cart-arrives\] to Murder by persons unknown \[murder-unknown\], once The victim was murdered \[murder\] and Hobb was spotted at the scene \[hobb\] are reached\. When: Kell signs Prout in/);
  assert.match(text, /\n### Suicide, under suspicious circumstances \[suspicious\] \(a mixed ending; progress; on to caerwyn-afternoon\)/);
  assert.match(text, /\n### Failed \[failed\] \(a bad ending; other; the story's end\)/);
  assert.match(text, /\n## Facts that can be settled\n\n- \[killed-not-suicide\] /);
  assert.doesNotMatch(text, /## More of the prep/, "every field of the scene has a part of its own, or isn't prep");
});

test("every scene of the story: its truth, each discovery, event and ending once, and every route once, under where it goes; a dice route with its check", async () => {
  const campaign = await loaded;
  for (const key of playable(campaign)) {
    const scene = sceneOf(campaign, key);
    const text = prepText(scene);
    assert.ok(scene.truth && text.includes(scene.truth), `${key}: its truth`);
    for (const b of scene.beats.filter(isDiscovery)) assert.equal(text.split(`\n### ${b.title} [${b.id}]`).length, 2, `${key}: the discovery ${b.id}, once`);
    for (const b of scene.beats.filter(b => isEvent(scene, b))) assert.equal(text.split(`\n### ${b.title} [${b.id}]`).length, 2, `${key}: the event ${b.id}, once`);
    for (const e of scene.exits) assert.match(text, new RegExp(`\\n### [^\\n]* \\[${e.id}\\] \\(a ${e.result} ending; ${e.kind}; `), `${key}: the ending ${e.id}, with its result`);
    for (const r of scene.routes) assert.equal(text.split(`\n- [${r.id}] from `).length, 2, `${key}: the route ${r.id}, once`);
    assert.doesNotMatch(text, /## More of the prep/, key);
  }
  const rat = prepText(sceneOf(campaign, "drowned-rat"));
  assert.match(rat, /\n- \[catch-him\] from Out of his chair \[hobb-bolts\] to I only held the rope \[hobb-talking\]; the dice decide \(Athletics DC 13\): a success takes it, a failure leaves the scene where it is\. When: /);
});

test("prose the scene has that no part shows is put at the end under its own name", async () => {
  const scene = { ...sceneOf(await loaded, "hanged-clerk"), stakes: "The King's trust." } as Scene;
  assert.match(prepText(scene), /\n## More of the prep\n\n\*\*stakes\.\*\* The King's trust\.$/);
});

test("endings: graded by their result; ended for QA on the first good or mixed, a fight's last", async () => {
  const campaign = await loaded;
  assert.equal(gradeOf("mixed"), "mixed");
  assert.equal(gradeOf(undefined), undefined);
  assert.equal(gradeOf("progress"), undefined, "a kind isn't a grade");
  assert.deepEqual(endingsOf(sceneOf(campaign, "hanged-clerk")), [
    { id: "murder-unknown", title: "Murder by persons unknown", grade: "good", kind: "progress", next: "caerwyn-afternoon" },
    { id: "suspicious", title: "Suicide, under suspicious circumstances", grade: "mixed", kind: "progress", next: "caerwyn-afternoon" },
    { id: "failed", title: "Failed", grade: "bad", kind: "other" },
  ]);

  assert.deepEqual(skipOrder(endingsOf(sceneOf(campaign, "hanged-clerk"))).map(e => e.id), ["murder-unknown", "suspicious", "failed"]);
  assert.deepEqual(skipOrder(endingsOf(sceneOf(campaign, "drowned-rat"))).map(e => e.id)[0], "hobb-talks");
  assert.deepEqual(skipOrder(endingsOf(sceneOf(campaign, "heron-warehouse"))).map(e => e.id), ["proof-taken", "caught-in-the-act", "caught", "barge-sails", "up-in-smoke", "fight"], "the fight, a mixed ending, last");
  const mixedFirst = skipOrder([{ id: "a", title: "A", grade: "bad" }, { id: "b", title: "B", grade: "good", kind: "combat" }, { id: "c", title: "C", grade: "mixed" }, { id: "d", title: "D", grade: "good" }]);
  assert.deepEqual(mixedFirst.map(e => e.id), ["c", "d", "a", "b"], "the first good or mixed in the scene's order, not the best");
});
