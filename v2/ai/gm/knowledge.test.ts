// After the prototype's src/runtime/knowledge.test.ts at 44c6d4a: what the player knows is built from what they lived, never from the prep (V0's one scene has no earlier scenes or talks to add), and someone goes by what the player calls them until their name is heard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDocs } from "../docs/config.ts";
import { playerDoc } from "../docs/docs.ts";
import { hangedClerk, viewAt } from "./fixtures.ts";
import { knowledgeBrief, nameAsKnown } from "./knowledge.ts";

const overlays = mkdtempSync(join(tmpdir(), "km-knowledge-"));
configureDocs({ overlay: game => join(overlays, game) });
const scene = hangedClerk();

test("what the player knows is built from what they lived, never from the GM's prep, in the campaign's own world", () => {
  const state = { ...viewAt(scene), player: { name: "Wren Ashdown", concept: "a hedge wizard with a long memory.", modifiers: {} } };
  const before = knowledgeBrief(state, "Caerwyn");
  playerDoc(state.id, state.player);
  const brief = knowledgeBrief(state, "Caerwyn");

  assert.match(brief, /^## What the player knows\n/);
  assert.match(brief, /- Who they are: Wren Ashdown, a hedge wizard with a long memory\. Their own past, as your notes on the player character have it \(Player\/Wren Ashdown\.md\), is theirs/);
  assert.doesNotMatch(before, /Player\/Wren Ashdown\.md/, "the doc is named once it's there");
  assert.match(brief, /- The world: what anyone in Caerwyn knows/);
  assert.match(knowledgeBrief(state, "Kingsport"), /what anyone in Kingsport knows/);
  // Nothing behind the screen: no one's secrets, no earlier scenes, no talks.
  for (const c of scene.cast) for (const s of c.secrets ?? []) assert.ok(!brief.includes(s.slice(0, 40)), `a secret of ${c.id} is in it`);
  assert.doesNotMatch(brief, /Sallow|earlier in the story|between scenes/);
});

test("someone goes by what the player calls them until their name is said", () => {
  const state = viewAt(scene);
  assert.equal(nameAsKnown(scene, state, "cob"), "the boy in the too-big boots");
  assert.equal(nameAsKnown(scene, state, "kell"), "Sergeant Agnes Kell", "nobody calls Kell anything else");
  state.transcript.push({ turn: 1, speaker: "gm", kind: "narration", text: "“Cob! Down off that, now,” Kell says." });
  assert.equal(nameAsKnown(scene, state, "cob"), "Cob");
  assert.equal(nameAsKnown(scene, state, "hoist-beam"), "the hoist beam", "the place's own things by their names");
});
