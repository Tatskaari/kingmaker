import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { note, readNotes } from "../../docs/notes.ts";
import { fakeFetch, type FakeFetch, type FakeOptions, type Request } from "../../llm/fake-openrouter.ts";
import { LOOK_MODEL } from "../../look/invent.ts";
import { initialGm, type GmState, type TalkRecord } from "../../../shared/gm/state.ts";
import { openingRoles, rolesNote } from "../../../shared/gm/two-part.ts";
import type { DecideRequest, Entry, LooksRequest, OpenRequest, SettleRequest, SheetRow, Story, TalkPrep } from "../../../shared/protocol/ai.ts";
import type { Mechanic } from "../../../shared/rules/types.ts";
import type { PlaceFile } from "../../../shared/scene/files.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { CONFIDED, GOODBYE, talkSceneId, TOLD } from "../../../shared/scene/talk.ts";
import { keysFor, worldToRows, type PlaceRows } from "../../../shared/world/rows.ts";
import { buildWorld, joinWorld } from "../../../shared/world/scene-world.ts";
import { callContext } from "../calls.ts";
import { campaigns } from "../campaigns.ts";
import { withTestClerk } from "../../gm/fixtures.ts";
import type { AiContext } from "../context.ts";
import { memoryStores } from "../memory-stores.ts";
import { aiService } from "../server.ts";
import type { StreamSink } from "../stream.ts";
import { canned } from "./canned.ts";
import { pipeline } from "./pipeline.ts";

/**
 * The town's thinks (docs/town-design.md §3.4-3.8, package A's done-when), on the stand-in for
 * OpenRouter: a talk with Kell opening on the two-part GM (her greeting, the mouthpiece's, streamed
 * beside the prep: the facts, the one thing she might tell on her card and filling the talk's
 * discovery with the ways it can come out, two to four lines, the deepest of her story withheld
 * before the third talk), a talk's settle (the co-GM, her role and the discovery its target, and the
 * next lines; once the co-GM has it out, a line of the GM's notes on her that she told it, written
 * once), decide with the map's menu's act already chosen (forced: no mechanic question, the act is
 * the decision's), and the looks of what the story made (an Invention per key; the canned GM's none).
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "..", "campaigns", "caerwyn");
const GAME = "0d1e2f3a-0000-4000-8000-0000000000d5";
const game = { id: GAME, campaign: "caerwyn", version: "0.1.0" };
const player = { id: "1", name: "Wren Ashdown" };
const KELL = "Cast/Sergeant Agnes Kell";

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}

const FILES = withTestClerk(filesOf(CAERWYN));
const stores = memoryStores();
const installed = campaigns(stores.campaigns, stores.docs);
await installed.put("caerwyn", "0.1.0", FILES);
const campaign = installed.use("caerwyn", "0.1.0");

/** A request's context on a fresh stand-in, what it streamed kept. */
function setUp(options: FakeOptions = {}) {
  const fake = fakeFetch({ streamMs: 0, ...options });
  const shown: string[] = [];
  const contextFor = (key: string): AiContext => {
    const { calls, usage } = callContext({ fetch: fake.fetch, apiKey: "test" }, stores, { game: GAME, key, attempt: 1 });
    const stream = (_turn: string): StreamSink => ({ show: text => { shown.push(text); }, finish: async text => { shown.push(text); }, firstTextMs: () => 0 });
    return { campaign, calls, usage, attempt: 1, stream };
  };
  return { fake, shown, contextFor };
}

/** The ready-made wizard as her sheet row has her. */
const WIZARD: SheetRow = {
  name: "Wren Ashdown", concept: "an absent-minded hedge-wizard of the Invisible College", build: "human wizard 3 (Evoker), sage background",
  skills: { arcana: 5, history: 5, insight: 3, investigation: 5, persuasion: 1 }, status: "HP 20/20, spell slots 1st 4/4, 2nd 2/2",
  spells: [{ id: "fire-bolt", name: "Fire Bolt", level: 0 }, { id: "ray-of-frost", name: "Ray of Frost", level: 0 }, { id: "magic-missile", name: "Magic Missile", level: 1 }],
  weapons: [{ id: "quarterstaff", name: "Quarterstaff" }], features: [],
};

/** The yard as the hanged clerk opens it, by the game's keys. */
function yardRows(gm: GmState): PlaceRows {
  const place = JSON.parse(FILES["places/granary-yard.json"]!) as PlaceFile;
  const people = presentCast(campaign.scene("hanged-clerk"), gm).map(c => ({ id: c.id, name: c.name }));
  const world = buildWorld("hanged-clerk", place, people, { name: "Wren Ashdown" });
  joinWorld(world, people, 0);
  return worldToRows(world, keysFor("granary-yard", "hanged-clerk", "pc:1"));
}

/** The town's own place, as a talk's requests carry it (a talk has no world of its own: the AI service reads none of it). */
const TOWN: PlaceRows = {
  place: { id: "9", key: "map:caerwyn", name: "Caerwyn", rootId: "10", sizeW: 80, sizeH: 40, round: 0, rev: 1 },
  entity: [], position: [], area: [], material: [], health: [], stack: [], surface: [], creature: [], playerCharacter: [], gear: [], narrative: [], gmNote: [], worldLog: [],
};

/** The story after the yard: its hand-off, and a little of what was said there. */
const STORY: Story = {
  time: "evening", day: 1, flags: {},
  history: [{ sceneId: "hanged-clerk", exitId: "case-made", summary: "Previous scene, \"The Hanged Clerk\", ended: Kell signed Prout in as murdered." }],
  earlier: [
    { turn: 1, speaker: "player:1", kind: "player", text: "Sergeant, who found him?", scene: "hanged-clerk" },
    { turn: 1, speaker: "gm", kind: "narration", text: "Kell looks up from her notebook. \"The porters, at first light.\"", scene: "hanged-clerk" },
  ],
};

/** The prep the stand-in answers (talk.plan): the door at the Rat, when she's asked. */
const PLAN = {
  told: [], standing: "Warming, a little.", willing: "yes", note: `${KELL}/knowledge/Nan Quill.md`, topic: "the door at the Drowned Rat",
  what: "Twenty years ago Nan Quill put her out through the Drowned Rat's door, and she has never been back.", shows: "a pause at the Rat's name", opens: "asking what she has against the Rat",
  first: "I know the Rat's door. From the wrong side.", ready: "when_asked", memory: "I told the investigator about Nan Quill's door. They didn't laugh.",
  suggestions: ["How long have you been with the watch, Sergeant?", "What did you make of the yard this morning?", "Do you know the Drowned Rat at all?"],
};
const GREETING = "Kell is writing in her notebook by the granary lane. She looks up. “Investigator.”";

/** A talk's bookkeeping as it opens (simulation/src/map/talk.ts openTalk): her opening role, the template's start's, as the co-GM's note -1. */
function talkGm(n = 1): GmState {
  const gm = initialGm({ start: "talk" });
  const scene = campaign.scene(talkSceneId("kell", n));
  const roles = openingRoles(scene, gm, presentCast(scene, gm));
  return { ...gm, twoPart: { roles, notes: [{ turn: -1, text: rolesNote(scene, roles, -1) }] }, talk: { with: "kell", where: "Granary Street in Caerwyn, evening" } };
}

function talkOpen(n: number, record: TalkRecord, suggest = true): OpenRequest {
  return {
    key: `${GAME}:s${10 + n}:t0:open`, game, player, scene: { id: String(10 + n), key: talkSceneId("kell", n), kind: "talk" }, pc: "pc:1",
    gm: talkGm(n), world: TOWN, party: [WIZARD], story: STORY, stream: { turn: "50" },
    talk: { with: "kell", where: "Granary Street in Caerwyn, evening", record, lead: "Kell is going down the river stairs to the Drowned Rat.", earlier: [], suggest },
    twoPart: true,
  };
}

/** The decider's calls, the director's and the sift's, by a question they ask. */
const asking = (fake: FakeFetch, question: string) => fake.sent.filter(b => b.questions?.[question]);
const formatted = (fake: FakeFetch, name: string) => fake.sent.filter(b => b.text?.format?.name === name);
const inputOf = (body: Request) => (body.input ?? []).map(m => m.content).join("\n\n");

test("a talk's open on the two-part GM: the mouthpiece streams Kell's greeting (her opening role, the talk's opening, the facts, her lore and the GM's notes on her, no dice) beside its prep: the facts, her card's secret and the talk's discovery filled with the ways it can come out, two to four lines, the deepest withheld before the third talk", async () => {
  const { fake, shown, contextFor } = setUp({ replies: [GREETING], byName: { talk: PLAN } });
  const req = talkOpen(1, { count: 1, told: [] });
  note(GAME, { id: "kell", name: "Sergeant Agnes Kell" }, "seen", "Saw the investigator look at the body before they looked at her.", { origin: { scene: "hanged-clerk", turn: 3 } });
  const answer = await pipeline.open(req, contextFor(req.key));

  assert.equal(answer.entries[0]!.text, GREETING);
  assert.equal(shown.at(-1), GREETING, "streamed to the opening's draft");
  assert.deepEqual(answer.present, ["kell"]);
  // The greeting: the mouthpiece's, on the talk's own opening, her role and the facts the talk opens on.
  const greeting = formatted(fake, "reply")[0]!;
  const said = inputOf(greeting);
  assert.match(said, /Character role for Sergeant Agnes Kell:\nConversation role: Characterise: at their own business in their own manner, a word of greeting/);
  assert.match(said, /## For this reply\nOpen the talk, as "Where it starts" has it \(as the talk opens\): in a sentence or two, what Sergeant Agnes Kell is doing/);
  assert.match(said, /Where and when: Granary Street in Caerwyn, evening\./);
  assert.match(said, /What Sergeant Agnes Kell knew in The Hanged Clerk/);
  assert.match(said, /## The GM's notes on Sergeant Agnes Kell from play \(what's happened with them\)\n[^#]*Seen the player do:\n- Saw the investigator look at the body before they looked at her\./);
  assert.match(greeting.instructions!, /## Where it starts: A word between scenes \[talk\]\nThe player has stopped for a word with Sergeant Agnes Kell[^]*As the talk opens: the player has come over for a word with Sergeant Agnes Kell/);
  assert.match(greeting.instructions!, /### Sergeant Agnes Kell: who they are, in their own lore\n[^]*#### Voice\n- Dry, calm, precise and sparing/, "her lore entry, theirs");
  assert.doesNotMatch(greeting.instructions!, /Read when relevant/, "no links for disclosure to open");
  assert.match(greeting.instructions!, /`check`: always null\. Nothing in a talk is decided by dice/);
  assert.deepEqual(greeting.text?.format?.schema.properties?.check, { type: "null" }, "a talk's reply has no check");
  // Beside it, the sift (a question a note, and which is the deepest), then the plan.
  const sift = asking(fake, "deepest")[0]!;
  assert.ok(Object.keys(sift.questions!).includes("told_1"));
  assert.equal(formatted(fake, "talk").length, 1);
  assert.doesNotMatch(inputOf(formatted(fake, "talk")[0]!), /The truth about them \(the GM's notes\)/, "the GM's truth only from the third talk");

  const prep = answer.talk as TalkPrep;
  assert.deepEqual(prep.confide, { note: `${KELL}/knowledge/Nan Quill.md`, topic: "the door at the Drowned Rat", what: PLAN.what, memory: PLAN.memory });
  assert.deepEqual(prep.patches.map(p => (p.cast ? "card" : p.fill ? `fill ${p.fill.id}` : "?")), ["card", `fill ${TOLD}`]);
  assert.deepEqual(prep.patches[0]!.cast!.secrets, [
    "Shows: a pause at the Rat's name. Opens: asking what she has against the Rat. First: 'I know the Rat's door. From the wrong side.'",
    `${PLAN.what} They tell it once, in their own words; told is told.`,
  ], "as the scenes' cards keep a secret: the tell, then the thing itself");
  assert.deepEqual(prep.patches[1]!.fill, {
    id: TOLD, revelation: PLAN.what, paths: [
      { via: "kell", clue: "It shows before it comes out: a pause at the Rat's name.", earn: "Free, when the talk comes near it: a tell, never what it's about.", strength: "hook" },
      { via: "kell", clue: `${PLAN.what} The first of it: 'I know the Rat's door. From the wrong side.'`, earn: "Asked about it, they tell it. What brings it out: asking what she has against the Rat.", strength: "strong" },
    ],
  });
  assert.equal(prep.guard, undefined, "no staged secret: the co-GM stages it through her role");
  assert.deepEqual(prep.suggestions, PLAN.suggestions);
  assert.ok(prep.suggestions.length >= 2 && prep.suggestions.length <= 4);
  // The deepest of her story (the stand-in's sift picks the first note: Cob) waits for a later talk.
  assert.deepEqual(prep.withheld, [`${KELL}/knowledge/Cob.md`]);
  const facts = prep.established.join("\n");
  assert.match(facts, /This is the first time Wren Ashdown has stopped for a word with Sergeant Agnes Kell between scenes\./);
  assert.match(facts, /may open up about is the door at the Drowned Rat \(what they're keeping back: on their card, and the talk's discovery\), a piece at a time as the player earns it/);
  assert.match(facts, /Not in this talk, however it comes up: the deepest of Sergeant Agnes Kell's own story \(their note "Cob"/);
  assert.match(facts, /Where the story goes next, and how the time since passed, as Wren Ashdown knows it: Kell is going down the river stairs to the Drowned Rat\./);
});

test("the third talk: the deepest may come out (nothing withheld) and the plan reads the GM's truth; lines only when the controller has them suggested; a prep that fails keeps the facts the talk opened on, with nothing to confide", async () => {
  const third = setUp({ replies: [GREETING], byName: { talk: PLAN } });
  const opened = talkOpen(3, { count: 3, told: [{ note: `${KELL}/knowledge/Wendell Prout.md`, topic: "why Prout's case matters to her", turn: 9 }] }, false);
  const earlier: Entry[] = [
    { turn: 1, speaker: "player:1", kind: "player", text: "Why does this one matter to you?", scene: talkSceneId("kell", 1) },
    { turn: 1, speaker: "gm", kind: "narration", text: "“He came to me first,” says Kell.", scene: talkSceneId("kell", 1) },
  ];
  const req = { ...opened, talk: { ...opened.talk!, earlier } };
  const prep = (await pipeline.open(req, third.contextFor(req.key))).talk!;
  assert.deepEqual(prep.withheld, []);
  const planned = inputOf(formatted(third.fake, "talk")[0]!);
  assert.match(planned, /## The truth about them \(the GM's notes\)/);
  assert.match(planned, /## What they've already told the player of their own story\n- why Prout's case matters to her/);
  assert.match(planned, /## Their earlier talks with the player between scenes, word for word\n### A word with Sergeant Agnes Kell \(talk-kell-1\)\nWren Ashdown \(player\): Why does this one matter to you\?\n\nGM: “He came to me first,” says Kell\./);
  assert.deepEqual(prep.suggestions, [], "lines aren't suggested: none");
  assert.match(prep.established.join("\n"), /This is the third time/);

  const failing = setUp({ replies: [GREETING], capped: { talk: 0.001 } });
  const failed = (await pipeline.open(talkOpen(2, { count: 2, told: [] }), failing.contextFor(`${GAME}:s12:t0:open`))).talk!;
  assert.deepEqual([failed.patches.map(p => p.drop), failed.guard, failed.confide, failed.withheld, failed.suggestions], [[TOLD], undefined, undefined, [], []], "the talk's discovery isn't this talk's");
  assert.match(failed.established.join("\n"), /keeps their own story to themselves/);
});

/** The talk's bookkeeping after its open, as the open's commit keeps it. */
function afterOpen(prep: TalkPrep): GmState {
  const gm = talkGm();
  return {
    ...gm, established: prep.established, patches: prep.patches, withheld: prep.withheld,
    talk: { with: "kell", where: "Granary Street in Caerwyn, evening", ...(prep.confide ? { confide: prep.confide } : {}) },
  };
}

async function openedPrep(): Promise<TalkPrep> {
  const { contextFor } = setUp({ replies: [GREETING], byName: { talk: PLAN } });
  const req = talkOpen(1, { count: 1, told: [] });
  return (await pipeline.open(req, contextFor(req.key))).talk!;
}

function talkSettle(n: number, gm: GmState, line: string, reply: string, suggest = true): SettleRequest {
  const transcript: Entry[] = [
    { turn: 0, speaker: "gm", kind: "narration", text: GREETING },
    { turn: n, speaker: "player:1", kind: "player", text: line },
    { turn: n, speaker: "gm", kind: "narration", text: reply },
  ];
  return {
    key: `${GAME}:s11:t${n}:settle`, game, player,
    turn: { scene: { id: "11", key: talkSceneId("kell", 1), kind: "talk", turn: n }, pc: "pc:1", gm: { ...gm, turnsInBeat: n }, transcript, line: { speaker: "player:1", text: line }, world: TOWN, party: [WIZARD], present: [], story: STORY },
    reply, lines: [], settled: [], talk: { suggest }, twoPart: true,
  };
}

const LINES = "Why do you write everything down?\n- What do you make of the King?\n“Have you always been with the watch?”\nWho taught you to read hands?\nOne line too many";

const ROLE = { status: "Walking beside the investigator, notebook away.", mental_state: "At ease, a little wary of the Rat's name.", conversation_role: "Could let slip she knows the Rat's door; holds back how." };

test("a talk's settle on the two-part GM: the co-GM, her role (the talk's discovery its target, its paths her clues, the GM's notes on her), beside the next lines; no world to keep in step, and nothing in her notes of telling it until it's told", async () => {
  const gm = afterOpen(await openedPrep());
  note(GAME, { id: "kell", name: "Sergeant Agnes Kell" }, "standing", "Warming to the investigator, a little.");
  const { fake, contextFor } = setUp({ talkSuggestions: LINES, coGm: { roles: { kell: ROLE } } });
  const req = talkSettle(1, gm, "What have you got against the Drowned Rat?", "Kell's pencil stops. “Nothing it would understand.”");
  const answer = await pipeline.settle(req, contextFor(req.key));

  assert.deepEqual(answer.coGm?.roles, { kell: ROLE });
  assert.deepEqual(answer.coGm?.moves, [], "the stand-in walks a talk only where a recipe says: its ending is the player's, and what she tells hers");
  const co = fake.sent.find(b => b.tools?.some(t => t.name === "move_scene"))!;
  assert.match(inputOf(co), /# The targets\nThe discoveries not reached yet:\n- Told \[told\]: Twenty years ago Nan Quill put her out/);
  assert.match(inputOf(co), new RegExp(`# Open routes\\n- \\[${GOODBYE}\\] from A word between scenes \\[talk\\] to Goodbye for now \\[${GOODBYE}\\]\\. When: The player says goodbye or ends the talk[^\\n]*\\n- \\[${CONFIDED}\\] from A word between scenes \\[talk\\] to Told \\[told\\]\\. When: its revelation has landed with the player \\(Twenty years ago`));
  assert.match(inputOf(co), /# Notes on the people here \(what's happened with them in play\)\n[\s\S]*## Sergeant Agnes Kell \[kell\]\nStanding with the player: Warming to the investigator, a little\./);
  assert.match(co.instructions!, /- The clues that are theirs to give:\n  - Towards Told \[told\]: It shows before it comes out: a pause at the Rat's name\./);
  assert.match(co.instructions!, /Suggested roles while the scene is here:\n- Sergeant Agnes Kell \[kell\]: Characterise: at their own business/);
  assert.deepEqual(answer.talk, { suggestions: ["Why do you write everything down?", "What do you make of the King?", "Have you always been with the watch?", "Who taught you to read hands?"] });
  const lines = fake.sent.find(b => b.instructions?.startsWith("You suggest what the player might say next in a conversation with Sergeant Agnes Kell"))!;
  assert.match(inputOf(lines), /## What Sergeant Agnes Kell might open up about in this talk \(one line may lead towards it without naming it\)\nthe door at the Drowned Rat/);
  assert.match(inputOf(lines), /Wren Ashdown \(player\): What have you got against the Drowned Rat\?\n\nGM: Kell's pencil stops/, "the talk so far, the reply included");
  assert.deepEqual(answer.ops, []);
  assert.equal(formatted(fake, "world_ops").length, 0, "no stage manager: a talk has no world");
  assert.equal(asking(fake, "guard_kell").length, 0, "no staged secrets: her role stages it");
  assert.equal(readNotes(GAME, "kell").did.length, 0, "nothing told, nothing in her notes");

  // Not asked for (the controller's setting): no lines, and no call for them.
  const quiet = setUp({ talkSuggestions: LINES });
  const off = await pipeline.settle(talkSettle(2, gm, "Fair enough.", "Kell nods.", false), quiet.contextFor(`${GAME}:s11:t2:settle`));
  assert.deepEqual(off.talk, { suggestions: [] });
  assert.equal(quiet.fake.sent.filter(b => b.instructions?.startsWith("You suggest what the player might")).length, 0);
});

test("once the co-GM takes the way into told, a line of the GM's notes on her that she told it is written, once however often it's found told", async () => {
  const gm = afterOpen(await openedPrep());
  const told = setUp({ talkSuggestions: LINES, coGm: { endings: [TOLD] } });
  const req = talkSettle(4, gm, "What happened at the Rat?", "“She put me out through the door. Through it.” Kell says it flatly, and writes nothing down.");
  const answer = await pipeline.settle(req, told.contextFor(req.key));

  assert.deepEqual(answer.coGm?.moves.map(m => m.route), [CONFIDED]);
  const remembered = () => readNotes(GAME, "kell").did.filter(l => l.startsWith("Told Wren"));
  assert.equal(remembered().length, 1);
  assert.match(remembered()[0]!, /^Told Wren about the door at the Drowned Rat, in a word between scenes/);

  // The next turn finds it told already (the discovery reached): nothing written twice, nothing moved.
  const later = { ...gm, reached: ["talk", TOLD], path: [{ turn: 4, from: "talk", to: TOLD, via: CONFIDED, source: "post" as const }] };
  const again = await pipeline.settle(talkSettle(5, later, "And you never went back?", "“Never.”"), setUp({ talkSuggestions: LINES, coGm: { endings: [TOLD] } }).contextFor(`${GAME}:s11:t5:settle`));
  assert.deepEqual(again.coGm?.moves, []);
  assert.equal(remembered().length, 1);
});

const RAY: Mechanic = { kind: "cast", spell: "ray-of-frost", targets: ["kell"], from: { backOff: 30 } };

test("decide with the menu's act chosen already (forced): no mechanic question, no details call, the act is the decision's, and no ruling over it", async () => {
  const { fake, contextFor } = setUp({ choices: { roll_call: "new", mechanic: "attack" } });
  const gm = initialGm({ start: "yard" });
  const line = "(I cast Ray of Frost at Sergeant Agnes Kell)";
  const req: DecideRequest = {
    key: `${GAME}:s1:t1:decide`, game, player,
    turn: { scene: { id: "1", key: "hanged-clerk", kind: "scene", turn: 1 }, pc: "pc:1", gm, transcript: [{ turn: 0, speaker: "gm", kind: "narration", text: "Rain on the cobbles." }, { turn: 1, speaker: "player:1", kind: "player", text: line }], line: { speaker: "player:1", text: line }, world: yardRows(gm), party: [WIZARD], present: [], story: { time: "morning", day: 1, flags: {} } },
    landed: [], forced: RAY,
  };
  const { decision } = await pipeline.decide(req, contextFor(req.key));

  assert.deepEqual(decision.mechanic, RAY);
  assert.equal(decision.considered, undefined, "the act settles it: no ruling, whatever the roll call says");
  const before = asking(fake, "earned")[0]!;
  assert.equal(before.questions!.mechanic, undefined, "not asked: it's chosen");
  assert.equal(fake.sent.filter(b => b.questions?.spell || b.questions?.target || b.questions?.weapon).length, 0, "no details call");

  // Without it, the same line is asked as ever.
  const asked = setUp();
  await pipeline.decide({ ...req, key: `${GAME}:s1:t2:decide`, forced: undefined }, asked.contextFor(`${GAME}:s1:t2:decide`));
  assert.ok(asking(asked.fake, "earned")[0]!.questions!.mechanic);
});

test("POST /v1/looks: an Invention per key it answers (the model's words made safe), a key it left out none, one call a batch of twenty; the canned GM's none", async () => {
  const answer = (key: string, fields: Record<string, unknown>) => ({ key, glyph: "person", letter: "", nerd: "none", color: "grey", motion: "still", light: false, being: false, group: false, material: "none", ...fields });
  const { fake, contextFor } = setUp({ byName: { looks: { looks: [
    answer("a disgruntled swan", { glyph: "letter", letter: "S", nerd: "duck", color: "white", motion: "bob", being: true, material: "flesh" }),
    answer("the purveyor's cart", { glyph: "cart", color: "chartreuse", motion: "spin", material: "wood" }),
    answer("never asked", {}),
  ] } } });
  const req: LooksRequest = { key: `${GAME}:s1:t3:look`, game, things: [{ key: "a disgruntled swan", name: "a disgruntled swan", kind: "creature" }, { key: "the purveyor's cart", name: "the Purveyor's grain cart in garlands", kind: "object" }, { key: "a sackbut", name: "a sackbut" }] };
  const { looks } = await pipeline.looks(req, contextFor(req.key));

  assert.deepEqual(looks, {
    "a disgruntled swan": { glyph: "S", nerd: "duck", color: "white", motion: "bob", light: false, being: true, group: false, material: "flesh" },
    "the purveyor's cart": { glyph: "æ", color: "grey", motion: "still", light: false, being: false, group: false, material: "wood" },
  });
  const call = formatted(fake, "looks")[0]! as Request & { model?: string };
  assert.equal(call.model, LOOK_MODEL);
  assert.match(inputOf(call), /Things:\n- key "a disgruntled swan": a disgruntled swan \(creature\)\n- key "the purveyor's cart": the Purveyor's grain cart in garlands \(object\)\n- key "a sackbut": a sackbut$/);

  const many = setUp();
  const things = Array.from({ length: 25 }, (_, i) => ({ key: `thing ${i}`, name: `thing ${i}` }));
  assert.deepEqual((await pipeline.looks({ ...req, key: `${GAME}:s1:t4:look`, things }, many.contextFor(`${GAME}:s1:t4:look`))).looks, {});
  assert.equal(formatted(many.fake, "looks").length, 2, "twenty, then five");

  const broken = setUp({ capped: { looks: 0.001 } });
  assert.deepEqual((await pipeline.looks(req, broken.contextFor(`${GAME}:s1:t5:look`))).looks, {}, "never fatal: the guesses stand");
  assert.deepEqual((await canned.looks(req, setUp().contextFor(req.key))).looks, {});
});

test("the service: a looks request with no things, or a talk with someone who has no lore entry, is a 400; the canned GM opens a talk with its two lines", async () => {
  const service = memoryStores();
  const ai = aiService({
    token: "t", stores: service, campaigns: campaigns(service.campaigns, service.docs), endpoints: canned,
    transport: () => ({}), stream: { url: "http://127.0.0.1:9", db: "kingmaker", periodMs: 200 },
    serves: { model: "fake", gm: "canned" }, faults: {}, log: () => {}, exit: () => {},
  });
  const post = async (path: string, body: { key: string }) => {
    const res = await ai.answer({ method: "POST", path, headers: { authorization: "Bearer t", "idempotency-key": body.key }, body: JSON.stringify(body) });
    return { status: res.status, body: JSON.parse(res.body) as { error?: { code: string; message: string }; talk?: TalkPrep } };
  };
  assert.equal((await ai.answer({ method: "PUT", path: "/v1/campaigns/caerwyn/0.1.0", headers: { authorization: "Bearer t" }, body: JSON.stringify({ files: FILES }) })).status, 200);

  const none = await post("/v1/looks", { key: `${GAME}:s1:t3:look`, game, things: [] } as LooksRequest);
  assert.deepEqual([none.status, none.body.error?.code], [400, "bad_request"]);
  const nobody = { ...talkOpen(1, { count: 1, told: [] }), key: `${GAME}:s20:t0:open`, scene: { id: "20", key: talkSceneId("nobody", 1), kind: "talk" as const } };
  const refused = await post("/v1/scenes/open", nobody);
  assert.deepEqual([refused.status, refused.body.error?.code], [400, "bad_request"]);
  assert.match(refused.body.error!.message, /nobody has no lore entry/);
  const bad = await post("/v1/scenes/open", { ...talkOpen(1, { count: 1, told: [] }), key: `${GAME}:s21:t0:open`, talk: { with: "kell" } } as unknown as OpenRequest);
  assert.match(bad.body.error?.message ?? "", /talk \{ with, where, record/);

  const opened = await post("/v1/scenes/open", { ...talkOpen(1, { count: 1, told: [] }), key: `${GAME}:s22:t0:open` });
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.body.talk, { established: [], patches: [{ turn: 0, why: "Canned: nothing to confide.", drop: TOLD }], withheld: [], suggestions: ["How are you keeping?", "What do you make of it all?"] });
});
