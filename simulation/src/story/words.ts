// The stand-in's words are copied from the prototype's src/game/fight-standin.ts at 44c6d4a (its act's line and its result's summary); FIGHT_NOT_PLAYED is the story unit's (story-design §1.2, step 7).

/**
 * The fight's stand-in (story-design §4.3): until fights land (V12), a fight resolves in one action
 * as won, and says what it is. Its words, as the prototype's stand-in has them.
 */

/** What the stand-in's one action says (fight-standin.ts's act). */
export const STANDIN_LINE = "Steel, dust and lantern light: after a short, ugly fight the Crakes are down and Sallow drops his sword-cane and asks, very politely, to surrender.";

/** How the fight went, as its result says it (fight-standin.ts's result: the aftermath is told from it). */
export const FIGHT_SUMMARY = "After a short, ugly fight the Crakes went down and Sallow surrendered, very politely.";

/** The notebook's line that the fight wasn't played: the requests' chapters leave it out (it's no line of the story's). */
export const FIGHT_NOT_PLAYED = "The fight wasn't played: it's told as won.";
