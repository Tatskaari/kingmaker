import type { Ask } from "../../llm/openrouter.ts";
import { pickBuild, threeBuilds } from "../../rules/builds.ts";
import { rulesEngine } from "../../rules/load.ts";
import type { CharactersRequest, CharactersResponse } from "../../../shared/protocol/ai.ts";
import { ownBuild, srdLists, type OwnPicks, type Rules } from "../../../shared/rules/index.ts";
import type { AiContext, Handler } from "../context.ts";
import { charactersAsk } from "../requests.ts";

/**
 * POST /v1/characters (v1-design §3.7): character creation's builds, each made legal by the rules
 * engine, which loads on the first of them. Three to choose from (offer: one model call); the
 * model's one (pick: one call); or the player's own picks (own: no model), refused in the SRD's
 * words when a pick isn't on its lists, with the lists to pick from. A model that fails, or none
 * (`askOf` gives null: offline, or the canned GM), gives the prototype's offline answers: the class
 * defaults, with a note saying why. Only the engine failing is a 500.
 */
export function characters(askOf: (ctx: AiContext) => Ask | null): Handler<CharactersRequest, CharactersResponse> {
  return async (req, ctx) => {
    const ask = charactersAsk(req);
    const rules = await rulesEngine();
    const { name, concept } = req.who;

    if (ask.kind === "three") return { offer: await threeBuilds(rules, name, concept, req.level, { ask: askOf(ctx) }), usage: ctx.usage() };
    if (ask.kind === "one") return { option: await pickBuild(rules, name, concept, req.level, { ask: askOf(ctx) }), usage: ctx.usage() };
    return { ...own(rules, ask.picks, req.level, name), usage: ctx.usage() };
  };
}

/**
 * The player's own picks made legal, and the lists they pick from. Whatever the engine won't make
 * of them is refused in its words (an id not on the SRD's lists says what is), as the prototype's
 * note has it: the same picks would be refused again, so there's nothing to retry.
 */
function own(rules: Rules, picks: OwnPicks, level: number, name: string): Omit<CharactersResponse, "usage"> {
  const lists = srdLists(rules, level);
  try {
    return { option: ownBuild(rules, picks, level, name), lists };
  } catch (error) {
    return { refusal: error instanceof Error ? error.message : String(error), lists };
  }
}
