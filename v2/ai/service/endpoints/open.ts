import { writePlayerBackstory } from "../../docs/docs.ts";
import { openingDirective } from "../../gm/directives.ts";
import { openSource } from "../../gm/view.ts";
import { gmReply, replyOf } from "../../gm/voice.ts";
import type { OpenRequest, OpenResponse } from "../../../shared/protocol/ai.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Handler } from "../context.ts";
import { disclosed, sceneAndView, withOpened } from "./turn.ts";

/**
 * POST /v1/scenes/open (v0-design §5.3, gm-port §5): the scene's opening. The player's doc is made
 * if it's missing, with their backstory in it when they wrote one at character creation (v1-design
 * §3.7: the GM's notes and its note of what the player knows both read it, so it's written before
 * disclosure), what bears on the scene's start is opened, and the GM opens the scene, its words
 * streamed to the opening's draft. The answer says who's here, the opening, and the notes opened,
 * for the simulation to commit.
 */
export const open: Handler<OpenRequest, OpenResponse> = async (req, ctx) => {
  const { scene, view } = sceneAndView(ctx, req.scene.key, openSource(req));
  writePlayerBackstory(view.id, view.player);

  const opened = await disclosed(scene, view, "", ctx.calls);
  withOpened(view, opened);

  const sink = ctx.stream(req.stream.turn);
  const spoken = await gmReply(scene, view, [openingDirective(scene)], { operation: "gm.opening", calls: ctx.calls, setting: ctx.campaign.title, onText: sink.show });
  const opening = replyOf(spoken);
  await sink.finish(opening.text, opening.markup);

  return { present: presentCast(scene, view).map(c => c.id), entries: [opening], opened, usage: ctx.usage() };
};
