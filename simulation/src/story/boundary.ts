// The commit is the prototype's chainScene after its calls (src/runtime/engine.ts:1080-1091 at 44c6d4a) and the game's onward (src/game/play.ts:518-527) as rows: the history entry completes the scene's chapter, freshScene and Object.assign are the next scene's gm_state (initialGm and what the boundary handed on), the next scene waits in its place (buildLead) and the story's lead and time move on; a summons (a scene that comes to the player: the King's morning, a guard taking them to the King) opens at once. The calls themselves, bringOver and the docs are the AI service's (POST /v1/scenes/boundary).

import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import { comesToPlayer } from "../../../shared/scene/beats.ts";
import type { BoundaryResponse, Usage } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import type { TxCtx } from "../context.ts";
import { boundaryCall } from "../gm/requests.ts";
import { getGm } from "../gm/rows.ts";
import type { JobOwner, Move } from "../moves/move.ts";
import type { BoundaryPlan } from "../moves/plans.ts";
import { gameRow, playerRow, sceneRow, type GameRow } from "../rows.ts";
import { exitOf, graphOf, sceneDefOf } from "../scenes.ts";
import { openLead } from "../map/lead.ts";
import { buildLead } from "../map/start.ts";
import { refreshActions } from "../rules/session.ts";

/**
 * The boundary after a scene ends (story-design §4.3): queued by closeScene (story/end.ts), never
 * made as a move, its job the game's and the ended scene's, with no turn. Whose it is: the story's,
 * while the scene has ended by the plan's exit and its chapter has no hand-off yet; its progress shows
 * on game.onward (moving, waiting with the lost thread's note, failed with why: carry_on queues it
 * again), and what it cost goes on the chapter. Its commit completes the chapter, leaves the scene the
 * story goes to waiting with what was handed on, and moves the lead and the time of day on; a summons
 * (the King's morning, next-morning) opens at once.
 */
const story: JobOwner<BoundaryPlan> = {
  wanted(tx, plan) {
    const scene = tx.db.scene.id.find(idOf(plan.scene));
    const chapter = tx.db.chapter.sceneId.find(idOf(plan.scene));
    return !!scene && scene.status === "ended" && scene.exitKey === plan.exit && !!chapter && chapter.summary === "";
  },
  /** While it waits to try again, the way on says why ("The GM has lost the thread…"); as the answer comes, it's moving again. */
  waiting(tx, plan, note) {
    onward(tx, plan, note === undefined ? "moving" : "waiting", note);
  },
  charge(tx, plan, usage) {
    const chapter = tx.db.chapter.sceneId.find(idOf(plan.scene));
    if (chapter) tx.db.chapter.sceneId.update({ ...chapter, calls: chapter.calls + usage.calls, costMicros: chapter.costMicros + micros(usage) });
  },
  /** It failed for good: the way on says so, in the player's words, and carry_on tries again. */
  failed(tx, plan, words) {
    onward(tx, plan, "failed", words);
  },
};

export const crossBoundary: Move<void, BoundaryPlan> = {
  name: "crossBoundary",
  owner: story,

  resolve() {
    throw new Error("a boundary is queued by a scene's end, never made as a move");
  },

  think: (tx, plan) => boundaryCall(tx, plan),

  commit(tx, plan, answer) {
    crossed(tx, plan, (answer ?? {}) as Partial<BoundaryResponse>);
    return { done: true };
  },
};

/**
 * The boundary crossed: the chapter completed (the hand-off, the last moments, the facts settled, what
 * moved in the fronts, the scenes skipped); the scene the story goes to (one of the plan's candidates,
 * the first when the answer named none of them) waiting in its place with what was handed on; the
 * lead, its words and the time of day on the game, nothing in flight. A summons opens at once.
 */
function crossed(tx: TxCtx, plan: BoundaryPlan, answer: Partial<BoundaryResponse>): void {
  const scene = sceneRow(tx, idOf(plan.scene));
  const game = gameRow(tx, scene.gameId);
  const gm = getGm(tx, scene.id);
  const chapter = tx.db.chapter.sceneId.find(scene.id);
  if (!chapter) throw new Error(`scene ${scene.id} has no chapter to complete`);

  const next = answer.next && plan.candidates.includes(answer.next.scene) ? answer.next : undefined;
  const key = next?.scene ?? plan.candidates[0]!;
  tx.db.chapter.sceneId.update({
    ...chapter,
    summary: answer.handOff?.trim() || fallbackHandOff(tx, game, scene.sceneKey, plan.exit),
    lastMoments: answer.lastMoments ?? chapter.lastMoments, facts: [...gm.established], fronts: answer.fronts ?? [],
    skipped: (next?.skipped ?? []).map(s => ({ sceneKey: s.sceneId, why: s.why })),
  });

  const nextGraph = graphOf(sceneDefOf(tx, game, key));
  const handed: GmState = {
    ...initialGm(nextGraph),
    adjustments: next?.adjustments ?? [], ...(next?.opening ? { opening: next.opening } : {}), ...(next?.lead ? { lead: next.lead } : {}),
    absent: next?.absent ?? [], patches: next?.patches ?? [], hinted: next?.hinted ?? [], owed: answer.owed ?? [],
  };
  const lead = buildLead(tx, game, key, handed);
  tx.db.game.id.update({ ...gameRow(tx, game.id), leadScene: key, leadText: next?.lead, time: lead.time ?? game.time, onward: undefined, onwardNote: undefined });
  // The clock moved on: the action menu's rests are the new time of day's (town-design §3.3), so the sheet's catalogue is made again.
  if ((lead.time ?? game.time) !== game.time) refreshActions(tx, playerRow(tx, game.hostId));
  const skipped = next?.skipped?.length ? ` (skipped: ${next.skipped.map(s => s.sceneId).join(", ")})` : "";
  const summons = comesToPlayer(nextGraph);
  tx.log(`[story] ${scene.sceneKey} ended by ${plan.exit}: ${key} ${summons ? "summons" : "waits"}${skipped}${handed.absent.length ? `; absent: ${handed.absent.join(", ")}` : ""}`);

  // A scene that comes to the player (a summons: the King's morning, a guard taking them to the King) opens straight away (play.ts:524).
  if (summons) {
    const host = playerRow(tx, game.hostId);
    openLead(tx, { identity: host.identity, id: host.id }, gameRow(tx, game.id));
  }
}

/** The hand-off when the answer has none: the prototype's own fallback (engine.ts:1167). */
function fallbackHandOff(tx: TxCtx, game: GameRow, sceneKey: string, exitId: string): string {
  const graph = graphOf(sceneDefOf(tx, game, sceneKey));
  const exit = exitOf(graph, exitId);
  return `Previous scene, "${graph.title}", ended: ${exit.title} (${graph.id}: ${exit.id}). ${exit.outcome}`;
}

/** The way on, as the game shows it: a boundary moving, waiting to try again (and why), or failed (and why). */
function onward(tx: TxCtx, plan: BoundaryPlan, state: "moving" | "waiting" | "failed", note: string | undefined): void {
  const game = tx.db.game.id.find(idOf(plan.game));
  if (!game || (game.onward === state && game.onwardNote === note)) return;
  tx.db.game.id.update({ ...game, onward: state, onwardNote: note });
  if (state === "failed") tx.log(`[story] game ${game.id}: the boundary after scene ${plan.scene} failed: ${note ?? ""}`);
}

const micros = (usage: Usage) => BigInt(Math.round(usage.costUsd * 1_000_000));
