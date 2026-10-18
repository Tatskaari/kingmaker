// Copied from the prototype's src/runtime/knowledge.test.ts at 44c6d4a, whole: the scenes come from the test story (fixtures.ts), the lore is the campaign's, a session is a TurnView, and the world whose common knowledge the player shares is named ("Caerwyn"). Then V0's: the brief in another campaign's world, and a name heard.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDocs } from "../docs/config.ts";
import { playerDoc, writeDoc } from "../docs/docs.ts";
import { CAERWYN, hangedClerk, sceneById, stateIn, viewAt } from "./fixtures.ts";
import { knowledgeBrief as briefIn, knowledgeCard as cardIn, linkMarks, nameAsKnown, playerKnowledge, unheardNames } from "./knowledge.ts";
import { parseMarkup } from "./markup.ts";
import type { TurnView } from "./view.ts";
import type { MarkLink } from "../../shared/markup.ts";

const overlays = mkdtempSync(join(tmpdir(), "km-knowledge-"));
after(() => rmSync(overlays, { recursive: true, force: true }));
configureDocs({ loreRoot: join(CAERWYN, "lore"), overlay: game => join(overlays, game) });
const knowledgeBrief = (state: TurnView) => briefIn(state, "Caerwyn");
const knowledgeCard = (state: TurnView, link: MarkLink) => cardIn(state, link, "Caerwyn");

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

test("a note's names: who the player hasn't heard named goes by what they'd call them", () => {
  const state = session("zoo-pie-stall", { transcript: [{ turn: 1, scene: "zoo-pie-stall", speaker: "player", kind: "player", text: "Two pies, please." }] });
  const scene = sceneById("zoo-pie-stall");
  const parsed = parseMarkup("(She folds her arms)[why: Madam Crust doesn't give credit; Crust reads the list out at Midwinter.] and waits.");
  const out = unheardNames(parsed, scene, state);
  assert.equal(out.marks[0]!.note, "The pie-seller doesn't give credit; the pie-seller reads the list out at Midwinter.");
  assert.equal(nameAsKnown(scene, state, "crust"), "the pie-seller");
  // Once her name's been said, it's her name.
  state.transcript.push({ turn: 1, scene: "zoo-pie-stall", speaker: "gm", kind: "narration", text: "“Madam Crust, my lamb, and don't you forget it.”" });
  assert.equal(unheardNames(parsed, scene, state).marks[0]!.note, parsed.marks[0]!.note);
});

test("a mark links to what the player knows: their own turn, someone they know, a place anyone could read about", () => {
  const state = session("zoo-ferry", {
    transcript: [
      { turn: 1, scene: "zoo-ferry", speaker: "player", kind: "player", text: "*steps round the eel-wife* Not now, you old trout. Ferryman! Take me across." },
      { turn: 2, scene: "zoo-ferry", speaker: "player", kind: "player", text: "Sergeant Kell of the watch sent me." },
    ],
  });
  const scene = sceneById("zoo-ferry");
  const parsed = parseMarkup([
    "[Dab] “No.” He doesn't look up: (you called his mother a trout)[you: You called the eel-wife an old trout on your way past her.].",
    "(The watch)[why: On the river stairs, the watch has never once come down for a gentleman, and nobody carries in its name.] gets you nothing here.",
    "Everyone knows (the river stairs)[know: The steps down the bank from the quay to the wharves, the river watch's patch.].",
  ].join(" "));
  const { marks } = linkMarks(parsed, parsed.text, scene, state);
  assert.deepEqual(marks[0]!.link, { kind: "deed", scene: "zoo-ferry", turn: 1 });
  assert.deepEqual(marks[2]!.link, { kind: "lore", path: "Places/River Stairs.md" });
  assert.deepEqual(marks[1]!.link, { kind: "lore", path: "World/City Watch.md" }, "in this scene, the watch is the City Watch");
});

test("a popover's card shows only what the player knows: never a GM-only doc, never an unheard name", () => {
  const state = session("hanged-clerk", { transcript: [{ turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "Who found him?" }] });
  const place = knowledgeCard(state, { kind: "lore", path: "Places/Granary Yard.md" });
  assert.match(place?.title ?? "", /granary yard/i);
  assert.equal(knowledgeCard(state, { kind: "lore", path: "Places/Granary Yard (truth).md" }), undefined, "the truth is the GM's");
  assert.equal(knowledgeCard(state, { kind: "lore", path: "World/Fronts.md" }), undefined, "what's in motion is the GM's");
  // Cob is "the boy in the too-big boots" until someone says his name, and his card shows nothing of his lore.
  const cob = knowledgeCard(state, { kind: "person", id: "cob" });
  assert.match(cob?.title ?? "", /^The boy in the too-big boots/);
  assert.ok(!cob?.lines.join(" ").includes("Cob"));
  const deed = knowledgeCard(state, { kind: "deed", scene: "hanged-clerk", turn: 1 });
  assert.deepEqual(deed, { title: "What you did", lines: ["In this scene, turn 1:", "“Who found him?”"] });
});

test("a lore card says what its doc says first, for a reader, and no name the player hasn't heard", () => {
  const state = session("drowned-rat");
  const watch = knowledgeCard(state, { kind: "lore", path: "World/City Watch.md" });
  assert.match(watch?.lines[0] ?? "", /^The watch keeps the King's peace in Caerwyn's streets/);
  assert.ok((watch?.lines[0]?.length ?? 0) <= 240, "a sentence or two, not the retrieval summary");
  // A place whose lore names the landlady before the player has heard of her: she's the landlady.
  writeDoc(state.id, { path: "Places/The Back Steps.md", meta: { visibility: "public", type: "place", summary: "x" }, body: "# The back steps\n\nWhere Nan Quill keeps her empties, and Mrs Quill's cat." });
  const steps = knowledgeCard(state, { kind: "lore", path: "Places/The Back Steps.md" });
  assert.equal(steps?.lines[0], "Where the landlady keeps her empties, and the landlady's cat.");
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

test("a lore card speaks of the campaign's own world", () => {
  const state = session("hanged-clerk");
  assert.equal(cardIn(state, { kind: "lore", path: "Places/Granary Yard.md" }, "Kingsport")?.lines.at(-1), "What anyone in Kingsport could tell you.");
});
