// Copied from the prototype's src/runtime/markup.ts:29-65 at 44c6d4a: the types only (the parser is the AI service's, ai/gm/markup.ts). M2 took the notes on marked words out of the game (docs/two-part-design.md, the user's call): the markup is who says each line, and nothing else.

/**
 * The GM's markup as the screen reads it: who says each line of a reply, as offsets into the
 * reply's text. The AI service parses the GM's written markup; the simulation keeps it on the
 * transcript row beside the words, as JSON; the client draws each person's lines in their colour.
 */

/** A spoken line: [start, end) in the reply's text, its quote marks included. */
export interface Speech {
  start: number;
  end: number;
  /** Who says it: a cast or world entity's id, "you" for the player's own words; none when nobody can tell. */
  speaker?: string;
  /** The tag the GM wrote, when it wrote one. */
  tag?: string;
}

/** A reply as the screen shows it: its words, and who says what. */
export interface Marked { text: string; speech: Speech[] }

/** What the markup said of a reply, kept on its transcript entry beside its words (offsets into them). */
export type Markup = Omit<Marked, "text">;
