import { respondJson, type Ask } from "../../llm/openrouter.ts";
import type { AiContext, Endpoints } from "../context.ts";
import { backstories } from "./backstories.ts";
import { boundary } from "./boundary.ts";
import { characters } from "./characters.ts";
import { consider } from "./consider.ts";
import { decide } from "./decide.ts";
import { open } from "./open.ts";
import { notes } from "./notes.ts";
import { reactions } from "./reactions.ts";
import { remember } from "./remember.ts";
import { repair } from "./repair.ts";
import { reply } from "./reply.ts";
import { settle } from "./settle.ts";
import { suggest } from "./suggest.ts";

/**
 * The GM pipeline's thinks (KM_AI_GM=pipeline, the default): the prototype's GM, a step a request
 * (the reactions to the player's violence among them), the notes and the lines beside a turn, the
 * memory reviews and the co-GM after it, the boundary after a scene, and character creation's model
 * calls, each made through the request's own calls (its call log, its costs, its usage).
 */
export const pipeline: Endpoints = {
  open, decide, reactions, consider, reply, settle, notes, suggest, remember, repair, boundary,
  characters: characters(modelAsk), backstories: backstories(modelAsk),
};

/** The model, asked for JSON through this request's calls. */
function modelAsk(ctx: AiContext): Ask {
  return request => respondJson({ ...request, calls: ctx.calls });
}
