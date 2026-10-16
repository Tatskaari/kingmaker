import { decideReactions, nameIn, reactionDirective, witnessesOf } from "../../gm/mechanics.ts";
import { turnSource } from "../../gm/view.ts";
import type { ReactionsRequest, ReactionsResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";
import { director, sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/reactions (world-bridge-design §3.1): everyone who saw the player's violence reacts,
 * each by their own lights, before the GM says a word (engine.ts:637-651). The witnesses are the cast
 * present and the place's other people who aren't out of it, the hurt first, ten at most
 * (witnessesOf, on the world as the act left it); none, and no model call, when nobody saw it.
 * Otherwise one decider call (decideReactions, Luna's decision mode, "director.reactions": a failure
 * leaves the hurt fighting and everyone else cowering, as the prototype's does), and the GM's
 * direction for what was decided (reactionDirective), by the names the player knows people by. The
 * reactions are by the world's local ids, which the simulation's world has too.
 */
export const reactions: Handler<ReactionsRequest, ReactionsResponse> = async (req, ctx) => {
  const { scene, view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const witnesses = witnessesOf(scene, view, req.act);
  if (!witnesses.length) return { reactions: {}, usage: ctx.usage() };
  const name = (id: string) => nameIn(scene, view, id);
  const decided = await decideReactions(director(ctx.calls), scene, view, req.turn.line.text, req.act, witnesses, name);
  return { reactions: decided.reactions, directive: reactionDirective(decided.reactions, name), usage: ctx.usage() };
};
