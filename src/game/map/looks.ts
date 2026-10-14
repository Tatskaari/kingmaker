import type { Entity } from "../../world/scene-world.ts";
import { km } from "../look/glyphs.ts";
import type { MapActor } from "../types.ts";

/**
 * How people and things look on the map. People are coloured letters (the cast of the Caerwyn arc
 * by id), things are glyphs picked from what they are. Scene-world entities and story presence both
 * come through here, so Kell is the same blue K in the lane, in the Rat and in the fight.
 *
 * CAST is the one cast table: the look layer (src/game/look/people.ts) and the app (src/app/theme.ts)
 * take their letters and colours from it.
 */

export interface Look { glyph: string; color: string; name?: string; /** Their sprite in the kingmaker glyph set (Kingmaker Glyphs: KM_GLYPHS=kingmaker). */ km?: string }

/** The cast of the arc. Ids match the scenes' cast cards. */
export const CAST: Record<string, Look & { name: string }> = {
  kell: { name: "Sergeant Kell", glyph: "K", color: "#6d9eeb", km: km("kell") },
  cob: { name: "Cob", glyph: "c", color: "#e8b15a", km: km("cob") },
  moll: { name: "Moll", glyph: "m", color: "#e07ab0", km: km("moll") },
  tull: { name: "Corporal Tull", glyph: "T", color: "#6d9eeb", km: km("tull") },
  "nan-quill": { name: "Nan Quill", glyph: "N", color: "#f2d16b", km: km("nan") },
  arlo: { name: "Arlo Quarry", glyph: "A", color: "#9be36b", km: km("arlo") },
  dilly: { name: "Dilly Sparrow", glyph: "D", color: "#c79bf2", km: km("dilly") },
  hobb: { name: "Big Hobb Mallory", glyph: "H", color: "#f08a5d", km: km("hobb") },
  saul: { name: "Saul Tench", glyph: "S", color: "#d9c27e", km: km("saul") },
  duchess: { name: "Duchess", glyph: "d", color: "#c08a5a", km: km("duchess") },
  hep: { name: "Hep Grist", glyph: "G", color: "#f4f1e4", km: km("hep") },
  scrope: { name: "Mister Scrope", glyph: "s", color: "#a9c29a", km: km("scrope") },
  // Sallow is money in a good coat (and lavender water).
  sallow: { name: "Master Sallow", glyph: "$", color: "#c9a3ff", km: km("sallow") },
  crake: { name: "a Crake", glyph: "C", color: "#9a8f80", km: km("crake") },
  king: { name: "King Aldren", glyph: "♔", color: "#ffd75f", km: km("king") },
  holt: { name: "Marshal Holt", glyph: "M", color: "#c8ccd4", km: km("holt") },
  page: { name: "a palace page", glyph: "p", color: "#e6a0ff", km: km("page") },
  // Sallow's yawning lantern-boy (by name alone he'd be drawn as his lantern).
  "lantern-boy": { name: "the lantern-boy", glyph: "l", color: "#8fd8c8", km: km("lantern-boy") },
  player: { name: "you", glyph: "@", color: "#ffffff" },
};

/** Someone in the cast by id; a numbered one ("crake-2") is one of a kind ("crake"). */
export const castOf = (id: string): (Look & { name: string }) | undefined => CAST[id] ?? CAST[id.replace(/-\d+$/, "")];

export const PLAYER_COLOR = "#ffffff";
export const TOWNSFOLK_COLOR = "#b8ad9c";

/** Things by name, most specific first: what a scene world's things look like on the map. */
const THINGS: Array<[RegExp, Look]> = [
  [/spectacles/, { glyph: "∞", color: "#c8d8e8" }],
  [/satchel|bag\b|purse/, { glyph: "▫", color: "#a8784a" }],
  [/body|corpse/, { glyph: "¥", color: "#b8b0a0" }],
  [/rope|noose|cord/, { glyph: "│", color: "#c8a878" }],
  [/lantern|lamp|candle/, { glyph: "¤", color: "#ffd27f" }],
  [/hoist|beam|pulley|crane/, { glyph: "╤", color: "#8a6a48" }],
  [/water butt|butt\b|barrel|keg|cask/, { glyph: "Ö", color: "#9a7046" }],
  [/fire\b|hearth|brazier/, { glyph: "Ψ", color: "#ff8c00" }],
  [/sacks?\b|sacking|grain stack|stacks/, { glyph: "■", color: "#cdb27a" }],
  [/chute/, { glyph: "╲", color: "#8a6a48" }],
  [/book|ledger|roll\b|page|letter|paper/, { glyph: "▤", color: "#d8cfa8" }],
  [/sign|board|notice/, { glyph: "▤", color: "#c8a060" }],
  [/card/, { glyph: "♠", color: "#f0f0f0" }],
  [/jar|bottle|gin|measure/, { glyph: "ô", color: "#9fd0c0" }],
  [/pots?\b|kettle|stew/, { glyph: "Ü", color: "#8a8a8a" }],
  [/cudgel|club|manners|stick|cane/, { glyph: "/", color: "#8a5a30" }],
  [/chair|throne|stool/, { glyph: "h", color: "#a0703a" }],
  [/bench/, { glyph: "═", color: "#8a6038" }],
  [/table|desk|counter|bar\b/, { glyph: "π", color: "#a0703a" }],
  [/wardrobe|cupboard|shelf|chest/, { glyph: "▥", color: "#7a5030" }],
  [/mirror|window/, { glyph: "▯", color: "#c8e0f0" }],
  [/tea|tray|cup/, { glyph: "ū", color: "#f0e0c0" }],
  [/traps?\b|oars?\b|nets?\b/, { glyph: "§", color: "#8a7a5a" }],
  [/nest|bedding|straw/, { glyph: "≈", color: "#c8b080" }],
  [/hatch|grille|trapdoor/, { glyph: "▦", color: "#7a6040" }],
  [/door|gate|wicket/, { glyph: "+", color: "#a0703a" }],
  [/box|crate/, { glyph: "▣", color: "#a07a4a" }],
  [/coin|crown|penn|token|ring/, { glyph: "¢", color: "#ffd75f" }],
  [/boots?\b/, { glyph: "b", color: "#5a4a3a" }],
  [/stones?\b|cobble/, { glyph: "•", color: "#9a9a9a" }],
  [/tree|elm|oak/, { glyph: "♣", color: "#4f8a3a" }],
  [/dog|hound|mastiff/, { glyph: "d", color: "#c08a5a" }],
  [/barge|boat|skiff/, { glyph: "▬", color: "#6b4c30" }],
  [/sentry box|box\b/, { glyph: "▣", color: "#6b5a45" }],
];

/** Things that hang or sit high up: drawn raised by this many rows, and never in the way. */
const RAISED: Array<[RegExp, number]> = [[/hoist|beam|pulley/, 4], [/traps|oars|nets|bunting|lantern hung/, 3]];

export function lookForName(name: string, kind: MapActor["kind"]): Look {
  const n = name.toLowerCase();
  for (const [re, look] of THINGS) if (re.test(n)) return look;
  if (kind === "person") return { glyph: "p", color: TOWNSFOLK_COLOR };
  if (kind === "creature") return { glyph: "r", color: "#a08060" };
  if (kind === "item") return { glyph: "•", color: "#c8c0a8" };
  return { glyph: "□", color: "#a08a6a" };
}

/** How high a thing is drawn above its tile (0 = on the ground). */
export function raiseFor(name: string, states: string[] = []): number {
  if (states.includes("hanging")) return 2;
  if (states.includes("overhead")) return 3;
  const n = name.toLowerCase();
  for (const [re, rows] of RAISED) if (re.test(n)) return rows;
  return 0;
}

/** A scene-world entity's look: the cast by id, then the thing by name and material. */
export function lookForEntity(e: Entity): Look {
  if (e.player) return { glyph: "@", color: PLAYER_COLOR };
  const cast = CAST[e.cast ?? e.id];
  if (cast) return cast;
  const kind: MapActor["kind"] = e.kind === "person" ? "person" : e.kind === "creature" ? "creature" : e.kind === "item" ? "item" : "object";
  const look = lookForName(e.name, kind);
  // A body is a body whatever it's called.
  if (e.tags.includes("body")) return { glyph: "¥", color: "#b8b0a0" };
  return look;
}

/** Crowds ("the regulars", "the gang") are drawn as a few people round the spot. */
export const isCrowd = (e: Entity) => (e.kind === "person" || e.kind === "creature") && !e.cast && !e.player && /^(the )?(regulars|gang|crowd|porters|bargees|townsfolk|delegations?|valets)\b|\b(gang|crowd|regulars)$/i.test(e.name);
