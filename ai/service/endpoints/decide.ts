import { URGENT } from "../../docs/disclosure.ts";
import type { Decider } from "../../llm/decide.ts";
import { beforeQuestions, decisionState, outOfCharacter, readBefore, talkSettings, withMechanic } from "../../gm/director.ts";
import { exitOf } from "../../gm/directives.ts";
import { aimable, type RulesOptions } from "../../gm/mechanics.ts";
import { turnSource, type TurnView } from "../../gm/view.ts";
import type { OpenedNote } from "../../../shared/gm/state.ts";
import type { DecideRequest, DecideResponse, Decision } from "../../../shared/protocol/ai.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { Handler } from "../context.ts";
import { director, disclosed, sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/decide (v0-design §5.3, gm-port §6, full-gm-design §4.1, world-bridge-design §3.1):
 * what the player's turn is. Disclosure opens what bears on it, beside the director's one decision,
 * which is read for the route the turn takes (its check for the simulation to roll), a cue, a roll
 * wanted that nothing the author wrote settles (considered: the GM rules on it at
 * /v1/turns/consider, and no route is taken), the same push again, earned, daft, out of character, a
 * limit, an answer to an ending on the brink, a plan off the graph (the co-GM reviews it, unless a
 * ruling answers it), a plain route the prep's own answer (byPrep), what the rules resolve (a
 * character with a build: the mechanic, whose details a second small call asks for, which spell at
 * whom, which blow; a route's check the act holds back comes back only when the player is also doing
 * what it's for); and whose memory bears on the moment. On the wind-down turn (an ending reached, the
 * scene closing on this reply) it asks only whether the player is out of character.
 *
 * With `forced` (town-design §3.4: the map's menu's act, played as the scene's first turn), what the
 * rules resolve is chosen already: no mechanic question and no details call, and the act is the
 * decision's mechanic, as the prototype's decideBefore takes it (director.ts:793, :889-901). A talk
 * (town-design §3.6) is decided as scenes/talk.ts's approach has it: no considered rolls and no co-GM,
 * so no roll call, no plan off the graph, and the means only for a route with a social check.
 */
export const decide: Handler<DecideRequest, DecideResponse> = async (req, ctx) => {
  const { scene, view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const line = req.turn.line.text;
  const decider = director(ctx.calls);

  if (view.closing) return { decision: await windingDown(decider, scene, view, line), opened: [], usage: ctx.usage() };

  const disclosing = disclosed(scene, view, line, ctx.calls);
  const rules = rulesOptions(scene, view, line);
  const asked = beforeQuestions(scene, view, view.pendingExit && exitOf(scene, view.pendingExit.exitId), { ...(rules ? { rules } : {}), ...(req.forced ? { forced: req.forced } : {}), ...talkSettings(scene) });
  const answers = await decider.decide(decisionState(scene, view, line), asked.questions, "director.before");
  const read = readBefore(scene, view, answers, asked);
  const decision = rules ? await withMechanic(decider, scene, view, line, read, rules) : read;
  const opened = await disclosing;

  return { decision: { ...decision, ...remembered(scene, opened) }, opened, usage: ctx.usage() };
};

/**
 * What the decider offers the rules' act (engine.ts:559), for a character with a build: their spells,
 * weapons and features from the sheet, and from the world what's near enough to aim at, the people
 * outside the cast, and where they might act from.
 */
function rulesOptions(scene: Scene, view: TurnView, line: string): RulesOptions | undefined {
  if (!view.rules) return undefined;
  return { spells: view.rules.spells ?? [], weapons: view.rules.weapons ?? [], features: view.rules.features ?? [], ...(view.world ? aimable(scene, view, line) : {}) };
}

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
