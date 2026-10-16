import type { ReactionsRequest, ReactionsResponse } from "../../../shared/protocol/ai.ts";
import type { AiContext } from "../context.ts";
import { canned } from "./canned.ts";

/**
 * POST /v1/turns/reactions (world-bridge-design §3.1): everyone who saw the player's violence reacts,
 * each by their own lights, before the GM says a word. The witnesses are the cast present and the
 * place's other people who aren't out of it, the hurt first, ten at most (the prototype's
 * witnessesOf); none, and no model call, when nobody saw it. Otherwise one decider call
 * (decideReactions, Luna's decision mode, "director.reactions"), and the GM's direction for what was
 * decided (reactionDirective). The reactions are by the world's local ids. A stub until the AI
 * service's package builds it (ai/gm/mechanics.ts): it answers as the canned GM does, nobody reacting.
 */
export function reactions(req: ReactionsRequest, ctx: AiContext): Promise<ReactionsResponse> {
  return canned.reactions(req, ctx);
}
