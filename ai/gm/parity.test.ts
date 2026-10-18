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
import type { Markup, Speech } from "../../shared/markup.ts";
import type { AiRequest, Entry, SceneContext, SheetRow, Suggestion, SuggestRequest, SuggestResponse } from "../../shared/protocol/ai.ts";
import { keysFor, worldToRows } from "../../shared/world/rows.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";
import { testScene, testStory } from "./fixtures.ts";
import { vetting, type Vetting } from "./suggest.ts";
import { gameMarkup, turnSource } from "./view.ts";

/**
 * Prompt parity for the suggested lines (v5-design §4.2), the suggester's acceptance test: the AI
 * service asks the models what the prototype's asks, for the same state. golden/hanged-clerk holds
 * the prototype's lines suggested after the opening and each of three replies on the hanged clerk at
 * 44c6d4a (recorded by the repo's tools/record-golden.mts; golden/README.md): for each moment, the
 * session frozen at the call and what came of it. Each session becomes the request the simulation
 * would send, the AI service's endpoint runs on the same stand-in, and what it asks and answers are
 * compared: byte for byte, the suggester's request (instructions, input, token cap: the spells in
 * "who they are" too) and the judge's state; question by question, the judge's; equal, every field
 * of the vetting, the lines and what was dropped, with why.
 *
 * (The GM's steps' parity, the opening and each turn's decide, reply and settle as the prototype's
 * old pipeline asked them, went with the old pipeline's scene steps: docs/migration-log.md, M2's
 * "The old pipeline's salvage". The two-part GM is held to PR #666's instead, by ai/gm/two-part.test.ts.)
 */

const GOLDEN = join(import.meta.dirname, "golden");
const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const GAME = "6f0c1d2e-0000-4000-8000-00000000901d";

/** The prototype's session, as far as the requests are made from it. */
interface Session {
  turn: number; beat: string; turnsInBeat: number; path: GmState["path"]; established: string[]; canon: string[]; notes: string | null;
  patches: GmState["patches"]; landed?: string[]; hinted?: string[]; memory?: { opened: GmState["opened"] };
  pendingExit?: GmState["pendingExit"]; closing?: GmState["closing"]; oocTurns?: number[]; pressureOffered?: string[];
  entered?: string[]; absent?: string[]; whispers?: GmState["whispers"];
  player: { name: string; concept: string; modifiers: SheetRow["skills"]; build?: string; backstory?: Backstory };
  rules?: { status?: string; spells?: SheetRow["spells"]; weapons?: SheetRow["weapons"]; features?: SheetRow["features"] };
  transcript: Array<{ turn: number; speaker: string; kind: Entry["kind"]; text: string; marked?: Markup }>;
  world: SceneWorld;
}
interface SuggestMoment { moment: string; fake: FakeOptions; session: Session; offered: string[]; bodies: { suggest: Request; judge?: Request & { state?: Record<string, string> } }; vetting: Vetting; lines: Suggestion[]; dropped: Array<{ text: string; why: string }> }

/** The player's spells, which the suggester and the judge are told of (suggest.ts's who()): from the sheet's spells, in both since the world bridge. */
const SPELLS = / Spells: [^.]*\./;

const MOMENTS = ["open", "t1", "t2", "t3"];
const linesOf = (moment: string) => JSON.parse(readFileSync(join(GOLDEN, "hanged-clerk", `${moment}.suggest.json`), "utf8")) as SuggestMoment;

test("the golden recording is there: each moment's lines, and what was dropped between them", () => {
  assert.deepEqual(readdirSync(join(GOLDEN, "hanged-clerk")).filter(f => f.endsWith(".json")).sort(), MOMENTS.map(m => `${m}.suggest.json`), "the GM's steps went with the old pipeline's");
  const why = MOMENTS.flatMap(m => linesOf(m).dropped.map(d => d.why.replace(/:.*/, "")));
  for (const reason of ["a name not heard", "no way out yet", "the GM's markup", "the judge", "offered last time"]) assert.ok(why.includes(reason), reason);
});

test("the AI service suggests what the prototype's does, moment by moment: the opening and three replies", async () => {
  const play = await game();
  for (const moment of MOMENTS) await sameLines(play, linesOf(moment));
});

// ---------------------------------------------------------------------------------------------
// What's compared.

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

/** The lines after a moment's reply: none of the scene's last set again. */
function suggestRequest(m: SuggestMoment): SuggestRequest {
  return { ...base("suggest", m.session.turn, m.session), turn: sceneOf(m.session), offered: m.offered };
}

function sceneOf(s: Session): SceneContext {
  return { scene: { id: "1", key: "hanged-clerk", kind: "scene", turn: s.turn }, pc: "pc:1", gm: gmOf(s), transcript: s.transcript.map(e => entryOf(e, s)), world: rowsOf(s), party: partyOf(s), present: [], story };
}

/** The GM's bookkeeping as gm_state keeps it, from the session's fields of the same names. */
function gmOf(s: Session): GmState {
  return {
    beat: s.beat, turnsInBeat: s.turnsInBeat, path: s.path, established: s.established, landed: s.landed ?? [], hinted: s.hinted ?? [],
    opened: s.memory?.opened ?? [],
    ...(s.pendingExit ? { pendingExit: s.pendingExit } : {}), ...(s.closing ? { closing: s.closing } : {}),
    oocTurns: s.oocTurns ?? [], pressureOffered: s.pressureOffered ?? [],
    canon: s.canon, patches: s.patches, entered: s.entered ?? [], absent: s.absent ?? [], notes: s.notes, whispers: s.whispers ?? [],
    notesTurn: null, rulings: [], adjustments: [], owed: [], fought: [],
    // (The prototype's session has no nodes reached nor a two-part GM: its beat stands for them.)
    reached: [s.beat], twoPart: { roles: {}, notes: [] },
  };
}

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
