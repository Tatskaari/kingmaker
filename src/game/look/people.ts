import { km } from "./glyphs.ts";
import { seedOf } from "./noise.ts";

/**
 * Named people: a letter and a colour each, the same everywhere (the lane, the Rat, the fight).
 * These match spike/map's CAST table (src/game/map/looks.ts) so the integrator can keep one of the
 * two. Children are lowercase (Cob, Moll), the King is a crown, Sallow is money in a good coat.
 * Anyone else gets their initial and a colour from their id: bright, distinct, never fire-red
 * (red means fire and danger) or water-blue. In the kingmaker glyph set each of the cast is their
 * own sprite instead (`km`, from the Kingmaker Glyphs font); the Crake brothers are one, as the
 * river says they are.
 */

export interface PersonLook { glyph: string; color: string; name?: string; child?: boolean; /** Their Kingmaker Glyphs sprite (a character). */ km?: string }

export const CAST_LOOKS: Record<string, PersonLook> = {
  kell: { name: "Sergeant Kell", glyph: "K", color: "#6d9eeb", km: km("kell") },
  cob: { name: "Cob", glyph: "c", color: "#e8b15a", child: true, km: km("cob") },
  moll: { name: "Moll", glyph: "m", color: "#e07ab0", child: true, km: km("moll") },
  tull: { name: "Corporal Tull", glyph: "T", color: "#6d9eeb", km: km("tull") },
  "nan-quill": { name: "Nan Quill", glyph: "N", color: "#f2d16b", km: km("nan") },
  arlo: { name: "Arlo Quarry", glyph: "A", color: "#9be36b", km: km("arlo") },
  dilly: { name: "Dilly Sparrow", glyph: "D", color: "#c79bf2", km: km("dilly") },
  hobb: { name: "Big Hobb Mallory", glyph: "H", color: "#f08a5d", km: km("hobb") },
  saul: { name: "Saul Tench", glyph: "S", color: "#d9c27e", km: km("saul") },
  duchess: { name: "Duchess", glyph: "d", color: "#c08a5a", km: km("duchess") },
  hep: { name: "Hep Grist", glyph: "G", color: "#f4f1e4", km: km("hep") },
  scrope: { name: "Mister Scrope", glyph: "s", color: "#a9c29a", km: km("scrope") },
  sallow: { name: "Master Sallow", glyph: "$", color: "#c9a3ff", km: km("sallow") },
  crake: { name: "a Crake", glyph: "C", color: "#9a8f80", km: km("crake") },
  king: { name: "King Aldren", glyph: "♔", color: "#ffd75f", km: km("king") },
  holt: { name: "Marshal Holt", glyph: "M", color: "#c8ccd4", km: km("holt") },
  page: { name: "a palace page", glyph: "p", color: "#e6a0ff", child: true, km: km("page") },
  "lantern-boy": { name: "the lantern-boy", glyph: "l", color: "#8fd8c8", child: true, km: km("lantern-boy") },
};

export const PLAYER_LOOK: PersonLook = { glyph: "@", color: "#ffffff" };

/** Hues for people nobody authored: readable on dark ground, clear of fire and water. */
const PEOPLE_HUES = ["#e8c170", "#9be36b", "#c79bf2", "#f0a0c0", "#8fd8c8", "#d9c27e", "#b8d870", "#f0b880", "#a8b8f0", "#e0a0ff", "#c8e0a0", "#f4e0b0"];

const TITLES = /^(sergeant|corporal|captain|master|mister|mistress|missus|mrs|mr|miss|big|little|old|young|lady|lord|sir|dame|king|queen|prince|princess|marshal|father|mother|brother|sister|doctor|dr|goodwife|goodman|granny|uncle|aunt)\s+/i;

/** A named person's look: the cast table, or their initial and a colour of their own. */
export function castLook(id: string, name: string): PersonLook {
  const known = CAST_LOOKS[id] ?? CAST_LOOKS[id.replace(/-\d+$/, "")];
  if (known) return known;
  let bare = name.replace(/\(.*?\)/g, "").replace(/^(the|a|an)\s+/i, "").trim();
  for (let i = 0; i < 3 && TITLES.test(bare); i++) bare = bare.replace(TITLES, "");
  const initial = (bare.match(/[A-Za-z]/)?.[0] ?? "?").toUpperCase();
  return { glyph: initial, color: PEOPLE_HUES[seedOf(id) % PEOPLE_HUES.length]! };
}
