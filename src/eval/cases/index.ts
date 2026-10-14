import type { EvalCase } from "../types.ts";
import { crossroadsCases } from "./crossroads.ts";
import { entranceCases } from "./entrance.ts";

export const CASES: EvalCase[] = [...crossroadsCases, ...entranceCases];
