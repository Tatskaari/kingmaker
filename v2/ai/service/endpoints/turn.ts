import { keepOpened, disclose } from "../../docs/disclosure.ts";
import { JEV_MODEL, JevDecider, LUNA_DECISIONS_MODEL } from "../../llm/decide.ts";
import type { CallContext } from "../../llm/openrouter.ts";
import { viewOf, type TurnView, type ViewSource } from "../../gm/view.ts";
import { workingSet } from "../../gm/working-set.ts";
import type { OpenedNote } from "../../../shared/gm/state.ts";
import { effectiveScene } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import { Failure, type AiContext } from "../context.ts";

/**
 * What every think starts from: the scene the request plays, with its words, as play has it (its
 * patches: none in V0, so it's the authored scene with an ending of its own), and the request's view
 * of it, which the GM code reads as the prototype's session.
 */
export function sceneAndView(ctx: AiContext, key: string, source: ViewSource): { scene: Scene; view: TurnView } {
  if (!source.party[0]) throw new Failure(400, "bad_request", "the request's party has no character in it");
  const scene = effectiveScene(ctx.campaign.scene(key), source.gm.patches);
  return { scene, view: viewOf(source, scene) };
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
