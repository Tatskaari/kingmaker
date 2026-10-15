import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sceneById } from "../../scenes/index.ts";
import { listDocs, readDoc } from "../lore/docs.ts";
import { knownCast, nameTokens } from "./brief.ts";
import { parseMarkup, withSpeakers } from "./markup.ts";
import { speakersOf } from "./knowledge.ts";
import { forReaders, notesInput, placeNotes, storyWords, type Drafted, type Written } from "./notes.ts";
import type { Entry, SessionState } from "./session.ts";

process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-notes-"));

/** A session some way into a scene: the player's turns and the GM's replies as they were shown. */
function session(sceneId: string, transcript: Array<[kind: "player" | "narration", text: string]>, extra: Partial<SessionState> = {}): SessionState {
  const scene = sceneById(sceneId);
  return {
    id: `notes-${sceneId}`, sceneId, approach: "v2", seed: 1, rollCount: 0,
    player: { name: "Wren Ashdown", concept: "a quick-witted half-elf ranger with a longbow", modifiers: {} },
    turn: transcript.filter(([k]) => k === "player").length, beat: scene.start, turnsInBeat: 1, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], metrics: [], history: [],
    transcript: transcript.map(([kind, text], i): Entry => ({ turn: transcript.slice(0, i + 1).filter(([k]) => k === "player").length, scene: sceneId, speaker: kind === "player" ? "player" : "gm", kind, text })),
    ...extra,
  };
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
  const state = session("zoo-ferry", [["player", "Ferryman! Take me across."]]);
  const text = "“The Heron? Not for you. Not for the watch. Not tonight.”";
  const speech = [{ start: 0, end: text.length }];
  const know: Written = { on: "", words: "the Heron", kind: "know", note: "The last warehouse at the downriver end of the wharves.", turn: 0, lore: "" };
  assert.equal(placeNotes(text, speech, [], [know], [], state, ["Heron"]).length, 0);
  assert.equal(placeNotes(text, speech, [], [know], [], state, ["Rule four"]).length, 1);
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
