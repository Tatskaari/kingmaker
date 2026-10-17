import { inventLooks } from "../../look/invent.ts";
import type { Invention, LooksRequest, LooksResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";

/** The most things one look.invent call is asked about (the prototype's flushInventions and inventNow batch by 20). */
const BATCH = 20;

/**
 * POST /v1/looks (v2/docs/town-design.md §3.7): how things the story made look on the map, for the
 * simulation's inventLook job to keep (look_invention, by the name's key) and draw (look rows): one
 * look.invent call a batch of twenty (ai/look/invent.ts, the prototype's src/game/look/invent.ts
 * askLuna), Luna with no reasoning. Never fatal, as the prototype's flush isn't: a key the model left
 * out, or a batch whose call failed, has no look, and the thing is drawn with the look layer's guess.
 * A key asked twice is asked once.
 */
export const looks: Handler<LooksRequest, LooksResponse> = async (req, ctx) => {
  const things = [...new Map(req.things.map(t => [t.key, { key: t.key, name: t.name, ...(t.kind ? { kind: t.kind } : {}) }])).values()];
  const looks: Record<string, Invention> = {};
  for (let i = 0; i < things.length; i += BATCH) {
    const answered = await inventLooks(things.slice(i, i + BATCH), ctx.calls).catch(() => undefined);
    Object.assign(looks, answered?.looks ?? {});
  }
  return { looks, usage: ctx.usage() };
};
