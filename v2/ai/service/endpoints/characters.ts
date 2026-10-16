import type { Ask } from "../../llm/openrouter.ts";
import { pickBuild, threeBuilds } from "../../rules/builds.ts";
import { rulesEngine } from "../../rules/load.ts";
import type { CharactersRequest, CharactersResponse } from "../../../shared/protocol/ai.ts";
import { keyParts, type CreationStep } from "../../../shared/protocol/keys.ts";
import { ownBuild, srdLists, type OwnPicks, type Rules } from "../../../shared/rules/index.ts";
import { Failure, type AiContext, type Handler } from "../context.ts";

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
    const ask = checked(req);
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

/** Which ask each step's key is for. */
const STEP_ASK: Partial<Record<CreationStep, CharactersRequest["ask"]["kind"]>> = { offer: "three", pick: "one", own: "own" };

/** The request's ask, or a 400 for a request the service can't read, or an ask that isn't its key's step's (the server let only this endpoint's steps through). */
function checked(req: CharactersRequest): CharactersRequest["ask"] {
  const step = keyParts(req.key)?.step as CreationStep;
  const missing = [
    !(typeof req.who?.name === "string" && req.who.name.trim()) && "who.name",
    typeof req.who?.concept !== "string" && "who.concept",
    !(Number.isInteger(req.level) && req.level >= 1 && req.level <= 20) && "a level from 1 to 20",
    req.ask?.kind === "own" && !picksRead(req.ask.picks) && "own's picks { speciesId, classId, subclassId?, backgroundId }",
  ].filter(Boolean);
  if (missing.length) throw new Failure(400, "bad_request", `the request is missing ${missing.join(", ")}`);
  if (STEP_ASK[step] !== req.ask?.kind) throw new Failure(400, "bad_request", `the ask is ${JSON.stringify(req.ask?.kind)}, not the key's step's (${step}: ${STEP_ASK[step]})`);
  return req.ask;
}

const picksRead = (p: OwnPicks | undefined) => !!p && [p.speciesId, p.classId, p.backgroundId].every(id => typeof id === "string") && (p.subclassId === undefined || typeof p.subclassId === "string");
