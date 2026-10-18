import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAERWYN as CREATION } from "../../docs/backstory.ts";
import { configureDocs } from "../../docs/config.ts";
import { readDoc } from "../../docs/docs.ts";
import { readNotes } from "../../docs/notes.ts";
import { CAERWYN, granaryYard, testStory } from "../../gm/fixtures.ts";
import { JevDecider, LUNA_DECISIONS_MODEL } from "../../llm/decide.ts";
import { fakeFetch, type FakeOptions, type Request } from "../../llm/fake-openrouter.ts";
import { initialGm, type GmState, type OwedRow } from "../../../shared/gm/state.ts";
import type { BoundaryRequest, Entry, OpenRequest, StreamReplyArgs } from "../../../shared/protocol/ai.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import { keysFor, worldToRows, type PlaceRows } from "../../../shared/world/rows.ts";
import { buildWorld, joinWorld, type WorldSpec } from "../../../shared/world/scene-world.ts";
import { callContext } from "../calls.ts";
import type { Campaign } from "../campaigns.ts";
import { Failure, type AiContext } from "../context.ts";
import { folderStores } from "../folder-stores.ts";
import { streamSink } from "../stream.ts";
import { pipeline } from "./pipeline.ts";

/**
 * The AI service's side of the whole story (story-design §4.4), on the stand-in model: the boundary
 * (its verdict, its fallbacks, presence, the docs written once for it), an opening after it, a fight's
 * aftermath, and the fake's list of endings (§1.1's recipe). The campaign is the test story
 * (gm/fixtures.ts): the hanged clerk as campaigns/caerwyn has it, the Rat, the Heron and the King's
 * morning as the prototype has them; its lore is the campaign's.
 */

const SCRATCH = mkdtempSync(join(tmpdir(), "km-story-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));
configureDocs({ loreRoot: join(CAERWYN, "lore"), overlay: game => join(SCRATCH, "games", game, "docs") });

const story = testStory();
const INSTALLED = ["hanged-clerk", "drowned-rat", "heron-warehouse", "kings-morning"];
const campaign: Campaign = {
  id: "caerwyn", version: "test", title: "Caerwyn", creation: CREATION, story,
  scene: key => {
    if (!INSTALLED.includes(key)) throw new Failure(400, "bad_request", `campaign caerwyn@test has no scene ${key}`);
    return story.scene(key)!;
  },
};
const sceneOf = (key: string): Scene => campaign.scene(key);

/** A request's context on the stand-in: its calls logged in a store of its own, its stream's posts kept. */
function contextFor(game: string, key: string, options: FakeOptions, fetchVia?: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch) {
  const fake = fakeFetch(options);
  const stores = folderStores(mkdtempSync(join(SCRATCH, "store-")));
  const { calls, usage } = callContext({ fetch: fetchVia ? fetchVia(fake.fetch) : fake.fetch, apiKey: "test" }, stores, { game, key, attempt: 1 });
  const posts: StreamReplyArgs[] = [];
  const capture: typeof fetch = async (_url, init) => { posts.push(JSON.parse(String(init?.body)) as StreamReplyArgs); return new Response(""); };
  const ctx: AiContext = { campaign, calls, usage, attempt: 1, stream: turn => streamSink({ url: "http://stdb.test", db: "kingmaker", token: "t", periodMs: 0, fetch: capture, log: () => {} }, { turn, attempt: 1, started: performance.now() }) };
  return { ctx, fake, posts };
}

/** The model refusing every call (a 400: no retries), or only those of these schemas' names. */
const refusing = (names?: string[]) => (fetch: typeof globalThis.fetch): typeof globalThis.fetch => async (input, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as Request;
  const refused = !names || names.includes(body.text?.format?.name ?? "");
  return refused ? new Response(JSON.stringify({ error: { message: "this test's model says no" } }), { status: 400 }) : fetch(input, init);
};

const party = [{ name: "Wren Ashdown", concept: "a hedge wizard from the fens", skills: {} }];
const gameOf = (n: number) => `5f0c2b7e-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lastNote = (body: Request) => body.input?.filter(m => m.role === "developer").at(-1)?.content ?? "";

/** A place's rows as the simulation sends them: built for whoever of the scene's cast is there, and joined. */
function placeRows(scene: Scene, spec: WorldSpec, placeKey: string, gm: GmState): PlaceRows {
  const people = presentCast(scene, gm).map(c => ({ id: c.id, name: c.name }));
  const world = buildWorld(scene.id, spec, people, { name: "Wren Ashdown" });
  joinWorld(world, people, 0);
  return worldToRows(world, keysFor(placeKey, scene.id, "pc:1"));
}

/** The granary yard's last moments, as the simulation's request has them: "Scene ends" last. */
const YARD: Entry[] = [
  { turn: 0, speaker: "gm", kind: "narration", text: "Behind the King's Granary a small grey-coated clerk turns slowly on the hoist rope." },
  { turn: 1, speaker: "player:1", kind: "player", text: "Sergeant, that's a cord mark, not a rope. Write him down as murdered, persons unknown." },
  { turn: 1, speaker: "gm", kind: "narration", text: "Kell looks at the neck a long moment, then writes." },
  { turn: 2, speaker: "player:1", kind: "player", text: "Let's go." },
  { turn: 2, speaker: "gm", kind: "narration", text: "Kell underlines the line twice. “An open case beats a wrong one.”" },
  { turn: 2, speaker: "system", kind: "system", text: "Scene ends: Murder by persons unknown" },
];

/** The boundary after the granary yard ended "Murder by persons unknown", the page still in Cob's boot. */
function yardBoundary(game: string): BoundaryRequest {
  const gm = initialGm({ start: "yard" });
  return {
    key: `${game}:s1:t2:boundary`, game: { id: game, campaign: "caerwyn", version: "test" }, player: { id: "1", name: "Wren Ashdown" },
    turn: { scene: { id: "1", key: "hanged-clerk", kind: "scene", turn: 2 }, pc: "pc:1", gm, transcript: YARD, world: placeRows(sceneOf("hanged-clerk"), granaryYard(), "granary-yard", gm), party, present: [], story: { time: "morning", day: 1, flags: {} } },
    exit: "open-case", candidates: ["drowned-rat", "heron-warehouse", "kings-morning"],
  };
}

const VERDICT = {
  scenes: [{ id: "drowned-rat", holds: true, why: "The big man hasn't been questioned." }],
  adjustments: ["Kell has signed Prout in as murdered, over the Captain's order.", "Cob was frightened off; he will not be at the Rat tonight."],
  opening: "Open at the Rat's door at dusk. End on the landlady asking the sergeant whether she's on duty.",
  lead: "As the afternoon wears on, Kell tells you she followed a big porter with a bandaged hand down the river stairs to the Drowned Rat.",
};
const FRONTS = { ticked: [{ front: "The Captain's book", step: "If a sergeant signs Prout in as a murder" }], struck: [], bills: [], shows: ["A constable is asking for Sergeant Kell with the Captain's word."] };
const HANDOFF_TEXT = "Kell signed Prout in as murdered, persons unknown, over the Captain's word.\n- The page is still sewn into the boot on Cob's feet.";

test("the boundary answers its verdict: the scene the story goes to, what's handed on to it, who's absent, what's owed by entity key, the fronts moved", async () => {
  const game = gameOf(1);
  const req = yardBoundary(game);
  const { ctx, fake } = contextFor(game, req.key, { byName: { boundary: VERDICT, fronts: FRONTS }, choices: { cob: "not_here" }, replies: [HANDOFF_TEXT] });
  const answer = await pipeline.boundary(req, ctx);

  assert.equal(answer.handOff, `Previous scene, "The Hanged Clerk", ended: Murder by persons unknown (hanged-clerk: open-case).\n${HANDOFF_TEXT}`);
  assert.deepEqual(answer.lastMoments, [
    "Wren Ashdown (player): Sergeant, that's a cord mark, not a rope. Write him down as murdered, persons unknown.",
    "Kell looks at the neck a long moment, then writes.", "Wren Ashdown (player): Let's go.", "Kell underlines the line twice. “An open case beats a wrong one.”",
  ]);
  const { patches, ...next } = answer.next;
  assert.deepEqual(next, { scene: "drowned-rat", skipped: [], adjustments: [...VERDICT.adjustments, FRONTS.shows[0]], opening: VERDICT.opening, lead: VERDICT.lead, absent: ["cob"], hinted: [] });
  assert.deepEqual(patches.map(p => [p.essential?.id, p.essential?.missed]), [["prouts-page", "hanged-clerk:page"]], "the Rat's own prep for the page, brought over");
  assert.deepEqual(answer.owed.map(({ where: _, ...o }) => o), [{ from: "hanged-clerk", id: "page", hinted: false, things: ["granary-yard/boots", "granary-yard/ledger-page"], holders: ["cob"] }]);
  assert.match(answer.owed[0]!.where!, /sewn into the left boot's lining, in Prout's good black boots, with Cob$/);
  assert.deepEqual(answer.fronts, ["ticked: The Captain's book: If a sergeant signs Prout in as a murder"]);
  assert.match(readDoc(game, "World/Fronts.md")!.body, /- \[x\] \*\*If a sergeant signs Prout in as a murder\*\*.*\*\(Ticked after The Hanged Clerk\.\)\*/);
  // The verdict saw the story, the errands, the names unheard, what's owed and the candidates' prep.
  const verdict = fake.sent.find(b => b.text?.format?.name === "boundary")!.input![0]!.content;
  assert.match(verdict, /## The last scene: The Hanged Clerk\nHow it ended: Murder by persons unknown \(hanged-clerk: open-case\)\./);
  assert.match(verdict, /Wren Ashdown \(player\): Let's go\.\n\nGM: Kell underlines the line twice\.[^\n]*\n\n\[Scene ends: Murder by persons unknown\]/);
  assert.match(verdict, /## What people do between scenes \(their lore, GM only\)[\s\S]*### Sergeant Agnes Kell\n[\s\S]*?\*\*The afternoon\*\*/);
  assert.match(verdict, /- Big Hobb Mallory: "the big man with the bandaged hand"/);
  assert.match(verdict, /\[hanged-clerk:page\] Prout found grain/);
  assert.match(verdict, /### drowned-rat: The Drowned Rat[\s\S]*### heron-warehouse: The Heron Warehouse[\s\S]*### kings-morning: The King's Morning/);
  assert.deepEqual(Object.keys(answer.usage.byOperation).sort(), ["boundary", "director.presence", "fronts", "handoff"]);
});

test("a scene play has overtaken is skipped for the next that holds, and the rewrite is that one's", async () => {
  const game = gameOf(2);
  const req = yardBoundary(game);
  const overtaken = { ...VERDICT, scenes: [{ id: "drowned-rat", holds: false, why: "Hobb is already in the cells." }, { id: "heron-warehouse", holds: true, why: "The barge hasn't sailed." }] };
  const { ctx } = contextFor(game, req.key, { byName: { boundary: overtaken }, replies: [HANDOFF_TEXT] });
  const answer = await pipeline.boundary(req, ctx);

  assert.deepEqual([answer.next.scene, answer.next.skipped, answer.next.opening, answer.next.lead], ["heron-warehouse", [{ sceneId: "drowned-rat", why: "Hobb is already in the cells." }], VERDICT.opening, VERDICT.lead]);
  assert.deepEqual(answer.next.patches, [], "the Heron has no prep for the page, and nobody there has it");
});

test("each call falls back as the prototype's does: the ending's own hand-off, the first scene that holds with nothing rewritten, the fronts as they were, nobody absent", async () => {
  const game = gameOf(3);
  const req = yardBoundary(game);
  const { ctx } = contextFor(game, req.key, {}, refusing());
  const answer = await pipeline.boundary(req, ctx);

  assert.match(answer.handOff, /^Previous scene, "The Hanged Clerk", ended: Murder by persons unknown \(hanged-clerk: open-case\)\. Kell writes Prout's death down as murder by persons unknown/);
  assert.equal(answer.lastMoments.length, 4);
  const { patches, ...next } = answer.next;
  assert.deepEqual(next, { scene: "drowned-rat", skipped: [], adjustments: [], absent: [], hinted: [] });
  assert.deepEqual(patches.map(p => p.essential?.id), ["prouts-page"], "what's owed still goes on, by the Rat's own prep");
  assert.deepEqual(answer.fronts, []);
  assert.doesNotMatch(readDoc(game, "World/Fronts.md")!.body, /Ticked after/);

  // Only the verdict failing: the hand-off and the fronts are the model's, and the story goes to the first scene, unrewritten.
  const again = gameOf(4);
  const second = contextFor(again, yardBoundary(again).key, { byName: { boundary: VERDICT, fronts: FRONTS }, replies: [HANDOFF_TEXT] }, refusing(["boundary"]));
  const crossed = await pipeline.boundary(yardBoundary(again), second.ctx);
  assert.equal(crossed.handOff, `Previous scene, "The Hanged Clerk", ended: Murder by persons unknown (hanged-clerk: open-case).\n${HANDOFF_TEXT}`);
  assert.deepEqual([crossed.next.scene, crossed.next.opening, crossed.next.lead, crossed.next.adjustments], ["drowned-rat", undefined, undefined, [FRONTS.shows[0]]]);
  assert.deepEqual(crossed.fronts, ["ticked: The Captain's book: If a sergeant signs Prout in as a murder"]);
});

test("presence is asked only of the next scene's people the hand-off or the adjustments name, and of nobody when they name none", async () => {
  const game = gameOf(5);
  const req = yardBoundary(game);
  const { ctx, fake } = contextFor(game, req.key, { byName: { boundary: { ...VERDICT, adjustments: [] } }, replies: ["Kell signed Prout in as murdered."] });
  await pipeline.boundary(req, ctx);
  const asked = fake.sent.filter(b => b.questions).map(b => Object.keys(b.questions!));
  assert.deepEqual(asked, [["kell"]], "Kell, whom the hand-off names, and none of the Rat's own (Hobb, Nan, Cob, Arlo, Dilly)");

  const quiet = gameOf(6);
  const none = contextFor(quiet, yardBoundary(quiet).key, { byName: { boundary: { ...VERDICT, adjustments: [] } }, replies: ["The yard is empty but for the rain."] });
  const answer = await pipeline.boundary(yardBoundary(quiet), none.ctx);
  assert.deepEqual(none.fake.sent.filter(b => b.questions), [], "nobody named: no presence call");
  assert.deepEqual(answer.next.absent, []);
});

test("the docs are written once for a boundary: run again (an exit after the docs, then the rerun), no line of anyone's notes, played scene or tick is written twice", async () => {
  const game = gameOf(7);
  const options = { byName: { boundary: VERDICT, fronts: FRONTS }, replies: [HANDOFF_TEXT] };
  for (let run = 0; run < 2; run++) await pipeline.boundary(yardBoundary(game), contextFor(game, yardBoundary(game).key, options).ctx);

  const did = (id: string) => readNotes(game, id).did;
  for (const id of ["cob", "moll"]) assert.deepEqual(did(id).filter(l => l.startsWith("Was there when")), ["Was there when The Hanged Clerk ended: Murder by persons unknown."], `${id} was there when it ended, once`);
  assert.deepEqual(did("kell").filter(l => l.startsWith("The Hanged Clerk, as it ended:") || l.startsWith("Was there when")), ["The Hanged Clerk, as it ended: Prout was murdered; nobody has been named for it yet, and the case is open."], "Kell's memory of how it ended (the ending's own), once");
  assert.deepEqual(readNotes(game, "tull"), { standing: [], seen: [], learned: [], promises: [], did: [] }, "Tull wasn't there at the end");
  assert.deepEqual(did("kell").filter(l => l.startsWith("Between The Hanged Clerk and The Drowned Rat")).map(l => l.split(": ")[0]), [
    "Between The Hanged Clerk and The Drowned Rat, as Wren heard it", "Between The Hanged Clerk and The Drowned Rat", "Between The Hanged Clerk and The Drowned Rat",
  ], "the time between, once each: the lead, the adjustment about her and the fronts' word that shows");
  assert.equal(did("cob").filter(l => l.startsWith("Between The Hanged Clerk and The Drowned Rat")).length, 1, "Cob, whom an adjustment names");
  assert.equal(readDoc(game, "story/index.md")!.body.split("\n").filter(l => l.includes("(scenes/hanged-clerk.md)")).length, 1, "the played scene in the story's index, once");
  assert.match(readDoc(game, "story/scenes/hanged-clerk.md")!.body, /^Previous scene, "The Hanged Clerk", ended:/);
  assert.equal(readDoc(game, "World/Fronts.md")!.body.split("(Ticked after The Hanged Clerk.)").length - 1, 1, "the step ticked once");
});

/** The Rat as it opens after the granary: what the boundary handed on, the story so far. */
function ratOpening(game: string, gm: Partial<GmState> = {}): OpenRequest {
  const rat = sceneOf("drowned-rat");
  const state: GmState = { ...initialGm({ start: rat.start }), adjustments: VERDICT.adjustments, opening: VERDICT.opening, lead: VERDICT.lead, absent: ["cob"], ...gm };
  const handOff = `Previous scene, "The Hanged Clerk", ended: Murder by persons unknown (hanged-clerk: open-case).\n${HANDOFF_TEXT}`;
  return {
    key: `${game}:s2:t0:open`, game: { id: game, campaign: "caerwyn", version: "test" }, player: { id: "1", name: "Wren Ashdown" },
    scene: { id: "2", key: "drowned-rat", kind: "scene" }, pc: "pc:1", gm: state, world: placeRows(rat, rat.world!, "drowned-rat", state), party,
    story: { time: "evening", day: 1, flags: {}, history: [{ sceneId: "hanged-clerk", exitId: "open-case", summary: handOff, lastMoments: ["Wren Ashdown (player): Let's go.", "Kell underlines the line twice."], journal: ["Prout was murdered. The watch has it down as persons unknown."] }], earlier: YARD.map(e => ({ ...e, scene: "hanged-clerk" })) },
    stream: { turn: "21" },
  };
}

test("an opening after a boundary picks up from how the last scene ended: the second branch with the rewritten opening, and the story so far in the GM's prep", async () => {
  const game = gameOf(8);
  const owed: OwedRow[] = [{ from: "hanged-clerk", id: "page", hinted: false, things: ["granary-yard/boots", "granary-yard/ledger-page"], holders: ["cob"], where: "a folded page sewn into the left boot's lining, in Prout's good black boots, with Cob" }];
  const req = ratOpening(game, { owed });
  const { ctx, fake, posts } = contextFor(game, req.key, { replies: ["The din drops by half as you come down the steps. [the landlady] “Sergeant. On duty?”"] });
  const answer = await pipeline.open(req, ctx);

  const gm = fake.sent.find(b => b.stream)!;
  assert.match(lastNote(gm), /## For this reply\nOpen the scene: show the whole of the opening below, from its first glance to the moment it ends on\. None of it has happened yet[^\n]*The opening, as it stands after what actually happened: Open at the Rat's door at dusk\. End on the landlady asking the sergeant whether she's on duty\. Keep it to a short paragraph or two, and end on what it ends on: something the player can respond to\.$/);
  const prep = gm.input![0]!.content;
  assert.match(prep, /## What happened just before this scene\n[\s\S]*Previous scene, "The Hanged Clerk", ended: Murder by persons unknown \(hanged-clerk: open-case\)\.\nKell signed Prout in as murdered[\s\S]*The last moments, word for word:\n> Wren Ashdown \(player\): Let's go\./);
  assert.match(prep, /## Where the prep is out of date\n[^\n]*\n- Kell has signed Prout in as murdered, over the Captain's order\.\n- Cob was frightened off/);
  assert.match(prep, /- What they did and saw earlier in the story \(everything that was narrated to them\):\n {2}- The Hanged Clerk: Murder by persons unknown\. Their notebook: "Prout was murdered\. The watch has it down as persons unknown\."\n/, "the scenes played, by their titles");
  assert.equal(gm.input!.at(-1)!.content, "(The player is ready. Begin.)", "the earlier scene's lines are the story so far, not this scene's conversation");
  assert.deepEqual(answer.present, ["hobb", "nan-quill", "kell", "arlo", "dilly"], "Cob is absent");
  assert.equal(answer.entries[0]!.text, "The din drops by half as you come down the steps. “Sergeant. On duty?”");
  assert.equal(posts.at(-1)!.turnId, 21);
});

test("the aftermath of a fight streams as an opening does, and the stage manager's operations come back by game key, with the player kept in the place", async () => {
  const game = gameOf(9);
  const heron = sceneOf("heron-warehouse");
  const summary = "After a short, ugly fight the Crakes went down and Sallow surrendered, very politely.";
  const gm: GmState = { ...initialGm({ start: heron.start }), beat: "midnight", fought: ["fight"], established: [`The fight is over: ${summary}`] };
  const blank = { to: "", how: "", feet: 0, name: "", kind: "", text: "", add: [], remove: [], quantity: 0 };
  const ops = [{ ...blank, op: "move", what: "sallow", to: "counting-box" }, { ...blank, op: "remove", what: "player", text: "away down the wharf" }, { ...blank, op: "state", what: "player", add: ["gone", "prone"] }];
  const req: OpenRequest = {
    key: `${game}:s3:t5:open`, game: { id: game, campaign: "caerwyn", version: "test" }, player: { id: "1", name: "Wren Ashdown" },
    scene: { id: "3", key: "heron-warehouse", kind: "scene" }, pc: "pc:1", gm, world: placeRows(heron, heron.world!, "heron", gm), party,
    story: { time: "night", day: 1, flags: {} }, stream: { turn: "33" }, aftermath: { summary },
    transcript: [
      { turn: 4, speaker: "player:1", kind: "player", text: "(I go for Sallow with my blade)" },
      { turn: 4, speaker: "system", kind: "system", text: "Scene ends: Roll for initiative" },
      { turn: 5, speaker: "system", kind: "system", text: `The fight: ${summary}` },
    ],
  };
  const { ctx, fake, posts } = contextFor(game, req.key, { replies: ["Sallow straightens his cuffs. “I surrender, naturally.”"], byName: { world_ops: { ops } } });
  const answer = await pipeline.open(req, ctx);

  const reply = fake.sent.find(b => b.stream)!;
  assert.match(lastNote(reply), /## For this reply\nThe fight is over, and this is how it went: After a short, ugly fight the Crakes went down and Sallow surrendered, very politely\.\. Narrate the immediate aftermath in a short paragraph/);
  assert.ok(reply.input!.some(m => m.role === "developer" && m.content === `[The fight: ${summary}]`), "the fight's line is in the GM's history");
  assert.equal(answer.entries[0]!.text, "Sallow straightens his cuffs. “I surrender, naturally.”");
  assert.deepEqual([posts.at(-1)!.turnId, posts.at(-1)!.done], [33, true]);
  const stage = fake.sent.find(b => b.text?.format?.name === "world_ops")!;
  assert.match(stage.input![0]!.content, /## The latest exchange\nPlayer: \(The fight is over\.\)\n\nGM: Sallow straightens his cuffs/);
  assert.match(stage.input![0]!.content, /## Settled before this exchange[^\n]*\n- The fight is over: After a short, ugly fight/);
  assert.deepEqual(answer.ops?.map(o => [o.op, o.what, o.to, o.add]), [["move", "sallow", "heron/counting-box", []], ["state", "pc:1", "", ["prone"]]]);
  assert.deepEqual(Object.keys(answer.usage.byOperation).sort(), ["gm.aftermath", "world.stage"], "no disclosure: the prototype's aftermath opens none");
  assert.deepEqual(answer.opened, []);
});

test("the fake takes a list of choices for a question: the first of them it offers (§1.1's endings, each scene's own)", async () => {
  const fake = fakeFetch({ choices: { ending: ["open-case", "hobb-talks", "fight", "caught-in-the-act", "justice"] } });
  const decider = new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions", { fetch: fake.fetch, apiKey: "test", log: () => {}, cost: () => {} });
  const ending = (...exits: string[]) => ({ ending: { instructions: "Which ending?", criteria: Object.fromEntries([...exits, "not_yet"].map(e => [e, e])) } });
  const choice = async (...exits: string[]) => (await decider.decide({}, ending(...exits), "director.after")).answers.ending!.choice;

  assert.equal(await choice("case-made", "open-case", "walked-away"), "open-case");
  assert.equal(await choice("taken-in", "hobb-talks"), "hobb-talks");
  assert.equal(await choice("proof-taken", "caught-in-the-act", "fight"), "fight", "the first of the list on offer, not the first offered");
  assert.equal(await choice("proof-taken", "caught-in-the-act"), "caught-in-the-act", "once the fight is fought");
  assert.equal(await choice("after-the-assembly"), "not_yet", "none of them on offer: the quiet choice");
});
