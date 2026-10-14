import type { EvalCase } from "../types.ts";
import { crossroadsCases, situationCases } from "./crossroads.ts";
import { entranceCases } from "./entrance.ts";
import { qa1Cases } from "./qa1.ts";
import { openingCases } from "./qa1-openings.ts";
import { garrowsTollCases } from "./garrows-toll.ts";
import { warrenHostageCases } from "./warren-hostage.ts";
import { greenStandoffCases } from "./green-standoff.ts";
import { hangedClerkCases } from "./hanged-clerk.ts";
import { repairCases } from "./repair.ts";

export const CASES: EvalCase[] = [
  ...crossroadsCases, ...situationCases, ...entranceCases, ...qa1Cases, ...openingCases,
  ...garrowsTollCases, ...warrenHostageCases, ...greenStandoffCases, ...hangedClerkCases,
  ...repairCases,
];
