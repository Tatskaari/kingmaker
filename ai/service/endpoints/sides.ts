import { pickSides } from "../../gm/sides.ts";
import { turnSource } from "../../gm/view.ts";
import type { SidesRequest, SidesResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";
import { sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/sides (docs/combat-gm.md): a fight has broken out at the end of the turn's reply,
 * and the people it left with no side are the GM's to place before it's set out on the board: with
 * the player, against them, or running from it, and what the table sees as they take their sides.
 */
export const sides: Handler<SidesRequest, SidesResponse> = async (req, ctx) => {
  const { scene, view, byKey } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const out = await pickSides(scene, view, req.sides, { calls: ctx.calls, byKey });
  return { sides: out.sides, entries: out.entries, usage: ctx.usage() };
};
