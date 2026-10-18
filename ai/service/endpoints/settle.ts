import type { CallContext } from "../../llm/openrouter.ts";
import { afterQuestions, decisionState, readAfter } from "../../gm/director.ts";
import { stageManage } from "../../gm/stage.ts";
import { rememberTold, talkLines, toldIt } from "../../gm/talk.ts";
import { coGm } from "../../gm/two-part.ts";
import { turnSource, type TurnView } from "../../gm/view.ts";
import type { After, CoGmAnswer, SettleRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { TOLD } from "../../../shared/scene/talk.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import { keysFor, opToGame } from "../../../shared/world/rows.ts";
import type { AiContext, Handler } from "../context.ts";
import { director, sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/settle (v0-design §5.3, gm-port §9, world-bridge-design §3.1): after the reply, the
 * world kept in step and the scene read. The stage manager's operations (16 at most, by game key,
 * best effort: none when it fails) for the simulation to apply through its gate, beside the
 * director's after-reply decision: how it's going, an ending, what has landed or been hinted, an
 * outcome route (its check for the simulation to roll), and, when their character is the rules
 * engine's, whether the player has walked out of the place (left) and what the reply left hanging
 * over them (threat: someone's blow, or a danger and its severity, which lands as their next turn
 * starts; threatRead, the question's raw choice). No reading when this reply closed the scene.
 *
 * A talk's (town-design §3.6, talk.ts talkTurn) has no world to keep in step (a talk has none): it's
 * the two-part GM's co-GM's, as a scene's, beside the next lines (talk.suggest, when the controller
 * has lines suggested), and once the one thing they were keeping back is out (the co-GM's move into
 * the talk's discovery, now or before) a line that they told it goes in the GM's notes on them, once.
 */
export const settle: Handler<SettleRequest, SettleResponse> = async (req, ctx) => {
  const { scene, view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const line = req.turn.line.text;
  if (scene.companion) return twoPartTalkSettle(req, ctx, scene, view);
  if (req.twoPart) return twoPartSettle(req, ctx, scene, view, line);
  const world = view.world!;
  const keys = keysFor(req.turn.world.place.key, req.turn.scene.key, req.turn.pc);

  const cast = presentCast(scene, view).map(c => ({ id: c.id, name: c.name, look: c.look }));
  const staging = stageManage(world, view.player, line, req.reply, { rules: req.lines, cast, settled: req.settled }, ctx.calls).catch(() => undefined);
  const after = view.ended ? undefined : await afterReply(scene, view, line, req.reply, ctx.calls);
  const staged = await staging;

  return { ops: (staged?.ops ?? []).map(op => opToGame(op, world, keys)), ...(after ? { after } : {}), usage: ctx.usage() };
};

/**
 * A scene of the story's settle, by the two-part GM (docs/two-part-design.md, step 3): the stage
 * manager and the co-GM side by side. The stage manager's operations, as any scene's (best effort:
 * none when it fails); the co-GM's roles and moves, each move answered at once with beats.ts's
 * takeRoute on a copy of the bookkeeping, told how this turn's check went. A co-GM that fails sets
 * and moves nothing (its error is in the answer). No read after the reply: the co-GM is how the
 * scene moves on.
 */
async function twoPartSettle(req: SettleRequest, ctx: AiContext, scene: Scene, view: TurnView, line: string): Promise<SettleResponse> {
  const world = view.world!;
  const keys = keysFor(req.turn.world.place.key, req.turn.scene.key, req.turn.pc);
  const cast = presentCast(scene, view).map(c => ({ id: c.id, name: c.name, look: c.look }));
  const staging = stageManage(world, view.player, line, req.reply, { rules: req.lines, cast, settled: req.settled }, ctx.calls).catch(() => undefined);
  const coGming = coGm(scene, view, req.turn.gm, req.check, ctx.calls).catch((error: unknown): CoGmAnswer => ({ roles: {}, moves: [], log: [], error: error instanceof Error ? error.message : String(error) }));
  const [staged, co] = await Promise.all([staging, coGming]);
  const { costUsd: _cost, ...answer } = co as CoGmAnswer & { costUsd?: number };
  return { ops: (staged?.ops ?? []).map(op => opToGame(op, world, keys)), coGm: answer, usage: ctx.usage() };
}

/**
 * A talk's settle on the two-part GM: no world, so no stage manager; the co-GM (the companion's role,
 * the confide staged through it; its move into told once it's out, or into goodbye once the player
 * has said goodbye in their own words) beside the next lines; once it's out, now or before, a line
 * in the GM's notes on the companion that they told it, written once.
 */
async function twoPartTalkSettle(req: SettleRequest, ctx: AiContext, scene: Scene, view: TurnView): Promise<SettleResponse> {
  const talk = req.turn.gm.talk;
  const next = talk && req.talk?.suggest === true ? talkLines(view, scene, talk, ctx.calls).catch(() => undefined) : undefined;
  const coGming = coGm(scene, view, req.turn.gm, req.check, ctx.calls).catch((error: unknown): CoGmAnswer => ({ roles: {}, moves: [], log: [], error: error instanceof Error ? error.message : String(error) }));
  const [made, co] = await Promise.all([next, coGming]);
  const { costUsd: _cost, ...answer } = co as CoGmAnswer & { costUsd?: number };
  const intoTold = answer.moves.some(m => scene.routes.find(r => r.id === m.route)?.target === TOLD && m.outcome !== "failure");
  if (talk?.confide && (toldIt(view) || intoTold)) rememberTold(view, scene, talk);
  return { ops: [], coGm: answer, talk: { suggestions: made?.lines ?? [] }, usage: ctx.usage() };
}

/** The after-reply decision, an ending held back this turn left out of it (it can't be confirmed by the reply that held it). */
async function afterReply(scene: Scene, view: TurnView, line: string, reply: string, calls: CallContext): Promise<After> {
  const hold = view.pendingExit?.turn === view.turn ? view.pendingExit.exitId : undefined;
  const asked = afterQuestions(scene, view, hold);
  const answers = await director(calls).decide(decisionState(scene, view, line, reply), asked.questions, "director.after");
  return readAfter(scene, answers, asked);
}
