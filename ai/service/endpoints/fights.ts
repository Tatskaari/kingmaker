import { boardTurn, narrateTurn } from "../../gm/board.ts";
import { turnSource } from "../../gm/view.ts";
import type { BoardTurnRequest, BoardTurnResponse, NarrateRequest, NarrateResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";
import { sceneAndView } from "./turn.ts";

/**
 * POST /v1/fights/narrate (docs/combat-gm.md): a turn the board played in a scene's fight, told by
 * the GM in the fight's log, in the scene's voice.
 */
export const narrate: Handler<NarrateRequest, NarrateResponse> = async (req, ctx) => {
  const { scene, view, byKey } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const out = await narrateTurn(scene, view, req, { calls: ctx.calls, byKey });
  return { entries: out.entries, usage: ctx.usage() };
};

/**
 * POST /v1/fights/turn (docs/combat-gm.md): the GM's next move on the player's turn in their own
 * words: one of the board's options for the simulation to do, a move toward someone, or the turn's
 * end, each with its narration as the screen has it.
 */
export const fight: Handler<BoardTurnRequest, BoardTurnResponse> = async (req, ctx) => {
  const { scene, view, byKey } = sceneAndView(ctx, req.turn.scene.key, turnSource(req));
  const out = await boardTurn(scene, view, { ...req, line: req.turn.line.text }, { calls: ctx.calls, byKey });
  return { move: out.move, entries: out.entries, usage: ctx.usage() };
};
