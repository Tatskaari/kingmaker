import assert from "node:assert/strict";
import { test } from "node:test";
import { YARD } from "../check/fixture.ts";
import { viewText } from "./text.ts";

test("the scene as text: the player's lines quoted, a reply's markup under it (who says what: the notes on marks went in M2), the phase", () => {
  const text = viewText(YARD);

  assert.match(text, /^MODE: scene\n\n\[The Hanged Clerk, morning\] Here: Sergeant Agnes Kell, the boy in the too-big boots, the girl in the shawl\.\n\nThis morning a palace clerk, Wendell Prout, was found hanged .* So, by the sound of it, are some children\.\n\n/);
  assert.match(text, /^> \*I put my hands up\* I'm not the watch\./m);
  assert.match(text, /⟨who says what: Sergeant Agnes Kell “You told the boy to show r…”⟩/);
  assert.doesNotMatch(text, /⟨(?:why|know|you) on|⟨card:/);
  assert.match(text, /PHASE: done \(your turn: say what your character says or does\)$/);
});

test("while the GM has the floor, the draft so far and no turn for the player", () => {
  const text = viewText({ ...YARD, phase: "replying", mayType: false, draft: { speaker: "gm", kind: "narration", text: "Sergeant Kell glances up", attempt: 1, seq: 4 } });

  assert.match(text, /\(The GM is still speaking: Sergeant Kell glances up…\)/);
  assert.match(text, /PHASE: replying \(the GM has the floor\)$/);
});

test("while the GM considers a risky act before the reply: PHASE: considering, and the GM has the floor", () => {
  const text = viewText({ ...YARD, entries: [...YARD.entries, { turn: 3, speaker: "player:1", kind: "player", text: "(I lift the paper from his boot)" }], phase: "considering", turn: 3, mayType: false });

  assert.match(text, /> \(I lift the paper from his boot\)\n\nPHASE: considering \(the GM has the floor\)$/);
});

test("a turn waiting on the AI service says so; a failed one says why and what to do", () => {
  const waiting = viewText({ ...YARD, phase: "replying", mayType: false, note: "The GM has lost the thread for a moment: trying again." });
  const failed = viewText({ ...YARD, phase: "failed", mayType: false, failed: "The GM couldn't answer: 500 model_failed" });

  assert.match(waiting, /\n\nThe GM has lost the thread for a moment: trying again\.\n\nPHASE: replying/);
  assert.match(failed, /PHASE: failed \(The GM couldn't answer: 500 model_failed\)\. Use: retry$/);
});

test("a spectator is told who has the lead; a scene that's over says so, and one a reply has closed", () => {
  const watching = viewText({ ...YARD, mayType: false, watching: "Pell Marrow" });
  const over = viewText({ ...YARD, mayType: false, over: true });
  const ending = viewText({ ...YARD, phase: "settling", mayType: false, ending: true });

  assert.match(watching, /PHASE: done \(you're watching: Pell Marrow has the lead\)$/);
  assert.match(over, /PHASE: over \(the scene has ended: there's nothing more to say in it\)$/);
  assert.match(ending, /PHASE: settling \(the scene is ending: there's nothing more to say in it\)$/);
});

test("the lines suggested, as the agent picks them: ACTIONS: before the phase, an id each; none, no ACTIONS:", () => {
  const lines = [{ kind: "say" as const, text: "Who found him?" }, { kind: "try" as const, text: "(I try a ha'penny on the boy)" }];
  const text = viewText({ ...YARD, suggestions: lines });

  assert.match(text, /\n\nACTIONS:\n- say_1: Who found him\?\n- say_2: \(I try a ha'penny on the boy\)\n\nPHASE: done/);
  assert.doesNotMatch(viewText(YARD), /ACTIONS:/);
});

test("who says what in a reply (the cast by the names the player knows, a voice nobody can place)", () => {
  const text = viewText(YARD);

  assert.match(text, /⟨who says what: the boy in the too-big boots “He's not bothered\.”; the boy in the too-big boots “And you're not my da\.”; nobody can tell “Leave the lad alone!”; the girl in the shawl “Leave him be\. He don't tal…”⟩/);
});
