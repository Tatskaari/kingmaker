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

test("a spectator is told who has the lead; a scene that's over says so, and one a reply has closed", () => {
  const watching = viewText({ ...YARD, mayType: false, watching: "Pell Marrow" });
  const over = viewText({ ...YARD, mayType: false, over: true });
  const ending = viewText({ ...YARD, phase: "settling", mayType: false, ending: true });

  assert.match(watching, /PHASE: done \(you're watching: Pell Marrow has the lead\)$/);
  assert.match(over, /PHASE: over \(the scene has ended: there's nothing more to say in it\)$/);
  assert.match(ending, /PHASE: settling \(the scene is ending: there's nothing more to say in it\)$/);
});
