import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fakeFetch, type FakeOptions, type Request } from "../../llm/fake-openrouter.ts";
import { prompt } from "../../prompts/index.ts";
import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import type { Markup } from "../../../shared/markup.ts";
import type { DecideRequest, Entry, NotesRequest, OpenRequest, Outcome, ReplyRequest, SettleRequest, StreamReplyArgs, SuggestRequest } from "../../../shared/protocol/ai.ts";
import type { PlaceFile } from "../../../shared/scene/files.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { keysFor, worldToRows, type PlaceRows } from "../../../shared/world/rows.ts";
import { buildWorld, joinWorld } from "../../../shared/world/scene-world.ts";
import { callContext } from "../calls.ts";
import { campaigns } from "../campaigns.ts";
import type { AiContext } from "../context.ts";
import { folderStores } from "../folder-stores.ts";
import { streamSink } from "../stream.ts";
import { pipeline } from "./pipeline.ts";

const CAERWYN = join(import.meta.dirname, "..", "..", "..", "campaigns", "caerwyn");
const GAME = "0d1e2f3a-0000-4000-8000-0000000000aa";
const LINE = "Sergeant, who found him?";

/** Every test's store is a folder in this one, removed once the file's tests are done (a store holds a whole campaign: left behind, a run's worth fills a tmpfs's inodes in a few hundred runs). */
const SCRATCH = mkdtempSync(join(tmpdir(), "km-pipeline-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}

/** The campaign installed in a fresh store, and a request's context on the stand-in, its stream posts and its calls kept. */
async function setUp(options: FakeOptions = {}) {
  const store = mkdtempSync(join(SCRATCH, "store-"));
  const stores = folderStores(store);
  const installed = campaigns(stores.campaigns, stores.docsRoot);
  await installed.put("caerwyn", "0.1.0", filesOf(CAERWYN));
  const campaign = installed.use("caerwyn", "0.1.0");
  const fake = fakeFetch(options);
  const posts: StreamReplyArgs[] = [];
  const capture: typeof fetch = async (_url, init) => { posts.push(JSON.parse(String(init?.body)) as StreamReplyArgs); return new Response(""); };
  const contextFor = (key: string): AiContext => {
    const { calls, usage } = callContext({ fetch: fake.fetch, apiKey: "test" }, stores, { game: GAME, key, attempt: 1 });
    return { campaign, calls, usage, attempt: 1, stream: turn => streamSink({ url: "http://stdb.test", db: "kingmaker", token: "t", periodMs: 0, fetch: capture, log: () => {} }, { turn, attempt: 1, started: performance.now() }) };
  };
  return { store, campaign, fake, posts, contextFor };
}

/** The opening world as the simulation builds it (buildWorld, joinWorld) and sends it, as rows; with `others`, people of the place's own (not the cast), by their local ids. */
function openingRows(gm: GmState, campaign: Awaited<ReturnType<typeof setUp>>["campaign"], others: Record<string, string> = {}): PlaceRows {
  const place = JSON.parse(readFileSync(join(CAERWYN, "places", "granary-yard.json"), "utf8")) as PlaceFile;
  const people = presentCast(campaign.scene("hanged-clerk"), gm).map(c => ({ id: c.id, name: c.name }));
  const world = buildWorld("hanged-clerk", place, people, { name: "Wren Ashdown" });
  joinWorld(world, people, 0);
  for (const [id, name] of Object.entries(others)) world.entities[id] = { id, name, kind: "person", parent: "lane", tags: [], states: [], notes: [] };
  return worldToRows(world, keysFor("granary-yard", "hanged-clerk", "pc:1"));
}

const party = [{ name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "human wizard 3 (Evoker), sage background", skills: { arcana: 5, history: 5, insight: 3, investigation: 5, persuasion: 1 }, status: "HP 17/17, spell slots 1st 4/4, 2nd 2/2" }];
const story = { time: "morning", day: 1, flags: {} };
const game = { id: GAME, campaign: "caerwyn", version: "0.1.0" };

function openRequest(rows: PlaceRows): OpenRequest {
  return { key: `${GAME}:s1:t0:open`, game, player: { id: "1", name: "Wren Ashdown" }, scene: { id: "1", key: "hanged-clerk", kind: "scene" }, pc: "pc:1", gm: initialGm({ start: "yard" }), world: rows, party, story, stream: { turn: "7" } };
}

function turnOf(n: number, gm: GmState, rows: PlaceRows, transcript: Entry[]) {
  const line = transcript.findLast(e => e.kind === "player")!.text;
  return { scene: { id: "1", key: "hanged-clerk", kind: "scene" as const, turn: n }, pc: "pc:1", gm, transcript, line: { speaker: "player:1", text: line }, world: rows, party, present: [], story };
}

const opening: Entry = { turn: 0, speaker: "gm", kind: "narration", text: "Rain on the cobbles. A body hangs from the hoist." };
const said = (n: number, text = LINE): Entry => ({ turn: n, speaker: "player:1", kind: "player", text });

/** A decision call's questions, and a Responses call's last developer message (the GM's note for this reply). */
const questionsOf = (body: Request) => Object.keys(body.questions ?? {});
const noteOf = (body: Request) => body.input?.filter(m => m.role === "developer").at(-1)?.content ?? "";

test("the opening: what bears on the scene's start is opened, the GM opens it, and its words stream to the opening's draft", async () => {
  const { campaign, fake, posts, contextFor, store } = await setUp({ replies: ["[Kell] “You took your time.” The boy in the boots lobs another stone."] });
  const req = openRequest(openingRows(initialGm({ start: "yard" }), campaign));
  const answer = await pipeline.open(req, contextFor(req.key));

  const gmCall = fake.sent.find(b => b.stream)!;
  assert.deepEqual(answer.present, ["kell", "cob", "moll"]);
  assert.equal(answer.entries[0]!.text, "“You took your time.” The boy in the boots lobs another stone.");
  assert.deepEqual(answer.entries[0]!.markup?.speech.map(s => [s.speaker, s.tag]), [["kell", "Kell"]]);
  assert.ok(answer.opened.length > 0 && answer.opened.every(n => n.turn === 0), "disclosure opened notes, on turn 0");
  assert.equal(gmCall.instructions, prompt("gm", { tone: prompt("tone-comic") }));
  assert.equal(gmCall.input!.at(-1)!.content, "(The player is ready. Begin.)");
  assert.match(noteOf(gmCall), /## For this reply\nOpen the scene\. /);
  assert.match(noteOf(gmCall), /## The world right now/);
  assert.ok(existsSync(join(store, "games", GAME, "docs", "Player", "Wren Ashdown.md")), "the player's doc is made");
  assert.deepEqual(posts.map(p => p.seq), posts.map((_, i) => i + 1));
  assert.deepEqual([posts.at(-1)!.turnId, posts.at(-1)!.done, posts.at(-1)!.text], [7, true, answer.entries[0]!.text]);
  assert.ok(answer.usage.calls === fake.sent.length && answer.usage.byOperation["gm.opening"]?.calls === 1);
});

test("decide: the route the turn takes with its check (rolled by the simulation), and whose memories bear on it", async () => {
  const { campaign, fake, contextFor } = await setUp({ choices: { attempt: "catch-moll" } });
  const gm = initialGm({ start: "yard" });
  const req: DecideRequest = { key: `${GAME}:s1:t1:decide`, game, player: { id: "1", name: "Wren Ashdown" }, turn: turnOf(1, gm, openingRows(gm, campaign), [opening, said(1, "Moll, you never saw him jump. You were asleep on that wall.")]), landed: [] };
  const answer = await pipeline.decide(req, contextFor(req.key));

  const before = fake.sent.find(b => b.questions?.earned)!;
  assert.deepEqual(answer.decision.route, { id: "catch-moll", phase: "attempt", check: { skill: "insight", dc: 13, reason: "to see through Moll's story about the jump" } });
  assert.deepEqual([answer.decision.earned, answer.decision.daft, answer.decision.outOfCharacter], [false, false, false]);
  assert.deepEqual(questionsOf(before), ["attempt", "attempt_means", "cue", "earned", "daft", "ooc", "limit"]);
  assert.ok(Object.keys(before.questions!.attempt!.criteria).some(k => k.startsWith("plain:")), "the outcomes that simply happen are options");
  assert.ok(answer.opened.length > 0);
  assert.deepEqual(answer.decision.remembered, ["Sergeant Agnes Kell", "Cob", "Moll"]);
});

test("decide on the wind-down asks only whether the player is out of character", async () => {
  const { campaign, fake, contextFor } = await setUp({ choices: { ooc: "out_of_character" } });
  const gm: GmState = { ...initialGm({ start: "yard" }), closing: { exitId: "case-made", turn: 3 } };
  const req: DecideRequest = { key: `${GAME}:s1:t4:decide`, game, player: { id: "1", name: "Wren Ashdown" }, turn: turnOf(4, gm, openingRows(gm, campaign), [opening, said(4, "(What happens now?)")]), landed: [] };
  const answer = await pipeline.decide(req, contextFor(req.key));

  assert.deepEqual(answer.decision, { earned: false, daft: false, outOfCharacter: true });
  assert.deepEqual(fake.sent.map(questionsOf), [["ooc"]]);
  assert.deepEqual(answer.opened, []);
});

test("reply: the directives rebuilt from what the decide commit did, a repeat warned of and cleared, streamed", async () => {
  const { campaign, fake, posts, contextFor } = await setUp({ replies: ["Moll's grin slips. “Fine. I didn't see him jump.”"] });
  const gm: GmState = { ...initialGm({ start: "yard" }), beat: "doubt", path: [{ turn: 1, from: "yard", to: "doubt", via: "catch-moll", source: "pre", known: 0, roll: { skill: "insight", dc: 13, die: 15, modifier: 3, total: 18, success: true, critical: null } }], repeated: "The boy lobs another stone at the hanged man's boots." };
  const roll = gm.path[0]!.roll!;
  const outcome: Outcome = { lines: ["Insight check to see through Moll's story about the jump: 15 + 3 = 18 vs DC 13: success"], directives: [], wasStuck: false, move: { route: "catch-moll", phase: "attempt", from: "yard", to: "doubt", roll, chosen: true } };
  const req: ReplyRequest = { key: `${GAME}:s1:t1:reply`, game, player: { id: "1", name: "Wren Ashdown" }, turn: turnOf(1, gm, openingRows(gm, campaign), [opening, said(1, "Moll, you never saw him jump."), { turn: 1, speaker: "dice", kind: "roll", text: outcome.lines[0]! }]), decision: { route: { id: "catch-moll", phase: "attempt", check: { skill: "insight", dc: 13 } }, earned: false, daft: false, outOfCharacter: false }, outcome, stream: { turn: "9" } };
  const answer = await pipeline.reply(req, contextFor(req.key));

  const note = noteOf(fake.sent[0]!);
  assert.match(note, /## For this reply\nThe player's attempt called for a Insight check to see through Moll's story about the jump\. Insight check: 15 \+ 3 = 18 vs DC 13: success\. /);
  assert.match(note, /The scene has moved on to "Not by his own hand"/);
  assert.match(note, /Your last reply repeated something already said, word for word \("The boy lobs another stone at the hanged man's boots\."\)/);
  assert.ok(fake.sent[0]!.input!.some(m => m.role === "developer" && m.content === `[${outcome.lines[0]}]`), "the dice line is in the GM's history");
  assert.equal(answer.gm.repeated, null);
  assert.equal(answer.entries[0]!.text, "Moll's grin slips. “Fine. I didn't see him jump.”");
  assert.equal(posts.at(-1)!.done, true);
});

test("reply on the wind-down closes the scene with gm.closing, unless the player spoke out of character", async () => {
  const { campaign, fake, contextFor, store } = await setUp();
  const gm: GmState = { ...initialGm({ start: "yard" }), closing: { exitId: "walked-away", turn: 3 } };
  const base = { game, player: { id: "1", name: "Wren Ashdown" }, stream: { turn: "11" } };
  const closing: ReplyRequest = { ...base, key: `${GAME}:s1:t4:reply`, turn: turnOf(4, gm, openingRows(gm, campaign), [opening, said(4, "I tip my hat and go.")]), decision: { earned: false, daft: false, outOfCharacter: false }, outcome: { lines: [], directives: [], wasStuck: false, windDown: { exit: "walked-away" } } };
  const ooc: ReplyRequest = { ...closing, key: `${GAME}:s1:t5:reply`, decision: { earned: false, daft: false, outOfCharacter: true } };
  await pipeline.reply(closing, contextFor(closing.key));
  await pipeline.reply(ooc, contextFor(ooc.key));

  const logged = readFileSync(join(store, "games", GAME, "calls.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(logged.filter(e => !e.started).map(e => e.operation), ["gm.closing", "gm.reply"]);
  assert.match(noteOf(fake.sent[0]!), /## For this reply\nThe scene is ending: /);
  assert.match(noteOf(fake.sent[1]!), /Nothing in the story moves on while you answer: the scene has come to Walked away/);
});

test("settle: the stage manager's operations by game key, beside the after-reply reading", async () => {
  const ops = [
    { op: "move", what: "player", to: "loft", how: "", feet: 0, name: "", kind: "", text: "", add: [], remove: [], quantity: 0 },
    { op: "move", what: "kell", to: "player", how: "", feet: 0, name: "", kind: "", text: "", add: [], remove: [], quantity: 0 },
  ];
  const { campaign, fake, contextFor } = await setUp({ byName: { world_ops: { ops } }, choices: { status: "drifting", ask: "unanswered" } });
  const gm = initialGm({ start: "yard" });
  const req: SettleRequest = { key: `${GAME}:s1:t1:settle`, game, player: { id: "1", name: "Wren Ashdown" }, turn: turnOf(1, gm, openingRows(gm, campaign), [opening, said(1), { turn: 1, speaker: "gm", kind: "narration", text: "Kell points at the boy." }]), reply: "Kell points at the boy.", lines: [], settled: [] };
  const answer = await pipeline.settle(req, contextFor(req.key));

  const stage = fake.sent.find(b => b.text?.format?.name === "world_ops")!;
  assert.deepEqual(answer.ops.map(o => [o.op, o.what, o.to]), [["move", "pc:1", "granary-yard/loft"], ["move", "kell", "pc:1"]]);
  assert.match(stage.input![0]!.content, /## The latest exchange\nPlayer: Sergeant, who found him\?\n\nGM: Kell points at the boy\./);
  assert.deepEqual(answer.after, { status: "drifting", landed: [], hinted: [], unanswered: true, theirs: false });
  assert.deepEqual(questionsOf(fake.sent.find(b => b.questions)!), ["status", "ending", "landed_not-suicide", "landed_page", "landed_silvertop", "outcome", "ask", "own_exit"]);
});

test("settle when the reply closed the scene: the world kept in step, no reading", async () => {
  const { campaign, fake, contextFor } = await setUp();
  const gm: GmState = { ...initialGm({ start: "yard" }), ended: { exitId: "case-made", turn: 2 } };
  const req: SettleRequest = { key: `${GAME}:s1:t2:settle`, game, player: { id: "1", name: "Wren Ashdown" }, turn: turnOf(2, gm, openingRows(gm, campaign), [opening, said(2)]), reply: "Kell writes it down.", lines: [], settled: [] };
  const answer = await pipeline.settle(req, contextFor(req.key));

  assert.equal(answer.after, undefined);
  assert.deepEqual(fake.asked, ["/api/v1/responses"]);
});

test("who says each line goes by the game's keys, as the reply streams and once it's whole: the place's own people under the place", async () => {
  const { campaign, posts, contextFor } = await setUp({ replies: ["[the porter] “Mind your feet.” He shoulders a sack. [Kell] “Out.” (The rope)[why: it's frayed] creaks."], streamMs: 40 });
  const gm = initialGm({ start: "yard" });
  const rows = openingRows(gm, campaign, { porter: "the porter" });
  const req: ReplyRequest = { key: `${GAME}:s1:t1:reply`, game, player: { id: "1", name: "Wren Ashdown" }, turn: turnOf(1, gm, rows, [opening, said(1)]), decision: { earned: false, daft: false, outOfCharacter: false }, outcome: { lines: [], directives: [], wasStuck: false }, stream: { turn: "9" } };
  const answer = await pipeline.reply(req, contextFor(req.key));
  const entry = answer.entries[0]!;
  const speakersOf = (markup: Markup | undefined) => markup?.speech.map(s => s.speaker);

  assert.deepEqual(speakersOf(entry.markup), ["granary-yard/porter", "kell"]);
  assert.deepEqual(entry.markup!.marks, [], "the GM's own note never reaches the screen");
  assert.deepEqual(entry.drafted, [{ start: entry.text.indexOf("The rope"), end: entry.text.indexOf("The rope") + 8, kind: "why" }], "where it marked, for the notes");
  const streamed = posts.filter(p => "some" in p.markup).map(p => speakersOf(JSON.parse((p.markup as { some: string }).some) as Markup));
  assert.ok(streamed.length >= 2, "the draft is posted as it grows, with its speakers");
  assert.deepEqual(streamed[0], ["granary-yard/porter"], "coloured before the reply is whole");
  assert.deepEqual(streamed.at(-1), ["granary-yard/porter", "kell"]);
});

test("a request's markup by game key is the world's again in the GM's history: the porter is the porter", async () => {
  const { campaign, fake, contextFor } = await setUp();
  const gm = initialGm({ start: "yard" });
  const text = "“Mind your feet.” He glares.";
  const markup: Markup = { speech: [{ start: 0, end: text.indexOf(" He"), speaker: "granary-yard/porter" }], marks: [{ start: text.indexOf("glare"), end: text.indexOf("glare") + 5, kind: "why", note: "you trod on his sack.", link: { kind: "person", id: "granary-yard/porter" }, card: { title: "The porter", lines: [] } }] };
  const entries: Entry[] = [{ turn: 0, speaker: "gm", kind: "narration", text, markup }, said(1)];
  const req: ReplyRequest = { key: `${GAME}:s1:t1:reply`, game, player: { id: "1", name: "Wren Ashdown" }, turn: turnOf(1, gm, openingRows(gm, campaign, { porter: "the porter" }), entries), decision: { earned: false, daft: false, outOfCharacter: false }, outcome: { lines: [], directives: [], wasStuck: false }, stream: { turn: "9" } };
  await pipeline.reply(req, contextFor(req.key));

  assert.deepEqual(fake.sent[0]!.input!.filter(m => m.role === "assistant").map(m => m.content), ["[the porter] “Mind your feet.” He (glare)[why: you trod on his sack.]s."]);
});

// --- The notes on a reply's marks.

/** A reply on the transcript after the player's first line: the porter's line (the place's own man), and Kell's; the GM marked the porter's scowl. */
const NOTED = "The porter scowls. “Not for the watch,” he says. Kell sighs. “He found him at first light.”";
const at = (words: string) => ({ start: NOTED.indexOf(words), end: NOTED.indexOf(words) + words.length });
const notedReply: NotesRequest["reply"] = {
  seq: 3, text: NOTED,
  speech: [{ ...at("“Not for the watch,”"), speaker: "granary-yard/porter" }, { ...at("“He found him at first light.”"), speaker: "kell" }],
  drafted: [{ ...at("scowls"), kind: "why" }],
};
function notesRequest(campaign: Awaited<ReturnType<typeof setUp>>["campaign"], reply = notedReply): NotesRequest {
  const gm = initialGm({ start: "yard" });
  const { line: _, ...turn } = turnOf(1, gm, openingRows(gm, campaign, { porter: "the porter" }), [opening, said(1), { turn: 1, speaker: "gm", kind: "narration", text: reply.text, markup: { speech: reply.speech, marks: [] } }]);
  return { key: `${GAME}:s1:t1:notes`, game, player: { id: "1", name: "Wren Ashdown" }, turn, reply };
}

test("notes: written from what the player knows, placed on the reply's words, linked by the game's keys, each link with its card", async () => {
  const notes = [
    { on: "M1", words: "scowls", kind: "why", note: "The porter doesn't want the watch in his yard.", turn: 0, lore: "" },
    { on: "", words: "Kell sighs", kind: "why", note: "Kell has had a long, wet morning of it.", turn: 0, lore: "" },
  ];
  const { campaign, fake, contextFor } = await setUp({ byName: { notes: { notes } } });
  const req = notesRequest(campaign);
  const answer = await pipeline.notes(req, contextFor(req.key));
  const asked = fake.sent.find(b => b.text?.format?.name === "notes")!;

  assert.equal(asked.instructions, prompt("notes"));
  assert.match(asked.input![1]!.content, /Its spoken lines:\nL1 \(the porter\): “Not for the watch,”\nL2 \(Sergeant Agnes Kell\): “He found him at first light\.”/);
  assert.match(asked.input![1]!.content, /The game master's marks:\nM1 \(why\) on «scowls»/);
  assert.deepEqual(answer.marks.map(m => [NOTED.slice(m.start, m.end), m.kind, m.note, m.link]), [
    ["scowls", "why", "The porter doesn't want the watch in his yard.", { kind: "person", id: "granary-yard/porter" }],
    ["Kell sighs", "why", "Kell has had a long, wet morning of it.", { kind: "person", id: "kell" }],
  ]);
  assert.deepEqual(answer.marks[0]!.card, { title: "The porter", lines: ["You met them in this scene.", "Last said to you (turn 1): “Not for the watch,”"] });
  assert.equal(answer.marks[1]!.card!.title, "Sergeant Agnes Kell");
  assert.equal(answer.marks[1]!.card!.lines[0], "A sergeant of the Caerwyn city watch, out of the watch house by the granary quarter.", "her public lore's first words, once her name's been heard");
  assert.equal(answer.marks[1]!.card!.lines.at(-1), "Last said to you (turn 1): “He found him at first light.”");
  assert.equal(answer.usage.byOperation.notes?.calls, 1);
});

test("notes: a reply with nothing to note (no spoken line, no mark of the GM's) makes no call, and a model that fails gives none", async () => {
  const { campaign, fake, contextFor, store } = await setUp();
  const quiet = notesRequest(campaign, { seq: 3, text: "Rain drips from the hoist.", speech: [], drafted: [] });
  assert.deepEqual((await pipeline.notes(quiet, contextFor(quiet.key))).marks, []);
  assert.equal(fake.sent.length, 0);

  const req = notesRequest(campaign);
  const refusing: typeof fetch = async () => new Response(JSON.stringify({ error: { message: "the model is unwell" } }), { status: 400 });
  const { calls, usage } = callContext({ fetch: refusing, apiKey: "test" }, folderStores(store), { game: GAME, key: req.key, attempt: 1 });
  const failed = await pipeline.notes(req, { ...contextFor(req.key), calls, usage });
  assert.deepEqual(failed.marks, []);
});

// --- The lines suggested after a reply.

const LINES = ["say: Sergeant, who saw it happen?", "say: Moll, who paid you to say he jumped?", "say: Lovely morning for it.", "do: (I look up at the body)", "try: (I try to coax the boy down with a pie)", "say: Nice boots, boy.", "say: Who found him, Sergeant?"].join("\n");

function suggestRequest(campaign: Awaited<ReturnType<typeof setUp>>["campaign"], offered: string[]): SuggestRequest {
  const gm = initialGm({ start: "yard" });
  const reply: Entry = { turn: 1, speaker: "gm", kind: "narration", text: "Kell flips her notebook open. “The porters, at first light.”" };
  const { line: _, ...turn } = turnOf(1, gm, openingRows(gm, campaign), [opening, said(1), reply]);
  return { key: `${GAME}:s1:t1:suggest`, game, player: { id: "1", name: "Wren Ashdown" }, turn, offered };
}

/** The stand-in's fetch, but each call `fails` picks answered 400. */
const failing = (fake: { fetch: typeof fetch }, fails: (url: string, body: Request) => boolean): typeof fetch => async (input, init) => {
  const url = String(input);
  return fails(url, JSON.parse(String(init?.body ?? "{}")) as Request) ? new Response(JSON.stringify({ error: { message: "no" } }), { status: 400 }) : fake.fetch(input, init);
};

test("suggest: lines from what the player knows, screened, judged and mixed, none of the scene's last set again", async () => {
  const { campaign, fake, contextFor } = await setUp({ suggestions: LINES, choices: { line_4: "gives_away" } });
  const req = suggestRequest(campaign, ["Lovely morning for it."]);
  const answer = await pipeline.suggest(req, contextFor(req.key));
  const asked = fake.sent.find(b => b.instructions?.startsWith("You suggest what the player might"))!;
  const judged = fake.sent.find(b => b.questions?.line_1)!;

  assert.equal(asked.instructions, prompt("suggest"));
  assert.equal(asked.max_output_tokens, 150);
  assert.match(asked.input![0]!.content, /# Not again\nThe player just said: Sergeant, who found him\?\nOffered last time \(none of these again, not even in other words: the player has seen them\):\n- Lovely morning for it\./);
  assert.deepEqual(Object.keys(judged.questions!), ["line_1", "line_2", "line_3", "roll_3", "line_4"]);
  assert.deepEqual(answer.lines, [{ kind: "say", text: "Sergeant, who saw it happen?" }, { kind: "do", text: "(I look up at the body)" }, { kind: "try", text: "(I try to coax the boy down with a pie)" }]);
  assert.deepEqual(Object.fromEntries(answer.dropped.map(d => [d.text, d.why])), {
    "Moll, who paid you to say he jumped?": "a name not heard: Moll",
    "Lovely morning for it.": "offered last time",
    "Who found him, Sergeant?": "just said",
    "Nice boots, boy.": "the judge: gives away what's held",
  });
  assert.deepEqual(Object.keys(answer.usage.byOperation).sort(), ["scene.suggest", "scene.suggest.judge"]);
});

test("suggest: a judge that fails leaves the lines unjudged; a model that fails gives none", async () => {
  const { campaign, fake, contextFor, store } = await setUp({ suggestions: LINES, choices: { line_4: "gives_away" } });
  const req = suggestRequest(campaign, []);
  const using = (answering: typeof fetch) => ({ ...contextFor(req.key), ...callContext({ fetch: answering, apiKey: "test" }, folderStores(store), { game: GAME, key: req.key, attempt: 1 }) });

  const unjudged = await pipeline.suggest(req, using(failing(fake, url => url.endsWith("/decisions"))));
  assert.deepEqual(unjudged.lines.map(l => l.text), ["Sergeant, who saw it happen?", "Lovely morning for it.", "(I look up at the body)", "(I try to coax the boy down with a pie)"]);
  assert.deepEqual(unjudged.dropped.map(d => [d.text, d.why]), [["Moll, who paid you to say he jumped?", "a name not heard: Moll"], ["Who found him, Sergeant?", "just said"], ["Nice boots, boy.", "enough of its kind"]]);

  const none = await pipeline.suggest(req, using(failing(fake, url => url.endsWith("/responses"))));
  assert.deepEqual([none.lines, none.dropped], [[], []]);
});

test("suggest: a reply that ran out of tokens loses its last line, which may be half a line", async () => {
  const { campaign, fake, contextFor, store } = await setUp({ choices: {} });
  const req = suggestRequest(campaign, []);
  const cut = "say: Sergeant, who saw it happen?\ndo: (I look up at the body)\nsay: And what did the por";
  const incomplete: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Request;
    if (!body.instructions?.startsWith("You suggest what the player might")) return fake.fetch(input, init);
    const response = { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", content: [{ type: "output_text", text: cut }] }], usage: { input_tokens: 900, output_tokens: 150, cost: 0.0001 } };
    const events = [{ type: "response.output_text.delta", delta: cut }, { type: "response.incomplete", response }];
    return new Response(`${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const answer = await pipeline.suggest(req, { ...contextFor(req.key), ...callContext({ fetch: incomplete, apiKey: "test" }, folderStores(store), { game: GAME, key: req.key, attempt: 1 }) });
  assert.deepEqual(answer.lines.map(l => l.text), ["Sergeant, who saw it happen?", "(I look up at the body)"]);
});

// (Markup on a request's entries reaches the GM's history as written: the speaker's name as the player knows it.)
test("the story is read by the notes and the lines alone: with a vocabulary.json that doesn't read (written past the PUT's check), a turn's own thinks answer and the lines are a failure", async () => {
  const { campaign, contextFor, store } = await setUp({ choices: {} });
  writeFileSync(join(store, "campaigns", "caerwyn", "0.1.0", "vocabulary.json"), "{}");
  const gm = initialGm({ start: "yard" });
  const decide: DecideRequest = { key: `${GAME}:s1:t1:decide`, game, player: { id: "1", name: "Wren Ashdown" }, turn: turnOf(1, gm, openingRows(gm, campaign), [opening, said(1)]), landed: [] };
  const lines = suggestRequest(campaign, []);

  assert.ok((await pipeline.decide(decide, contextFor(decide.key))).decision);
  await assert.rejects(pipeline.suggest(lines, contextFor(lines.key)), /the installed vocabulary\.json doesn't read: vocabulary\.json: isn't \{ source, scenes: \[\.\.\.\] \}/);
});

test("a GM entry's markup is written back into the history with the name the player knows", async () => {
  const { campaign, fake, contextFor } = await setUp();
  const gm = initialGm({ start: "yard" });
  const markup: Markup = { speech: [{ start: 0, end: 7, speaker: "cob", tag: "Cob" }], marks: [] };
  const entries: Entry[] = [{ turn: 0, speaker: "gm", kind: "narration", text: "“Oi!” A stone flies.", markup }, said(1)];
  const req: ReplyRequest = { key: `${GAME}:s1:t1:reply`, game, player: { id: "1", name: "Wren Ashdown" }, turn: turnOf(1, gm, openingRows(gm, campaign), entries), decision: { earned: false, daft: false, outOfCharacter: false }, outcome: { lines: [], directives: [], wasStuck: false }, stream: { turn: "9" } };
  await pipeline.reply(req, contextFor(req.key));

  assert.ok(fake.sent[0]!.input!.some(m => m.role === "assistant" && m.content === "[the boy in the too-big boots] “Oi!” A stone flies."));
});
