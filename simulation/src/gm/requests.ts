import type { Backstory } from "../../../shared/creation/types.ts";
import {
  STEP_ENDPOINT, STEP_TIMEOUT_MS, type ActRequest, type AiRequest, type BoundaryRequest, type Chapter, type Entry, type LooksRequest, type OpenRequest, type ReactionsRequest,
  type RememberRequest, type ReplyRequest, type SceneContext, type SettleRequest, type SheetRow, type SidesRequest, type BoardMoment, type BoardOption, type BoardTurnRequest, type BoardView, type NarrateRequest, type Story, type SuggestRequest, type TalkOpen, type TurnContext,
} from "../../../shared/protocol/ai.ts";
import type { GuardStage, TalkRecord } from "../../../shared/gm/state.ts";
import { talkOf } from "../../../shared/scene/talk.ts";
import { idempotencyKey, idOf, idText, playerSpeaker } from "../../../shared/protocol/keys.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { SpellFacts } from "../../../shared/rules/types.ts";
import type { Skill } from "../../../shared/scene/types.ts";
import { pcKey } from "../../../shared/world/rows.ts";
import type { TxCtx } from "../context.ts";
import type { AiCall } from "../moves/move.ts";
import type { BoardTurnPlan, BoundaryPlan, LookPlan, NarratePlan, OpenPlan, RememberPlan, SayPlan, SuggestPlan } from "../moves/plans.ts";
import { gameRow, playerRow, sceneRow, sheetRow, turnRow, type GameRow, type PlayerRow, type RowOf, type SceneRow } from "../rows.ts";
import { sceneGraph } from "../scenes.ts";
import { FIGHT_NOT_PLAYED } from "../story/words.ts";
import { entriesOf } from "../transcript.ts";
import { placeRows } from "../world/rows-io.ts";
import { getGm } from "./rows.ts";

/**
 * think's bodies (v0-design §5.2, §6.2; v5-design §3.6; full-gm-design §4.2; world-bridge-design
 * §3.1): each step's request,
 * built from the rows the transaction that queues it sees, so the request is exactly the state the
 * commit's checks compare against, and a stored request can be POSTed again unchanged after any
 * crash.
 */

/**
 * The opening's call: POST /v1/scenes/open, key <uid>:s<scene>:t0:open. A fight's aftermath (story-
 * design §4.3) is the same call on a turn of its own (key <uid>:s<scene>:t<n>:open), with how the
 * fight went and the scene's transcript so far.
 */
export function openCall(tx: TxCtx, plan: OpenPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.aftermath ? turnRow(tx, idOf(plan.turn)).n : 0, "open");
  const request: OpenRequest = {
    ...aiRequest(key, at),
    scene: { id: idText(at.scene.id), key: at.scene.sceneKey, kind: kindOf(at.scene) },
    pc: pcKey(at.controller.id), gm: getGm(tx, at.scene.id), world: placeRows(tx, at.scene.placeId), party: partyOf(tx, at.controller), story: storyOf(tx, at.game, at.scene.id),
    stream: { turn: plan.turn },
    ...(plan.aftermath ? { aftermath: plan.aftermath, transcript: entriesOf(tx, at.scene.id) } : {}),
    ...(at.scene.kind === "talk" ? { talk: talkOpen(tx, at) } : {}),
  };
  return { endpoint: STEP_ENDPOINT.open, key, timeoutMs: STEP_TIMEOUT_MS.open, request };
}

/**
 * The boundary's call: POST /v1/scenes/boundary, key <uid>:s<scene>:t<n>:boundary (n: the ended
 * scene's last turn). The scene's working set as it ended ("Scene ends" last, the place as its
 * afterwards left it), the exit it ended by, and the scenes the story could go to.
 */
export function boundaryCall(tx: TxCtx, plan: BoundaryPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, "boundary");
  const request: BoundaryRequest = { ...aiRequest(key, at), turn: sceneContext(tx, at, plan.n), exit: plan.exit, candidates: plan.candidates };
  return { endpoint: STEP_ENDPOINT.boundary, key, timeoutMs: STEP_TIMEOUT_MS.boundary, request };
}

/** A say turn's call for its step: act, reactions, reply or settle, each with the turn's working set. */
export function sayCall(tx: TxCtx, plan: SayPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, plan.step);
  const base = { ...aiRequest(key, at), turn: turnContext(tx, plan, at) };
  return { endpoint: STEP_ENDPOINT[plan.step], key, timeoutMs: STEP_TIMEOUT_MS[plan.step], request: stepRequest(plan, base, at.controller.suggestions) };
}

/**
 * A turn the board played, told (docs/combat-gm.md): POST /v1/fights/narrate, key
 * <uid>:s<scene>:t<n>:narrate-<to>, the scene's working set at the turn the fight broke out on, the
 * board as the GM sees it, and the turn's moments.
 */
export function narrateCall(tx: TxCtx, plan: NarratePlan, fight: BoardView, moments: BoardMoment[], before: BoardMoment[] = []): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, "narrate", plan.to);
  const request: NarrateRequest = { ...aiRequest(key, at), turn: sceneContext(tx, at, plan.n), fight, whose: plan.whose, moments, ...(before.length ? { before } : {}) };
  return { endpoint: STEP_ENDPOINT.narrate, key, timeoutMs: STEP_TIMEOUT_MS.narrate, request };
}

/**
 * A step of the player's typed turn on the board (docs/combat-gm.md): POST /v1/fights/turn, key
 * <uid>:s<scene>:t<n>:fight-<at * 100 + step>, the scene's working set with the player's line, the
 * board as the GM sees it, what they can do now, and what's been done of it so far.
 */
export function boardTurnCall(tx: TxCtx, plan: BoardTurnPlan, fight: BoardView, options: BoardOption[], movement: number): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, "fight", plan.at * 100 + plan.done.length + 1);
  const turn: TurnContext = { ...sceneContext(tx, at, plan.n), line: { speaker: playerSpeaker(at.controller.id), text: plan.line } };
  const request: BoardTurnRequest = { ...aiRequest(key, at), turn, fight, options, movement, done: plan.done };
  return { endpoint: STEP_ENDPOINT.fight, key, timeoutMs: STEP_TIMEOUT_MS.fight, request };
}

/**
 * The lines' call: POST /v1/turns/suggest, key <uid>:s<scene>:t<n>:suggest, and suggest-<k> for the
 * turn's k-th ask. The scene up to now, and its last set offered, none of which is offered again.
 */
export function suggestCall(tx: TxCtx, plan: SuggestPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, "suggest", plan.ask);
  const request: SuggestRequest = { ...aiRequest(key, at), turn: sceneContext(tx, at, plan.n), offered: offeredIn(tx, at.scene.id) };
  return { endpoint: STEP_ENDPOINT.suggest, key, timeoutMs: STEP_TIMEOUT_MS.suggest, request };
}

/**
 * The memory reviews' call: POST /v1/turns/remember, key <uid>:s<scene>:t<n>:remember. The scene as
 * turn n left it (the prototype's rememberJob reviewed the turn's snapshot), and the turn reviewed.
 */
export function rememberCall(tx: TxCtx, plan: RememberPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, "remember");
  const request: RememberRequest = { ...aiRequest(key, at), turn: reviewedContext(tx, at, plan.n), reviewed: plan.n };
  return { endpoint: STEP_ENDPOINT.remember, key, timeoutMs: STEP_TIMEOUT_MS.remember, request };
}

/** A turn's working set: everything the GM may need, as this transaction sees it, with the player's line. */
export function turnContext(tx: TxCtx, plan: SayPlan, at: Where): TurnContext {
  return { ...sceneContext(tx, at, plan.n), line: { speaker: playerSpeaker(plan.player), text: plan.input } };
}

/** The scene's working set at turn n, with no line in it: what a job beside a turn reads (an opening has none). */
export function sceneContext(tx: TxCtx, at: Where, n: number): SceneContext {
  const gm = getGm(tx, at.scene.id);
  return {
    scene: { id: idText(at.scene.id), key: at.scene.sceneKey, kind: kindOf(at.scene), turn: n },
    pc: pcKey(at.controller.id),
    gm,
    transcript: entriesOf(tx, at.scene.id),
    world: placeRows(tx, at.scene.placeId),
    party: partyOf(tx, at.controller),
    present: presentCast(sceneGraph(tx, at.scene, gm), gm).map(c => ({ key: c.id, name: c.name, ...(c.called ? { called: c.called } : {}) })),
    story: storyOf(tx, at.game, at.scene.id),
  };
}

/**
 * The scene's working set as turn n left it, for the jobs after a turn: a line said meanwhile (queued
 * for the next turn) is already in the transcript, and the prototype's jobs never saw it.
 */
function reviewedContext(tx: TxCtx, at: Where, n: number): SceneContext {
  const context = sceneContext(tx, at, n);
  return { ...context, transcript: context.transcript.filter(e => e.turn <= n) };
}

// ---------------------------------------------------------------------------------------------

type Where = { game: GameRow; scene: SceneRow; controller: PlayerRow };

function whereOf(tx: TxCtx, sceneId: string): Where {
  const scene = sceneRow(tx, BigInt(sceneId));
  return { game: gameRow(tx, scene.gameId), scene, controller: playerRow(tx, scene.controllerId) };
}

/** Every request's head: its key, the game's content, the scene's controller. */
function aiRequest(key: string, at: Where): AiRequest {
  return { key, game: { id: at.game.uid, campaign: at.game.campaign, version: at.game.campaignVersion }, player: { id: idText(at.controller.id), name: at.controller.name } };
}

/**
 * act: the turn's working set, its line the player's (what the rules resolve of it is asked). reactions:
 * what the rules' act did (takeAct), which everyone who saw it reacts to (the turn's working set is
 * the world after it).
 */
function stepRequest(plan: SayPlan, base: AiRequest & { turn: TurnContext }, suggest: boolean): ActRequest | ReactionsRequest | ReplyRequest | SettleRequest | SidesRequest {
  if (plan.step === "act") return base;
  // A fight breaking out (docs/combat-gm.md): who's on which side, and who's the GM's to place.
  if (plan.step === "sides") return { ...base, sides: needs(plan.sides, "sides", "sides") };
  if (plan.step === "reactions") return { ...base, act: needs(plan.act, "act", "reactions") };
  // The two-part GM's reply: the outcome's directives are the rules' and the player's act's (docs/two-part-design.md).
  if (plan.step === "reply") return { ...base, outcome: needs(plan.outcome, "outcome", "reply"), stream: { turn: plan.turn } };
  // A talk's settle asks for its next lines when its controller has them on (talk.suggest: town-design §3.6); the co-GM is told how the turn's check went, and what the rules resolved of the player's act.
  return {
    ...base, reply: plan.reply ?? "", lines: plan.lines, settled: plan.settledBefore, ...(base.turn.scene.kind === "talk" ? { talk: { suggest } } : {}),
    ...(plan.check ? { check: plan.check } : {}), ...(plan.acted ? { act: plan.acted } : {}),
  };
}

/**
 * The party: the controller's character, by their sheet, with the backstory they wrote at creation
 * (the GM's brief and the player's doc read it), and what the rules' act can be done with: the
 * spells ready, the weapons carried, the class features with uses (world-bridge-design §3.1).
 */
function partyOf(tx: TxCtx, controller: PlayerRow): SheetRow[] {
  const sheet = sheetRow(tx, controller.id);
  return [{
    name: controller.name, concept: controller.concept, build: sheet.build, skills: JSON.parse(sheet.skills) as Partial<Record<Skill, number>>, status: sheet.statusLine,
    ...(sheet.backstory ? { backstory: JSON.parse(sheet.backstory) as Backstory } : {}),
    spells: spellsOf(sheet),
    weapons: sheet.weapons.map(w => ({ id: w.id, name: w.name })),
    features: sheet.features.map(f => ({ id: f.id, name: f.name, target: f.target === "creature" ? "creature" : "self" })),
  }];
}

/**
 * The spells ready, with what the rules say of each one's reach (the sheet's spellFacts: its range,
 * its effects' kinds, an area), which tells the act step a spell that needs aiming from one that
 * doesn't; as the sheet names them while nothing has worked the facts out.
 */
function spellsOf(sheet: RowOf<"sheet">): SpellFacts[] {
  const facts = sheet.spellFacts ? JSON.parse(sheet.spellFacts) as SpellFacts[] : [];
  return sheet.spells.map(s => facts.find(f => f.id === s.id) ?? { id: s.id, name: s.name, level: s.level });
}

/** The scene's suggested lines as they stand, in the order shown: the last set offered. */
function offeredIn(tx: TxCtx, sceneId: bigint): string[] {
  return [...tx.db.sceneSuggestion.sceneId.filter(sceneId)].sort((a, b) => a.ord - b.ord).map(s => s.text);
}

/**
 * The story so far, beside the scene (story-design §4.2): its clock, the flags its endings set, and,
 * once a scene has been played before this one, the chapters (the prototype's history, oldest first)
 * and every entry of those scenes, in order, each with its scene's key (the prototype's transcript
 * holds the whole story). This scene's own chapter, while its boundary is being crossed, isn't yet
 * the story before it.
 */
export function storyOf(tx: TxCtx, game: GameRow, sceneId: bigint): Story {
  const flags = Object.fromEntries([...tx.db.flag.gameId.filter(game.id)].sort((a, b) => (a.id < b.id ? -1 : 1)).map(f => [f.name, f.value]));
  const chapters = [...tx.db.chapter.gameId.filter(game.id)].filter(c => c.sceneId !== sceneId).sort((a, b) => a.seq - b.seq);
  const history = chapters.map(c => chapterOf(tx, c));
  const earlier = chapters.flatMap(c => earlierEntries(tx, c.sceneId, c.sceneKey));
  const talks = talksOf(tx, game.id);
  return { time: game.time, day: game.day, flags, ...(history.length ? { history } : {}), ...(earlier.length ? { earlier } : {}), ...(Object.keys(talks).length ? { talks } : {}) };
}

/** What companions have told the player of themselves in talks between scenes (town-design §3.8: talk_record), by their cast ids. */
function talksOf(tx: TxCtx, gameId: bigint): Record<string, TalkRecord> {
  return Object.fromEntries([...tx.db.talkRecord.gameId.filter(gameId)].sort((a, b) => (a.id < b.id ? -1 : 1)).map(r => [r.castKey, recordOf(r)]));
}

const recordOf = (r: RowOf<"talkRecord">): TalkRecord => ({
  count: r.count, told: r.told.map(t => ({ note: t.note, topic: t.topic, turn: t.turn })),
  ...(r.stages.length ? { stages: Object.fromEntries(r.stages.map(s => [s.note, s.stage as GuardStage])) } : {}),
});

/** A scene's kind on the wire: a scene of the story, or a talk with a companion. */
const kindOf = (scene: SceneRow): "scene" | "talk" => (scene.kind === "talk" ? "talk" : "scene");

/**
 * A talk's open (town-design §3.6, talk.ts startTalk and plan): with whom and where; their record,
 * this talk counted; how the story led on to the waiting scene, as the player knows it (its
 * bookkeeping's lead); every entry of their earlier talks with the player, each with its scene's
 * key; and whether lines are suggested (the controller's own setting).
 */
function talkOpen(tx: TxCtx, at: Where): TalkOpen {
  const talk = getGm(tx, at.scene.id).talk;
  if (!talk) throw new Error(`talk ${at.scene.id} has no talk in its bookkeeping`);
  const record = [...tx.db.talkRecord.gameId.filter(at.game.id)].find(r => r.castKey === talk.with);
  const lead = at.game.leadScene ? [...tx.db.scene.gameId.filter(at.game.id)].find(s => s.sceneKey === at.game.leadScene && s.status === "waiting") : undefined;
  const leadText = lead ? getGm(tx, lead.id).lead : undefined;
  const earlier = [...tx.db.scene.gameId.filter(at.game.id)]
    .filter(s => s.kind === "talk" && s.id !== at.scene.id && talkOf(s.sceneKey)?.companion === talk.with).sort((a, b) => (a.id < b.id ? -1 : 1))
    .flatMap(s => earlierEntries(tx, s.id, s.sceneKey));
  return {
    with: talk.with, where: talk.where, record: record ? recordOf(record) : { count: 1, told: [] },
    ...(leadText ? { lead: leadText } : {}), earlier, suggest: at.controller.suggestions,
  };
}

/**
 * The looks' call (town-design §3.7): POST /v1/looks, key <uid>:s<scene>:t<n>:look, each new thing by
 * the key its look is kept by (its name in lower case), its name and kind.
 */
export function looksCall(tx: TxCtx, plan: LookPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, "look");
  const seen = new Set<string>();
  const things = plan.things.filter(t => !seen.has(t.key) && seen.add(t.key)).map(t => ({ key: t.key, name: t.name, ...(t.kind ? { kind: t.kind } : {}) }));
  const request: LooksRequest = { ...aiRequest(key, at), things };
  return { endpoint: STEP_ENDPOINT.look, key, timeoutMs: STEP_TIMEOUT_MS.look, request };
}

/**
 * A chapter as the prototype's history entry has it (engine.ts:1080): the scene's and exit's keys,
 * the hand-off, its last moments, then only what it has of the scenes skipped, the fronts moved, its
 * notebook's lines (its ending's journal, not the fight stand-in's word on the fight) and its facts.
 */
function chapterOf(tx: TxCtx, c: RowOf<"chapter">): Chapter {
  const journal = [...tx.db.journal.gameId.filter(c.gameId)].filter(j => j.sceneId === c.sceneId && j.text !== FIGHT_NOT_PLAYED).sort((a, b) => a.seq - b.seq).map(j => j.text);
  const skipped = c.skipped.map(s => ({ sceneId: s.sceneKey, why: s.why }));
  return {
    sceneId: c.sceneKey, exitId: c.exitKey, summary: c.summary, lastMoments: [...c.lastMoments],
    ...(skipped.length ? { skipped } : {}), ...(c.fronts.length ? { fronts: [...c.fronts] } : {}), ...(journal.length ? { journal } : {}), ...(c.facts.length ? { facts: [...c.facts] } : {}),
  };
}

/** An earlier scene's entries, in order, each with its scene's key, without markup. */
function earlierEntries(tx: TxCtx, sceneId: bigint, sceneKey: string): Entry[] {
  return entriesOf(tx, sceneId).map(({ markup: _markup, ...e }) => ({ ...e, scene: sceneKey }));
}

function needs<T>(value: T | undefined, what: string, step: SayPlan["step"]): T {
  if (value === undefined) throw new Error(`the plan has no ${what} for its ${step}`);
  return value;
}
