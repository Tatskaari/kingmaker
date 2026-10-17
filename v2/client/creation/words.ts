// Copied from the prototype's src/app/story.ts:15-25 at 44c6d4a: DEFAULT_NAME, DEFAULT_CONCEPT and TIME_WORDS unchanged; LEVEL is now the campaign row's (levelOf), with the prototype's 3 when it doesn't say.
import type { Campaign } from "../module_bindings/types.ts";
import { jsonOf } from "../json.ts";

/**
 * Character creation's own words, and the time of day in the story's: what the create screen
 * fills an empty field with, and what the title and the sheet say of when it is.
 */

/** The level a character is made at when the campaign doesn't say (the prototype's LEVEL). */
export const LEVEL = 3;
export const DEFAULT_NAME = "Wren Ashdown";
export const DEFAULT_CONCEPT = "a quick-witted half-elf ranger with a longbow, a dry sense of humour and a soft spot for underdogs";

export const TIME_WORDS: Record<string, string> = {
  morning: "Morning, on the eve of the Assembly",
  afternoon: "Afternoon, on the eve of the Assembly",
  evening: "Evening, on the eve of the Assembly",
  night: "Night, before the midnight bells",
  "next-morning": "The morning of the Assembly",
};

/** A game's time of day in the story's words: "Morning, on the eve of the Assembly" (a time it has no words for, as it is). */
export const timeWords = (time: string): string => TIME_WORDS[time] ?? `${time.charAt(0).toUpperCase()}${time.slice(1)}`;

/** The level a campaign makes characters at: its campaign.json's `level`, else LEVEL. */
export function levelOf(campaign: Pick<Campaign, "json"> | undefined): number {
  const level = jsonOf<{ level?: unknown }>(campaign?.json)?.level;
  return typeof level === "number" && level > 0 ? level : LEVEL;
}
