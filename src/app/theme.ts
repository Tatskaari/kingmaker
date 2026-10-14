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
  targetBg: "#6b1f1f",
} as const;

/** Distinct colours for the people of the story, by cast id (anyone else gets the default). */
export const PEOPLE: Record<string, string> = {
  kell: "#9ad1d4", cob: "#e0b07a", moll: "#e88aa8", tull: "#b0b8c8", hobb: "#d9a066", "nan-quill": "#c6a0e0",
  arlo: "#b7c47a", dilly: "#f2d27a", saul: "#a8b8a0", hep: "#d8c49a", scrope: "#c0c0d8", sallow: "#d8a0ff",
  king: "#ffd75e", holt: "#c8d0e0",
};
