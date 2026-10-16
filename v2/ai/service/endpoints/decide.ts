import { URGENT } from "../../docs/disclosure.ts";
import type { Decider } from "../../llm/decide.ts";
import { beforeQuestions, decisionState, outOfCharacter, readBefore } from "../../gm/director.ts";
import { exitOf } from "../../gm/directives.ts";
import { turnSource, type TurnView } from "../../gm/view.ts";
import type { OpenedNote } from "../../../shared/gm/state.ts";
import type { DecideRequest, DecideResponse, Decision } from "../../../shared/protocol/ai.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { Handler } from "../context.ts";
import { director, disclosed, sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/decide (v0-design §5.3, gm-port §6): what the player's turn is. Disclosure opens
 * what bears on it, beside the director's one decision, which is read for the route the turn takes
 * (its check for the simulation to roll), a cue, the same push again, earned, daft, out of
 * character, a limit, an answer to an ending on the brink; and whose memory bears on the moment.
 * On the wind-down turn (an ending reached, the scene closing on this reply) it asks only whether
 * the player is out of character.
 */
export const decide: Handler<DecideRequest, DecideResponse> = async (req, ctx) => {
  const { scene, view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const line = req.turn.line.text;
  const decider = director(ctx.calls);

  if (view.closing) return { decision: await windingDown(decider, scene, view, line), opened: [], usage: ctx.usage() };

  const disclosing = disclosed(scene, view, line, ctx.calls);
  const asked = beforeQuestions(scene, view, view.pendingExit && exitOf(scene, view.pendingExit.exitId));
  const answers = await decider.decide(decisionState(scene, view, line), asked.questions, "director.before");
  const decision = readBefore(scene, view, answers, asked);
  const opened = await disclosing;

  return { decision: { ...decision, ...remembered(scene, opened) }, opened, usage: ctx.usage() };
};

/** The wind-down turn's one question; a failure to ask is taken as in character, and the close goes ahead (engine.ts:489). */
async function windingDown(decider: Decider, scene: Scene, view: TurnView, line: string): Promise<Decision> {
  const asked = await outOfCharacter(decider, scene, view, line).catch(() => undefined);
  return { earned: false, daft: false, outOfCharacter: asked?.ooc === true };
}

/** Notes opened surely enough (p ≥ 0.9) bear on this moment: the reply is told whose memories they are (engine.ts:584-586). */
function remembered(scene: Scene, opened: OpenedNote[]): Pick<Decision, "remembered"> {
  const urgent = opened.filter(n => (n.p ?? 0) >= URGENT);
  if (!urgent.length) return {};
  const owners = [...new Set(urgent.map(n => scene.cast.find(c => `character:${c.id}` === n.scope)?.name).filter((name): name is string => !!name))];
  return { remembered: owners };
}
