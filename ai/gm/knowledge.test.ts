// Copied from the prototype's src/runtime/knowledge.test.ts at 44c6d4a, but its tests of the marks' links and cards (the notes', gone in M2): the scenes come from the test story (fixtures.ts), the lore is the campaign's, a session is a TurnView, and the world whose common knowledge the player shares is named ("Caerwyn"). Then V0's: the brief in another campaign's world, and a name heard.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDocs } from "../docs/config.ts";
import { playerDoc } from "../docs/docs.ts";
import { CAERWYN, hangedClerk, sceneById, stateIn, viewAt } from "./fixtures.ts";
import { knowledgeBrief as briefIn, nameAsKnown, playerKnowledge } from "./knowledge.ts";
import type { TurnView } from "./view.ts";

const overlays = mkdtempSync(join(tmpdir(), "km-knowledge-"));
after(() => rmSync(overlays, { recursive: true, force: true }));
configureDocs({ loreRoot: join(CAERWYN, "lore"), overlay: game => join(overlays, game) });
const knowledgeBrief = (state: TurnView) => briefIn(state, "Caerwyn");

/** A session in a scene, some way in: the player's own turns, and what earlier scenes and talks left them. */
function session(sceneId: string, extra: Partial<TurnView> = {}): TurnView {
  const scene = sceneById(sceneId);
  return stateIn(sceneId, {
    id: `knowledge-${sceneId}`,
    player: { name: "Wren Ashdown", concept: "a hedge wizard with a long memory", modifiers: {} },
    turn: 2, beat: scene.start, turnsInBeat: 1, ...extra,
  });
}

test("what the player knows is built from what they lived, never from the GM's prep", () => {
  const state = session("hanged-clerk", {
    history: [{ sceneId: "zoo-pie-stall", exitId: "bargain", summary: "The visitor talked the pie-seller down to tuppence, and she'll remember.", journal: ["Talked the pie-seller down to tuppence. She'll remember."] }],
    talks: { kell: { count: 1, told: [{ note: "Cast/Sergeant Agnes Kell/knowledge/Brother.md", topic: "her brother on the barges", turn: 3 }] } },
  });
  const brief = knowledgeBrief(state);
  assert.match(brief, /Wren Ashdown, a hedge wizard with a long memory/);
  assert.match(brief, /The Last Pie: A bargain\. Their notebook: "Talked the pie-seller down to tuppence\. She'll remember\."/);
  assert.match(brief, /Sergeant Agnes Kell, her brother on the barges/);
  // Nothing behind the screen: no one's secrets, no scene's hand-off summary (the GM's), no truth.
  for (const c of sceneById("hanged-clerk").cast) for (const s of c.secrets ?? []) assert.ok(!brief.includes(s.slice(0, 40)), `a secret of ${c.id} is in it`);
  assert.ok(!brief.includes("she'll remember."), "the hand-off is the GM's, not the player's");
  assert.doesNotMatch(brief, /Sallow|truth/);
  assert.deepEqual(playerKnowledge(state).scenes.map(s => s.id), ["zoo-pie-stall"]);
});

test("a talk's untold stories and a scene's secrets never reach what the player knows", () => {
  // Kell keeps back what she hasn't told: only what she told is in it.
  const state = session("hanged-clerk", { talks: { kell: { count: 2, told: [] } } });
  assert.doesNotMatch(knowledgeBrief(state), /What people have told them/);
});

// --- V0's: the campaign's own world, and a name heard.

test("what the player knows is built from what they lived, never from the GM's prep, in the campaign's own world", () => {
  const scene = hangedClerk();
  const state = { ...viewAt(scene), player: { name: "Wren Ashdown", concept: "a hedge wizard with a long memory.", modifiers: {} } };
  const before = briefIn(state, "Caerwyn");
  playerDoc(state.id, state.player);
  const brief = briefIn(state, "Caerwyn");

  assert.match(brief, /^## What the player knows\n/);
  assert.match(brief, /- Who they are: Wren Ashdown, a hedge wizard with a long memory\. Their own past, as your notes on the player character have it \(Player\/Wren Ashdown\.md\), is theirs/);
  assert.doesNotMatch(before, /Player\/Wren Ashdown\.md/, "the doc is named once it's there");
  assert.match(brief, /- The world: what anyone in Caerwyn knows/);
  assert.match(briefIn(state, "Kingsport"), /what anyone in Kingsport knows/);
  // Nothing behind the screen: no one's secrets, no earlier scenes, no talks.
  for (const c of scene.cast) for (const s of c.secrets ?? []) assert.ok(!brief.includes(s.slice(0, 40)), `a secret of ${c.id} is in it`);
  assert.doesNotMatch(brief, /Sallow|earlier in the story|between scenes/);
});

test("someone goes by what the player calls them until their name is said", () => {
  const scene = hangedClerk();
  const state = viewAt(scene);
  assert.equal(nameAsKnown(scene, state, "cob"), "the boy in the too-big boots");
  assert.equal(nameAsKnown(scene, state, "kell"), "Sergeant Agnes Kell", "nobody calls Kell anything else");
  state.transcript.push({ turn: 1, speaker: "gm", kind: "narration", text: "“Cob! Down off that, now,” Kell says." });
  assert.equal(nameAsKnown(scene, state, "cob"), "Cob");
  assert.equal(nameAsKnown(scene, state, "hoist-beam"), "the hoist beam", "the place's own things by their names");
});

