// Copied from the prototype's src/app/story.ts:19-42 at 44c6d4a (TIME_WORDS, ARROW, leadWay), whole; the map's direction and steps from v2/shared/map/tiles.ts. (timeOf, :27-29, is left: the game's time of day is a row.)
import { direction, steps } from "../../shared/map/tiles.ts";
import type { StoryState, Tile2 } from "../../shared/map/types.ts";

export const TIME_WORDS: Record<StoryState["time"], string> = {
  morning: "Morning, on the eve of the Assembly",
  afternoon: "Afternoon, on the eve of the Assembly",
  evening: "Evening, on the eve of the Assembly",
  night: "Night, before the midnight bells",
  "next-morning": "The morning of the Assembly",
};

/** Which way, on screen, a compass direction on the map points (north is up-left). */
export const ARROW: Record<string, string> = { north: "↖", "north-east": "↑", east: "↗", "south-east": "→", south: "↘", "south-west": "↓", west: "↙", "north-west": "←", here: "•" };

/**
 * The way to the lead from where the player stands, as the map says it (the game core's lead target:
 * src/game/town.ts leadTarget): "the Drowned Rat ↓ 24 paces", or "Up the river stairs, then on to the
 * Heron ← 3 paces". The map's sidebar shows it, and Kell reads it out between scenes, so the two
 * can't disagree.
 */
export function leadWay(from: Tile2, lead: { at: Tile2; label: string; via?: string | undefined }): string {
  return `${lead.via ? `${lead.via}, then on to ` : ""}${lead.label} ${ARROW[direction(from, lead.at)] ?? ""} ${steps(from, lead.at)} pace${steps(from, lead.at) === 1 ? "" : "s"}`.replace(/ {2,}/g, " ");
}
