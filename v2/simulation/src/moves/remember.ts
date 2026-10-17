import type { RememberResponse } from "../../../shared/protocol/ai.ts";
import { rememberCall } from "../gm/requests.ts";
import type { Move } from "./move.ts";
import type { RememberPlan } from "./plans.ts";

/**
 * The memory reviews of a turn once it's over (full-gm-design §4.2; the prototype's rememberJob,
 * jobs.ts:77-91, as a job in the background): queued in the turn's last commit (gm/background.ts
 * afterTurn), POST /v1/turns/remember with the scene as the turn left it. The AI service runs the
 * attention filter and the memories and lore agents it fires, and writes their notes into the
 * game's docs, where the next turns' prompts find them; nothing comes back to the rows but a log
 * line, as the prototype's job left only its files. Shaped as V5's notes and suggest are: in the
 * background, never the turn's failure, nothing on screen; one that can't be had is given up.
 */
export const remember: Move<void, RememberPlan> = {
  name: "remember",
  background: true,

  resolve() {
    throw new Error("a memory review is queued by a turn's last commit, never made as a move");
  },

  think: (tx, plan) => rememberCall(tx, plan),

  /** Always: the docs are the game's, whatever has happened in the scene since. */
  applies: () => true,

  commit(tx, plan, answer) {
    const { flags, reviews } = answer as Partial<RememberResponse>;
    if (!Array.isArray(flags) || !Array.isArray(reviews)) throw new Error("the answer has no flags or reviews");

    const done = reviews.map(r => (r.error ? `${r.kind} failed: ${r.error}` : r.changes.length ? r.changes.join("; ") : `${r.kind}: nothing written`));
    tx.log(`[scene ${plan.scene} turn ${plan.n}] remembered: ${flags.length ? `flags ${flags.join(", ")}` : "nothing flagged"}${done.length ? `; ${done.join("; ")}` : ""}`);
    return { done: true };
  },

  /** The prototype's job wrote nothing when it failed: the turn is remembered by no one. */
  giveUp(tx, plan, why) {
    tx.log(`[scene ${plan.scene} turn ${plan.n}] the memory review gave up: ${why}`);
  },
};
