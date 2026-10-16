import type { Move } from "./move.ts";
import type { RepairPlan } from "./plans.ts";

/**
 * The background co-GM's review of a turn once it's over (full-gm-design §4.2; the prototype's
 * repairJob, jobs.ts:94-105, as a job in the background): queued in the turn's last commit when
 * shouldRepair says so, POST /v1/turns/repair, its answer a co_gm_result row that the next turn's
 * start merges into gm_state. Shaped as V5's notes and suggest are: in the background, never the
 * turn's failure. A stub until the simulation's package builds it: nothing queues it yet.
 */
export const repair: Move<void, RepairPlan> = {
  name: "repair",
  background: true,

  resolve() {
    throw new Error("repair is not built: a turn's last commit will queue it (full-gm-design §4.2)");
  },

  think() {
    throw new Error("repair is not built: its request (POST /v1/turns/repair) is the simulation package's");
  },

  applies: () => true,

  commit() {
    throw new Error("repair is not built: its commit (a co_gm_result row) is the simulation package's");
  },

  giveUp() {
    throw new Error("repair is not built: its give-up is the simulation package's");
  },
};
