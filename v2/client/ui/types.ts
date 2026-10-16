// Copied from the prototype's src/game/types.ts:83-84 at 44c6d4a (Span, StyledLine), unchanged.
/** A run of styled text, and a line of them: what the portraits and the sheet's rows are drawn from. */
export interface Span { text: string; fg?: string; bg?: string; bold?: boolean }
export type StyledLine = Span[];
