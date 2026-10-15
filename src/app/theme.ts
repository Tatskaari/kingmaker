import { castLook } from "../game/look/people.ts";
import { castOf } from "../game/map/looks.ts";

/** Colours for the app: candlelight on parchment, river at night. */
export const C = {
  bg: "#15131a",
  panel: "#1b1922",
  border: "#4a4458",
  borderHot: "#c9a24a",
  title: "#e8c170",
  text: "#ddd5c4",
  dim: "#8a8273",
  faint: "#5c564d",
  gm: "#e9e2d0",
  player: "#8fc7ff",
  name: "#f0b86e",
  dice: "#ffd166",
  system: "#a89bc4",
  good: "#7bd389",
  danger: "#ff6b6b",
  warn: "#f4a259",
  lead: "#ffd75e",
  leadBg: "#5a4600",
  playerBg: "#2d5b8a",
  ally: "#7bd389",
  enemy: "#ff7b6b",
  neutral: "#c9c2b0",
  highlightBg: "#3b3550",
  /** Something picked with the keys (a spell on the sheet): apart from highlightBg, under the pointer. */
  pickBg: "#5a4600",
  targetBg: "#6b1f1f",
} as const;

/**
 * How the arc's people are known (Kell is K, Hobb is H, the Master is $) and their colours: the
 * map's cast table (src/game/map/looks.ts), so the transcript and the map agree. Anyone else goes
 * by initial, in the default colour.
 */
export const glyphOf = (id: string, name: string): string => castLook(id, name).glyph;

/** A speaker's colour, by cast id ("crake-2" is a Crake), or undefined for nobody in particular. */
export const personColor = (id: string): string | undefined => (id === "player" ? undefined : castOf(id)?.color);
