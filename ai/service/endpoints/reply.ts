import { ruledLines } from "../../gm/consider.ts";
import { directivesFor, replyOperation } from "../../gm/directives.ts";
import { turnSource, type TurnView } from "../../gm/view.ts";
import { gmReply, replyOf } from "../../gm/voice.ts";
import type { ReplyRequest, ReplyResponse } from "../../../shared/protocol/ai.ts";
import { currentBeat, effectiveScene } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { AiContext, Handler } from "../context.ts";
import { sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/reply (v0-design §5.3, gm-port §8): the GM's reply. Its directives are rebuilt from
 * the decision and what the decide commit did (the prototype's words, in its order), with a
 * considered turn's ruling as the consider commit played it, and the reply is streamed to the turn's
 * draft as it's written, with who says each line. The answer has the reply (who says each line by the
 * game's keys, and the marks the GM made, for its notes), the beat whose pressure this reply was
 * offered, and the sentence it repeated (or null, the last one's warning used up).
 */
export const reply: Handler<ReplyRequest, ReplyResponse> = async (req, ctx) => {
  const { scene, view, byKey } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const directives = [...req.outcome.directives, ...directivesFor(scene, view, req.decision, req.outcome, ruled(ctx, req, view))];
  const offered = req.outcome.windDown ? undefined : pressureOffered(scene, view);

  const sink = ctx.stream(req.stream.turn);
  const spoken = await gmReply(scene, view, directives, { operation: replyOperation(req.decision, req.outcome), calls: ctx.calls, setting: ctx.campaign.title, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  const said = replyOf(spoken, byKey);
  await sink.finish(said.text, said.markup);

  return { entries: [said], gm: { ...(offered ? { offered } : {}), repeated: view.repeated ?? null }, firstTextMs: sink.firstTextMs(), usage: ctx.usage() };
};

/**
 * A ruled turn's lines (gm/consider.ts), told on the scene before the ruling's own close patches, as
 * settleRuling told them before it made them: otherwise a way of trying it shut reads as its id. The
 * reply's prep (gmReply) has the scene as it now is, the ways shut gone, for the GM as for the decider.
 */
function ruled(ctx: AiContext, req: ReplyRequest, view: TurnView): string[] | undefined {
  if (!req.outcome.ruled) return undefined;
  const before = effectiveScene(ctx.campaign.scene(req.turn.scene.key), view.patches.filter(p => !(p.close && p.turn === view.turn)));
  return ruledLines(before, view, req.outcome.ruled);
}

/** The beat whose pressure this reply's note offered (two exchanges in, once a beat): the simulation marks it offered (engine.ts:870). */
function pressureOffered(scene: Scene, view: TurnView): string | undefined {
  const beat = currentBeat(scene, view);
  return beat.pressure && view.turnsInBeat >= 2 && !view.pressureOffered.includes(beat.id) ? beat.id : undefined;
}
