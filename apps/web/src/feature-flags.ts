/** Opt in to Jev's local action tree and room connection map for evaluation. */
export const ROOM_SCOPED_JEV = false;

export type JevActionContextLevel = 1 | 2 | 3;
/** Action execution only: 1 = scene + objective; 2 adds biography and parked
 * objectives; 3 also adds relationships and character-visible notes. */
export const JEV_ACTION_CONTEXT_LEVEL: JevActionContextLevel = 1;
/** Include completed action IDs in every context tier; disable for ablation evals. */
export const JEV_ACTION_INCLUDE_RECENT_RESULTS = true;
