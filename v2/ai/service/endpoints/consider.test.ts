import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { CONSEQUENCE_DIRECTIVE, EARNED_DIRECTIVE } from "../../gm/directives.ts";
import { fakeFetch, type FakeOptions, type Request } from "../../llm/fake-openrouter.ts";
import { prompt } from "../../prompts/index.ts";
import type { RollResult } from "../../../shared/dice.ts";
import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import type { ConsiderRequest, ConsiderResponse, Decision, DecideRequest, Entry, Outcome, ReplyRequest, SettleRequest, SheetRow } from "../../../shared/protocol/ai.ts";
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

/**
 * A turn's thinks with the full GM (full-gm-design §4.1, package A1), on the stand-in for
 * OpenRouter: the decision read for a roll to rule on and a plan off the graph; the GM's ruling, its
 * verdict and its route; a review past its deadline, and the plain check to roll instead; the reply
 * told what the ruling decided (and, without one, what the plain check did); and the player gone
 * from the place, read after the reply.
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "..", "campaigns", "caerwyn");
const GAME = "0d1e2f3a-0000-4000-8000-0000000000c1";
const LINE = "*crouches by Cob* Take the left boot off yourself and feel along the lining with your own fingers.";

const SCRATCH = mkdtempSync(join(tmpdir(), "km-consider-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}

/** The campaign installed in a fresh store, and a request's context on the stand-in, its calls kept. */
async function setUp(options: FakeOptions = {}) {
  const stores = folderStores(mkdtempSync(join(SCRATCH, "store-")));
  const installed = campaigns(stores.campaigns, stores.docs);
  await installed.put("caerwyn", "0.1.0", filesOf(CAERWYN));
  const campaign = installed.use("caerwyn", "0.1.0");
  const fake = fakeFetch(options);
  const contextFor = (key: string, considerDeadlineMs?: number): AiContext => {
    const { calls, usage } = callContext({ fetch: fake.fetch, apiKey: "test" }, stores, { game: GAME, key, attempt: 1 });
    const stream = (turn: string) => streamSink({ url: "http://stdb.test", db: "kingmaker", token: "t", periodMs: 0, fetch: async () => new Response(""), log: () => {} }, { turn, attempt: 1, started: performance.now() });
    return { campaign, calls, usage, attempt: 1, stream, ...(considerDeadlineMs ? { considerDeadlineMs } : {}) };
  };
  const rows = (gm: GmState) => {
    const place = JSON.parse(readFileSync(join(CAERWYN, "places", "granary-yard.json"), "utf8")) as PlaceFile;
    const people = presentCast(campaign.scene("hanged-clerk"), gm).map(c => ({ id: c.id, name: c.name }));
    const world = buildWorld("hanged-clerk", place, people, { name: "Wren Ashdown" });
    joinWorld(world, people, 0);
    return worldToRows(world, keysFor("granary-yard", "hanged-clerk", "pc:1"));
  };
  return { fake, contextFor, rows };
}

const WIZARD: SheetRow = { name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "human wizard 3 (Evoker), sage background", skills: { arcana: 5, insight: 3, persuasion: 1 }, status: "HP 17/17, spell slots 1st 4/4, 2nd 2/2" };
const game = { id: GAME, campaign: "caerwyn", version: "0.1.0" };
const player = { id: "1", name: "Wren Ashdown" };
const opening: Entry = { turn: 0, speaker: "gm", kind: "narration", text: "Rain on the cobbles. A body hangs from the hoist, and a boy in boots too big for him throws stones at it." };
const said = (n: number, text = LINE): Entry => ({ turn: n, speaker: "player:1", kind: "player", text });

function turnOf(n: number, gm: GmState, rows: PlaceRows, transcript: Entry[], party: SheetRow[] = [WIZARD]) {
  const line = transcript.findLast(e => e.kind === "player")!.text;
  return { scene: { id: "1", key: "hanged-clerk", kind: "scene" as const, turn: n }, pc: "pc:1", gm, transcript, line: { speaker: "player:1", text: line }, world: rows, party, present: [], story: { time: "morning", day: 1, flags: {} } };
}

/** The GM's note for this reply: the reply call's last developer message. */
const noteOf = (body: Request) => body.input?.filter(m => m.role === "developer").at(-1)?.content ?? "";
const forThisReply = (note: string) => note.slice(note.indexOf("## For this reply"));

/** The review's answer for Cob's boot (the prototype's consider.test.ts LINING): a Persuasion roll at DC 12, the page out on a success, Cob bolting on a failure. */
const outcome = (o: Record<string, unknown>) => ({ happens: "", gets: "some", to: "stay", counts_as: "none", establishes: [], reveals: [], closes: [], ...o });
const LINING = {
  act: "talk Cob into opening the boot's lining himself", target: "cob", lie: false, skill: "persuasion", stakes: "guarded", approach: "plausible",
  disposition: "wary", freely: false, same_again: false, difficulty: "moderate", reason: "to get Cob to open the boot's lining",
  success: outcome({ happens: "Cob drags the left boot off, picks the stitches with a grimy thumbnail and draws out a folded page.", gets: "all", counts_as: "page-found", reveals: ["page"] }),
  failure: outcome({ happens: "Cob jeers and bolts behind the water butt and through the gap into the granary, boots and all.", gets: "none", establishes: ["Cob has bolted into the granary through the gap behind the water butt."], closes: ["win-cob"] }),
};

/** The decider's read that asked for the ruling: a roll wanted, leaning towards winning Cob round. */
const READ: NonNullable<Decision["considered"]> = { probability: 0.97, routes: [{ id: "win-cob", p: 0.3 }] };

function considerRequest(n: number, gm: GmState, rows: PlaceRows, read: Decision["considered"] = READ): ConsiderRequest {
  return { key: `${GAME}:s1:t${n}:consider`, game, player, turn: turnOf(n, gm, rows, [opening, said(n)]), ...(read ? { read } : {}) };
}

test("decide: a roll wanted that no route settles is the GM's to rule on (no route taken), with the routes the decider leant towards; a plan off the graph is the co-GM's", async () => {
  const { fake, contextFor, rows } = await setUp({ choices: { roll_call: "new", off_graph: "off_graph", attempt: "coax-cob" }, odds: { attempt: 0.5 } });
  const gm = initialGm({ start: "yard" });
  const req: DecideRequest = { key: `${GAME}:s1:t1:decide`, game, player, turn: turnOf(1, gm, rows(gm), [opening, said(1)]), landed: [] };
  const { decision } = await pipeline.decide(req, contextFor(req.key));

  assert.equal(decision.route, undefined, "nothing rolled or moved for it: the GM rules on it first");
  assert.ok(decision.considered && decision.considered.probability >= 0.7, "a roll wanted");
  assert.deepEqual(decision.considered.routes, [{ id: "coax-cob", p: 0.5 }], "the routes with a roll it leant towards (0.05 or more)");
  assert.equal(decision.offGraph, true);
  const before = fake.sent.find(b => b.questions?.roll_call)!;
  assert.deepEqual(Object.keys(before.questions!.roll_call!.criteria), ["route", "new", "none"]);

  // A quiet turn: neither.
  const quiet = await setUp();
  const plain = await pipeline.decide(req, quiet.contextFor(req.key));
  assert.equal(plain.decision.considered, undefined);
  assert.equal(plain.decision.offGraph, undefined);
});

test("consider: the GM's ruling on the fake's byName.ruling, with its verdict (the guidance's grid) and its route, told the decider's read", async () => {
  const { fake, contextFor, rows } = await setUp({ byName: { ruling: LINING } });
  const gm = initialGm({ start: "yard" });
  const req = considerRequest(2, gm, rows(gm));
  const answer: ConsiderResponse = await pipeline.consider(req, contextFor(req.key));

  assert.deepEqual(answer.verdict, { kind: "roll", dc: 12, why: "guarded, plausible, wary" });
  assert.equal(answer.route?.id, "considered-2");
  assert.deepEqual({ ...answer.route?.check, success: undefined, failure: undefined, establishes: undefined }, { skill: "persuasion", dc: 12, reason: "to get Cob to open the boot's lining", onSuccess: "motive", success: undefined, failure: undefined, establishes: undefined });
  assert.match(answer.route!.check!.success, /^Decided, and it stands \(.*\): Cob drags the left boot off/);
  assert.deepEqual([answer.ruling?.success.countsAs, answer.ruling?.success.to, answer.ruling?.success.reveals], ["page-found", "motive", ["page"]]);
  assert.deepEqual(answer.ruling?.failure.closes, ["win-cob"], "a way really tried (0.3) is shut by a failure");
  assert.equal(answer.refusal, undefined);
  assert.equal(answer.error, undefined);

  const asked = fake.sent.find(b => b.text?.format?.name === "ruling")!;
  assert.equal(asked.instructions, prompt("consider"));
  assert.equal(asked.max_output_tokens, 1000);
  assert.match(asked.input![1]!.content, /## Rule on this: the player's latest turn\n\*crouches by Cob\*[^\n]*\n\n\(The decider's read: it leant towards win-cob \(0\.30\)\.\)$/);
  assert.equal(answer.usage.byOperation.consider?.calls, 1);

  // A lever that can't move him: a no without dice, its refusal costing nothing, the scene where it was.
  const no = await setUp({ byName: { ruling: { ...LINING, approach: "no_chance" } } });
  const refused = await pipeline.consider(req, no.contextFor(req.key));
  assert.deepEqual([refused.verdict?.kind, refused.verdict?.no], ["no", "refused"]);
  assert.deepEqual(refused.refusal, { happens: "", gets: "none", establishes: [], reveals: [], closes: [] });
  assert.deepEqual([refused.route?.to, refused.route?.check], ["yard", undefined]);
});

test("consider: a review past its deadline is cut off, and the plain check to roll instead comes back inside it; with no roll wanted (a plan off the graph alone), none", async () => {
  const { contextFor, rows } = await setUp({ stall: ["ruling"], choices: { skill: "sleight_of_hand", difficulty: "hard" } });
  const gm = initialGm({ start: "yard" });
  const req = considerRequest(2, gm, rows(gm));
  const started = performance.now();
  const answer = await pipeline.consider(req, contextFor(req.key, 300));
  const took = performance.now() - started;

  assert.equal(answer.ruling, undefined);
  assert.match(answer.error ?? "", /^the review took longer than 300 ms$/);
  assert.deepEqual(answer.fallback, { skill: "sleight_of_hand", dc: 16, reason: "to pull it off" });
  assert.ok(took < 3000, `the plain check came back ${Math.round(took)} ms after the line, against a 300 ms deadline`);

  const { read: _, ...offGraph } = req;
  const none = await pipeline.consider(offGraph, contextFor(offGraph.key, 300));
  assert.equal(none.fallback, undefined);
});

/** The yard after the consider commit played the ruling: rolled, and how it went. */
function ruledOutcome(answer: ConsiderResponse, roll: RollResult, to: string): NonNullable<Outcome["ruled"]> {
  return { ruling: answer.ruling!, verdict: answer.verdict!, route: answer.route!, went: roll.success ? "success" : "failure", roll, from: "yard", to, chosen: roll.success };
}

test("reply: a ruled turn is told what the ruling decided, with the dice, where it went and the way it shut (named, though the reply's prep no longer offers it); no bill or payoff on top", async () => {
  const { contextFor, rows } = await setUp({ byName: { ruling: LINING }, replies: ["Cob scowls, then hauls the boot off and picks at the lining."] });
  const yard = initialGm({ start: "yard" });
  const considered = await pipeline.consider(considerRequest(2, yard, rows(yard)), contextFor(`${GAME}:s1:t2:consider`));
  const decision: Decision = { earned: true, daft: true, outOfCharacter: false, considered: READ };
  const replyFor = (gm: GmState, ruled: NonNullable<Outcome["ruled"]>, line: string): ReplyRequest => ({
    key: `${GAME}:s1:t2:reply`, game, player, turn: turnOf(2, gm, rows(gm), [opening, said(2), { turn: 2, speaker: "dice", kind: "roll", text: line }]),
    decision, outcome: { lines: [line], directives: [], wasStuck: true, ruled }, stream: { turn: "9" },
  });

  // Won: the page out, the scene on to what Prout found.
  const won: RollResult = { skill: "persuasion", dc: 12, die: 15, modifier: 1, total: 16, success: true, critical: null };
  const page: GmState = { ...yard, beat: "motive", turnsInBeat: 0, path: [{ turn: 2, from: "yard", to: "motive", via: "considered-2", source: "pre", roll: won, known: 0 }] };
  const winning = await setUp({ replies: ["Cob scowls, then hauls the boot off."] });
  await pipeline.reply(replyFor(page, ruledOutcome(considered, won, "motive"), "Persuasion check to get Cob to open the boot's lining: 15 + 1 = 16 vs DC 12: success"), winning.contextFor(`${GAME}:s1:t2:reply`));
  const told = forThisReply(noteOf(winning.fake.sent.find(b => b.stream)!));
  assert.match(told, /^## For this reply\nThe player's attempt called for a Persuasion check to get Cob to open the boot's lining\. Persuasion check: 15 \+ 1 = 16 vs DC 12: success\. Decided, and it stands \(people react to it, but nothing in this reply undoes, reverses or spoils it\): Cob drags the left boot off/);
  assert.match(told, /The scene has moved on to "What Prout found"/);
  for (const line of [CONSEQUENCE_DIRECTIVE, EARNED_DIRECTIVE, "The scene has been going in circles"]) assert.ok(!told.includes(line), `not over a ruling: ${line.slice(0, 40)}…`);

  // Lost: Cob bolts, and winning him round is shut, named as the way it was, while the prep's routes have it gone.
  const lost: RollResult = { skill: "persuasion", dc: 12, die: 4, modifier: 1, total: 5, success: false, critical: null };
  const shut: GmState = { ...yard, path: [{ turn: 2, from: "yard", to: "yard", via: "considered-2", source: "pre", roll: lost, known: 0 }], established: ["Cob has bolted into the granary through the gap behind the water butt."], patches: [{ turn: 2, close: { beat: "yard", id: "win-cob" }, why: `Closed by the ruling on: ${LINING.act}` }] };
  const losing = await setUp({ replies: ["Cob jeers and is gone."] });
  await pipeline.reply(replyFor(shut, ruledOutcome(considered, lost, "yard"), "Persuasion check to get Cob to open the boot's lining: 4 + 1 = 5 vs DC 12: failure"), losing.contextFor(`${GAME}:s1:t2:reply`));
  const note = noteOf(losing.fake.sent.find(b => b.stream)!);
  assert.match(forThisReply(note), /Persuasion check: 4 \+ 1 = 5 vs DC 12: failure\. Decided, and it stands [^:]*: Cob jeers and bolts/);
  assert.match(forThisReply(note), /From here on this way of trying is shut, for the rest of the scene: The player pushes past Cob's hostility/);
  const routes = note.slice(note.indexOf("## What moves the scene on from here"), note.indexOf("## For this reply"));
  assert.ok(routes.includes("promise that truly answers") && !routes.includes("pushes past Cob's hostility"), "the reply's prep offers the yard's routes but the one shut");
});

test("reply: with no ruling, the plain check's dice are narrated; the bill still comes, as the prototype's does", async () => {
  const { fake, contextFor, rows } = await setUp({ replies: ["Cob shrugs you off."] });
  const gm = initialGm({ start: "yard" });
  const roll: RollResult = { skill: "persuasion", dc: 13, die: 9, modifier: 1, total: 10, success: false, critical: null };
  const line = "Persuasion check to win Cob over: 9 + 1 = 10 vs DC 13: failure";
  const req: ReplyRequest = {
    key: `${GAME}:s1:t2:reply`, game, player, turn: turnOf(2, gm, rows(gm), [opening, said(2), { turn: 2, speaker: "dice", kind: "roll", text: line }]),
    decision: { earned: false, daft: true, outOfCharacter: false, considered: READ }, outcome: { lines: [line], directives: [], wasStuck: false, freeform: { skill: "persuasion", dc: 13, roll, reason: "to win Cob over" } }, stream: { turn: "9" },
  };
  await pipeline.reply(req, contextFor(req.key));
  const told = forThisReply(noteOf(fake.sent.find(b => b.stream)!));
  assert.match(told, /^## For this reply\nThe player's attempt called for a Persuasion check\. Persuasion check: 9 \+ 1 = 10 vs DC 13: failure\. Narrate the result: /);
  assert.ok(told.includes(CONSEQUENCE_DIRECTIVE));
});

test("settle: the player gone from the place, read at 0.7 when their character is the rules engine's; not asked of a sheet without a build", async () => {
  const settleFor = (rows: PlaceRows, party: SheetRow[] = [WIZARD]): SettleRequest => {
    const gm = initialGm({ start: "yard" });
    return { key: `${GAME}:s1:t3:settle`, game, player, turn: turnOf(3, gm, rows, [opening, said(3, "(I nod to the sergeant and walk out of the yard, back towards the palace)")], party), reply: "Kell watches you go.", lines: [], settled: [] };
  };
  const gone = await setUp({ choices: { left: "gone" } });
  const answer = await pipeline.settle(settleFor(gone.rows(initialGm({ start: "yard" }))), gone.contextFor(`${GAME}:s1:t3:settle`));
  assert.equal(answer.after?.left, true);
  const asked = gone.fake.sent.find(b => b.questions)!.questions!.left!;
  assert.equal((asked as { instructions?: string }).instructions, "Where is the player character at the end of the latest GM reply? This scene is set in The Hanged Clerk (The yard behind the King's Granary).");

  const unsure = await setUp({ choices: { left: "gone" }, odds: { left: 0.6 } });
  assert.equal((await pipeline.settle(settleFor(unsure.rows(initialGm({ start: "yard" }))), unsure.contextFor(`${GAME}:s1:t3:settle`))).after?.left, undefined);

  const plain = await setUp({ choices: { left: "gone" } });
  const { build: _, ...sheet } = WIZARD;
  await pipeline.settle(settleFor(plain.rows(initialGm({ start: "yard" })), [sheet]), plain.contextFor(`${GAME}:s1:t3:settle`));
  assert.equal(plain.fake.sent.find(b => b.questions)!.questions!.left, undefined);
});
