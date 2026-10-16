import { checkLore, draftBackstory, finishBackstory, workIn } from "../../docs/backstory.ts";
import type { Ask } from "../../llm/openrouter.ts";
import type { BackstoriesRequest, BackstoriesResponse, BackstoryOp } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import { Failure, type AiContext, type Handler } from "../context.ts";

/**
 * POST /v1/backstories (v1-design §3.7): the player's backstory at character creation, through the
 * shared v2/ai/docs/backstory.ts, for the world in the campaign's `creation` block. A draft from who
 * they are (draft), their notes worked into a story (work), the lore check (check: what doesn't fit
 * the world, each with a fix), and what it says of them (traits). One model call each, or two when
 * the first answer slips; none with `askOf` null (offline, or the canned GM). Whatever the model
 * does, the answer is the prototype's: why there's no draft, why it wasn't checked, the traits from
 * the player's own words.
 */
export function backstories(askOf: (ctx: AiContext) => Ask | null): Handler<BackstoriesRequest, BackstoriesResponse> {
  return async (req, ctx) => {
    const op = checked(req);
    const ask = askOf(ctx), world = ctx.campaign.creation;

    if (op === "draft") return { asked: await draftBackstory(req.who, { ask, world }), usage: ctx.usage() };
    if (op === "work") return { asked: await workIn(req.text, req.who, { ask }), usage: ctx.usage() };
    if (op === "check") return { checked: await checkLore(req.text, req.who, { ask, world }), usage: ctx.usage() };
    return { backstory: await finishBackstory(req.text, req.who, { ask }), usage: ctx.usage() };
  };
}

/** The request's op, or a 400 for a request the service can't read, or an op that isn't its key's step (the server let only this endpoint's steps through). */
function checked(req: BackstoriesRequest): BackstoryOp {
  const step = keyParts(req.key)?.step;
  const missing = [
    !(typeof req.who?.name === "string" && req.who.name.trim()) && "who.name",
    typeof req.who?.concept !== "string" && "who.concept",
    req.who?.build !== undefined && typeof req.who.build !== "string" && "who.build (a line)",
    typeof req.text !== "string" && "the text (empty for a draft)",
  ].filter(Boolean);
  if (missing.length) throw new Failure(400, "bad_request", `the request is missing ${missing.join(", ")}`);
  if (req.op !== step) throw new Failure(400, "bad_request", `the op is ${JSON.stringify(req.op)}, not the key's step (${step})`);
  return req.op;
}
