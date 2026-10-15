import type { SessionState } from "../../runtime/session.ts";
import type { Dressing } from "../look/stage.ts";
import type { EffectKind } from "../look/effects.ts";
import type { CompiledPlace } from "../map/generate/index.ts";
import type { MapSpec } from "../map/tiles.ts";
import type { ExploreState } from "../map/explore.ts";
import type { GameState } from "../play.ts";
import type { Tile2 } from "../types.ts";
import type { Entity, Point, Rect, SceneWorld, WorldOp, WorldSpec } from "../../world/scene-world.ts";

/**
 * The zoo's model (README.md): wings, each a map with a world live on it; exhibits, each a sign and
 * the triggers that set it off; and what a trigger did, for the map to say and the view to play.
 */

/** A place for an effect: feet in the wing's world, or someone or something in it by id. */
export type Anchor = Point | { id: string };

/**
 * An effect to play once that the world's changes don't make by themselves (the director makes the
 * rest from what changed): a goose's alarm, a ball thrown at a coconut, the colour chart's bolts.
 */
export type Cue =
  | { kind: "effect"; effect: EffectKind; at?: Anchor; from?: Anchor; to?: Anchor; radius?: number; color?: string; glyph?: string; amount?: number; delay?: number }
  | { kind: "float"; at: Anchor; text: string; damage?: string; style?: "damage" | "heal" | "info"; color?: string; delay?: number }
  | { kind: "bark"; id: string; text: string; delay?: number }
  | { kind: "alert"; id: string; delay?: number }
  /** A GM reply with quotes in it, for the director to put the short lines over their speakers (barksFrom). */
  | { kind: "narration"; text: string; called?: Record<string, string> }
  /** Someone's own line (a voiced character's, as the actors approach has them): over their head (barkLine). */
  | { kind: "line"; id: string; text: string };

/** What a trigger did. */
export interface Outcome {
  /** What the player is told (the map's "What happens"). */
  text: string;
  /** The rules' lines, dice and news: the view floats their numbers and plays their spells, as a scene's are. */
  lines?: string[];
  cues?: Cue[];
  /** A scene to open (the theatre's, a rehearsal). */
  open?: string;
  /** An arena whose fight starts (the arena's rings). */
  fight?: string;
  /** Something for the screen to show beyond the map (the app's): The End, as the story ends; the window onto the story's first morning. */
  show?: Show["kind"];
}

/** Something the last thing done asks the screen to show once (a sign's card, The End, the window), numbered like the news. */
export interface Show { seq: number; kind: "sign" | "end" | "window"; id?: string }

/** What a trigger is given: the game, the wing it's in and its world, and a few hands for the work. */
export interface Ctx {
  game: GameState;
  session: SessionState;
  ex: ExploreState;
  zoo: ZooState;
  wing: Wing;
  /** The wing's world: the session's world while the trigger runs, with the player in it where they stand on the map. */
  world: SceneWorld;
  /** The wing's story time, in turns. */
  turn: number;
  /** World operations, as the stage manager writes them: what changed, and what couldn't be done (as "(not done) ..."). */
  ops(ops: Array<Partial<WorldOp> & { op: WorldOp["op"] }>): string[];
  /** A turn of story time in the wing: what's burning burns and spreads, puddles dry, smoke drifts off. */
  tick(): string[];
  /** Where someone or something is in the wing's world (feet). */
  at(id: string): Point;
  /** An entity of the wing's world (it throws if it isn't there: an exhibit's own things always are). */
  thing(id: string): Entity;
}

export interface Trigger {
  /** Unique across the zoo: the action that sets it off is use_<id>. */
  id: string;
  /** What it does, as the menu says it: "Cast Fireball at the scarecrow". */
  label: string;
  /** Where it's offered: a tile (the lever's), or something in the wing's world by id (wherever it is now). You stand beside it. */
  at: Tile2 | string;
  /** Walking onto it sets it off (a plate), as well as asking. */
  step?: boolean;
  /** You stand on it to set it off (a chalk circle to cast from), rather than beside it. */
  stand?: boolean;
  /** What stands on its tile, when the tile is its own (a lever, a bell, a plate); a thing in the world needs none. */
  station?: { name: string; glyph: string; color?: string };
  /** Is it on offer now? (The wardrobe doesn't offer the robes you're wearing.) */
  when?: (z: Ctx) => boolean;
  run(z: Ctx): Outcome | Promise<Outcome>;
  /**
   * What the view should play when it's set off, whatever the dice say (the tour checks): effect
   * kinds ("fireball", "bolt", "poof"...), "float:damage", "float:heal", "float:unharmed", "bark",
   * "alert", or "moves" (someone walks or something slides); "fight" (a fight starts, and is
   * fought to its end), "scene" (a scene opens, and is played to an ending).
   */
  expect?: string[];
  /** For the tour: how to play the scene or the fight it opens. */
  plan?: Plan;
}

/** How the tour plays a scene or a fight (offline it takes the ending at once; --live says the lines to the GM first). */
export interface Plan {
  /** Lines to say in the scene, with the GM (--live). */
  say?: string[];
  /** The ending to take, if the scene hasn't ended by itself. */
  exit?: string;
  /** After a fight from the scene's ending: the ending to take once its aftermath is under way. */
  after?: string;
  /** In a fight: the first actions to take (then the dice decide the rest). */
  fight?: string[];
}

export interface Exhibit {
  /** "fireball". */
  id: string;
  title: string;
  /** The inventory's features it shows (src/game/zoo/README.md lists them by wing). */
  shows: string[];
  /** Where its sign stands. */
  sign: Tile2;
  /** The sign's words: what it is, and how to set it off, in the house's voice. */
  text: string;
  triggers: Trigger[];
  /** It needs the GM (a model) to be seen properly; offline it says what you get instead. */
  needsModel?: boolean;
  /** For the tour: the triggers to set off, in order (repeats allowed); every one on offer, in turn, by default. */
  tour?: string[];
  /** A scene of the zoo's own whose room this exhibit is (walk in and it opens), and how the tour plays it. */
  scene?: Plan & { id: string };
  /** A word with someone walking with you (Kell), and what the tour says in it (--live). */
  talk?: { with: string; say?: string[] };
}

export interface Wing {
  /** The map's id ("zoo-fire"), which is also its world's scene id. */
  id: string;
  name: string;
  /** A line for the hall's door, the sidebar and the README. */
  about: string;
  /** The map: its grid and legend, its places (the wing's own region over the whole map is added), its ways out. */
  map: Omit<MapSpec, "id" | "name">;
  /** The wing's world, lined up with the map: (0, 0) feet is tile (0, 0), 5 ft to a tile. */
  world: WorldSpec;
  exhibits: Exhibit[];
  /** How its world looks from above (v): what the floors and walls are. */
  dressing?: Dressing;
  /** Where you come in from the hall. */
  entry: Tile2;
  /** Signs that aren't exhibits (what's through a door), and what they say. */
  notices?: Array<{ at: Tile2; name: string; text: string }>;
  /** People of the wing's world who are cast (by id, as the scenes' cards have them: "sallow", "crake-1"), with their names. */
  cast?: Record<string, { name: string; description?: string }>;
  /** Rules stats for the wing's people outside the cast (a sparring partner, a goblin): SRD statblocks. */
  stats?: Record<string, { statblock: string; weapon?: string }>;
  /** A place compiled from a plan (src/game/map/generate): its map and world are the compiler's, not a grid's. */
  compiled?: CompiledPlace;
  /** The wing whose door leads here, when it isn't the hall (for the next exhibit's way). */
  via?: string;
  /** What the world starts with that a spec can't say: puddles and slicks already spilled (the physics' own surfaces). */
  setup?: (world: SceneWorld) => void;
}

/** The zoo's own state, in the game's explore state beside the map's (game.explore.zoo). */
export interface ZooState {
  version: 1;
  /** Exhibits seen: their sign read, or set off. The next one not seen is the lead (g). */
  seen: string[];
  /** Each wing's story time, in turns. */
  turns: Record<string, number>;
  /** What the last thing done left for the view to play, numbered so a view plays each once. */
  news?: News;
  seq: number;
  /** The fight in progress from the map: its arena, and where the player stood. */
  fight?: { arena: string; from: { map: string; at: Tile2 } };
  /** What the screen should show once, beyond the map: the sign just read, in full; The End; the window. */
  show?: Show;
}

export interface News {
  seq: number;
  /** The wing it happened in. */
  map: string;
  lines: string[];
  cues: Cue[];
}

export function zooOf(game: GameState): ZooState {
  const explore = game.explore as { zoo?: ZooState };
  explore.zoo ??= { version: 1, seen: [], turns: {}, seq: 0 };
  return explore.zoo;
}

// ---------------------------------------------------------------------------------------------
// Authoring helpers.

/**
 * Where each marker in a grid is: digits and letters mark spots (a sign, a thing, a door) so the
 * code reads coordinates off the drawing rather than keeping its own. Each must appear once.
 */
export function marks(grid: string, chars: string): Record<string, Tile2> {
  const rows = grid.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  const out: Record<string, Tile2> = {};
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!chars.includes(ch)) return;
    if (out[ch]) throw new Error(`marker ${ch} appears twice (${out[ch]!.x},${out[ch]!.y} and ${x},${y})`);
    out[ch] = { x, y };
  }));
  for (const ch of chars) if (!out[ch]) throw new Error(`marker ${ch} isn't in the grid`);
  return out;
}

/** A tile's middle in a wing's world (feet). */
export const feet = (t: Tile2): [number, number] => [t.x * 5 + 2.5, t.y * 5 + 2.5];
/** A tile's middle as a point. */
export const point = (t: Tile2): Point => ({ x: t.x * 5 + 2.5, y: t.y * 5 + 2.5 });
/** Tiles as feet: a rectangle of whole tiles. */
export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x: x * 5, y: y * 5, w: w * 5, h: h * 5 });
/** A tile beside another. */
export const by = (t: Tile2, dx: number, dy: number): Tile2 => ({ x: t.x + dx, y: t.y + dy });

/** A world operation with the stage manager's blanks filled in. */
export const op = (o: Partial<WorldOp> & { op: WorldOp["op"] }): WorldOp => ({ what: "", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [], ...o });
