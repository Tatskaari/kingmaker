import { CAST, castOf } from "../map/looks.ts";
import { seedOf } from "./noise.ts";

/**
 * Named people: a letter and a colour each, the same everywhere (the lane, the Rat, the fight).
 * They come from the map's CAST table (src/game/map/looks.ts), the one table the map and the app
 * draw from too: children are lowercase (Cob, Moll), the King is a crown, Sallow is money in a good
 * coat. Anyone else gets their initial and a colour from their id: bright, distinct, never fire-red
 * (red means fire and danger) or water-blue.
 */

export interface PersonLook { glyph: string; color: string; name?: string }

/** The cast by id, from the map's table (the player is PLAYER_LOOK). */
export const CAST_LOOKS: Record<string, PersonLook> = Object.fromEntries(Object.entries(CAST).filter(([id]) => id !== "player"));

export const PLAYER_LOOK: PersonLook = CAST.player!;

/** Is this id someone in the cast ("crake-2" is: one of the Crakes)? */
export const isCast = (id: string) => id !== "player" && !!castOf(id);

/** Hues for people nobody authored: readable on dark ground, clear of fire and water. */
const PEOPLE_HUES = ["#e8c170", "#9be36b", "#c79bf2", "#f0a0c0", "#8fd8c8", "#d9c27e", "#b8d870", "#f0b880", "#a8b8f0", "#e0a0ff", "#c8e0a0", "#f4e0b0"];

const TITLES = /^(sergeant|corporal|captain|master|mister|mistress|missus|mrs|mr|miss|big|little|old|young|lady|lord|sir|dame|king|queen|prince|princess|marshal|father|mother|brother|sister|doctor|dr|goodwife|goodman|granny|uncle|aunt)\s+/i;

/** A named person's look: the cast table, or their initial and a colour of their own. */
export function castLook(id: string, name: string): PersonLook {
  const known = id === "player" ? undefined : castOf(id);
  if (known) return known;
  let bare = name.replace(/\(.*?\)/g, "").replace(/^(the|a|an)\s+/i, "").trim();
  for (let i = 0; i < 3 && TITLES.test(bare); i++) bare = bare.replace(TITLES, "");
  const initial = (bare.match(/[A-Za-z]/)?.[0] ?? "?").toUpperCase();
  return { glyph: initial, color: PEOPLE_HUES[seedOf(id) % PEOPLE_HUES.length]! };
}
