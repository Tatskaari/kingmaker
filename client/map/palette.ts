// Copied from the prototype's src/game/map/palette.ts at 44c6d4a, whole; StoryState from v2/shared/map/types.ts. New (M6): GROUND.sand, the zoo ring's floor (a floor of style sand: the look layer's sand ground already had its cell).
import type { StoryState } from "../../shared/map/types.ts";

/**
 * Colours and textures for the isometric renderer. Ground is painted with a background colour and a
 * sparse texture; built things are solid blocks with a lit top, a lighter west face and a darker
 * south face (the light comes from the north-west, the viewer stands to the south-west).
 */

export interface GroundLook {
  bg: string;
  fg: string;
  /** Texture for a tile's three face cells, picked per cell by a hash; " " leaves the bg showing. */
  face: string;
  /** The diamond's bottom vertex: a lattice dot that makes the grid read. */
  tip: string;
  /** Animated (water): textures cycle with the tick. */
  animate?: boolean;
  /** A second fg for variety (water highlights, grass flowers). */
  fg2?: string;
}

export const GROUND: Record<string, GroundLook> = {
  cobbles: { bg: "#3a383e", fg: "#535058", fg2: "#5f5b64", face: "   ∙  ", tip: "·" },
  floor: { bg: "#3a3631", fg: "#57514a", face: "  · ", tip: "·" },
  flags: { bg: "#3b3a40", fg: "#5a5862", face: " ▫  ", tip: "·" },
  boards: { bg: "#3d2c1d", fg: "#5c4430", fg2: "#4a3624", face: "──═─", tip: "╌" },
  grass: { bg: "#1f2b1a", fg: "#30452a", fg2: "#4a6a32", face: "  '   \"  ", tip: " " },
  dirt: { bg: "#382f25", fg: "#4c4134", face: "   .  ", tip: "·" },
  sand: { bg: "#5a4e34", fg: "#a89468", fg2: "#8a7a54", face: "  · ∙  ", tip: "·" },
  stairs: { bg: "#3c3a3f", fg: "#7a7680", face: "▁▂▃", tip: "▔" },
  water: { bg: "#123352", fg: "#3d7ab0", fg2: "#6aa6d6", face: "~ ≈ ~ ", tip: "~", animate: true },
  "deep-water": { bg: "#0b1f36", fg: "#25537e", fg2: "#3d78ab", face: "≈ ~  ", tip: "~", animate: true },
  bridge: { bg: "#47321f", fg: "#6b4c30", face: "═══", tip: "╪" },
  carpet: { bg: "#4a1f2a", fg: "#6e3341", fg2: "#8a6a2a", face: "░ ░", tip: "·" },
  rubble: { bg: "#2e2a26", fg: "#6a625a", face: "%∴,.", tip: "." },
  scorched: { bg: "#1f1a17", fg: "#4a3a30", fg2: "#6a3a20", face: "∴. ,", tip: "." },
  void: { bg: "", fg: "", face: " ", tip: " " },
};

export interface BlockLook {
  top: string;
  topFg: string;
  /** Roof/cap texture, picked per cell by a hash. */
  topChars: string;
  west: string;
  south: string;
  /** The corner edge between the two faces. */
  edge: string;
  /** Texture on the faces (timber framing, brick courses), on the face colour. */
  faceFg?: string;
  faceChars?: string;
}

export const BLOCKS: Record<string, BlockLook> = {
  // Walls: a light cap. Buildings: a roof, shaded by slope (see the renderer's roof analysis).
  stone: { top: "#86837d", topFg: "#97948d", topChars: " ▫ ", west: "#6f6c68", south: "#55534f", edge: "#45433f", faceFg: "#7d7a75", faceChars: "  ▁ " },
  civic: { top: "#5d6468", topFg: "#687074", topChars: "▚▞", west: "#bdb4a2", south: "#9a9282", edge: "#6e685c", faceFg: "#7e786c", faceChars: "  │ " },
  brick: { top: "#4d525c", topFg: "#585e69", topChars: "▚▞", west: "#8c4a38", south: "#6b3527", edge: "#55291f", faceFg: "#a05a46", faceChars: "▬ ▬" },
  plaster: { top: "#86493a", topFg: "#925444", topChars: "▚▞", west: "#c8b48a", south: "#a8946c", edge: "#5a3a22", faceFg: "#5a3a22", faceChars: "│  " },
  timber: { top: "#4e3e30", topFg: "#5a493a", topChars: "═", west: "#6e5440", south: "#56402f", edge: "#3e2e22", faceFg: "#3e2e22", faceChars: "│ " },
  tar: { top: "#2b2622", topFg: "#3c3530", topChars: "═─", west: "#3a322b", south: "#2a241f", edge: "#1c1815", faceFg: "#4a4038", faceChars: "│ " },
  granary: { top: "#5e4632", topFg: "#69503b", topChars: "▚▞", west: "#9a7a52", south: "#7a5e3c", edge: "#4e3a24", faceFg: "#5e4630", faceChars: "▬  " },
  palace: { top: "#46536a", topFg: "#50607a", topChars: "▚▞", west: "#d8cfbf", south: "#b3aa98", edge: "#8a8270", faceFg: "#c9a94a", faceChars: "  ┼ " },
  // The palace inside: pale stone capped walls, gilt mouldings.
  gilt: { top: "#bdb4a2", topFg: "#c9a94a", topChars: " ─ ", west: "#d8cfbf", south: "#b3aa98", edge: "#8a8270", faceFg: "#c9a94a", faceChars: "  ┼ " },
  bank: { top: "#4a5a34", topFg: "#5c6e40", topChars: "\"',", west: "#6b5a45", south: "#56483a", edge: "#3e342a", faceFg: "#7a6a52", faceChars: "▒ ░ " },
  hedge: { top: "#2f4a24", topFg: "#3f6030", topChars: "♣\"", west: "#2a4220", south: "#22361a", edge: "#1a2a14", faceFg: "#3a5a2a", faceChars: "\"" },
  fence: { top: "#6b5038", topFg: "#7d6046", topChars: "┼─", west: "#5a4230", south: "#4a3626", edge: "#3a2a1e", faceFg: "#7d6046", faceChars: "│" },
  panel: { top: "#5a3a26", topFg: "#6e4a32", topChars: "─", west: "#7a5236", south: "#5e3e28", edge: "#40291a", faceFg: "#c9a94a", faceChars: "  ╷ " },
  hull: { top: "#2a2a2f", topFg: "#56565f", topChars: "═", west: "#222226", south: "#1a1a1d", edge: "#121214", faceFg: "#44444c", faceChars: "─" },
  burnt: { top: "#2a2220", topFg: "#5a2a18", topChars: "%∴ ", west: "#33291f", south: "#271f18", edge: "#1a1410", faceFg: "#7a3a1a", faceChars: "▒ ∴" },
};

export const TREE = { canopy: "#2f5a2a", canopyFg: "#4f8a3a", canopyChars: "♣♠♣", trunk: "#5a4030" };

/** Default block style per structural terrain when a tile doesn't name one. */
export const DEFAULT_STYLE: Record<string, string> = { wall: "stone", window: "stone", door: "stone", fence: "fence" };

/**
 * Daylight by the time of day, Brogue-style: a level and a tint, multiplied into every colour that
 * isn't lit by something nearer. Outdoors, and indoors (a room with its roof lifted: dimmer, lit by
 * its windows, lamps and fires). The town has to stay walkable at night, so its dark is lighter
 * than a scene's top-down stage's.
 */
export const DAYLIGHT: Record<StoryState["time"], { outdoor: { level: number; tint: string }; indoor: { level: number; tint: string } }> = {
  morning: { outdoor: { level: 1, tint: "#fff0d4" }, indoor: { level: 0.62, tint: "#f0dcc0" } },
  afternoon: { outdoor: { level: 1.04, tint: "#ffffff" }, indoor: { level: 0.66, tint: "#f4ece0" } },
  evening: { outdoor: { level: 0.82, tint: "#f0c0b0" }, indoor: { level: 0.5, tint: "#c8a8a0" } },
  night: { outdoor: { level: 0.62, tint: "#7088c8" }, indoor: { level: 0.44, tint: "#7480a8" } },
  "next-morning": { outdoor: { level: 1.02, tint: "#eef4ff" }, indoor: { level: 0.64, tint: "#e8eef8" } },
};

/** Lamplight in windows at night; daylight through them by day. */
export const WINDOW_LIGHT = { night: "#ffc870", day: "#fff4e0" };
export const FIRE = ["#ff4500", "#ff8c00", "#ffd000", "#ff6a00"];

// ---------------------------------------------------------------------------------------------
// Colour arithmetic on "#rrggbb".

export function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgb(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex(a), [br, bg, bb] = hex(b);
  return rgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function scale(c: string, k: number): string {
  const [r, g, b] = hex(c);
  return rgb(r * k, g * k, b * k);
}

/** A stable small hash of integers, for textures that don't crawl as the camera moves. */
export function hash(...ns: number[]): number {
  let h = 2166136261;
  for (const n of ns) { h ^= n & 0xffff; h = Math.imul(h, 16777619); h ^= n >>> 16; h = Math.imul(h, 16777619); }
  return (h ^ (h >>> 13)) >>> 0;
}

export const pick = (chars: string, ...ns: number[]) => { const a = [...chars]; return a[hash(...ns) % a.length]!; };
