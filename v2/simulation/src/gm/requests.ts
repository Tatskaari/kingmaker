import { STEP_ENDPOINT, STEP_TIMEOUT_MS, type AiRequest, type DecideRequest, type OpenRequest, type ReplyRequest, type SettleRequest, type SheetRow, type Story, type TurnContext } from "../../../shared/protocol/ai.ts";
import { idempotencyKey, idText, playerSpeaker } from "../../../shared/protocol/keys.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Skill } from "../../../shared/scene/types.ts";
import { pcKey } from "../../../shared/world/rows.ts";
import type { TxCtx } from "../context.ts";
import type { AiCall } from "../moves/move.ts";
import type { OpenPlan, SayPlan } from "../moves/plans.ts";
import { gameRow, playerRow, sceneRow, sheetRow, type GameRow, type PlayerRow, type SceneRow } from "../rows.ts";
import { sceneGraph } from "../scenes.ts";
import { entriesOf } from "../transcript.ts";
import { placeRows } from "../world/rows-io.ts";
import { getGm } from "./rows.ts";

/**
 * think's bodies (v0-design §5.2, §6.2): each step's request, built from the rows the transaction
 * that queues it sees, so the request is exactly the state the commit's checks compare against,
 * and a stored request can be POSTed again unchanged after any crash.
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

/** A say turn's call for its step: decide, reply or settle, each with the turn's working set. */
export function sayCall(tx: TxCtx, plan: SayPlan): AiCall {
  const at = whereOf(tx, plan.scene);
  const key = idempotencyKey(at.game.uid, at.scene.id, plan.n, plan.step);
  const base = { ...aiRequest(key, at), turn: turnContext(tx, plan, at) };
  return { endpoint: STEP_ENDPOINT[plan.step], key, timeoutMs: STEP_TIMEOUT_MS[plan.step], request: stepRequest(plan, base) };
}

/** A turn's working set: everything the GM may need, as this transaction sees it. */
export function turnContext(tx: TxCtx, plan: SayPlan, at: Where): TurnContext {
  const gm = getGm(tx, at.scene.id);
  return {
    scene: { id: idText(at.scene.id), key: at.scene.sceneKey, kind: "scene", turn: plan.n },
    pc: pcKey(at.controller.id),
    gm,
    transcript: entriesOf(tx, at.scene.id),
    line: { speaker: playerSpeaker(plan.player), text: plan.input },
    world: placeRows(tx, at.scene.placeId),
    party: partyOf(tx, at.controller),
    present: presentCast(sceneGraph(tx, at.scene), gm).map(c => ({ key: c.id, name: c.name, ...(c.called ? { called: c.called } : {}) })),
    story: storyOf(at.game),
  };
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

function stepRequest(plan: SayPlan, base: AiRequest & { turn: TurnContext }): DecideRequest | ReplyRequest | SettleRequest {
  if (plan.step === "decide") return { ...base, landed: [] };
  if (plan.step === "reply") return { ...base, decision: needs(plan.decision, "decision"), outcome: needs(plan.outcome, "outcome"), stream: { turn: plan.turn } };
  return { ...base, reply: plan.reply ?? "", lines: plan.lines, settled: plan.settledBefore };
}

/** V0's party: the controller's character, by their sheet. */
function partyOf(tx: TxCtx, controller: PlayerRow): SheetRow[] {
  const sheet = sheetRow(tx, controller.id);
  return [{ name: controller.name, concept: controller.concept, build: sheet.build, skills: JSON.parse(sheet.skills) as Partial<Record<Skill, number>>, status: sheet.statusLine }];
}

/** The story's clock (no flags until the boundary vertical). */
const storyOf = (game: GameRow): Story => ({ time: game.time, day: game.day, flags: {} });

function needs<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the plan has no ${what} for its reply`);
  return value;
}
