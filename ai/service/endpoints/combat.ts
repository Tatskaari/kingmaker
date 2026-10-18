import { combatMove } from "../../gm/combat.ts";
import { turnSource } from "../../gm/view.ts";
import type { CombatRequest, CombatResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";
import { sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/combat (docs/combat-gm.md): the GM's next move in a fight in the conversation, on
 * whoever's turn it is: an action for the simulation to resolve (its narration the attempt), the
 * turn's end or the fight's (each with what came of it), and the narration as the screen has it.
 */
export const combat: Handler<CombatRequest, CombatResponse> = async (req, ctx) => {
  const { scene, view, byKey } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const out = await combatMove(scene, view, req.combat, { calls: ctx.calls, byKey });
  return { move: out.move, entries: out.entries, usage: ctx.usage() };
};
