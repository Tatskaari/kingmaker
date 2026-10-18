import { mechanicOf, SCENE_ACTS } from "../../gm/director.ts";
import { rulesOptions } from "../../gm/mechanics.ts";
import { turnSource } from "../../gm/view.ts";
import type { ActRequest, ActResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";
import { director, sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/act (world-bridge-design §3.1; the old pipeline's decide, as far as the rules go):
 * what the rules resolve of the player's line in a scene, asked before the reply of a line that might
 * be an act (the simulation's line check: shared/rules/acting.ts mightAct). The mechanic question in a
 * call of its own (`director.rules`: a spell, a blow, a shot or a throw, a class feature, or none of
 * them: SCENE_ACTS), then, for an act, its details in a second (`director.mechanic` or
 * `director.feature`: which spell at whom or at what, which blow at whom with what, where they act
 * from), on what the sheet and the world offer (rulesOptions): mechanicOf, Luna's decision mode. A
 * spell for a character with none needs no second call: whatever they reach for isn't theirs, and the
 * rules say so. No act and no model call for a character the rules haven't made (a sheet with no build).
 */
export const act: Handler<ActRequest, ActResponse> = async (req, ctx) => {
  const { scene, view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const line = req.turn.line.text;
  const rules = rulesOptions(scene, view, line);
  if (!rules) return { usage: ctx.usage() };

  const read = await mechanicOf(director(ctx.calls), scene, view, line, rules, {}, SCENE_ACTS);
  return { ...(read.mechanic ? { mechanic: read.mechanic } : {}), usage: ctx.usage() };
};
