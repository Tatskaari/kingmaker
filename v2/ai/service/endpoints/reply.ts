import { directivesFor, replyOperation } from "../../gm/directives.ts";
import { turnSource, type TurnView } from "../../gm/view.ts";
import { gmReply, replyOf } from "../../gm/voice.ts";
import type { ReplyRequest, ReplyResponse } from "../../../shared/protocol/ai.ts";
import { currentBeat } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { Handler } from "../context.ts";
import { sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/reply (v0-design §5.3, gm-port §8): the GM's reply. Its directives are rebuilt from
 * the decision and what the decide commit did (the prototype's words, in its order), and the reply
 * is streamed to the turn's draft as it's written. The answer has the reply, the beat whose pressure
 * this reply was offered, and the sentence it repeated (or null, the last one's warning used up).
 */
export const reply: Handler<ReplyRequest, ReplyResponse> = async (req, ctx) => {
  const { scene, view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const directives = [...req.outcome.directives, ...directivesFor(scene, view, req.decision, req.outcome)];
  const offered = req.outcome.windDown ? undefined : pressureOffered(scene, view);

  const sink = ctx.stream(req.stream.turn);
  const spoken = await gmReply(scene, view, directives, { operation: replyOperation(req.decision, req.outcome), calls: ctx.calls, setting: ctx.campaign.title, onText: sink.show });
  const said = replyOf(spoken);
  await sink.finish(said.text, said.markup);

  return { entries: [said], gm: { ...(offered ? { offered } : {}), repeated: view.repeated ?? null }, firstTextMs: sink.firstTextMs(), usage: ctx.usage() };
};

/** The beat whose pressure this reply's note offered (two exchanges in, once a beat): the simulation marks it offered (engine.ts:870). */
function pressureOffered(scene: Scene, view: TurnView): string | undefined {
  const beat = currentBeat(scene, view);
  return beat.pressure && view.turnsInBeat >= 2 && !view.pressureOffered.includes(beat.id) ? beat.id : undefined;
}
