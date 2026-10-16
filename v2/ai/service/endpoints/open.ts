import { writePlayerBackstory } from "../../docs/docs.ts";
import { resumeAfterFight } from "../../gm/aftermath.ts";
import { openingDirective } from "../../gm/directives.ts";
import { keysOf, openSource, type TurnView } from "../../gm/view.ts";
import { gmReply, replyOf } from "../../gm/voice.ts";
import type { Markup } from "../../../shared/markup.ts";
import type { OpenRequest, OpenResponse } from "../../../shared/protocol/ai.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import { opToGame } from "../../../shared/world/rows.ts";
import type { AiContext, Handler } from "../context.ts";
import { disclosed, sceneAndView, withOpened } from "./turn.ts";

/**
 * POST /v1/scenes/open (v0-design §5.3, gm-port §5): the scene's opening. The player's doc is made
 * if it's missing, with their backstory in it when they wrote one at character creation (v1-design
 * §3.7: the GM's notes and its note of what the player knows both read it, so it's written before
 * disclosure), what bears on the scene's start is opened, and the GM opens the scene, its words
 * streamed to the opening's draft with who says each line. The answer says who's here, the opening
 * (who says each line by the game's keys, and the marks the GM made, for its notes) and the notes
 * opened, for the simulation to commit. After a boundary the opening picks up from how the last
 * scene ended, as the boundary rewrote it (the opening directive's second branch: story-design §4.4).
 *
 * With `aftermath`, the scene picks up after a fight instead (the prototype's resumeAfterFight): the
 * GM narrates the aftermath (`gm.aftermath`), streamed as an opening is, and the stage manager's
 * operations for what it narrated come back with it (`ops`, by the game's keys), for the simulation
 * to apply through its gate. No disclosure: the prototype's resumeAfterFight opens none.
 */
export const open: Handler<OpenRequest, OpenResponse> = async (req, ctx) => {
  const { scene, view, byKey } = sceneAndView(ctx, req.scene.key, openSource(req));
  if (req.aftermath) return aftermath(req, req.aftermath.summary, ctx, scene, view, byKey);
  writePlayerBackstory(view.id, view.player);

  const opened = await disclosed(scene, view, "", ctx.calls);
  withOpened(view, opened);

  const sink = ctx.stream(req.stream.turn);
  const spoken = await gmReply(scene, view, [openingDirective(scene, view)], { operation: "gm.opening", calls: ctx.calls, setting: ctx.campaign.title, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  const opening = replyOf(spoken, byKey);
  await sink.finish(opening.text, opening.markup);

  return { present: presentCast(scene, view).map(c => c.id), entries: [opening], opened, usage: ctx.usage() };
};

/** The scene after a fight: the aftermath streamed to its turn's draft, and what the stage manager made of it. */
async function aftermath(req: OpenRequest, summary: string, ctx: AiContext, scene: Scene, view: TurnView, byKey: (markup: Markup) => Markup): Promise<OpenResponse> {
  const sink = ctx.stream(req.stream.turn);
  const { spoken, staging } = await resumeAfterFight(scene, view, summary, { operation: "gm.aftermath", calls: ctx.calls, setting: ctx.campaign.title, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  const said = replyOf(spoken, byKey);
  await sink.finish(said.text, said.markup);
  const ops = await staging;

  return { present: presentCast(scene, view).map(c => c.id), entries: [said], opened: [], ops: ops.map(op => opToGame(op, view.world!, keysOf(openSource(req)))), usage: ctx.usage() };
}
