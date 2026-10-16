import assert from "node:assert/strict";
import { test } from "node:test";
import { YARD } from "../check/fixture.ts";
import { viewText } from "./text.ts";

test("the scene as text: the player's lines quoted, a reply's markup under it, the phase", () => {
  const text = viewText(YARD);

  assert.match(text, /^MODE: scene\n\n\[The Hanged Clerk, morning\] Here: Sergeant Agnes Kell, the boy in the too-big boots, the girl in the shawl\.\n\nThis morning a palace clerk, Wendell Prout, was found hanged .* So, by the sound of it, are some children\.\n\n/);
  assert.match(text, /^> \*I put my hands up\* I'm not the watch\./m);
  assert.match(text, /⟨who says what: Sergeant Agnes Kell “You told the boy to show r…”⟩/);
  assert.match(text, /⟨you on “you're asking him for help”: You barked at him to stop throwing stones a minute ago\./);
  assert.match(text, /PHASE: done \(your turn: say what your character says or does\)$/);
});

test("while the GM has the floor, the draft so far and no turn for the player", () => {
  const text = viewText({ ...YARD, phase: "replying", mayType: false, draft: { speaker: "gm", kind: "narration", text: "Sergeant Kell glances up", attempt: 1, seq: 4 } });

  assert.match(text, /\(The GM is still speaking: Sergeant Kell glances up…\)/);
  assert.match(text, /PHASE: replying \(the GM has the floor\)$/);
});

test("a turn waiting on the AI service says so; a failed one says why and what to do", () => {
  const waiting = viewText({ ...YARD, phase: "replying", mayType: false, note: "The GM has lost the thread for a moment: trying again." });
  const failed = viewText({ ...YARD, phase: "failed", mayType: false, failed: "The GM couldn't answer: 500 model_failed" });

  assert.match(waiting, /\n\nThe GM has lost the thread for a moment: trying again\.\n\nPHASE: replying/);
  assert.match(failed, /PHASE: failed \(The GM couldn't answer: 500 model_failed\)\. Use: retry$/);
});

test("a spectator is told who has the lead; a scene that's over says so", () => {
  const watching = viewText({ ...YARD, mayType: false, watching: "Pell Marrow" });
  const over = viewText({ ...YARD, mayType: false, over: true });

  assert.match(watching, /PHASE: done \(you're watching: Pell Marrow has the lead\)$/);
  assert.match(over, /PHASE: over \(the scene has ended: there's nothing more to say in it\)$/);
});

test("the lines suggested, as the agent picks them: ACTIONS: before the phase, an id each; none, no ACTIONS:", () => {
  const lines = [{ kind: "say" as const, text: "Who found him?" }, { kind: "try" as const, text: "(I try a ha'penny on the boy)" }];
  const text = viewText({ ...YARD, suggestions: lines });

  assert.match(text, /\n\nACTIONS:\n- say_1: Who found him\?\n- say_2: \(I try a ha'penny on the boy\)\n\nPHASE: done/);
  assert.doesNotMatch(viewText(YARD), /ACTIONS:/);
});

test("each note with what it's linked to, and the card its popover shows under it", () => {
  const text = viewText(YARD);

  assert.match(text, /^ {2}⟨why on “He don't talk to the watch's friends”: You came in with Sergeant Kell, .* every time\. \(who: Sergeant Agnes Kell\)⟩\n {4}⟨card: Sergeant Agnes Kell · A sergeant of the Caerwyn city watch, out of the watch house by the granary quarter\. · You met them in this scene\. · Last said to you \(turn 0\): “Investigator\.”⟩$/m);
  assert.match(text, /^ {2}⟨you on “you're asking him for help”: You barked at him .* \(what you did, turn 1\)⟩\n {4}⟨card: What you did · In this scene, turn 1: · “Boy! Stop that\. Show some respect for the dead\.”⟩$/m);
  // A mark with no link has no card to show.
  assert.match(viewText({ ...YARD, entries: YARD.entries.slice(0, 1) }), /⟨know on “the King's Granary”: The King's Granary feeds the palace; .*⟩\n\nPHASE:/);
});

test("who says what in a reply (the cast by the names the player knows, a voice nobody can place), and a lore link by its doc's name", () => {
  const text = viewText(YARD);

  assert.match(text, /⟨who says what: the boy in the too-big boots “He's not bothered\.”; the boy in the too-big boots “And you're not my da\.”; nobody can tell “Leave the lad alone!”; the girl in the shawl “Leave him be\. He don't tal…”⟩/);
  const lore = { ...YARD, entries: [{ turn: 3, speaker: "gm", kind: "narration" as const, text: "The watch came.", markup: { speech: [], marks: [{ start: 4, end: 9, kind: "know" as const, note: "They keep a house on the corner.", link: { kind: "lore" as const, path: "World/City Watch.md" } }] } }] };
  assert.match(viewText(lore), /⟨know on “watch”: They keep a house on the corner\. \(lore: City Watch\)⟩/);
});
