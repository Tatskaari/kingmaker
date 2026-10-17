import { chainScene } from "../../gm/boundary.ts";
import { trace, type Owed } from "../../gm/owed.ts";
import { keysOf, turnSource, type TurnView } from "../../gm/view.ts";
import type { OwedRow } from "../../../shared/gm/state.ts";
import type { BoundaryRequest, BoundaryResponse } from "../../../shared/protocol/ai.ts";
import { withImprovisedEnding } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import { fullKey, type Keys } from "../../../shared/world/rows.ts";
import { Failure, type AiContext, type Handler } from "../context.ts";
import { director, sceneAndView } from "./turn.ts";

/**
 * POST /v1/scenes/boundary (story-design §4.4): the boundary after a scene ends, as the prototype's
 * chainScene crosses it (gm/boundary.ts). The ended scene as it was left (its transcript with "Scene
 * ends: …" last, its world after `afterwards`) and the story before it; what's owed, traced in that
 * world; the hand-off, the verdict on the scenes the story could go to and the fronts, at once, each
 * falling back as the prototype's does (a hand-off of the ending alone, the first scene that holds
 * with nothing rewritten, the fronts as they were); the ending's memory for everyone there, the time
 * between in the memories of those it names, and the played scene in the story's index, each written
 * once for the boundary (a rerun after a crash writes none twice); who's absent from the scene
 * chosen (director.presence, asked only of its people the hand-off or the adjustments name); what's
 * owed brought over into it. The answer has the next scene's handed-on state and what's still owed,
 * its things by their entity keys, for the simulation to keep.
 */
export async function boundary(req: BoundaryRequest, ctx: AiContext): Promise<BoundaryResponse> {
  const source = turnSource(req);
  const { view } = sceneAndView(ctx, req.turn.scene.key, source, ctx.campaign.story);
  // The scenes as the prototype's sceneById has them: as authored, with an ending of their own.
  const sceneById = (key: string): Scene => withImprovisedEnding(ctx.campaign.scene(key));
  const scene = sceneById(req.turn.scene.key);
  const exit = scene.exits.find(e => e.id === req.exit);
  if (!exit) throw new Failure(400, "bad_request", `${scene.id} has no exit ${req.exit}`);

  const crossed = await chainScene(scene, view, exit, req.candidates.map(sceneById), { calls: ctx.calls, sceneById, decider: director(ctx.calls) });

  return {
    handOff: crossed.chapter.summary,
    lastMoments: crossed.chapter.lastMoments,
    next: crossed.next,
    owed: owedRows(crossed.owed, view, req.turn.gm.owed ?? [], keysOf(source)),
    fronts: crossed.fronts,
    usage: ctx.usage(),
  };
}

/**
 * What's still owed, as the rows keep it: its things by their entity keys, as the ended scene's world
 * has them where the boundary traced them there (none when the player has them: they carry them on),
 * or as the request had them where it didn't (they're where they were).
 */
function owedRows(owed: Owed[], view: TurnView, before: OwedRow[], keys: Keys): OwedRow[] {
  return owed.map(o => {
    const traced = view.world && o.essential.things?.length ? trace(view.world, o.essential.things) : undefined;
    const was = before.find(r => r.from === o.from && r.id === o.id);
    const things = traced ? (o.things ?? []).map(t => fullKey(t.id, t, keys)) : was?.things ?? [];
    return { from: o.from, id: o.id, hinted: !!o.hinted, things, holders: [...(o.holders ?? [])], ...(o.where !== undefined ? { where: o.where } : {}) };
  });
}
