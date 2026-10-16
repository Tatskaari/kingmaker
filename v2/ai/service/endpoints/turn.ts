import { keepOpened, disclose } from "../../docs/disclosure.ts";
import { JEV_MODEL, JevDecider, LUNA_DECISIONS_MODEL } from "../../llm/decide.ts";
import type { CallContext } from "../../llm/openrouter.ts";
import { gameMarkup, keysOf, viewOf, type TurnView, type ViewSource } from "../../gm/view.ts";
import { workingSet } from "../../gm/working-set.ts";
import type { OpenedNote } from "../../../shared/gm/state.ts";
import type { Markup } from "../../../shared/markup.ts";
import { effectiveScene } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { AiContext } from "../context.ts";

/**
 * What every think starts from: the scene the request plays, with its words, as play has it (its
 * patches: none in V0, so it's the authored scene with an ending of its own), the request's view of
 * it, which the GM code reads as the prototype's session, and the way back from the view's names for
 * people to the game's keys, for the markup an endpoint answers with (who says each line, whom a
 * mark is about). The server has checked the request has what this reads (requests.ts).
 */
export function sceneAndView(ctx: AiContext, key: string, source: ViewSource): { scene: Scene; view: TurnView; byKey(markup: Markup): Markup } {
  const scene = effectiveScene(ctx.campaign.scene(key), source.gm.patches);
  const view = viewOf(source, scene, ctx.campaign.story);
  return { scene, view, byKey: markup => gameMarkup(markup, scene, view.world, keysOf(source)) };
}

/** The deciders the prototype's v2 approach uses: Luna's decision mode for the director, and Jev for disclosure (the docs service's own). */
export const director = (calls: CallContext) => new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions", calls);
const discloser = (calls: CallContext) => new JevDecider(JEV_MODEL, "jev", calls);

/** Disclosure, best effort as the prototype's is: the notes that bear on the moment, opened for each person here and the GM (none when it fails). */
export async function disclosed(scene: Scene, view: TurnView, line: string, calls: CallContext): Promise<OpenedNote[]> {
  try {
    return (await disclose(workingSet(scene, view), line, discloser(calls))).opened;
  } catch {
    return [];
  }
}

/** The view with these notes open too, as the simulation will keep them (the newest 24). */
export function withOpened(view: TurnView, notes: OpenedNote[]): void {
  view.memory = keepOpened(view.memory, notes);
}
