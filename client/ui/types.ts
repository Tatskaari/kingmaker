// Copied from the prototype's src/game/types.ts:83-84 at 44c6d4a (Span, StyledLine), unchanged; with the map's types the look layer's map halves name (Tile2, MapActor, Interaction: client/look's cast.ts, lamps.ts, overlay.ts, map.ts), re-exported from v2/shared/map/types.ts, the prototype's :1-81 copied whole there.
/** A run of styled text, and a line of them: what the portraits and the sheet's rows are drawn from. */
export interface Span { text: string; fg?: string; bg?: string; bold?: boolean }
export type StyledLine = Span[];

export type { Interaction, MapActor, Tile2 } from "../../shared/map/types.ts";
