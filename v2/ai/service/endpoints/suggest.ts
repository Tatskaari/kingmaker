import { respond } from "../../llm/openrouter.ts";
import { propose } from "../../gm/suggest.ts";
import { turnSource } from "../../gm/view.ts";
import type { SuggestRequest, SuggestResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";
import { director, sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/suggest (v5-design §3.6): what the player might say or do next, after a reply
 * (gm/suggest.ts). One call for the lines, from what the player knows; then screened by what can be
 * read off their words, judged by the GM's own judge (the director's decider) and mixed. None is the
 * scene's last set again (`offered`, from its rows). A model that fails gives none, as the
 * prototype lands none (suggest.ts:91); a judge that fails leaves them unjudged (:118).
 */
export const suggest: Handler<SuggestRequest, SuggestResponse> = async (req, ctx) => {
  const { view } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  view.suggestions = { scene: view.sceneId, turn: view.turn, lines: req.offered.map(text => ({ text })) };

  const made = await propose(view, { decider: director(ctx.calls), ask: request => respond({ ...request, calls: ctx.calls }) }).catch(() => undefined);

  return { lines: made?.lines ?? [], dropped: made?.dropped ?? [], usage: ctx.usage() };
};
