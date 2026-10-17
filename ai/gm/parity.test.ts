import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fakeFetch, type FakeOptions, type Request } from "../llm/fake-openrouter.ts";
import type { CallContext } from "../llm/openrouter.ts";
import { noUsage } from "../service/calls.ts";
import { campaigns, type Campaign } from "../service/campaigns.ts";
import type { AiContext } from "../service/context.ts";
import { pipeline } from "../service/endpoints/pipeline.ts";
import { sceneAndView } from "../service/endpoints/turn.ts";
import { folderStores } from "../service/folder-stores.ts";
import type { StreamSink } from "../service/stream.ts";
import type { Backstory } from "../../shared/creation/types.ts";
import type { GmState } from "../../shared/gm/state.ts";
import type { Card, Mark, Markup, Speech } from "../../shared/markup.ts";
import type { AiRequest, Decision, DecideRequest, Drafted, Entry, NotesRequest, NotesResponse, OpenRequest, OpenResponse, Outcome, ReplyRequest, ReplyResponse, SceneContext, SettleRequest, SheetRow, Suggestion, SuggestRequest, SuggestResponse, TurnContext } from "../../shared/protocol/ai.ts";
import { keysFor, worldToRows } from "../../shared/world/rows.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";
import { testScene, testStory } from "./fixtures.ts";
import { vetting, type Vetting } from "./suggest.ts";
import { gameMarkup, turnSource } from "./view.ts";

/**
 * Prompt parity (v0-design §10.2, v5-design §4.2, v1-design §4.2), the AI service's acceptance test:
 * its GM asks the models what the prototype's asks, for the same state. golden/hanged-clerk holds the
 * prototype's calls on the hanged clerk at 44c6d4a, with marked-up replies, the notes on them and the
 * lines suggested after each (recorded by the repo's tools/record-golden.mts; golden/README.md): for
 * each step, the session as it stood and every call it made; for each moment's notes and lines, the
 * session frozen at the call and what came of it. golden/hanged-clerk-backstory holds the GM's steps
 * for a player with a backstory from character creation (tools/v2/record-v1-golden.mts), whose
 * opening writes it into the player's doc and whose brief says who they are from it. Each session
 * becomes the request the simulation would send, the AI service's endpoint runs on the same
 * stand-in, and what it asks and answers are compared:
 *
 * - byte for byte: the GM's (gm.opening, gm.reply: the speakers' names and the notes in its
 *   history), the stage manager's, disclosure's, the notes' writer's (instructions, input, schema)
 *   and the suggester's (instructions, input, token cap: the spells in "who they are" too); the
 *   director's and the judge's state;
 * - question by question: the director's (every one the prototype's v2 approach asks, the rules'
 *   mechanic, threat and threat_severity included) and the judge's;
 * - equal: who says each line as each reply streams in a word at a time and once it's whole; the
 *   notes placed (offsets, kinds, notes, links by the game's keys) and their cards; every field of
 *   the vetting; the lines and what was dropped, with why.
 *
 * The steps run in order on one store, as a game would: the opening writes the player's doc, which
 * every later prompt reads. A reply's decision is the AI service's own, from its decide on the same
 * turn; what the decide commit did (the roll, the move) is read off the prototype's session.
 */

const GOLDEN = join(import.meta.dirname, "golden");
const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const GAME = "6f0c1d2e-0000-4000-8000-00000000901d";

/** The prototype's session, as far as the requests are made from it. */
interface Session {
  turn: number; beat: string; turnsInBeat: number; path: GmState["path"]; established: string[]; canon: string[]; notes: string | null;
  patches: GmState["patches"]; landed?: string[]; hinted?: string[]; memory?: { opened: GmState["opened"] }; endingLead?: GmState["endingLead"];
  pendingExit?: GmState["pendingExit"]; closing?: GmState["closing"]; sceneStatus?: GmState["sceneStatus"]; oocTurns?: number[]; pressureOffered?: string[];
  repeated?: string; entered?: string[]; absent?: string[]; whispers?: GmState["whispers"]; rulings?: unknown[];
  player: { name: string; concept: string; modifiers: SheetRow["skills"]; build?: string; backstory?: Backstory };
  rules?: { status?: string; spells?: SheetRow["spells"]; weapons?: SheetRow["weapons"]; features?: SheetRow["features"] };
  transcript: Array<{ turn: number; speaker: string; kind: Entry["kind"]; text: string; marked?: Markup }>;
  world: SceneWorld;
}
/** Who says each line of a reply as it streams (each time its words grow) and once it's whole. */
interface Speakers { streamed: Array<{ text: string; speech: Speech[] }>; whole: { text: string; speech: Speech[]; drafted: Drafted[] } }
/**
 * A step of the GM's. The stand-in it ran on is `fake` (tools/record-golden.mts), or, in V1's
 * recording with a backstory (tools/v2/record-v1-golden.mts), its replies and the decider's choices.
 */
interface Step { step: string; line?: string; fake?: FakeOptions; replies?: string[]; choices?: Record<string, string>; session: Session; calls: Array<{ operation: string; body: Request }>; speakers?: Speakers }
interface NotesMoment { moment: string; fake: FakeOptions; session: Session; reply: { at: number; text: string; speech: Speech[]; drafted: Drafted[] }; body: Request; marks: Mark[]; cards: Array<Card | null> }
interface SuggestMoment { moment: string; fake: FakeOptions; session: Session; offered: string[]; bodies: { suggest: Request; judge?: Request & { state?: Record<string, string> } }; vetting: Vetting; lines: Suggestion[]; dropped: Array<{ text: string; why: string }> }

/**
 * What the AI service doesn't ask the director that the prototype's v2 approach does: nothing. The
 * rules' mechanic before the reply, and their threat and threat_severity after it, are asked since
 * the world bridge (world-bridge-design §3.1), as considered rolls' roll_call and the means in every
 * beat, the co-GM's off_graph and the rules' left are since the full GM (full-gm-design §4.1): each
 * the prototype's to the letter (the recordings' wizard and rogue have builds, so their sessions are
 * rules sessions). gm-port §6, §9.
 */
const NOT_ASKED: { before: string[]; after: string[] } = { before: [], after: [] };

/** Questions asked in both whose words differ, and why. None: each it asks is the prototype's to the letter. */
const WORDED_OTHERWISE: string[] = [];

/** The player's spells, which the suggester and the judge are told of (suggest.ts's who()): from the sheet's spells, in both since the world bridge. */
const SPELLS = / Spells: [^.]*\./;

const read = <T>(file: string, recording = "hanged-clerk") => JSON.parse(readFileSync(join(GOLDEN, recording, file), "utf8")) as T;
const filesIn = (recording: string) => readdirSync(join(GOLDEN, recording)).filter(f => f.endsWith(".json")).sort();
const stepsOf = (recording: string) => filesIn(recording).filter(f => /^\d\d-/.test(f)).map(f => read<Step>(f, recording));
const files = filesIn("hanged-clerk");
const steps = stepsOf("hanged-clerk");
const withBackstory = stepsOf("hanged-clerk-backstory");
const notesOf = (moment: string) => read<NotesMoment>(`${moment}.notes.json`);
const linesOf = (moment: string) => read<SuggestMoment>(`${moment}.suggest.json`);
/** The stand-in a step ran on. */
const fakeOf = (g: Step): FakeOptions => g.fake ?? { replies: g.replies ?? [], ...(g.choices ? { choices: g.choices } : {}) };

test("the golden recording is there: the opening and three turns, each step's calls, and each moment's notes and lines", () => {
  assert.deepEqual(steps.map(s => s.step), ["open", "t1-decide", "t1-reply", "t1-settle", "t2-decide", "t2-reply", "t2-settle", "t3-decide", "t3-reply", "t3-settle"]);
  assert.deepEqual(steps.filter(s => s.step.endsWith("-reply")).map(s => s.calls.map(c => c.operation)), [["gm.reply"], ["gm.reply"], ["gm.reply"]]);
  assert.deepEqual(files.filter(f => !/^\d\d-/.test(f)), ["open.notes.json", "open.suggest.json", "t1.notes.json", "t1.suggest.json", "t2.notes.json", "t2.suggest.json", "t3.notes.json", "t3.suggest.json"]);
  // Between them: a note on a mark of the GM's, on a spoken line, on words of the reply; a person, a lore doc and a deed linked; and lines judged and dropped.
  const marks = ["open", "t1", "t2", "t3"].flatMap(m => notesOf(m).marks);
  assert.deepEqual([...new Set(marks.map(m => m.link?.kind))].sort(), ["deed", "lore", "person"]);
  assert.deepEqual([...new Set(marks.map(m => m.kind))].sort(), ["know", "why", "you"]);
  const why = ["open", "t1", "t2", "t3"].flatMap(m => linesOf(m).dropped.map(d => d.why.replace(/:.*/, "")));
  for (const reason of ["a name not heard", "no way out yet", "the GM's markup", "the judge", "offered last time"]) assert.ok(why.includes(reason), reason);
  // A rules session (the wizard's build): the director's rules questions are in the recording, for the AI service to ask too.
  const asked = (step: string, operation: string) => Object.keys(steps.find(s => s.step === step)!.calls.find(c => c.operation === operation)!.body.questions ?? {});
  for (const step of ["t1-decide", "t2-decide", "t3-decide"]) assert.ok(asked(step, "director.before").includes("mechanic"), `${step}: the mechanic`);
  for (const step of ["t1-settle", "t2-settle", "t3-settle"]) assert.ok(["left", "threat", "threat_severity"].every(id => asked(step, "director.after").includes(id)), `${step}: left, the threat and its severity`);
});

test("the AI service asks what the prototype's asks, step by step through the opening and three turns, with the notes and the lines after each reply", async () => {
  await playedAlong(steps, { notesAndLines: true });
});

test("the recording with a backstory is there: the opening and a turn, the GM told who they are from it", () => {
  assert.deepEqual(withBackstory.map(s => s.step), ["open", "t1-decide", "t1-reply", "t1-settle"]);
  assert.ok(withBackstory.every(s => s.session.player.backstory?.text.trim()), "a backstory on the player throughout");
  const gm = withBackstory.flatMap(s => s.calls).filter(c => c.operation === "gm.opening" || c.operation === "gm.reply");
  assert.equal(gm.length, 2);
  for (const call of gm) assert.match(call.body.input![0]!.content, /Who they are, from their own backstory: /);
});

test("with a backstory from character creation, the GM asks what the prototype's asks: the player's doc written before disclosure, the brief's who they are", async () => {
  await playedAlong(withBackstory, { notesAndLines: false });
});

/**
 * A recording's steps in order on one game, each compared with the prototype's calls; and, where
 * the recording has them (the hanged clerk's, not the one with a backstory), each reply's notes and
 * lines after it.
 */
async function playedAlong(recording: Step[], { notesAndLines }: { notesAndLines: boolean }): Promise<void> {
  const play = await game();
  const decisions = new Map<string, Decision>();
  const before = new Map<string, Session>();

  for (const golden of recording) {
    const turn = golden.step.split("-")[0]!;
    const asked = await play.run(fakeOf(golden), request => {
      if (golden.step === "open") return pipeline.open(openRequest(golden), request);
      if (golden.step.endsWith("-decide")) return pipeline.decide(decideRequest(golden), request);
      if (golden.step.endsWith("-reply")) return pipeline.reply(replyRequest(golden, decisions.get(turn)!, before.get(turn)!), request);
      return pipeline.settle(settleRequest(golden, before.get(turn)!), request);
    });
    if (golden.step.endsWith("-decide")) { decisions.set(turn, (asked.answer as { decision: Decision }).decision); before.set(turn, golden.session); }

    compare(golden.step, golden.calls, asked.calls);
    if (golden.speakers) sameSpeakers(golden.step, golden.speakers, asked.shown, (asked.answer as OpenResponse | ReplyResponse).entries[0]!);
    if (notesAndLines && (golden.step === "open" || golden.step.endsWith("-reply"))) {
      await sameNotes(play, notesOf(turn));
      await sameLines(play, linesOf(turn));
    }
  }
}

test("the notes are in the GM's history: a reply's notes, written once it's on the transcript, are what the next reply's history writes back", () => {
  const t2 = steps.find(s => s.step === "t2-reply")!.calls[0]!.body;
  const t1Why = notesOf("t1").marks.find(m => m.kind === "why")!;
  assert.ok(t2.input!.some(m => m.role === "assistant" && m.content.includes(`)[why: ${t1Why.note}]`)), "t1's note, in t2's history as the prototype writes it");
});

// ---------------------------------------------------------------------------------------------
// What's compared.

/** Each of the prototype's calls against the AI service's of the same operation (in turn, for an operation made more than once). */
function compare(step: string, theirs: Array<{ operation: string; body: Request }>, ours: Array<{ operation: string; body: Request }>): void {
  assert.deepEqual(ours.map(c => c.operation).sort(), theirs.map(c => c.operation).sort(), `${step}: the same calls`);
  const taken = new Set<number>();
  for (const call of theirs) {
    const at = ours.findIndex((c, i) => !taken.has(i) && c.operation === call.operation && (!call.operation.startsWith("memory.disclose.") || JSON.stringify(c.body) === JSON.stringify(call.body)));
    assert.ok(at >= 0, `${step} ${call.operation}: the AI service made no call like the prototype's${call.operation.startsWith("memory.disclose.") ? `:\n${firstDifference(call.body, ours.filter(c => c.operation === call.operation).map(c => c.body))}` : ""}`);
    taken.add(at);
    const mine = ours[at]!.body;
    if (call.operation.startsWith("director.")) sameDecision(step, call.operation, mine, call.body);
    else assert.equal(JSON.stringify(mine), JSON.stringify(call.body), `${step} ${call.operation}:\n${firstDifference(call.body, [mine])}`);
  }
}

/** The director's call: the state byte for byte, each question asked the prototype's, and only the ones left out missing. */
function sameDecision(step: string, operation: string, mine: Request & { state?: unknown }, theirs: Request & { state?: unknown }): void {
  assert.equal(JSON.stringify(mine.state), JSON.stringify(theirs.state), `${step} ${operation}: the state`);
  const left = operation === "director.after" ? NOT_ASKED.after : NOT_ASKED.before;
  for (const [id, q] of Object.entries(mine.questions ?? {})) {
    assert.ok(theirs.questions?.[id], `${step} ${operation}: the AI service asks ${id}, which the prototype doesn't`);
    if (!WORDED_OTHERWISE.includes(id)) assert.equal(JSON.stringify(q), JSON.stringify(theirs.questions![id]), `${step} ${operation}: the question ${id}`);
  }
  const missing = Object.keys(theirs.questions ?? {}).filter(id => !mine.questions?.[id]);
  assert.deepEqual(missing.filter(id => !left.includes(id)), [], `${step} ${operation}: questions the AI service should ask and doesn't`);
}

/** Who says each line as the reply streams (the draft's posts, a word at a time) and once it's whole, by the game's keys: the cast's are their ids either way. */
function sameSpeakers(step: string, theirs: Speakers, shown: Array<{ text: string; speech: Speech[] }>, entry: OpenResponse["entries"][number]): void {
  assert.deepEqual(shown, theirs.streamed, `${step}: who says each line as it streams`);
  assert.deepEqual({ text: entry.text, speech: entry.markup?.speech ?? [], drafted: entry.drafted ?? [] }, theirs.whole, `${step}: who says each line once it's whole`);
  assert.deepEqual(entry.markup?.marks ?? [], [], `${step}: none of the GM's own notes`);
}

/** A moment's notes: the writer told what the prototype's was, byte for byte; the same marks placed and linked (by the game's keys), each with the same card. */
async function sameNotes(play: Game, moment: NotesMoment): Promise<void> {
  const req = notesRequest(moment);
  const asked = await play.run(moment.fake, ctx => pipeline.notes(req, ctx));
  const answer = asked.answer as NotesResponse;
  const keys = (m: Mark) => gameMarkup({ speech: [], marks: [m] }, play.scene(), worldOf(moment.session), KEYS).marks[0]!;

  compare(`${moment.moment} notes`, [{ operation: "notes", body: moment.body }], asked.calls);
  assert.deepEqual(answer.marks.map(({ card: _, ...m }) => m), moment.marks.map(keys), `${moment.moment}: the notes placed and linked`);
  assert.deepEqual(answer.marks.map(m => m.card ?? null), moment.cards, `${moment.moment}: each link's card`);
}

/**
 * A moment's lines: the suggester and the judge told what the prototype's were, byte for byte, the
 * player's spells included (SPELLS); every field of the vetting the same; and the same lines, and the
 * same dropped, with why.
 */
async function sameLines(play: Game, moment: SuggestMoment): Promise<void> {
  const req = suggestRequest(moment);
  let vetted: Vetting | undefined;
  const asked = await play.run(moment.fake, async ctx => {
    const { scene, view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req), ctx.campaign.story);
    view.suggestions = { scene: view.sceneId, turn: view.turn, lines: req.offered.map(text => ({ text })) };
    vetted = vetting(scene, view);
    return pipeline.suggest(req, ctx);
  });
  const answer = asked.answer as SuggestResponse;
  const suggest = asked.calls.find(c => c.operation === "scene.suggest")!.body;
  const judge = asked.calls.find(c => c.operation === "scene.suggest.judge")?.body as (Request & { state?: Record<string, string> }) | undefined;
  const theirs = moment.bodies;

  assert.match(theirs.suggest.input![0]!.content, SPELLS, `${moment.moment}: the prototype's suggester hears the spells`);
  assert.match(suggest.input![0]!.content, SPELLS, `${moment.moment}: and the AI service's, from the sheet's`);
  assert.equal(JSON.stringify(suggest), JSON.stringify(theirs.suggest), `${moment.moment} scene.suggest:\n${firstDifference(theirs.suggest, [suggest])}`);
  assert.equal(!!judge, !!theirs.judge, `${moment.moment}: the judge asked in both, or neither`);
  if (judge && theirs.judge) {
    assert.equal(JSON.stringify(judge.state), JSON.stringify(theirs.judge.state), `${moment.moment} scene.suggest.judge: the state`);
    assert.equal(JSON.stringify(judge.questions), JSON.stringify(theirs.judge.questions), `${moment.moment} scene.suggest.judge: the questions`);
  }
  assert.deepEqual(vetted, moment.vetting, `${moment.moment}: the vetting`);
  assert.deepEqual(answer.lines, moment.lines, `${moment.moment}: the lines`);
  assert.deepEqual(answer.dropped, moment.dropped, `${moment.moment}: what was dropped, and why`);
}

/** Where two requests first part, for the failure's message. */
function firstDifference(theirs: Request, ours: Request[]): string {
  const a = JSON.stringify(theirs, null, 1).split("\n");
  return ours.map(o => {
    const b = JSON.stringify(o, null, 1).split("\n");
    const i = a.findIndex((line, k) => line !== b[k]);
    return i < 0 ? "(the same)" : `line ${i}:\n  prototype:   ${a[i]?.slice(0, 400)}\n  AI service:  ${b[i]?.slice(0, 400)}`;
  }).join("\n") || "(the AI service made none)";
}

// ---------------------------------------------------------------------------------------------
// A game on the AI service: one store, the campaign installed, a step at a time on the stand-in.

type Game = Awaited<ReturnType<typeof game>>;

/** Every game's store is a folder in this one, removed once the file's tests are done (a store holds a whole campaign: left behind, a run's worth fills a tmpfs's inodes in a few hundred runs). */
const SCRATCH = mkdtempSync(join(tmpdir(), "km-parity-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

async function game() {
  const stores = folderStores(mkdtempSync(join(SCRATCH, "store-")));
  const installed = campaigns(stores.campaigns, stores.docs);
  await installed.put("caerwyn", "0.1.0", filesOf(CAERWYN));
  // The campaign installed (its lore for the docs service, its title, its creation world), but its scenes
  // the ones the goldens were recorded on: the hanged clerk as it stood, in the story of the prototype's
  // scenes (gm/fixtures.ts), whatever the campaign's own scenes become.
  const live = installed.use("caerwyn", "0.1.0");
  const story = testStory();
  const campaign: Campaign = { id: live.id, version: live.version, title: live.title, creation: live.creation, scene: testScene, story };

  return {
    scene: () => campaign.scene("hanged-clerk"),
    /**
     * An endpoint on a stand-in told what the prototype's was, its replies streamed a word at a time:
     * its answer, its calls (each named by its operation from the call log) and the draft it showed.
     */
    async run(options: FakeOptions, endpoint: (ctx: AiContext) => Promise<unknown>) {
      const fake = fakeFetch({ ...options, streamMs: 1 });
      const logged: Array<Record<string, unknown>> = [];
      const shown: Array<{ text: string; speech: Speech[] }> = [];
      const calls: CallContext = { fetch: fake.fetch, apiKey: "parity", log: e => logged.push(e), cost: () => {} };
      const sink: StreamSink = { show: (text, markup) => shown.push({ text, speech: markup?.speech ?? [] }), finish: async () => {}, firstTextMs: () => null };
      const answer = await endpoint({ campaign, calls, usage: noUsage, attempt: 1, stream: () => sink });
      return { answer, calls: named(fake.sent, logged), shown };
    },
  };
}

/** Each body the stand-in was sent, with its operation from the call log (a decision by its whole request, a reply by its instructions and input). */
function named(sent: Request[], logged: Array<Record<string, unknown>>): Array<{ operation: string; body: Request }> {
  const done = logged.filter(e => e.request && (e.text !== undefined || e.answers !== undefined)) as Array<{ operation: string; request: Record<string, unknown> }>;
  const used = new Set<number>();
  return sent.map(body => {
    const decision = !!body.questions;
    const at = done.findIndex((e, i) => !used.has(i) && (decision ? JSON.stringify(e.request) === JSON.stringify(body) : e.request.instructions === body.instructions && JSON.stringify(e.request.input) === JSON.stringify(body.input)));
    assert.ok(at >= 0, "every call is in the call log");
    used.add(at);
    return { operation: done[at]!.operation, body };
  });
}

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}

// ---------------------------------------------------------------------------------------------
// The requests the simulation would send, from the prototype's session as it stood.

const KEYS = keysFor("granary-yard", "hanged-clerk", "pc:1");
const base = (step: string, n: number, s: Session): AiRequest => ({ key: `${GAME}:s1:t${n}:${step}`, game: { id: GAME, campaign: "caerwyn", version: "0.1.0" }, player: { id: "1", name: s.player.name } });
const story = { time: "morning", day: 1, flags: {} };

function openRequest(g: Step): OpenRequest {
  return { ...base("open", 0, g.session), scene: { id: "1", key: "hanged-clerk", kind: "scene" }, pc: "pc:1", gm: gmOf(g.session), world: rowsOf(g.session), party: partyOf(g.session), story, stream: { turn: "1" } };
}

function decideRequest(g: Step): DecideRequest {
  return { ...base("decide", g.session.turn, g.session), turn: turnOf(g.session), landed: [] };
}

function replyRequest(g: Step, decision: Decision, before: Session): ReplyRequest {
  return { ...base("reply", g.session.turn, g.session), turn: turnOf(g.session), decision, outcome: outcomeOf(before, g.session, decision), stream: { turn: String(g.session.turn + 1) } };
}

function settleRequest(g: Step, before: Session): SettleRequest {
  const s = g.session;
  const reply = s.transcript.filter(e => e.turn === s.turn && e.kind === "narration").at(-1)!.text;
  const lines = s.transcript.filter(e => e.turn === s.turn && e.kind === "roll").map(e => e.text);
  // What was settled before the turn (settledFacts: the facts, and the rulings, none here), the last 16.
  return { ...base("settle", s.turn, s), turn: turnOf(s), reply, lines, settled: before.established.slice(-16) };
}

/** The notes on a moment's reply: the reply's seq is its place on the scene's transcript, from 1, as the simulation numbers its rows. */
function notesRequest(m: NotesMoment): NotesRequest {
  return { ...base("notes", m.session.turn, m.session), turn: sceneOf(m.session), reply: { seq: m.reply.at + 1, text: m.reply.text, speech: m.reply.speech, drafted: m.reply.drafted } };
}

/** The lines after a moment's reply: none of the scene's last set again. */
function suggestRequest(m: SuggestMoment): SuggestRequest {
  return { ...base("suggest", m.session.turn, m.session), turn: sceneOf(m.session), offered: m.offered };
}

function turnOf(s: Session): TurnContext {
  const line = s.transcript.filter(e => e.kind === "player").at(-1)!.text;
  return { ...sceneOf(s), line: { speaker: "player:1", text: line } };
}

function sceneOf(s: Session): SceneContext {
  return { scene: { id: "1", key: "hanged-clerk", kind: "scene", turn: s.turn }, pc: "pc:1", gm: gmOf(s), transcript: s.transcript.map(e => entryOf(e, s)), world: rowsOf(s), party: partyOf(s), present: [], story };
}

/** The GM's bookkeeping as gm_state keeps it, from the session's fields of the same names. */
function gmOf(s: Session): GmState {
  return {
    beat: s.beat, turnsInBeat: s.turnsInBeat, path: s.path, established: s.established, landed: s.landed ?? [], hinted: s.hinted ?? [],
    opened: s.memory?.opened ?? [],
    ...(s.endingLead ? { endingLead: s.endingLead } : {}), ...(s.pendingExit ? { pendingExit: s.pendingExit } : {}), ...(s.closing ? { closing: s.closing } : {}),
    ...(s.sceneStatus ? { sceneStatus: s.sceneStatus } : {}), oocTurns: s.oocTurns ?? [], pressureOffered: s.pressureOffered ?? [], ...(s.repeated ? { repeated: s.repeated } : {}),
    canon: s.canon, patches: s.patches, entered: s.entered ?? [], absent: s.absent ?? [], notes: s.notes, whispers: s.whispers ?? [],
    notesTurn: null, rulings: [], adjustments: [], owed: [], fought: [],
    // (The prototype's session has no nodes reached nor a two-part GM: its beat stands for them.)
    reached: [s.beat], twoPart: { roles: {}, notes: [] },
  };
}

const worldOf = (s: Session) => s.world;
const rowsOf = (s: Session) => worldToRows(s.world, KEYS);
/**
 * The sheet as the simulation sends it: the player's, the rules' status line, the backstory they
 * wrote at character creation, and the spells, weapons and features the rules keep ready.
 */
const partyOf = (s: Session): SheetRow[] => [{
  name: s.player.name, concept: s.player.concept, ...(s.player.build ? { build: s.player.build } : {}), skills: s.player.modifiers,
  ...(s.rules?.status ? { status: s.rules.status } : {}), ...(s.player.backstory ? { backstory: s.player.backstory } : {}),
  ...(s.rules?.spells ? { spells: s.rules.spells } : {}), ...(s.rules?.weapons ? { weapons: s.rules.weapons } : {}), ...(s.rules?.features ? { features: s.rules.features } : {}),
}];

/** An entry as the simulation keeps it: the player's lines as player:1, the markup by the game's keys (the place's own people under the place). */
function entryOf(e: Session["transcript"][number], s: Session): Entry {
  const scene = { cast: [{ id: "kell" }, { id: "cob" }, { id: "moll" }, { id: "tull" }] } as Parameters<typeof gameMarkup>[1];
  return { turn: e.turn, speaker: e.speaker === "player" ? "player:1" : e.speaker, kind: e.kind, text: e.text, ...(e.marked ? { markup: gameMarkup(e.marked, scene, s.world, KEYS) } : {}) };
}

/**
 * What the decide commit did, read off the session at the reply as the prototype left it: the
 * turn's dice lines, the route's move (from the beat it left, its roll as the path has it), and
 * whether the scene was stuck. The golden turns reach no ending, so there's nothing taken or held.
 */
function outcomeOf(before: Session, at: Session, d: Decision): Outcome {
  const lines = at.transcript.filter(e => e.turn === at.turn && e.kind === "roll").map(e => e.text);
  const wasStuck = before.sceneStatus === "stuck";
  if (before.closing) return { lines, directives: [], wasStuck, windDown: { exit: before.closing.exitId } };
  const step = at.path.find(p => p.turn === at.turn && p.source === "pre" && p.via === d.route?.id);
  const move = d.route && { route: d.route.id, phase: d.route.phase, from: before.beat, to: step?.to ?? before.beat, ...(step?.roll ? { roll: step.roll } : {}), chosen: !!d.route.theirs || (d.route.phase === "attempt" && (!step?.roll || step.roll.success)) };
  return { lines, directives: [], wasStuck, ...(move ? { move } : {}) };
}
