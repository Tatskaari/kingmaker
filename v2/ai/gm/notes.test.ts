// Copied from the prototype's src/runtime/notes.test.ts at 44c6d4a, whole: the scenes come from the test story (fixtures.ts), the lore is the campaign's, and a session is a TurnView.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDocs } from "../docs/config.ts";
import { listDocs, readDoc } from "../docs/docs.ts";
import { knownCast, nameTokens } from "../../shared/scene/names.ts";
import { CAERWYN, sceneById, stateIn } from "./fixtures.ts";
import { parseMarkup, withSpeakers } from "./markup.ts";
import { speakersOf } from "./knowledge.ts";
import { forReaders, notesInput, placeNotes, storyWords, type Drafted, type Written } from "./notes.ts";
import type { TurnView, ViewEntry } from "./view.ts";

const overlays = mkdtempSync(join(tmpdir(), "km-notes-"));
after(() => rmSync(overlays, { recursive: true, force: true }));
configureDocs({ loreRoot: join(CAERWYN, "lore"), overlay: game => join(overlays, game) });

/** A session some way into a scene: the player's turns and the GM's replies as they were shown. */
function session(sceneId: string, transcript: Array<[kind: "player" | "narration", text: string]>, extra: Partial<TurnView> = {}): TurnView {
  const scene = sceneById(sceneId);
  return stateIn(sceneId, {
    id: `notes-${sceneId}`,
    player: { name: "Wren Ashdown", concept: "a quick-witted half-elf ranger with a longbow", modifiers: {} },
    turn: transcript.filter(([k]) => k === "player").length, beat: scene.start, turnsInBeat: 1,
    transcript: transcript.map(([kind, text], i): ViewEntry => ({ turn: transcript.slice(0, i + 1).filter(([k]) => k === "player").length, scene: sceneId, speaker: kind === "player" ? "player" : "gm", kind, text })),
    ...extra,
  });
}

/** A distinctive stretch of words from some text (forty characters of its first long line). */
const snippet = (text: string) => text.split("\n").map(l => l.replace(/^[-*#>\s]+/, "").trim()).find(l => l.length > 50)?.slice(0, 40);

test("the notes' writer is told only what the player knows: no one's secrets, no GM or private doc, no name they haven't heard", () => {
  for (const [sceneId, said] of [
    ["hanged-clerk", ["Boy! Stop that. Show some respect for the dead.", "*I look up at the body* Who found him?"]],
    ["drowned-rat", ["We're with the watch, landlady. We need a word with the porters.", "*walks to the fireside corner* You. Big fellow. Let's see that hand."]],
  ] as const) {
    const scene = sceneById(sceneId);
    const state = session(sceneId, [["narration", "The yard smells of wet grain. A boy throws stones; a girl in a shawl watches from the wall."], ["player", said[0]], ["narration", "“Not a chance,” says the landlady, and the boy runs."], ["player", said[1]]]);
    const reply = parseMarkup("[the landlady] “(Rule four)[why: You came in the watch's name.], my duck.” She folds her arms.");
    const { input } = notesInput(scene, state, { text: reply.text, speech: reply.speech, drafted: reply.marks }, state.transcript);
    const told = input.map(m => m.content).join("\n");
    // The GM's own notes never go in: only where it marked, and what kind.
    assert.doesNotMatch(told, /You came in the watch's name/);
    assert.match(told, /M1 \(why\) on «Rule four»/);
    // Nothing of the prep: what people want, fear, know and hide, the beats, what the scene needs found.
    for (const c of scene.cast) for (const s of [...(c.secrets ?? []), ...c.knows, c.wants, c.fears ?? "", c.attitude]) if (s.length > 40) assert.ok(!told.includes(s.slice(0, 40)), `${sceneId}: something of ${c.id}'s prep is in it: ${s.slice(0, 40)}`);
    for (const b of scene.beats) assert.ok(!told.includes(b.direction.slice(0, 40)), `${sceneId}: the beat ${b.id}'s direction is in it`);
    for (const e of scene.essentials ?? []) assert.ok(!told.includes(e.what.slice(0, 40)), `${sceneId}: the essential ${e.id} is in it`);
    // No doc that isn't public (but for words a public one says too).
    const docs = listDocs(state.id).map(p => readDoc(state.id, p)).filter(d => !!d);
    const open = docs.filter(d => d.meta.visibility === "public").map(d => d.body).join("\n");
    for (const doc of docs.filter(d => d.meta.visibility !== "public")) {
      for (const line of doc.body.split("\n")) {
        const words = snippet(line);
        if (words && !open.includes(words)) assert.ok(!told.includes(words), `${sceneId}: ${doc.path} (${doc.meta.visibility}) is in it: ${words}`);
      }
    }
    // Nobody by a name the player hasn't heard.
    const known = knownCast(scene, state);
    for (const c of scene.cast.filter(x => x.called && !known.has(x.id))) for (const t of nameTokens(c)) assert.doesNotMatch(told, new RegExp(`\\b${t}\\b`), `${sceneId}: ${c.id}'s name (${t}) is in it`);
  }
});

test("a doc as the writer reads it: no pointers to the GM's docs, no lines that hold only if they happened, only the scene's hour", () => {
  const now = readDoc("notes-hours", "World/Caerwyn now.md")!;
  const evening = forReaders(now, "evening");
  assert.match(evening, /## Evening, the eve/);
  assert.doesNotMatch(evening, /## Morning, the eve|## Night, the eve|## Procession morning/);
  assert.doesNotMatch(evening, /^\s*-\s+If\b/m);
  assert.doesNotMatch(evening, /Read when relevant|GM only/);
  assert.match(forReaders(now, "next-morning"), /## Procession morning/);
});

test("the notes are placed on their words: the GM's mark, a line or the words of it, words of the reply; three at most", () => {
  const scene = sceneById("zoo-ferry");
  const state = session("zoo-ferry", [["narration", "An eel-wife steps into your way."], ["player", "*steps round the eel-wife* Not now, you old trout. Ferryman! Take me across."]]);
  const raw = "[the eel-wife] “Old trout, am I?” She turns to the river. [the ferryman] “(No.)[why: …]” He doesn't look up. [the ferryman] “Not for anyone who calls my mother names. A penny, King's face up, for them as are spoke for.”";
  const parsed = withSpeakers(parseMarkup(raw), speakersOf(scene, state));
  const drafted: Drafted[] = parsed.marks.map(m => ({ start: m.start, end: m.end, kind: m.kind }));
  const on = (m: { start: number; end: number }) => parsed.text.slice(m.start, m.end);
  const written: Written[] = [
    { on: "M1", words: "No.", kind: "why", note: "You called his mother an old trout on her own landing.", turn: 1, lore: "" },
    { on: "L1", words: "Old trout", kind: "you", note: "You called her an old trout as you pushed past.", turn: 1, lore: "" },
    // On words already marked: left out.
    { on: "L2", words: "", kind: "why", note: "A second note on the same refusal.", turn: 0, lore: "" },
    { on: "", words: "King's face up", kind: "know", note: "Caerwyn's pennies carry the King's face, and the stairs want to see it.", turn: 0, lore: "D1" },
    // A fourth: past three.
    { on: "L3", words: "spoke for", kind: "why", note: "The stairs carry their own.", turn: 0, lore: "" },
  ];
  const marks = placeNotes(parsed.text, parsed.speech, drafted, written, [{ id: "D1", path: "World/Caerwyn.md" }], state);
  assert.deepEqual(marks.map(m => [m.kind, on(m)]), [["you", "Old trout"], ["why", "No."], ["know", "King's face up"]]);
  assert.deepEqual(marks.find(m => m.kind === "why")?.link, { kind: "deed", scene: "zoo-ferry", turn: 1 });
  assert.deepEqual(marks.find(m => m.kind === "know")?.link, { kind: "lore", path: "World/Caerwyn.md" });
  // A callback to nothing the player did isn't one.
  const none = placeNotes(parsed.text, parsed.speech, drafted, [{ on: "L3", words: "spoke for", kind: "you", note: "You were spoken for once, long ago.", turn: 0, lore: "" }], [], state);
  assert.equal(none.length, 0);
  // A line with words of it that aren't in it: the whole line.
  const whole = placeNotes(parsed.text, parsed.speech, [], [{ on: "L1", words: "not in the line", kind: "why", note: "She heard what you called her.", turn: 1, lore: "" }], [], state);
  assert.equal(on(whole[0]!), "“Old trout, am I?”");
});

test("a note speaks of the story, not the game: no turn numbers or ids in it", () => {
  assert.equal(storyWords("You apologized to Cob this morning for calling him a gutter rat. You said it in turn 3."), "You apologized to Cob this morning for calling him a gutter rat.");
  assert.equal(storyWords("You called her an old trout in turn 1, so she won't speak for you."), "You called her an old trout, so she won't speak for you.");
  assert.equal(storyWords("You told Saul this turn that you'd be coming in."), "You told Saul just now that you'd be coming in.");
  assert.equal(storyWords("“Rule four bars the watch on duty (D2).”"), "Rule four bars the watch on duty.");
  assert.equal(storyWords("You called her an old trout, so she refuses to help you. You did that this turn."), "You called her an old trout, so she refuses to help you.");
  assert.equal(storyWords("You asked Hobb to show his hand, and he refused. You did this a moment ago."), "You asked Hobb to show his hand, and he refused.");
});

test("what's been explained in the scene isn't explained again, and two reasons a reply are plenty", () => {
  const state = session("zoo-ferry", [["player", "Ferryman! Take me across. I'm here for the watch."]]);
  const text = "“The Heron? Not for you. Not for the watch. Not tonight.”";
  const speech = [{ start: 0, end: text.length }];
  const know: Written = { on: "", words: "the Heron", kind: "know", note: "The last warehouse at the downriver end of the wharves.", turn: 0, lore: "D1" };
  const refs = [{ id: "D1", path: "Places/Heron Warehouse.md" }];
  assert.equal(placeNotes(text, speech, [], [know], refs, state, ["Heron"]).length, 0);
  assert.equal(placeNotes(text, speech, [], [know], refs, state, ["Rule four"]).length, 1);
  const why = (words: string): Written => ({ on: "", words, kind: "why", note: "You came in the watch's name.", turn: 1, lore: "" });
  assert.deepEqual(placeNotes(text, speech, [], [why("Not for you"), why("Not for the watch"), why("Not tonight")], [], state).map(m => text.slice(m.start, m.end)), ["Not for you", "Not for the watch"]);
});

test("a note about someone's public face is linked to them, as a person, not to their doc", () => {
  const state = session("drowned-rat", [["player", "Who's the big fellow by the fire?"]]);
  const scene = sceneById("drowned-rat");
  const text = "“That's the champion,” says the young lighterman.";
  const marks = placeNotes(text, [], [], [{ on: "", words: "the champion", kind: "know", note: "He's held the Rat's arm-wrestling chair these eleven years.", turn: 0, lore: "D1" }], [{ id: "D1", path: "Cast/Big Hobb Mallory/public.md" }], state, [], scene);
  assert.deepEqual(marks[0]?.link, { kind: "person", id: "hobb" });
});

// --- What the QA pass's players were told that wasn't so, or wasn't theirs to know (the notes as written).

test("someone's public face reaches the writer once the player has heard their name, not while he's the big man by the fire", () => {
  const scene = sceneById("drowned-rat");
  const reply = parseMarkup("By the fire, an old bargewoman deals cards beside the big man with the bandaged right hand. [the young lighterman] “Not tonight, Hobb?”");
  const before = session("drowned-rat", [["narration", "The Rat's din drops by half as you come in."], ["player", "Two of whatever's honest, missus."]]);
  const told = (state: TurnView, upTo = state.transcript) => notesInput(scene, state, { text: reply.text, speech: reply.speech, drafted: [] }, upTo).input.map(m => m.content).join("\n");
  // The lighterman says his name in this reply: it's not the writer's to explain him from what the regulars know (the robustness tester's rb-2b).
  assert.doesNotMatch(told({ ...before, transcript: [...before.transcript, { turn: 1, scene: "drowned-rat", speaker: "gm", kind: "narration", text: reply.text }] }, before.transcript), /sickening for something/);
  // Once the landlady has sold his name, it is.
  const sold = session("drowned-rat", [["player", "A gill of gossip, missus. The big lad by the fire?"], ["narration", "“Big Hobb Mallory. Champion of the Rat these eleven years.”"]]);
  assert.match(told(sold), /sickening for something/);
});

test("a note says only what's so of what the player knows: no guess, no echo, nothing the player didn't do, no words in anyone's mouth", () => {
  const yard = sceneById("hanged-clerk");
  const opening = session("hanged-clerk", []);
  const text = "Below him, a scrawny boy lobs gutter stones. “Cob says he’s dead already! Stop hogging the sky, Mister Prout!” A woman in a rain cape steps away from the gate. “The Captain calls it suicide.”";
  const speech = parseMarkup(text).speech;
  const place = (w: Written, state = opening, scene = yard, refs = [{ id: "D1", path: "Places/Granary Yard.md" }]) => placeNotes(text, speech, [], [w], refs, state, [], scene, state.transcript);
  // At the opening the player hasn't done anything: the stones are the boy's (barbarian#55, the goals tester's g2 and g9).
  assert.equal(place({ on: "L1", words: "Stop hogging the sky, Mister Prout!", kind: "why", note: "You’re interrupting Cob’s game by occupying the hoist he’s throwing stones at.", turn: 0, lore: "" }).length, 0);
  assert.equal(place({ on: "L1", words: "Stop hogging the sky", kind: "why", note: "You’re throwing stones at the body, and Cob is trying to hit its nose.", turn: 0, lore: "" }).length, 0);
  // A know is from the lore, not a guess or the reply said again (the thief's T10, the robustness tester's openings).
  assert.equal(place({ on: "L2", words: "The Captain calls it suicide.", kind: "know", note: "The Watch Captain has already called Prout’s death a suicide, but Kell hasn’t recorded that as her finding.", turn: 0, lore: "" }).length, 0);
  assert.equal(place({ on: "L2", words: "The Captain calls it suicide.", kind: "know", note: "You now know the Watch Captain has called Prout’s death a suicide.", turn: 0, lore: "D1" }).length, 0);
  assert.equal(place({ on: "L2", words: "The Captain calls it suicide.", kind: "know", note: "The Watch Captain files what the Purveyor's office asks him to file.", turn: 0, lore: "D1" }).length, 1);
  // A note about itself is no note (g11).
  assert.equal(place({ on: "L1", words: "Stop hogging the sky", kind: "why", note: "Cob may be teasing the dead man, but the reason for this line isn’t clear.", turn: 0, lore: "D1" }).length, 0);
  // A callback the turn it names doesn't bear out (g1's T40: the King told the player how Wendell took his tea, not the other way round).
  const king = sceneById("kings-morning");
  const morning = session("kings-morning", [["player", "Majesty, Wendell Prout was murdered."], ["narration", "“Wendell took his tea with the milk in first, one sugar.”"], ["player", "Majesty, what becomes of Hobb? He held the rope, but he's the one who told us."]]);
  const tea = "The King looks toward you. “You take your tea without milk, I think. I shall remember.”";
  const teaSpeech = parseMarkup(tea).speech;
  assert.equal(placeNotes(tea, teaSpeech, [], [{ on: "L1", words: "You take your tea without milk", kind: "you", note: "You told the King Wendell took his tea with the milk first, and made it feel expected.", turn: 2, lore: "" }], [], morning, [], king, morning.transcript).length, 0);
  // A reason that isn't the player's own doing keeps its note, without a link to a turn that isn't about it.
  const kept = placeNotes(tea, teaSpeech, [], [{ on: "L1", words: "I shall remember", kind: "why", note: "The King remembers how everyone takes their tea.", turn: 2, lore: "" }], [], morning, [], king, morning.transcript);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.link, undefined);
  // Nobody says what they haven't said: the bargewoman hasn't spoken, whatever her lore says she says (rb-2b's T2).
  const rat = sceneById("drowned-rat");
  const gill = session("drowned-rat", [["player", "A gill of gossip, missus."]]);
  const said = "[Nan Quill] “Big Hobb Mallory. He’s been drinking for two since last night.”";
  const p = parseMarkup(said);
  assert.equal(placeNotes(p.text, p.speech, [], [{ on: "L1", words: "He’s been drinking for two since last night.", kind: "know", note: "The old bargewoman says Hobb has been drinking for two lately; she thinks he’s sickening for something.", turn: 0, lore: "D1" }], [{ id: "D1", path: "Cast/Big Hobb Mallory/public.md" }], gill, [], rat, gill.transcript).length, 0);
});
