import type { CallContext } from "../../llm/openrouter.ts";
import { strangers } from "../../gm/brief.ts";
import { plainReason, refusalOf, reviewWithin, rulingRoute, verdict } from "../../gm/consider.ts";
import { decisionState, freeformQuestions, readFreeform } from "../../gm/director.ts";
import { turnSource, type TurnView } from "../../gm/view.ts";
import type { ConsiderRequest, ConsiderResponse } from "../../../shared/protocol/ai.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import { CONSIDER_DEADLINE_MS } from "../config.ts";
import type { AiContext, Handler } from "../context.ts";
import { director, sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/consider (full-gm-design §4.1): the GM's ruling on an act the decider flagged,
 * before the reply, as the prototype's playerTurn asks for it (engine.ts:569-575, :656-701). The
 * review (gm/consider.ts) runs with its watchdog at the service's KM_CONSIDER_DEADLINE_MS, told of
 * the ending held for the player's answer and of everyone in the story whose name the player hasn't
 * heard. With a ruling: its verdict, its refusal for a no without dice, and its route, for the
 * simulation to roll from its dice and apply like any route's. Without one (the review failed, or
 * ran past its deadline): when the decider wanted a roll (`read`), the plain check to roll instead,
 * the decider's skill and difficulty (freeformCheck's questions) with its dice line's reason. A 200
 * either way, with why there's no ruling.
 */
export const consider: Handler<ConsiderRequest, ConsiderResponse> = async (req, ctx) => {
  const { scene, view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const line = req.turn.line.text;
  const unheard = strangers([scene, ...storyScenes(ctx)], view, [scene.hook]);

  const reviewed = await reviewWithin(scene, view, line, req.read, {
    ...(req.pending ? { pending: req.pending } : {}), unheard, calls: ctx.calls, deadlineMs: ctx.considerDeadlineMs ?? CONSIDER_DEADLINE_MS,
  });
  if (reviewed.ruling) {
    const v = verdict(scene, reviewed.ruling);
    const refusal = v.kind === "no" ? refusalOf(reviewed.ruling, v) : undefined;
    return { ruling: reviewed.ruling, verdict: v, route: rulingRoute(scene, view, reviewed.ruling, v, refusal), ...(refusal ? { refusal } : {}), ms: reviewed.ms, usage: ctx.usage() };
  }
  const fallback = req.read ? await plainCheck(scene, view, line, unheard, ctx.calls) : undefined;
  return { error: reviewed.error ?? "no ruling", ...(fallback ? { fallback } : {}), ms: reviewed.ms, usage: ctx.usage() };
};

/**
 * The roll a considered turn makes without a ruling (engine.ts:686-699): freeformCheck's skill and
 * difficulty, asked of the director, and the dice line's reason, the plain goal at whoever the turn
 * names. None when the director can't be asked: then nothing is rolled, as in the prototype.
 */
async function plainCheck(scene: Scene, view: TurnView, line: string, unheard: Array<{ name: string; called: string }>, calls: CallContext): Promise<ConsiderResponse["fallback"]> {
  try {
    const decision = await director(calls).decide(decisionState(scene, view, line), freeformQuestions(), "director.freeform");
    const { skill, dc } = readFreeform(decision);
    return { skill, dc, reason: plainReason(scene, view, skill, line, unheard) };
  } catch {
    return undefined;
  }
}

/**
 * The story's scenes, whose people the dice line calls what the player would until their names are
 * heard (the prototype's SCENES: engine.ts:412-415). Read for their names alone: a vocabulary that
 * doesn't read leaves the scene's own people, and the turn goes on.
 */
function storyScenes(ctx: AiContext): Scene[] {
  try {
    return ctx.campaign.story.all();
  } catch {
    return [];
  }
}
