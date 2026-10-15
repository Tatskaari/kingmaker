import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sceneById } from "../../scenes/index.ts";
import { talkOf, talkSceneId } from "../../scenes/talk.ts";
import { memoryLines, readDoc } from "../lore/docs.ts";
import { sceneApproach } from "./approaches.ts";
import { effectiveScene } from "./brief.ts";
import type { SessionState } from "./session.ts";
import { confidences, endTalk, leaveTalk, startTalk } from "./talk.ts";

/**
 * Talks with a companion between scenes (src/runtime/talk.ts), without model calls: the scene
 * built from any companion's lore, the story's waiting scene set aside and put back exactly, and
 * what a talk leaves on record (how many talks, what was told, how far they'd come).
 */

process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-talk-"));

/** A session between scenes: the granary played, the Rat waiting (its opening and lead written at the boundary). */
function between(id: string): SessionState {
  return {
    id, sceneId: "drowned-rat", approach: "v2", seed: 7, rollCount: 3, turn: 12,
    player: { name: "Wren Ashdown", concept: "a quick-witted half-elf ranger", modifiers: {} },
    beat: "the-room", turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], whispers: [], entered: [], absent: [], memory: { opened: [] }, landed: [], hinted: [], guard: {},
    adjustments: ["Hobb is in the Rat tonight, nursing his hand."], opening: "Dusk on the river stairs.", lead: "Kell is going down the river stairs to the Drowned Rat.",
    carried: [{ id: "wren-pennies", name: "4 pennies", kind: "item", parent: "player", tags: ["coin"], states: [], notes: [] }],
    transcript: [{ turn: 12, scene: "hanged-clerk", speaker: "system", kind: "system", text: "Scene ends: The case is made" }],
    metrics: [], history: [{ sceneId: "hanged-clerk", exitId: "case-made", summary: "Prout was murdered; Kell signed him in as such." }],
  } as SessionState;
}

test("a talk scene is built from any companion's lore: their look and voice, no story exits, a staged secret's machinery", () => {
  const kell = sceneById(talkSceneId("kell", 2));
  assert.deepEqual(talkOf(kell.id), { companion: "kell", n: 2 });
  assert.equal(kell.companion, "kell");
  assert.equal(kell.title, "A word with Sergeant Agnes Kell");
  assert.match(kell.cast[0]!.look, /notebook/);
  assert.match(kell.cast[0]!.voice, /Noted/);
  assert.equal(kell.cast[0]!.statblock, "guard", "the rules' stats come from her authored card");
  assert.ok(kell.exits.every(e => !e.next), "no exit leads anywhere in the story");
  assert.deepEqual(sceneApproach({ approach: "v2" }, kell), { ...sceneApproach({ approach: "v2" }, {}), repair: "off", freeformChecks: false, considered: false, staging: true });
  // Anyone with a lore entry, not just Kell.
  const nan = sceneById(talkSceneId("nan-quill", 1));
  assert.equal(nan.title, "A word with Nan Quill");
  assert.match(nan.cast[0]!.look, /forearms/);
  assert.throws(() => sceneById(talkSceneId("nobody", 1)), /Unknown scene/);
});

test("what a companion might open up about: their own private notes, never a told one twice", () => {
  const state = between("talk-confidences");
  const all = confidences(state, "kell").map(d => d.path);
  assert.ok(all.includes("Cast/Sergeant Agnes Kell/knowledge/Nan Quill.md"));
  assert.ok(all.includes("Cast/Sergeant Agnes Kell/knowledge/Wendell Prout.md"));
  assert.ok(!all.some(p => /private\.md|gm\.md|public\.md|memories/.test(p)), `not the lore entry, the GM's truth, the public face or memories: ${all.join(", ")}`);
  state.talks = { kell: { count: 1, told: [{ note: "Cast/Sergeant Agnes Kell/knowledge/Nan Quill.md", topic: "the door at the Drowned Rat", turn: 9 }] } };
  assert.ok(!confidences(state, "kell").some(d => d.path.endsWith("Nan Quill.md")));
});

test("a talk sets the waiting scene aside and puts it back exactly; the story's lead and history are untouched", () => {
  const state = between("talk-roundtrip");
  const before = structuredClone(state);
  startTalk(state, "kell", "the granary lane in Caerwyn, evening");
  assert.equal(state.sceneId, "talk-kell-1");
  assert.equal(state.beat, "talk");
  assert.equal(state.lead, undefined, "the talk shows its own hook, not the lead");
  assert.equal(state.carried, undefined);
  assert.equal(state.adjustments, undefined);
  assert.equal(state.talks?.kell?.count, 1);
  assert.match(state.established.join("\n"), /granary lane in Caerwyn, evening/);
  assert.match(state.established.join("\n"), /first time Wren Ashdown has stopped for a word/);
  assert.match(state.established.join("\n"), /river stairs to the Drowned Rat/, "the talk knows where the story goes next");
  // A turn's worth of the talk: the transcript and the turn go on; the scene's own state is the talk's.
  state.turn++;
  state.transcript.push({ turn: state.turn, scene: state.sceneId, speaker: "player", kind: "player", text: "Long day?" });
  state.path.push({ turn: state.turn, from: "talk", to: "goodbye", via: "goodbye", source: "pre" });
  state.ended = { exitId: "goodbye", turn: state.turn, operations: [], warnings: [] };
  state.closing = { exitId: "goodbye", turn: state.turn };
  assert.throws(() => startTalk(state, "kell", "anywhere"), /Already talking/);
  endTalk(state);
  assert.equal(state.talk, undefined);
  const { transcript, turn, talks, ...rest } = state;
  const { transcript: t0, turn: n0, ...rest0 } = before;
  assert.deepEqual(rest, rest0, "everything of the waiting scene's is as it was, and nothing of the talk's is left");
  assert.equal(turn, n0 + 1);
  assert.equal(transcript.length, t0.length + 1);
  assert.equal(talks?.kell?.count, 1);
  // The next talk is the second, with its own scene (its own transcript).
  startTalk(state, "kell", "the river stairs, night");
  assert.equal(state.sceneId, "talk-kell-2");
  assert.match(state.established.join("\n"), /second time/);
  leaveTalk(state);
  assert.equal(state.sceneId, "drowned-rat");
  assert.match(state.transcript.at(-1)!.text, /walks on/);
});

test("a talk knows what the scenes knew: the companion's card in the last scene they were in, and what the lead says they did", () => {
  const state = between("talk-knew");
  startTalk(state, "kell", "the granary lane in Caerwyn, evening");
  const facts = state.established.join("\n");
  // Asked how she knew the thief's real name, Kell made something up, then wouldn't say: her card had it.
  assert.match(facts, /What Sergeant Agnes Kell knew in The Hanged Clerk \(their prep there, as things stood then; what's happened since is the story's\): She has never met the King's investigator: this morning a palace page came to the watch house/);
  assert.match(facts, /It's theirs to tell, as they would, when it comes up\./);
  assert.doesNotMatch(facts, /Three days ago Prout came to the watch house/, "her card's secrets stay the talk's own business");
  assert.match(facts, /That's what happened: whatever it says Sergeant Agnes Kell did, saw or told Wren Ashdown, they did, saw and told, and they stand by it in their own words/);
  leaveTalk(state);
  // Nobody the story has met yet: no card, no line.
  const fresh = { ...between("talk-knew-none"), history: [] };
  startTalk(fresh, "kell", "the granary lane in Caerwyn, evening");
  assert.doesNotMatch(fresh.established.join("\n"), /What Sergeant Agnes Kell knew in/);
});

test("what they're keeping back goes on their card for the talk only (a patch on the talk scene)", () => {
  const state = between("talk-card");
  startTalk(state, "kell", "the granary lane in Caerwyn, evening");
  state.patches.push({ turn: state.turn, why: "test", cast: { id: "kell", secrets: ["Nan Quill put her out through the Rat's door twenty years ago."] } });
  const scene = effectiveScene(sceneById(state.sceneId), state.patches);
  assert.deepEqual(scene.cast[0]!.secrets, ["Nan Quill put her out through the Rat's door twenty years ago."]);
  assert.equal(sceneById(state.sceneId).cast[0]!.secrets, undefined, "the scene itself is unchanged");
  endTalk(state);
  assert.deepEqual(state.patches, [], "the waiting scene's patches are its own");
});

test("told once, it's on record and in their memories; not yet told, how far they'd come carries to the next talk", () => {
  const state = between("talk-record");
  const door = { note: "Cast/Sergeant Agnes Kell/knowledge/Nan Quill.md", topic: "the door at the Drowned Rat", what: "Nan Quill put her out through the door.", memory: "I told the investigator about the door. They didn't laugh." };
  const prout = { note: "Cast/Sergeant Agnes Kell/knowledge/Wendell Prout.md", topic: "why Prout's case matters to her", what: "Prout came to her first.", memory: "I told them Prout came to me." };

  // First talk: the door comes out (staged secrets: settled).
  startTalk(state, "kell", "the granary lane in Caerwyn, evening");
  state.talk!.confide = door;
  state.guard = { kell: { stage: "settled", turn: state.turn } };
  endTalk(state);
  assert.deepEqual(state.talks?.kell?.told.map(t => t.topic), ["the door at the Drowned Rat"]);
  const remembered = memoryLines(state.id, "kell");
  assert.equal(remembered.length, 1);
  assert.match(remembered[0]!, /Told Wren about the door at the Drowned Rat/);
  assert.match(remembered[0]!, /between scenes: the granary lane in Caerwyn, evening/);
  const note = readDoc(state.id, `Cast/Sergeant Agnes Kell/memories/${/\]\(([^)]+)\)/.exec(remembered[0]!)![1]}`);
  assert.match(note!.body, /They didn't laugh/);
  assert.deepEqual(note!.meta.readers, ["character:kell"], "her memory, private to her");

  // Second talk: Prout's visit gets as far as "torn" and no further; it carries over.
  startTalk(state, "kell", "the river stairs in Caerwyn, night");
  assert.match(state.established.join("\n"), /Of their own story, Sergeant Agnes Kell has already told Wren Ashdown: the door at the Drowned Rat\. Told is told/);
  assert.match(state.established.join("\n"), /keeps their own story to themselves/, "until the prep says what she might open up about");
  state.talk!.confide = prout;
  state.guard = { kell: { stage: "torn", turn: state.turn } };
  endTalk(state);
  assert.equal(state.talks?.kell?.told.length, 1);
  assert.deepEqual(state.talks?.kell?.stages, { [prout.note]: "torn" });
  assert.equal(memoryLines(state.id, "kell").length, 1, "nothing told, nothing remembered as told");

  // Third talk: Prout's visit comes out by its route (judged after a reply) before the stage says settled.
  startTalk(state, "kell", "the wharves in Caerwyn, night");
  state.talk!.confide = prout;
  state.guard = { kell: { stage: "torn", turn: state.turn } };
  state.path.push({ turn: state.turn, from: "talk", to: "told", via: "confided", source: "post" });
  endTalk(state);
  assert.deepEqual(state.talks?.kell?.told.map(t => t.topic), ["the door at the Drowned Rat", "why Prout's case matters to her"]);
  assert.deepEqual(state.talks?.kell?.stages, {}, "told: nothing left to carry");
  assert.equal(memoryLines(state.id, "kell").length, 2);

  // Nothing kept back (nothing chosen): nothing changes.
  startTalk(state, "kell", "the wharves in Caerwyn, night");
  endTalk(state);
  assert.equal(state.talks?.kell?.count, 4);
  assert.equal(state.talks?.kell?.told.length, 2);
});

test("a talk's route for what they tell is never offered as something the player simply does", async () => {
  const { decideBefore } = await import("./director.ts");
  const state = between("talk-given");
  startTalk(state, "kell", "the granary lane in Caerwyn, evening");
  state.patches.push({ turn: state.turn, why: "test", transition: { beat: "talk", transition: { id: "confided", on: "outcome", given: true, to: "told", when: "Kell has told the player about the door." } } });
  const scene = effectiveScene(sceneById(state.sceneId), state.patches);
  let asked: Record<string, { criteria: Record<string, string> }> = {};
  await decideBefore({ name: "stub", decide: async (_state, questions) => { asked = questions; return { answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { choice: Object.keys(q.criteria).at(-1)!, probabilities: {} }])), latencyMs: 0, costUsd: 0, decider: "stub" }; } }, scene, state, "Tell me about the door.", { speaker: false });
  assert.ok(asked.attempt, "the goodbye is still an attempt");
  assert.ok(!Object.keys(asked.attempt!.criteria).some(k => k.includes("confided")), Object.keys(asked.attempt!.criteria).join(", "));
});
