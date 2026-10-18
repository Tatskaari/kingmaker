import { JevDecider, LUNA_DECISIONS_MODEL } from "../../llm/decide.ts";
import type { CallContext } from "../../llm/openrouter.ts";
import type { Story } from "../../gm/story.ts";
import { gameMarkup, keysOf, viewOf, type TurnView, type ViewSource } from "../../gm/view.ts";
import type { Markup } from "../../../shared/markup.ts";
import { effectiveScene } from "../../../shared/scene/graph.ts";
import type { Essential, Scene } from "../../../shared/scene/types.ts";
import type { AiContext } from "../context.ts";

/**
 * What every think starts from: the scene the request plays, with its words, as play has it (its
 * patches: none in V0, so it's the authored scene with an ending of its own), the request's view of
 * it, which the GM code reads as the prototype's session, and the way back from the view's names for
 * people to the game's keys, for the markup an endpoint answers with (who says each line, whom a
 * mark is about). The server has checked the request has what this reads (requests.ts).
 *
 * The story (the campaign's scenes and its vocabulary.json: gm/story.ts) is on the view for the
 * endpoints that read it, the notes and the lines, and for any think once the story has scenes
 * played before this one (story-design §4.4: the GM's note of what the player knows names them by
 * their titles and endings); so a first scene's own thinks never depend on the vocabulary. What the
 * story still owes the player has its essential from the scene it was placed in.
 */
export function sceneAndView(ctx: AiContext, key: string, source: ViewSource, story?: Story): { scene: Scene; view: TurnView; byKey(markup: Markup): Markup } {
  const scene = effectiveScene(ctx.campaign.scene(key), source.gm.patches);
  const told = story ?? (source.told?.history?.length ? ctx.campaign.story : undefined);
  const view = viewOf(source, scene, told, (from, id) => essentialOf(ctx, from, id));
  return { scene, view, byKey: markup => gameMarkup(markup, scene, view.world, keysOf(source)) };
}

/** An essential of a scene of the campaign's (none when it hasn't got the scene). */
function essentialOf(ctx: AiContext, from: string, id: string): Essential | undefined {
  try {
    return ctx.campaign.scene(from).essentials?.find(e => e.id === id);
  } catch {
    return undefined;
  }
}

/** The decider the prototype's v2 approach uses for the director: Luna's decision mode. (Jev, disclosure's, went with disclosure.) */
export const director = (calls: CallContext) => new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions", calls);
