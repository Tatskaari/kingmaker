import { Failure, type Endpoints } from "../context.ts";

/** The GM pipeline's four thinks: not ported yet, so the service runs with KM_AI_GM=canned until they are. */
const notYet = async (): Promise<never> => { throw new Failure(500, "model_failed", "the GM pipeline isn't ported yet: run with KM_AI_GM=canned"); };

export const pipeline: Endpoints = { open: notYet, decide: notYet, reply: notYet, settle: notYet };
