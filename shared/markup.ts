// Copied from the prototype's src/runtime/markup.ts:29-65 and knowledge.ts:274 at 44c6d4a: the types only (the parser is the AI service's, ai/gm/markup.ts); a mark carries its card.

/**
 * The GM's markup as the screen reads it: who says each line of a reply, and the notes on its
 * phrases, as offsets into the reply's text. The AI service parses the GM's written markup (and
 * writes the notes); the simulation keeps it on the transcript row beside the words, as JSON; the
 * client draws it.
 */

export type MarkKind = "why" | "know" | "you";
export const MARK_KINDS: readonly MarkKind[] = ["why", "know", "you"];

/** The knowledge entry a mark is about, found after the reply (src/runtime/knowledge.ts): only ever something the player knows. */
export type MarkLink =
  /** Someone of the scene's cast or the place's world. */
  | { kind: "person"; id: string }
  /** A lore doc anyone could read (a place, a custom, a body of people). */
  | { kind: "lore"; path: string }
  /** Something the player did: their own turn. */
  | { kind: "deed"; scene: string; turn: number };

/** What a mark's popover shows of its link, under the note: only ever what the player knows. */
export interface Card { title: string; lines: string[] }

/** A note on a phrase of the reply: [start, end) in its text. */
export interface Mark {
  start: number;
  end: number;
  kind: MarkKind;
  /** The note, said to the player. What parseMarkup reads is the GM's own, which never reaches the screen: the one shown is written from what the player knows (src/runtime/notes.ts). */
  note: string;
  link?: MarkLink;
  /**
   * The link's card, written by the AI service with the note (the client has no docs), so it says
   * what the player knew then. The prototype's popover reads it afresh each time it opens.
   */
  card?: Card;
}

/** A spoken line: [start, end) in the reply's text, its quote marks included. */
export interface Speech {
  start: number;
  end: number;
  /** Who says it: a cast or world entity's id, "you" for the player's own words; none when nobody can tell. */
  speaker?: string;
  /** The tag the GM wrote, when it wrote one. */
  tag?: string;
}

/** A reply as the screen shows it: its words, who says what, and the notes. */
export interface Marked { text: string; speech: Speech[]; marks: Mark[] }

/** What the markup said of a reply, kept on its transcript entry beside its words (offsets into them). */
export type Markup = Omit<Marked, "text">;
