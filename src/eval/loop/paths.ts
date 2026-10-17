import { join } from "node:path";

/** The repo's root (src/eval/loop is three levels down). */
export const ROOT = join(import.meta.dirname, "..", "..", "..");
/** What's checked in: the rubric, the briefs, the personas, the cases, the variants. */
export const LOOP_DIR = join(ROOT, "evals", "loop");
export const CASES_DIR = join(LOOP_DIR, "cases");
export const VARIANTS_DIR = join(LOOP_DIR, "variants");
export const RUBRIC = join(LOOP_DIR, "rubric.md");
/** Where rounds and eval runs go (big, not checked in): KM_LOOP_DIR, or runs/loop. */
export const runsRoot = () => process.env.KM_LOOP_DIR ?? join(ROOT, "runs", "loop");
/** The loop's command as a brief tells an agent to type it (with KM_LOOP_DIR when it's set). */
export const loopCommand = () => `${process.env.KM_LOOP_DIR ? `KM_LOOP_DIR=${process.env.KM_LOOP_DIR} ` : ""}npm run -s loop --`;
