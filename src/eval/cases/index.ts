import type { EvalCase } from "../types.ts";
import { crossroadsCases } from "./crossroads.ts";
import { entranceCases } from "./entrance.ts";
import { qa1Cases } from "./qa1.ts";
import { openingCases } from "./qa1-openings.ts";

export const CASES: EvalCase[] = [...crossroadsCases, ...entranceCases, ...qa1Cases, ...openingCases];
