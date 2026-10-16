import type { Backstory } from "../../../shared/creation/types.ts";
import {
  STEP_ENDPOINT, STEP_TIMEOUT_MS, type AiRequest, type ConsiderRequest, type DecideRequest, type NotesRequest, type OpenRequest, type RememberRequest, type RepairRequest, type ReplyRequest, type SceneContext,
  type SettleRequest, type SheetRow, type Story, type SuggestRequest, type TurnContext,
} from "../../../shared/protocol/ai.ts";
import { idempotencyKey, idText, playerSpeaker } from "../../../shared/protocol/keys.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Skill } from "../../../shared/scene/types.ts";
import { pcKey } from "../../../shared/world/rows.ts";
import type { TxCtx } from "../context.ts";
import type { AiCall } from "../moves/move.ts";
import type { NotesPlan, OpenPlan, RememberPlan, RepairPlan, SayPlan, SuggestPlan } from "../moves/plans.ts";
import { gameRow, playerRow, sceneRow, sheetRow, type GameRow, type PlayerRow, type SceneRow } from "../rows.ts";
import { sceneGraph } from "../scenes.ts";
import { entriesOf, entryAt, markupOf } from "../transcript.ts";
import { placeRows } from "../world/rows-io.ts";
import { getGm } from "./rows.ts";

/**
 * think's bodies (v0-design §5.2, §6.2; v5-design §3.6; full-gm-design §4.2): each step's request,
 * built from the rows the transaction that queues it sees, so the request is exactly the state the
 * commit's checks compare against, and a stored request can be POSTed again unchanged after any
 * crash.
 */

/** The opening's call: POST /v1/scenes/open, key <uid>:s<scene>:t0:open. */
export function openCall(tx: TxCtx, plan: OpenPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, 0, "open");
  const request: OpenRequest = {
    ...aiRequest(key, at),
    scene: { id: idText(at.scene.id), key: at.scene.sceneKey, kind: "scene" },
    pc: pcKey(at.controller.id), gm: getGm(tx, at.scene.id), world: placeRows(tx, at.scene.placeId), party: partyOf(tx, at.controller), story: storyOf(at.game),
    stream: { turn: plan.turn },
  };
  return { endpoint: STEP_ENDPOINT.open, key, timeoutMs: STEP_TIMEOUT_MS.open, request };
}

/** A say turn's call for its step: decide, consider, reply or settle, each with the turn's working set. */
export function sayCall(tx: TxCtx, plan: SayPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, plan.step);
  const base = { ...aiRequest(key, at), turn: turnContext(tx, plan, at) };
  return { endpoint: STEP_ENDPOINT[plan.step], key, timeoutMs: STEP_TIMEOUT_MS[plan.step], request: stepRequest(plan, base) };
}

/**
 * The notes' call: POST /v1/turns/notes, key <uid>:s<scene>:t<n>:notes. The reply as its transcript
 * row has it (its words, who says each line), the marks the GM drafted, and the scene up to it.
 */
export function notesCall(tx: TxCtx, plan: NotesPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, "notes");
  const entry = entryAt(tx, at.scene.id, plan.seq);
  const request: NotesRequest = {
    ...aiRequest(key, at),
    turn: sceneContext(tx, at, plan.n),
    reply: { seq: entry.seq, text: entry.text, speech: markupOf(entry)?.speech ?? [], drafted: plan.drafted },
  };
  return { endpoint: STEP_ENDPOINT.notes, key, timeoutMs: STEP_TIMEOUT_MS.notes, request };
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

/** The co-GM's call: POST /v1/turns/repair, key <uid>:s<scene>:t<n>:repair. The scene as turn n left it, and the turn reviewed. */
export function repairCall(tx: TxCtx, plan: RepairPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, "repair");
  const request: RepairRequest = { ...aiRequest(key, at), turn: reviewedContext(tx, at, plan.n), reviewed: plan.n };
  return { endpoint: STEP_ENDPOINT.repair, key, timeoutMs: STEP_TIMEOUT_MS.repair, request };
}

/** A turn's working set: everything the GM may need, as this transaction sees it, with the player's line. */
export function turnContext(tx: TxCtx, plan: SayPlan, at: Where): TurnContext {
  return { ...sceneContext(tx, at, plan.n), line: { speaker: playerSpeaker(plan.player), text: plan.input } };
}

/** The scene's working set at turn n, with no line in it: what a job beside a turn reads (an opening has none). */
export function sceneContext(tx: TxCtx, at: Where, n: number): SceneContext {
  const gm = getGm(tx, at.scene.id);
  return {
    scene: { id: idText(at.scene.id), key: at.scene.sceneKey, kind: "scene", turn: n },
    pc: pcKey(at.controller.id),
    gm,
    transcript: entriesOf(tx, at.scene.id),
    world: placeRows(tx, at.scene.placeId),
    party: partyOf(tx, at.controller),
    present: presentCast(sceneGraph(tx, at.scene, gm), gm).map(c => ({ key: c.id, name: c.name, ...(c.called ? { called: c.called } : {}) })),
    story: storyOf(at.game),
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

/** consider: the decider's read that asked for the ruling, and the ending held for the player's answer (the decide commit took it off the bookkeeping). */
function stepRequest(plan: SayPlan, base: AiRequest & { turn: TurnContext }): DecideRequest | ConsiderRequest | ReplyRequest | SettleRequest {
  if (plan.step === "decide") return { ...base, landed: [] };
  if (plan.step === "consider") return { ...base, ...(plan.decision?.considered ? { read: plan.decision.considered } : {}), ...(plan.pendingExit ? { pending: plan.pendingExit } : {}) };
  if (plan.step === "reply") return { ...base, decision: needs(plan.decision, "decision"), outcome: needs(plan.outcome, "outcome"), stream: { turn: plan.turn } };
  return { ...base, reply: plan.reply ?? "", lines: plan.lines, settled: plan.settledBefore };
}

/** The party: the controller's character, by their sheet, with the backstory they wrote at creation (the GM's brief and the player's doc read it). */
function partyOf(tx: TxCtx, controller: PlayerRow): SheetRow[] {
  const sheet = sheetRow(tx, controller.id);
  return [{
    name: controller.name, concept: controller.concept, build: sheet.build, skills: JSON.parse(sheet.skills) as Partial<Record<Skill, number>>, status: sheet.statusLine,
    ...(sheet.backstory ? { backstory: JSON.parse(sheet.backstory) as Backstory } : {}),
  }];
}

/** The scene's suggested lines as they stand, in the order shown: the last set offered. */
function offeredIn(tx: TxCtx, sceneId: bigint): string[] {
  return [...tx.db.sceneSuggestion.sceneId.filter(sceneId)].sort((a, b) => a.ord - b.ord).map(s => s.text);
}

/** The story's clock (no flags until the boundary vertical). */
const storyOf = (game: GameRow): Story => ({ time: game.time, day: game.day, flags: {} });

function needs<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the plan has no ${what} for its reply`);
  return value;
}
