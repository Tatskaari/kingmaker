import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { prepText } from "./prep.ts";
import { campaignAt, endingsOf, gradeOf, playable, sceneOf, skipOrder, type Loose } from "./scenes.ts";

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");

test("the campaign through the AI service's loader: the story's scenes in order, the interludes not to be played", async () => {
  const loaded = await campaignAt(CAERWYN);
  assert.deepEqual(loaded.keys, ["hanged-clerk", "caerwyn-afternoon", "drowned-rat", "wharf-night", "heron-warehouse", "kings-morning"]);
  assert.deepEqual(playable(loaded), ["hanged-clerk", "drowned-rat", "heron-warehouse", "kings-morning"]);
});

test("the hanged clerk's prep as the GM had it: the scene, the opening, every card with what each keeps back, the beats with their routes and checks, the essentials, the endings graded", async () => {
  const text = prepText(sceneOf(await campaignAt(CAERWYN), "hanged-clerk"));
  assert.match(text, /^# The prep: The Hanged Clerk\n\nA palace clerk hanged behind the granary/);
  assert.match(text, /\n## The scene\n\n\*\*Setting\.\*\* Mid-morning on the eve of the Centennial Assembly/);
  assert.match(text, /\n\*\*What the world can't offer here:\*\*\n- Getting someone to talk to the dead/);
  assert.match(text, /\n## The opening\n\nOpen on the yard: Prout turning slowly/);
  assert.match(text, /\n### Sergeant Agnes Kell \[kell\]\n- \*\*Look:\*\* Forties/);
  assert.match(text, /\n### Cob \[cob\]\nCalled “the boy in the too-big boots” until the player hears the name\./);
  assert.match(text, /\n### Corporal Abner Tull \[tull\]\nCalled “the corporal” until the player hears the name\. Arrives with \[dead-cart\]\. A group: /);
  assert.match(text, /\n- \*\*Keeps back:\*\*\n {2}- /);
  assert.match(text, /\n### \[yard\] Stones at a hanged man: where it starts\n/);
  assert.match(text, /\n- \[examine-body\] \(attempt\) Medicine DC 12, to tell how Prout really died: to \[doubt\] on a success, staying here on a failure\. When: The player examines Prout's neck/);
  assert.match(text, /\n {2}- On a success: They see what the noose didn't make/);
  assert.match(text, /\(brings the essential \[not-suicide\]; settles: Prout didn't hang himself/);
  assert.match(text, /\n## From any beat\n\n- \[make-case\] \(outcome\) to \[case-made\]\./);
  assert.match(text, /\n## What the player needs to come across\n\n- \[not-suicide\] Prout didn't hang himself/);
  assert.match(text, /\n### \[case-made\] The case is made \(good; progress; on to caerwyn-afternoon\)\n\n\*\*What's true\.\*\* /);
  assert.match(text, /\n### \[closed-suicide\] Filed as a suicide \(not graded; other; on to caerwyn-afternoon\)/);
  assert.doesNotMatch(text, /## More of the prep/, "every field of today's scenes has a part of its own");
});

/** A scene as the M2 format keeps it (docs/scene-format.md on the scenes' branch), as a loader might hand it on. */
const M2: Loose = {
  id: "the-yard", title: "The Yard", description: "A clerk hanged.", truth: "Sallow had him killed for the page.", clock: "The dead-cart at noon.",
  setting: "A cobbled yard.", premise: "Murder or suicide?",
  cast: [{ id: "cob", name: "Cob", called: "the boy", look: "Small.", voice: "Loud.", wants: "Boots.", whyHere: "His patch.", knows: ["The loft."], secrets: ["He heard it."], attitude: "Hostile.", limits: "Coin buys boasts.", roles: { characterise: "cocky", hooks: "the crackle in his boot" } }],
  nodes: [
    { id: "start", type: "story", data: { kind: "start", title: "Stones", description: "Open on the yard." } },
    { id: "murder", type: "story", data: { kind: "beat", title: "Murdered" } },
    { id: "murder-unknown", type: "story", data: { kind: "exit", title: "Murder by persons unknown", description: "On the books as murder.", closing: "Kell writes it.", result: "good", exitKind: "progress", next: "caerwyn-afternoon" } },
    { id: "failed", type: "story", data: { kind: "exit", title: "Failed", description: "Filed as suicide.", closing: "The cart.", result: "bad", exitKind: "other" } },
  ],
  beats: [{ id: "murder", title: "The victim was murdered", description: "Prout was killed.", revelation: "He didn't hang himself.", required: true, paths: [{ via: "the body", clue: "A level cord mark.", earn: "a close look", strength: "strong", check: { skill: "medicine", dc: 12 } }] }],
  edges: [{ id: "find-murder", source: "start", target: "murder", label: "Murder", data: { condition: "", phase: "outcome", skill: "", dc: 0 } }, { id: "signed", source: "start", target: "murder-unknown", label: "Signed", data: { condition: "Kell writes murder.", phase: "outcome", requires: ["murder"], skill: "", dc: 0 } }],
  facts: { "killed": "Prout was killed." },
  stakes: "The King's trust.",
};

test("a scene in the M2 format: its truth and clock, a discovery's revelation and paths, the people's roles, the routes, the graded endings, and prose it doesn't know by name", () => {
  const text = prepText(M2);
  assert.match(text, /\*\*What really happened \(never told outright: it comes out through the beats\)\.\*\* Sallow had him killed for the page\./);
  assert.match(text, /\*\*The clock\.\*\* The dead-cart at noon\./);
  assert.match(text, /\*\*Their part in the talk \(the co-GM's palette\):\*\* characterise: cocky; hooks: the crackle in his boot/);
  assert.match(text, /\*\*Why here:\*\* His patch\./);
  assert.match(text, /\*\*Never:\*\* Coin buys boasts\./);
  assert.match(text, /\*\*What the player can come to understand \(the scene can't end well without it\)\.\*\* He didn't hang himself\./);
  assert.match(text, /- via the body: A level cord mark\. Earned by: a close look\. As evidence: strong\. A check that suits it: Medicine DC 12\n/);
  assert.match(text, /\n## The routes\n\n- \[find-murder\] start → murder \(Murder\); on outcome\n- \[signed\] start → murder-unknown \(Signed\); on outcome; when Kell writes murder; needing first \[murder\]\n/);
  assert.match(text, /\n### \[murder-unknown\] Murder by persons unknown \(good; progress; on to caerwyn-afternoon\)\n\n\*\*What's true\.\*\* On the books as murder\.\n\n\*\*How to close it\.\*\* Kell writes it\./);
  assert.match(text, /\n### \[failed\] Failed \(bad; other; the story's end\)/);
  assert.match(text, /\n## Facts that can be settled\n\n- \[killed\] Prout was killed\./);
  assert.match(text, /\n## More of the prep\n\n\*\*stakes\.\*\* The King's trust\./);
});

test("endings: graded as the scene grades them, or by their kind before M2; ended for QA on the first good or mixed, a fight's last", async () => {
  assert.equal(gradeOf("mixed", "progress"), "mixed");
  assert.equal(gradeOf(undefined, "progress"), "good");
  assert.equal(gradeOf(undefined, "persuaded"), "good");
  assert.equal(gradeOf(undefined, "leave"), "bad");
  assert.equal(gradeOf(undefined, "other"), undefined);
  assert.deepEqual(endingsOf(M2), [
    { id: "murder-unknown", title: "Murder by persons unknown", grade: "good", kind: "progress", next: "caerwyn-afternoon" },
    { id: "failed", title: "Failed", grade: "bad", kind: "other" },
  ]);

  const loaded = await campaignAt(CAERWYN);
  assert.deepEqual(skipOrder(endingsOf(sceneOf(loaded, "hanged-clerk"))).map(e => e.id), ["case-made", "open-case", "wrong-man", "closed-suicide", "walked-away"]);
  assert.deepEqual(skipOrder(endingsOf(sceneOf(loaded, "heron-warehouse"))).map(e => e.id), ["proof-taken", "caught-in-the-act", "caught", "up-in-smoke", "barge-sails", "fight"]);
  const mixedFirst = skipOrder([{ id: "a", title: "A", grade: "bad" }, { id: "b", title: "B", kind: "combat" }, { id: "c", title: "C", grade: "mixed" }, { id: "d", title: "D", grade: "good" }]);
  assert.deepEqual(mixedFirst.map(e => e.id), ["c", "d", "a", "b"], "the first good or mixed in the scene's order, not the best");
});
