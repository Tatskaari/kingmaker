import assert from "node:assert/strict";
import { test } from "node:test";
import { YARD } from "../check/fixture.ts";
import { viewText } from "./text.ts";

test("the scene as text: the player's lines quoted, a reply's markup under it, the phase", () => {
  const text = viewText(YARD);
  assert.match(text, /^MODE: scene\n\n\[The Hanged Clerk, morning\] Here: Sergeant Agnes Kell, the boy in the too-big boots, the girl in the shawl\./);
  assert.match(text, /^> \*I put my hands up\* I'm not the watch\./m);
  assert.match(text, /⟨who says what: Sergeant Agnes Kell “You told the boy to show r…”⟩/);
  assert.match(text, /⟨you on “you're asking him for help”: You barked at him to stop throwing stones a minute ago\./);
  assert.match(text, /PHASE: done \(your turn: say what your character says or does\)$/);
});

test("while the GM has the floor, the draft so far and no turn for the player", () => {
  const text = viewText({ ...YARD, phase: "replying", mayType: false, draft: { speaker: "gm", kind: "narration", text: "Sergeant Kell glances up" } });
  assert.match(text, /\(The GM is still speaking: Sergeant Kell glances up…\)/);
  assert.match(text, /PHASE: replying \(the GM has the floor\)$/);
});
