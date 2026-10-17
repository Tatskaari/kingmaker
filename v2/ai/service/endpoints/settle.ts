import type { CallContext } from "../../llm/openrouter.ts";
import { afterQuestions, decisionState, readAfter } from "../../gm/director.ts";
import { stageManage } from "../../gm/stage.ts";
import { rememberTold, talkLines, toldIt } from "../../gm/talk.ts";
import { turnSource, type TurnView } from "../../gm/view.ts";
import type { After, SettleRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { CONFIDED } from "../../../shared/scene/talk.ts";
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
 * A talk's (town-design §3.6, talk.ts talkTurn) has no world to keep in step (a talk has none), and
 * its decision reads staged secrets too (`after.guard`: how far the companion has come towards giving
 * up what they keep back); beside it, when the controller has lines suggested (`talk.suggest`), the
 * next lines (talk.suggest), none when the reply closed the talk. Out is out: once the one thing they
 * were keeping back is told (its route taken, now or before, or their guard settled), their guard is
 * settled and their memory of telling it is written, once.
 */
export const settle: Handler<SettleRequest, SettleResponse> = async (req, ctx) => {
  const { scene, view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const line = req.turn.line.text;
  if (scene.companion) return talkSettle(req, ctx, scene, view, line);
  const world = view.world!;
  const keys = keysFor(req.turn.world.place.key, req.turn.scene.key, req.turn.pc);

  const cast = presentCast(scene, view).map(c => ({ id: c.id, name: c.name, look: c.look }));
  const staging = stageManage(world, view.player, line, req.reply, { rules: req.lines, cast, settled: req.settled }, ctx.calls).catch(() => undefined);
  const after = view.ended ? undefined : await afterReply(scene, view, line, req.reply, ctx.calls);
  const staged = await staging;

  return { ops: (staged?.ops ?? []).map(op => opToGame(op, world, keys)), ...(after ? { after } : {}), usage: ctx.usage() };
};

/** A talk's settle: the after-reply decision with staged secrets, and the next lines beside it; once it's told, out is out, and remembered. */
async function talkSettle(req: SettleRequest, ctx: AiContext, scene: Scene, view: TurnView, line: string): Promise<SettleResponse> {
  const talk = req.turn.gm.talk;
  const asking = !view.ended && !!talk && req.talk?.suggest === true;
  const next = asking ? talkLines(view, scene, talk!, ctx.calls).catch(() => undefined) : undefined;
  const after = view.ended ? undefined : await afterReply(scene, view, line, req.reply, ctx.calls, { staging: true });
  const made = await next;
  if (talk?.confide) {
    const out = toldIt(view, talk.with) || after?.outcome?.route === CONFIDED || after?.guard?.[talk.with] === "settled";
    if (out && after && view.guard?.[talk.with]?.stage !== "settled") after.guard = { ...after.guard, [talk.with]: "settled" };
    if (out) rememberTold(view, scene, talk);
  }
  return { ops: [], ...(after ? { after } : {}), talk: { suggestions: made?.lines ?? [] }, usage: ctx.usage() };
}

/** The after-reply decision, an ending held back this turn left out of it (it can't be confirmed by the reply that held it). */
async function afterReply(scene: Scene, view: TurnView, line: string, reply: string, calls: CallContext, options: { staging?: boolean } = {}): Promise<After> {
  const hold = view.pendingExit?.turn === view.turn ? view.pendingExit.exitId : undefined;
  const asked = afterQuestions(scene, view, hold, { ...options, exchange: `${line}\n${reply}` });
  const answers = await director(calls).decide(decisionState(scene, view, line, reply), asked.questions, "director.after");
  return readAfter(scene, answers, asked);
}
