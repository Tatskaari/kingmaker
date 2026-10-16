import type { Move } from "./move.ts";
import type { RememberPlan } from "./plans.ts";

/**
 * The memory reviews of a turn once it's over (full-gm-design §4.2; the prototype's rememberJob,
 * jobs.ts:77-91, as a job in the background): queued in the turn's last commit, POST
 * /v1/turns/remember, and nothing committed but a log line, since the AI service writes the notes
 * into the game's docs. Shaped as V5's notes and suggest are: in the background, never the turn's
 * failure. A stub until the simulation's package builds it: nothing queues it yet.
 */
export const remember: Move<void, RememberPlan> = {
  name: "remember",
  background: true,

  resolve() {
    throw new Error("remember is not built: a turn's last commit will queue it (full-gm-design §4.2)");
  },

  think() {
    throw new Error("remember is not built: its request (POST /v1/turns/remember) is the simulation package's");
  },

  applies: () => true,

  commit() {
    throw new Error("remember is not built: its commit is the simulation package's");
  },

  giveUp() {
    throw new Error("remember is not built: its give-up is the simulation package's");
  },
};
