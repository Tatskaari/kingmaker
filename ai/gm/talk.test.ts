// Copied from the prototype's src/runtime/talk.test.ts at 44c6d4a: its cases on the AI service's half, with the usual edits (a TurnView for the session, the scene from the campaign's talk template, gm/director.ts's questions for decideBefore). The waiting scene set aside and put back, and the talk record kept, are the simulation's (its talk is a scene row of its own); new here: the prep as a TalkPrep (prepareTalk), the told memory written once (rememberTold), and the staged secrets asked and read after a reply, and told to the GM. Since a talk plays on the two-part GM: the prep fills the talk's discovery and keeps a secret as the scenes' cards do, with nothing to confide the discovery dropped, toldIt by the discovery reached, and the companion's lore and the GM's notes on them as the two parts read them; the staged secrets' tests stay with the old pipeline's code until it goes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readDoc, type Doc } from "../docs/docs.ts";
import { gmNotes, note, readNotes } from "../docs/notes.ts";
import type { Decision } from "../llm/decide.ts";
import { campaigns } from "../service/campaigns.ts";
import { Failure } from "../service/context.ts";
import { memoryStores } from "../service/memory-stores.ts";
import { GUARD_STAGES, initialGm, type TalkState } from "../../shared/gm/state.ts";
import type { TalkOpen } from "../../shared/protocol/ai.ts";
import { effectiveScene } from "../../shared/scene/graph.ts";
import { talkOf, talkSceneId } from "../../shared/scene/talk.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { nowNote } from "./brief.ts";
import { afterQuestions, beforeQuestions, readAfter, talkSettings } from "./director.ts";
import { confidences, prepareTalk, rememberTold, talkFacts, talkLore, talkNotes, talkOpening, toldIt } from "./talk.ts";
import { TOLD } from "../../shared/scene/talk.ts";
import type { TurnView } from "./view.ts";

/**
 * Talks with a companion between scenes (gm/talk.ts), without model calls: the scene built from any
 * companion's lore and the campaign's talk template, what they might open up about, what the talk's
 * GM takes as given, the prep as the open's commit keeps it, what they keep back on their card for
 * the talk only, the told memory written once, and the staged secrets after a reply.
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const KELL = "Cast/Sergeant Agnes Kell";

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}

const stores = memoryStores();
const installed = campaigns(stores.campaigns, stores.docs);
await installed.put("caerwyn", "0.1.0", filesOf(CAERWYN));
const campaign = installed.use("caerwyn", "0.1.0");
const kell = effectiveScene(campaign.scene(talkSceneId("kell", 1)), []);

/** A talk as it opens, between scenes: the granary played (Kell signed Prout in as murdered), the Rat waiting. */
function talking(game: string, scene: Scene = kell, fields: Partial<TurnView> = {}): TurnView {
  return {
    ...initialGm({ start: scene.start }), id: game, sceneId: scene.id, turn: 0,
    player: { name: "Wren Ashdown", concept: "a quick-witted half-elf ranger", modifiers: {} },
    memory: { opened: [] }, rulings: [], fought: [], owed: [], guard: {}, transcript: [], story: campaign.story,
    history: [{ sceneId: "hanged-clerk", exitId: "case-made", summary: "Prout was murdered; Kell signed him in as such." }],
    ...fields,
  };
}

const opening = (fields: Partial<TalkOpen> = {}): TalkOpen => ({
  with: "kell", where: "the granary lane in Caerwyn, evening", record: { count: 1, told: [] }, lead: "Kell is going down the river stairs to the Drowned Rat.", earlier: [], suggest: true, ...fields,
});

test("a talk scene is built from any companion's lore and the campaign's template: their look and voice, no story exits, a talk's settings", () => {
  const second = campaign.scene(talkSceneId("kell", 2));
  assert.deepEqual(talkOf(second.id), { companion: "kell", n: 2 });
  assert.equal(second.companion, "kell");
  assert.equal(second.title, "A word with Sergeant Agnes Kell");
  assert.match(second.cast[0]!.look, /notebook/);
  assert.match(second.cast[0]!.voice, /Noted/);
  assert.equal(second.cast[0]!.statblock, "guard", "the rules' stats come from her authored card");
  assert.ok(second.exits.every(e => !e.next), "no exit leads anywhere in the story");
  assert.equal(second.anytime?.[0]?.when, "The player says goodbye or ends the talk (\"I'll leave you to it.\"), or walks on.");
  assert.doesNotMatch(JSON.stringify(second), /\{name\}|\{companion\}|\{farewell\}/, "the template's words are filled, its Markdown too");
  assert.deepEqual(talkSettings(second), { considered: false, offGraph: false }, "no considered rolls and no co-GM");
  assert.deepEqual(talkSettings(campaign.scene("hanged-clerk")), {});
  // Anyone with a lore entry, not just Kell.
  const nan = campaign.scene(talkSceneId("nan-quill", 1));
  assert.equal(nan.title, "A word with Nan Quill");
  assert.match(nan.cast[0]!.look, /forearms/);
  assert.throws(() => campaign.scene(talkSceneId("nobody", 1)), (e: unknown) => e instanceof Failure && e.status === 400 && /nobody has no lore entry/.test(e.message));
});

test("what a companion might open up about: their own private notes, never a told one twice", () => {
  const state = talking("talk-confidences");
  const all = confidences(state, "kell").map(d => d.path);
  assert.ok(all.includes(`${KELL}/knowledge/Nan Quill.md`));
  assert.ok(all.includes(`${KELL}/knowledge/Wendell Prout.md`));
  assert.ok(!all.some(p => /private\.md|gm\.md|public\.md|memories/.test(p)), `not the lore entry, the GM's truth, the public face or memories: ${all.join(", ")}`);
  state.talks = { kell: { count: 1, told: [{ note: `${KELL}/knowledge/Nan Quill.md`, topic: "the door at the Drowned Rat", turn: 9 }] } };
  assert.ok(!confidences(state, "kell").some(d => d.path.endsWith("Nan Quill.md")));
});

test("a talk knows where and when, how often, where the story goes, and what the scenes knew: the companion's card in the last scene they were in", () => {
  const facts = talkFacts(talking("talk-knew"), kell, opening()).join("\n");
  assert.match(facts, /granary lane in Caerwyn, evening/);
  assert.match(facts, /first time Wren Ashdown has stopped for a word/);
  assert.match(facts, /river stairs to the Drowned Rat/, "the talk knows where the story goes next");
  // Asked how she knew the thief's real name, Kell made something up, then wouldn't say: her card had it.
  assert.match(facts, /What Sergeant Agnes Kell knew in The Hanged Clerk \(their prep there, as things stood then; what's happened since is the story's\): She has never met the King's investigator: this morning a palace page came to the watch house/);
  assert.match(facts, /It's theirs to tell, as they would, when it comes up\./);
  assert.doesNotMatch(facts, /Three days ago Prout came to the watch house/, "her card's secrets stay the talk's own business");
  assert.match(facts, /That's what happened: whatever it says Sergeant Agnes Kell did, saw or told Wren Ashdown, they did, saw and told, and they stand by it in their own words/);
  assert.match(facts, /keeps their own story to themselves/, "until the prep says what she might open up about");
  // Nobody the story has met yet: no card, no line.
  assert.doesNotMatch(talkFacts(talking("talk-knew-none", kell, { history: [] }), kell, opening()).join("\n"), /What Sergeant Agnes Kell knew in/);
  // The second talk, the door told in the first.
  const second = talkFacts(talking("talk-knew-2"), kell, opening({ record: { count: 2, told: [{ note: `${KELL}/knowledge/Nan Quill.md`, topic: "the door at the Drowned Rat", turn: 3 }] } })).join("\n");
  assert.match(second, /second time/);
  assert.match(second, /Of their own story, Sergeant Agnes Kell has already told Wren Ashdown: the door at the Drowned Rat\. Told is told/);
});

const PLAN = {
  told: ["Prout came to her."], standing: "Wary, warming.", willing: "yes" as const, note: `${KELL}/knowledge/Nan Quill.md`, topic: "the door at the Drowned Rat",
  what: "Nan Quill put her out through the Rat's door twenty years ago.", shows: "going still at the Rat's name.", opens: "asking her about the Rat.", first: "“I know that door.”", ready: "picked_at" as const,
  memory: "I told the investigator about the door. They didn't laugh.",
  suggestions: ["How long have you been with the watch?", "“What about the Rat?”", "What did you make of [Cob]?", "how long have you been with the watch?", "Who taught you to watch hands?", "One too many"],
};

test("the prep as the open's commit keeps it: the facts, the one thing on their card (as the scenes' cards keep a secret) and filling the talk's discovery with the ways it can come out, as readily as a talk from before left it, the deepest withheld, the opening lines", () => {
  const state = talking("talk-prep");
  const cob = readDoc(state.id, `${KELL}/knowledge/Cob.md`) as Doc;
  const prep = prepareTalk(state, kell, opening({ record: { count: 1, told: [], stages: { [`${KELL}/knowledge/Nan Quill.md`]: "stirred" } } }), { prep: PLAN, held: cob });

  assert.deepEqual(prep.withheld, [`${KELL}/knowledge/Cob.md`]);
  assert.deepEqual(prep.confide, { note: `${KELL}/knowledge/Nan Quill.md`, topic: "the door at the Drowned Rat", what: PLAN.what, memory: PLAN.memory });
  assert.deepEqual(prep.patches[0], { turn: 0, why: "What Sergeant Agnes Kell might open up about in this talk: the door at the Drowned Rat.", cast: { id: "kell", secrets: ["Shows: going still at the Rat's name. Opens: asking her about the Rat. First: 'I know that door.'", "Nan Quill put her out through the Rat's door twenty years ago. They tell it once, in their own words; told is told."] } });
  assert.deepEqual(prep.patches[1], {
    turn: 0, why: "the door at the Drowned Rat: what Sergeant Agnes Kell might confide in this talk, and the ways it can come out.",
    fill: { id: TOLD, revelation: PLAN.what, paths: [
      { via: "kell", clue: "It shows before it comes out: going still at the Rat's name.", earn: "Free, when the talk comes near it: a tell, never what it's about.", strength: "hook" },
      // picked_at, but a talk from before (the old pipeline's staged secret) left it stirred: asked twice.
      { via: "kell", clue: `${PLAN.what} The first of it: 'I know that door.'`, earn: "Asked, they hold back a moment and give only the first of it; asked again, they tell it. What brings it out: asking her about the Rat.", strength: "strong" },
    ] },
  });
  assert.equal(prep.guard, undefined, "no staged secret: the co-GM stages it through their role");
  assert.deepEqual(prep.suggestions, ["How long have you been with the watch?", "What about the Rat?", "Who taught you to watch hands?", "One too many"], "plain, no markup, no repeats, four at most");
  const facts = prep.established.join("\n");
  assert.match(facts, /Of their own story, Sergeant Agnes Kell has already told Wren Ashdown: Prout came to her\./);
  assert.match(facts, /the only part of their own story Sergeant Agnes Kell may open up about is the door at the Drowned Rat/);
  assert.match(facts, /Not in this talk, however it comes up: the deepest of Sergeant Agnes Kell's own story \(their note "Cob"/);
  // As the plan says, with no talk from before.
  assert.match(prepareTalk(state, kell, opening(), { prep: PLAN }).patches[1]!.fill!.paths[1]!.earn, /^Only once the player has picked at it a while/);

  // Lines not suggested (the controller's setting), and nothing they'd tell: the facts say so, nothing goes on their card, and the talk's discovery isn't this talk's.
  assert.deepEqual(prepareTalk(state, kell, opening({ suggest: false }), { prep: PLAN }).suggestions, []);
  const unwilling = prepareTalk(state, kell, opening(), { prep: { ...PLAN, willing: "no" } });
  assert.deepEqual([unwilling.patches.map(p => [p.drop, p.cast, p.fill]), unwilling.guard, unwilling.confide, unwilling.withheld], [[[TOLD, undefined, undefined]], undefined, undefined, []]);
  assert.match(unwilling.established.join("\n"), /keeps their own story to themselves/);
  // What they've already told isn't theirs to tell again, whatever the prep says.
  const told = talking("talk-prep-told", kell, { talks: { kell: { count: 2, told: [{ note: `${KELL}/knowledge/Nan Quill.md`, topic: "the door", turn: 3 }] } } });
  assert.equal(prepareTalk(told, kell, opening(), { prep: PLAN }).confide, undefined);
});

test("it's out once the talk's discovery is reached, or in a talk from before, once its route was taken or its staged secret settled", () => {
  const state = talking("talk-out");
  assert.equal(toldIt(state, "kell"), false);
  assert.equal(toldIt({ ...state, reached: ["talk", TOLD] }, "kell"), true);
  assert.equal(toldIt({ ...state, path: [{ turn: 2, from: "talk", to: "told", via: "confided", source: "post" }] }, "kell"), true);
  assert.equal(toldIt({ ...state, guard: { kell: { stage: "settled", turn: 2 } } }, "kell"), true);
});

test("the two parts' talk: its opening, the companion's lore (theirs, without links nothing opens) and the GM's notes on them; none in a scene of the story", () => {
  const state = talking("talk-two-part");
  assert.match(talkOpening(kell), /^Open the talk, as "Where it starts" has it \(as the talk opens\): in a sentence or two, what Sergeant Agnes Kell is doing as the player comes over/);
  const lore = talkLore(kell, state)!;
  assert.match(lore, /^### Sergeant Agnes Kell: who they are, in their own lore\nTheir lore is theirs, written to them/);
  assert.match(lore, /You are Sergeant Agnes Kell of the Caerwyn city watch/);
  assert.match(lore, /\n#### Voice\n/);
  assert.doesNotMatch(lore, /Read when relevant|\]\(knowledge\//);
  assert.match(talkNotes(kell, state)!, /^## The GM's notes on Sergeant Agnes Kell from play \(what's happened with them\)\n.*\n\(nothing yet\)$/);
  note(state.id, { id: "kell", name: "Sergeant Agnes Kell" }, "seen", "Watched the investigator look at the body first.", { origin: { scene: "hanged-clerk", turn: 2 } });
  note(state.id, { id: "kell", name: "Sergeant Agnes Kell" }, "did", "The Hanged Clerk, as it ended: signed in as murder.", { origin: { scene: "hanged-clerk", turn: 9 } });
  assert.match(talkNotes(kell, state)!, /\nSeen the player do:\n- Watched the investigator look at the body first\.\nDid:\n- The Hanged Clerk, as it ended: signed in as murder\.$/);
  const yard = campaign.scene("hanged-clerk");
  assert.deepEqual([talkLore(yard, state), talkNotes(yard, state)], [undefined, undefined]);
});

test("what they're keeping back goes on their card for the talk only (a patch on the talk scene)", () => {
  const scene = effectiveScene(kell, [{ turn: 0, why: "test", cast: { id: "kell", secrets: ["Nan Quill put her out through the Rat's door twenty years ago."] } }]);
  assert.deepEqual(scene.cast[0]!.secrets, ["Nan Quill put her out through the Rat's door twenty years ago."]);
  assert.equal(kell.cast[0]!.secrets, undefined, "the scene itself is unchanged");
});

test("told once, it's in the GM's notes on them, under what they did, written once however often it's found told; the GM's alone", () => {
  const state = talking("talk-record");
  const talk: TalkState = { with: "kell", where: "the granary lane in Caerwyn, evening", confide: { note: `${KELL}/knowledge/Nan Quill.md`, topic: "the door at the Drowned Rat", what: "Nan Quill put her out through the door.", memory: "I told the investigator about the door. They didn't laugh." } };

  assert.equal(gmNotes(state.id, "kell"), undefined, "nothing yet");
  assert.equal(rememberTold(state, kell, talk), true);
  assert.equal(rememberTold(state, kell, talk), false, "a settle run again writes nothing twice");
  assert.deepEqual(readNotes(state.id, "kell").did, ["Told Wren about the door at the Drowned Rat, in a word between scenes (the granary lane in Caerwyn, evening)."]);
  assert.equal(readDoc(state.id, `${KELL}/notes.md`)!.meta.visibility, "gm", "the GM's notes, which nobody in the story reads");
  assert.equal(rememberTold(state, kell, { with: "kell", where: "anywhere" }), false, "nothing kept back, nothing to remember");
});

test("a talk's route for what they tell is never offered as something the player simply does, and a talk's decision asks no roll call, plan or pretending", () => {
  const scene = effectiveScene(kell, [{ turn: 0, why: "test", transition: { beat: "talk", transition: { id: "confided", on: "outcome", given: true, to: "told", when: "Kell has told the player about the door." } } }]);
  const state = talking("talk-given", scene, { turnsInBeat: 1, transcript: [{ turn: 1, speaker: "player", kind: "player", text: "Tell me about the door." }] });
  const asked = beforeQuestions(scene, state, undefined, talkSettings(scene));
  assert.ok(asked.questions.attempt, "the goodbye is still an attempt");
  assert.ok(!Object.keys(asked.questions.attempt!.criteria).some(k => k.includes("confided")), Object.keys(asked.questions.attempt!.criteria).join(", "));
  assert.deepEqual(["attempt_means", "roll_call", "off_graph"].filter(q => asked.questions[q]), [], "considered rolls and the co-GM are off in a talk");
  assert.equal(asked.questions.limit?.criteria.pretending, undefined);
  assert.doesNotMatch(asked.questions.limit!.instructions, /Faking one/);
  // A scene of the story asks them all, as it did.
  const yard = campaign.scene("hanged-clerk");
  const story = beforeQuestions(yard, talking("talk-given-yard", yard, { turnsInBeat: 1, transcript: state.transcript }));
  assert.deepEqual(["attempt_means", "roll_call", "off_graph"].filter(q => story.questions[q]), ["attempt_means", "roll_call", "off_graph"]);
  assert.ok(story.questions.limit?.criteria.pretending);
});

test("staged secrets: asked after a reply in a talk, never back once settled, never in a scene of the story; and the GM told how far they've come", () => {
  const scene = effectiveScene(kell, [{ turn: 0, why: "test", cast: { id: "kell", secrets: ["Nan Quill put her out through the Rat's door twenty years ago."] } }]);
  const state = talking("talk-guard", scene, { guard: { kell: { stage: "torn", turn: 0 } }, turn: 2, turnsInBeat: 2 });
  const asked = afterQuestions(scene, state, undefined, { staging: true, exchange: "What have you got against the Rat, Kell?\nKell goes still." });
  assert.deepEqual(Object.keys(asked.questions.guard_kell!.criteria), [...GUARD_STAGES]);
  assert.match(asked.questions.guard_kell!.instructions, /How far has Sergeant Agnes Kell come towards giving up what they're keeping to themselves \(Nan Quill put her out/);
  const answers: Decision = { answers: { guard_kell: { choice: "settled", probabilities: { settled: 0.9 } } }, latencyMs: 0, costUsd: 0, decider: "stub" };
  assert.deepEqual(readAfter(scene, answers, asked).guard, { kell: "settled" });
  assert.equal(readAfter(scene, { ...answers, answers: {} }, asked).guard, undefined, "nothing judged, nothing moved");
  assert.equal(afterQuestions(scene, talking("talk-guard-out", scene, { guard: { kell: { stage: "settled", turn: 1 } } }), undefined, { staging: true }).questions.guard_kell, undefined, "out is out");
  assert.equal(afterQuestions(scene, state).questions.guard_kell, undefined, "a scene of the story stages nothing");
  // The GM's note for the reply says where she stands, and the one step she can take next.
  assert.match(nowNote(scene, state, []), /## How far people have opened up\n[^#]*- Sergeant Agnes Kell: torn, in the open\. Next, the thing itself comes out/);
});
