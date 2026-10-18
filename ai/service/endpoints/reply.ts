import { exitOf } from "../../gm/directives.ts";
import { closingDirective, movedDirective, pressureOffered as stagePressure, saidLast, speak } from "../../gm/two-part.ts";
import { turnSource } from "../../gm/view.ts";
import type { ReplyRequest, ReplyResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";
import { sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/reply (v0-design §5.3, docs/two-part-design.md "A turn, step by step"): the two-part
 * GM's mouthpiece speaks, its narration streamed to the turn's draft as it's written. Its directives
 * are the rules' from before the player acted and the map's act's (the outcome's, as the simulation
 * resolved them), then, when the co-GM moved the scene on after the last reply, that it shows it; on
 * the wind-down, the closing, which may wait once (closes: false), but for a talk's (its goodbye
 * said, which closes it). A talk plays here too (its reply has no dice: two-part.ts TALK_FORMAT). The
 * answer has the narration, the check it called with its five outcomes (the simulation rolls it),
 * whether a closing closed, and the stage whose pressure the per-turn note offered (the simulation
 * marks it offered: once a stage). The old pipeline's reply (its directives rebuilt from the decide
 * commit's decision) went with it (docs/migration-log.md, M2's "The old pipeline's salvage").
 */
export const reply: Handler<ReplyRequest, ReplyResponse> = async (req, ctx) => {
  const { scene, view, byKey } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const closing = req.outcome.windDown ? exitOf(scene, req.outcome.windDown.exit) : undefined;
  // A talk's closing is the goodbye said (town-design §3.6): it never waits.
  const mayHold = !!closing && !view.twoPart.held && !scene.companion;
  const moved = closing ? undefined : movedDirective(scene, view);
  const directives = [...req.outcome.directives, ...(req.outcome.acts ?? []), ...(closing ? [closingDirective(closing, mayHold, saidLast(scene, view))] : moved ? [moved] : [])];
  const offered = closing ? undefined : stagePressure(scene, view);

  const sink = ctx.stream(req.stream.turn);
  const spoke = await speak(scene, view, directives, { operation: closing ? "two-part.closing" : "two-part.reply", calls: ctx.calls, byKey, mayHold, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  await sink.finish(spoke.narration.text, spoke.narration.markup);

  return {
    entries: [spoke.narration], gm: offered ? { offered } : {}, firstTextMs: sink.firstTextMs(),
    ...(spoke.check ? { check: spoke.check } : {}), ...(closing ? { closes: !mayHold || spoke.closes } : {}), usage: ctx.usage(),
  };
};
