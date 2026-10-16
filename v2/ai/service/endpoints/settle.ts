import type { CallContext } from "../../llm/openrouter.ts";
import { afterQuestions, decisionState, readAfter } from "../../gm/director.ts";
import { stageManage } from "../../gm/stage.ts";
import { turnSource, type TurnView } from "../../gm/view.ts";
import type { After, SettleRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import { keysFor, opToGame } from "../../../shared/world/rows.ts";
import type { Handler } from "../context.ts";
import { director, sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/settle (v0-design §5.3, gm-port §9): after the reply, the world kept in step and
 * the scene read. The stage manager's operations (16 at most, by game key, best effort: none when it
 * fails) for the simulation to apply through its gate, beside the director's after-reply decision:
 * how it's going, an ending, what has landed or been hinted, an outcome route (its check for the
 * simulation to roll), and whether the player has walked out of the place (left: asked when their
 * character is the rules engine's). No reading when this reply closed the scene.
 */
export const settle: Handler<SettleRequest, SettleResponse> = async (req, ctx) => {
  const { scene, view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const line = req.turn.line.text;
  const world = view.world!;
  const keys = keysFor(req.turn.world.place.key, req.turn.scene.key, req.turn.pc);

  const cast = presentCast(scene, view).map(c => ({ id: c.id, name: c.name, look: c.look }));
  const staging = stageManage(world, view.player, line, req.reply, { rules: req.lines, cast, settled: req.settled }, ctx.calls).catch(() => undefined);
  const after = view.ended ? undefined : await afterReply(scene, view, line, req.reply, ctx.calls);
  const staged = await staging;

  return { ops: (staged?.ops ?? []).map(op => opToGame(op, world, keys)), ...(after ? { after } : {}), usage: ctx.usage() };
};

/** The after-reply decision, an ending held back this turn left out of it (it can't be confirmed by the reply that held it). */
async function afterReply(scene: Scene, view: TurnView, line: string, reply: string, calls: CallContext): Promise<After> {
  const hold = view.pendingExit?.turn === view.turn ? view.pendingExit.exitId : undefined;
  const asked = afterQuestions(scene, view, hold);
  const answers = await director(calls).decide(decisionState(scene, view, line, reply), asked.questions, "director.after");
  return readAfter(scene, answers, asked);
}
