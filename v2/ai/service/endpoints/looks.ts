import type { LooksRequest, LooksResponse } from "../../../shared/protocol/ai.ts";
import { noUsage } from "../calls.ts";
import type { Handler } from "../context.ts";

/**
 * POST /v1/looks (v2/docs/town-design.md §3.7): how things the story made look on the map, one
 * look.invent call for a batch (the prototype's src/game/look/invent.ts askLuna). K's stand-in
 * invents none, so each thing keeps the look layer's guess, as now; package A makes it the model's.
 */
export const looks: Handler<LooksRequest, LooksResponse> = async () => ({ looks: {}, usage: noUsage() });
