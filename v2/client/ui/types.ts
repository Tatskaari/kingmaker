// Copied from the prototype's src/game/types.ts:83-84 at 44c6d4a (Span, StyledLine), unchanged; with :7 (Tile2) and :46-70 (MapActor, Interaction), which the look layer's map halves name (client/look: cast.ts, lamps.ts, overlay.ts).
/** A run of styled text, and a line of them: what the portraits and the sheet's rows are drawn from. */
export interface Span { text: string; fg?: string; bg?: string; bold?: boolean }
export type StyledLine = Span[];

export interface Tile2 { x: number; y: number }

/** Something on the map that isn't terrain: people, creatures, objects, items. */
export interface MapActor {
  id: string;
  name: string;
  kind: "player" | "person" | "creature" | "object" | "item";
  glyph: string;
  /** Hex colour for the renderer. */
  color?: string;
  map: string;
  at: Tile2;
  /** A cast id in the current scene, or a scene-world entity id. */
  ref?: string;
  /** States worth drawing (burning, destroyed, down...). */
  states?: string[];
  /** A stack's count (three pennies on the cobbles), from the scene's world. */
  quantity?: number;
  blocks?: boolean;
  /** What happens when the player interacts with it. */
  interaction?: Interaction;
}

export type Interaction =
  | { kind: "scene"; sceneId: string; verb: "talk" | "enter" | "open" | "examine"; label: string }
  | { kind: "travel"; to: { map: string; at: Tile2 }; label: string }
  | { kind: "examine"; text: string; label: string };
