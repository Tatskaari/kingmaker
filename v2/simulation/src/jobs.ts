// B's file (queueThink's rows, claimJob, finishJob, failJob, reapJobs, retry): until B writes it, it re-exports package A's stand-ins, which refuse "not_built" (the reaper, which runs every 2 s, has nothing to reap).
export { claimJob, finishJob, failJob, reapJobs } from "./stubs.ts";
