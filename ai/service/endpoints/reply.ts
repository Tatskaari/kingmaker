import { ruledLines } from "../../gm/consider.ts";
import { directivesFor, exitOf, replyOperation } from "../../gm/directives.ts";
import { closingDirective, movedDirective, pressureOffered as stagePressure, speak } from "../../gm/two-part.ts";
import { turnSource, type TurnView } from "../../gm/view.ts";
import { gmReply, replyOf } from "../../gm/voice.ts";
import type { Decision, ReplyRequest, ReplyResponse } from "../../../shared/protocol/ai.ts";
import { currentBeat, effectiveScene } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import { Failure, type AiContext, type Handler } from "../context.ts";
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
  if (req.twoPart) return twoPartReply(req, ctx);
  const { scene, view, byKey } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const decision = decisionOf(req);
  const directives = [...req.outcome.directives, ...directivesFor(scene, view, decision, req.outcome, ruled(ctx, req, view))];
  const offered = req.outcome.windDown ? undefined : pressureOffered(scene, view);

  const sink = ctx.stream(req.stream.turn);
  const spoken = await gmReply(scene, view, directives, { operation: replyOperation(decision, req.outcome), calls: ctx.calls, setting: ctx.campaign.title, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  const said = replyOf(spoken, byKey);
  await sink.finish(said.text, said.markup);

  return { entries: [said], gm: { ...(offered ? { offered } : {}), repeated: view.repeated ?? null }, firstTextMs: sink.firstTextMs(), usage: ctx.usage() };
};

/** The old pipeline's decision (a talk's): its request has one (requests.ts holds it to that). */
function decisionOf(req: ReplyRequest): Decision {
  if (!req.decision) throw new Failure(400, "bad_request", "the request is missing decision");
  return req.decision;
}

/**
 * A scene of the story's reply, by the two-part GM (docs/two-part-design.md "A turn, step by step"):
 * the mouthpiece speaks, its narration streamed to the turn's draft as it's written. Its directives
 * are the rules' from before the player acted and the map's act's (the outcome's, as the simulation
 * resolved them), then, when the co-GM moved the scene on after the last reply, that it shows it; on
 * the wind-down, the closing, which may wait once (closes: false). The answer has the narration, the
 * check it called with its five outcomes (the simulation rolls it), whether a closing closed, and the
 * stage whose pressure the per-turn note offered (the simulation marks it offered: once a stage).
 */
async function twoPartReply(req: ReplyRequest, ctx: AiContext): Promise<ReplyResponse> {
  const { scene, view, byKey } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const closing = req.outcome.windDown ? exitOf(scene, req.outcome.windDown.exit) : undefined;
  const mayHold = !!closing && !view.twoPart.held;
  const moved = closing ? undefined : movedDirective(scene, view);
  const directives = [...req.outcome.directives, ...(req.outcome.acts ?? []), ...(closing ? [closingDirective(closing, mayHold)] : moved ? [moved] : [])];
  const offered = closing ? undefined : stagePressure(scene, view);

  const sink = ctx.stream(req.stream.turn);
  const spoke = await speak(scene, view, directives, { operation: closing ? "two-part.closing" : "two-part.reply", calls: ctx.calls, byKey, mayHold, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  await sink.finish(spoke.narration.text, spoke.narration.markup);

  return {
    entries: [spoke.narration], gm: { ...(offered ? { offered } : {}), repeated: null }, firstTextMs: sink.firstTextMs(),
    ...(spoke.check ? { check: spoke.check } : {}), ...(closing ? { closes: !mayHold || spoke.closes } : {}), usage: ctx.usage(),
  };
}

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
