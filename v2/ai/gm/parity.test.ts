import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fakeFetch, type Request } from "../llm/fake-openrouter.ts";
import type { CallContext } from "../llm/openrouter.ts";
import { noUsage } from "../service/calls.ts";
import { campaigns } from "../service/campaigns.ts";
import type { AiContext } from "../service/context.ts";
import { pipeline } from "../service/endpoints/pipeline.ts";
import { folderStores } from "../service/folder-stores.ts";
import type { StreamSink } from "../service/stream.ts";
import type { GmState } from "../../shared/gm/state.ts";
import type { AiRequest, Decision, DecideRequest, Entry, OpenRequest, Outcome, ReplyRequest, SettleRequest, SheetRow, TurnContext } from "../../shared/protocol/ai.ts";
import { keysFor, worldToRows } from "../../shared/world/rows.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";

/**
 * Prompt parity (v0-design §10.2), the AI service's acceptance test: V0's GM asks the models what
 * the prototype's asks, for the same state. golden/hanged-clerk holds the prototype's calls on the
 * hanged clerk at 44c6d4a (recorded by the repo's tools/record-golden.mts; golden/README.md): for
 * each step, the session as it stood and every call it made. Each step's session becomes the
 * request the simulation would send, V0's endpoint runs on the same stand-in, and its calls are
 * compared:
 *
 * - byte for byte: the GM's (gm.opening, gm.reply), the stage manager's (instructions, input,
 *   schema), and disclosure's (each scope's state and questions);
 * - the director's (before and after): the state byte for byte, and each question V0 asks equal to
 *   the prototype's of that id. V0 asks fewer: the ones it leaves out are pinned below.
 *
 * The steps run in order on one store, as a game would: the opening writes the player's doc, which
 * every later prompt reads. A reply's decision is V0's own, from its decide on the same turn; what
 * the decide commit did (the roll, the move) is read off the prototype's session.
 */

const GOLDEN = join(import.meta.dirname, "golden", "hanged-clerk");
const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const GAME = "6f0c1d2e-0000-4000-8000-00000000901d";

/** The prototype's session, as far as the requests are made from it. */
interface Session {
  turn: number; beat: string; turnsInBeat: number; path: GmState["path"]; established: string[]; canon: string[]; notes: string | null;
  patches: GmState["patches"]; landed?: string[]; hinted?: string[]; memory?: { opened: GmState["opened"] }; endingLead?: GmState["endingLead"];
  pendingExit?: GmState["pendingExit"]; closing?: GmState["closing"]; sceneStatus?: GmState["sceneStatus"]; oocTurns?: number[]; pressureOffered?: string[];
  repeated?: string; entered?: string[]; absent?: string[]; whispers?: GmState["whispers"]; rulings?: unknown[];
  player: { name: string; concept: string; modifiers: SheetRow["skills"]; build?: string };
  rules?: { status?: string };
  transcript: Array<{ turn: number; speaker: string; kind: Entry["kind"]; text: string; marked?: Entry["markup"] }>;
  world: SceneWorld;
}
interface Golden { step: string; line?: string; choices?: Record<string, string>; replies: string[]; session: Session; calls: Array<{ operation: string; body: Request }> }

/**
 * What V0 doesn't ask the director that the prototype's v2 approach does: considered rolls'
 * roll_call (and the means, which they ask in every beat, where V0 asks it only of a social route's
 * check), the co-GM's off_graph and the rules' mechanic before the reply, and the rules' left,
 * threat and threat_severity after it. gm-port §6, §9.
 */
const NOT_ASKED = { before: ["roll_call", "attempt_means", "off_graph", "mechanic"], after: ["left", "threat", "threat_severity"] };

/** Questions asked in both whose words differ, and why. None: each V0 asks is the prototype's to the letter. */
const WORDED_OTHERWISE: string[] = [];

const steps = readdirSync(GOLDEN).filter(f => f.endsWith(".json")).sort().map(f => JSON.parse(readFileSync(join(GOLDEN, f), "utf8")) as Golden);

test("the golden recording is there: the opening and three turns, each step's calls", () => {
  assert.deepEqual(steps.map(s => s.step), ["open", "t1-decide", "t1-reply", "t1-settle", "t2-decide", "t2-reply", "t2-settle", "t3-decide", "t3-reply", "t3-settle"]);
  assert.deepEqual(steps.filter(s => s.step.endsWith("-reply")).map(s => s.calls.map(c => c.operation)), [["gm.reply"], ["gm.reply"], ["gm.reply"]]);
});

test("V0's GM asks what the prototype's asks, step by step through the opening and three turns", async () => {
  const play = await game();
  const decisions = new Map<string, Decision>();
  const before = new Map<string, Session>();

  for (const golden of steps) {
    const turn = golden.step.split("-")[0]!;
    const asked = await play.run(golden, request => {
      if (golden.step === "open") return pipeline.open(openRequest(golden), request);
      if (golden.step.endsWith("-decide")) return pipeline.decide(decideRequest(golden), request);
      if (golden.step.endsWith("-reply")) return pipeline.reply(replyRequest(golden, decisions.get(turn)!, before.get(turn)!), request);
      return pipeline.settle(settleRequest(golden, before.get(turn)!), request);
    });
    if (golden.step.endsWith("-decide")) { decisions.set(turn, (asked.answer as { decision: Decision }).decision); before.set(turn, golden.session); }

    compare(golden, asked.calls);
  }
});

/** Each of the prototype's calls against V0's of the same operation (in turn, for an operation made more than once). */
function compare(golden: Golden, ours: Array<{ operation: string; body: Request }>): void {
  assert.deepEqual(ours.map(c => c.operation).sort(), golden.calls.map(c => c.operation).sort(), `${golden.step}: the same calls`);
  const taken = new Set<number>();
  for (const theirs of golden.calls) {
    const at = ours.findIndex((c, i) => !taken.has(i) && c.operation === theirs.operation && (!theirs.operation.startsWith("memory.disclose.") || JSON.stringify(c.body) === JSON.stringify(theirs.body)));
    assert.ok(at >= 0, `${golden.step} ${theirs.operation}: V0 made no call like the prototype's${theirs.operation.startsWith("memory.disclose.") ? `:\n${firstDifference(theirs.body, ours.filter(c => c.operation === theirs.operation).map(c => c.body))}` : ""}`);
    taken.add(at);
    const mine = ours[at]!.body;
    if (theirs.operation.startsWith("director.")) sameDecision(golden.step, theirs.operation, mine, theirs.body);
    else assert.equal(JSON.stringify(mine), JSON.stringify(theirs.body), `${golden.step} ${theirs.operation}:\n${firstDifference(theirs.body, [mine])}`);
  }
}

/** The director's call: the state byte for byte, each question V0 asks the prototype's, and only the ones it leaves out missing. */
function sameDecision(step: string, operation: string, mine: Request & { state?: unknown }, theirs: Request & { state?: unknown }): void {
  assert.equal(JSON.stringify(mine.state), JSON.stringify(theirs.state), `${step} ${operation}: the state`);
  const left = operation === "director.after" ? NOT_ASKED.after : NOT_ASKED.before;
  for (const [id, q] of Object.entries(mine.questions ?? {})) {
    assert.ok(theirs.questions?.[id], `${step} ${operation}: V0 asks ${id}, which the prototype doesn't`);
    if (!WORDED_OTHERWISE.includes(id)) assert.equal(JSON.stringify(q), JSON.stringify(theirs.questions![id]), `${step} ${operation}: the question ${id}`);
  }
  const missing = Object.keys(theirs.questions ?? {}).filter(id => !mine.questions?.[id]);
  assert.deepEqual(missing.filter(id => !left.includes(id)), [], `${step} ${operation}: questions V0 should ask and doesn't`);
}

/** Where two requests first part, for the failure's message. */
function firstDifference(theirs: Request, ours: Request[]): string {
  const a = JSON.stringify(theirs, null, 1).split("\n");
  return ours.map(o => {
    const b = JSON.stringify(o, null, 1).split("\n");
    const i = a.findIndex((line, k) => line !== b[k]);
    return i < 0 ? "(the same)" : `line ${i}:\n  prototype: ${a[i]?.slice(0, 400)}\n  V0:        ${b[i]?.slice(0, 400)}`;
  }).join("\n") || "(V0 made none)";
}

// ---------------------------------------------------------------------------------------------
// A game on V0's service: one store, the campaign installed, a step at a time on the stand-in.

async function game() {
  const stores = folderStores(mkdtempSync(join(tmpdir(), "km-parity-")));
  const installed = campaigns(stores.campaigns, stores.docsRoot);
  await installed.put("caerwyn", "0.1.0", filesOf(CAERWYN));
  const campaign = installed.use("caerwyn", "0.1.0");

  return {
    /** A step's endpoint on a stand-in told what the prototype's was told; its calls, each named by its operation from the call log. */
    async run(golden: Golden, endpoint: (ctx: AiContext) => Promise<unknown>) {
      const fake = fakeFetch({ replies: golden.replies, ...(golden.choices ? { choices: golden.choices } : {}) });
      const logged: Array<Record<string, unknown>> = [];
      const calls: CallContext = { fetch: fake.fetch, apiKey: "parity", log: e => logged.push(e), cost: () => {} };
      const answer = await endpoint({ campaign, calls, usage: noUsage, attempt: 1, stream: () => silent });
      return { answer, calls: named(fake.sent, logged) };
    },
  };
}

const silent: StreamSink = { show: () => {}, finish: async () => {}, firstTextMs: () => null };

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

const base = (step: string, n: number): AiRequest => ({ key: `${GAME}:s1:t${n}:${step}`, game: { id: GAME, campaign: "caerwyn", version: "0.1.0" }, player: { id: "1", name: "Wren Ashdown" } });
const story = { time: "morning", day: 1, flags: {} };

function openRequest(g: Golden): OpenRequest {
  return { ...base("open", 0), scene: { id: "1", key: "hanged-clerk", kind: "scene" }, pc: "pc:1", gm: gmOf(g.session), world: rowsOf(g.session), party: partyOf(g.session), story, stream: { turn: "1" } };
}

function decideRequest(g: Golden): DecideRequest {
  return { ...base("decide", g.session.turn), turn: turnOf(g.session), landed: [] };
}

function replyRequest(g: Golden, decision: Decision, before: Session): ReplyRequest {
  return { ...base("reply", g.session.turn), turn: turnOf(g.session), decision, outcome: outcomeOf(before, g.session, decision), stream: { turn: String(g.session.turn + 1) } };
}

function settleRequest(g: Golden, before: Session): SettleRequest {
  const s = g.session;
  const reply = s.transcript.filter(e => e.turn === s.turn && e.kind === "narration").at(-1)!.text;
  const lines = s.transcript.filter(e => e.turn === s.turn && e.kind === "roll").map(e => e.text);
  // What was settled before the turn (settledFacts: the facts, and the rulings, none here), the last 16.
  return { ...base("settle", s.turn), turn: turnOf(s), reply, lines, settled: before.established.slice(-16) };
}

function turnOf(s: Session): TurnContext {
  const line = s.transcript.filter(e => e.kind === "player").at(-1)!.text;
  return { scene: { id: "1", key: "hanged-clerk", kind: "scene", turn: s.turn }, pc: "pc:1", gm: gmOf(s), transcript: s.transcript.map(entryOf), line: { speaker: "player:1", text: line }, world: rowsOf(s), party: partyOf(s), present: [], story };
}

/** The GM's bookkeeping as gm_state keeps it, from the session's fields of the same names. */
function gmOf(s: Session): GmState {
  return {
    beat: s.beat, turnsInBeat: s.turnsInBeat, path: s.path, established: s.established, landed: s.landed ?? [], hinted: s.hinted ?? [],
    opened: s.memory?.opened ?? [],
    ...(s.endingLead ? { endingLead: s.endingLead } : {}), ...(s.pendingExit ? { pendingExit: s.pendingExit } : {}), ...(s.closing ? { closing: s.closing } : {}),
    ...(s.sceneStatus ? { sceneStatus: s.sceneStatus } : {}), oocTurns: s.oocTurns ?? [], pressureOffered: s.pressureOffered ?? [], ...(s.repeated ? { repeated: s.repeated } : {}),
    canon: s.canon, patches: s.patches, entered: s.entered ?? [], absent: s.absent ?? [], notes: s.notes, whispers: s.whispers ?? [],
  };
}

const rowsOf = (s: Session) => worldToRows(s.world, keysFor("granary-yard", "hanged-clerk", "pc:1"));
const partyOf = (s: Session): SheetRow[] => [{ name: s.player.name, concept: s.player.concept, ...(s.player.build ? { build: s.player.build } : {}), skills: s.player.modifiers, ...(s.rules?.status ? { status: s.rules.status } : {}) }];
const entryOf = (e: Session["transcript"][number]): Entry => ({ turn: e.turn, speaker: e.speaker === "player" ? "player:1" : e.speaker, kind: e.kind, text: e.text, ...(e.marked ? { markup: e.marked } : {}) });

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

test("pinned: the GM's marks aren't kept (no notes in V0), so a reply's history has none of the prototype's (phrase)[why: note]", async () => {
  const play = await game();
  const golden = steps.find(s => s.step === "t1-reply")!;
  const marked = "Moll snorts. (She won't tell you a thing)[why: you called her a liar in front of Cob.] She turns to the street.";
  const first = await play.run({ ...golden, replies: [marked] }, ctx => pipeline.reply(replyRequest(golden, { earned: false, daft: false, outOfCharacter: false }, golden.session), ctx));
  const reply = (first.answer as { entries: Entry[] }).entries[0]!;

  assert.equal(reply.text, "Moll snorts. She won't tell you a thing. She turns to the street.");
  assert.deepEqual(reply.markup, { speech: [], marks: [] }, "the drafted mark is dropped: no note will be written for it");

  // On the next turn, the GM's own history has the reply's words without the mark the prototype would write back with its note.
  const next = { ...golden, session: { ...golden.session, transcript: [...golden.session.transcript, { turn: 1, speaker: "gm", kind: "narration" as const, text: reply.text, marked: reply.markup! }, { turn: 2, speaker: "player", kind: "player" as const, text: "Moll?" }], turn: 2 } };
  const second = await play.run(next, ctx => pipeline.reply(replyRequest(next, { earned: false, daft: false, outOfCharacter: false }, next.session), ctx));
  assert.ok(second.calls[0]!.body.input!.some(m => m.role === "assistant" && m.content.endsWith(reply.text)));
  assert.ok(!second.calls[0]!.body.input!.some(m => /\)\[why: /.test(m.content)));
});
