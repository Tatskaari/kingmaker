// Copied from the prototype's src/app/theme.ts:4-48 at 44c6d4a; colorOf (src/game/look/people.ts:23's PEOPLE_HUES, src/game/look/noise.ts:23-27's seedOf) replaces glyphOf and personColor, which read the map's cast table.
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
  /** A spoken line by someone who isn't in the place (or nobody could tell who): drawn italic, too, being nobody's own colour. */
  speech: "#e6c35c",
} as const;

/** Hues for people nobody gave a look: readable on dark ground, clear of fire and water (the prototype's src/game/look/people.ts). */
const PEOPLE_HUES = ["#e8c170", "#9be36b", "#c79bf2", "#f0a0c0", "#8fd8c8", "#d9c27e", "#b8d870", "#f0b880", "#a8b8f0", "#e0a0ff", "#c8e0a0", "#f4e0b0"];

/** A string's FNV-1a hash (the prototype's src/game/look/noise.ts seedOf). */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Someone's colour when their `look` row hasn't come (or they have none): a hue of their own from
 * their key, the same on every client. Their look's fg wins when there is one.
 */
export const colorOf = (key: string): string => PEOPLE_HUES[seedOf(key) % PEOPLE_HUES.length]!;
