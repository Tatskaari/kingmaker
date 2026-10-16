// Creation is the prototype's src/app/game.ts:60-96 at 44c6d4a (Creation), with own.lists optional (the row has them once the engine's first answer comes), busy one of the row's words and made the game's id; creationOf is new.
import type { LoreIssue, OwnBuild, Proposal } from "../../shared/creation/types.ts";
import type { BuildOption, Offer, OwnPicks, SrdLists } from "../../shared/rules/types.ts";
import type { CreationRow } from "../backend.ts";
import { jsonOf } from "../json.ts";

/**
 * Character creation as the screens draw it (v1-design §3.10): the caller's `creation` row, read
 * through my_creation, with what's the screen's own laid over it (the card picked out, which list
 * has the keys, the box's text as it's typed, picks on their way). Pure: the model keeps the local
 * part and calls this whenever either changes, with a parse that keeps each column's object while
 * its text stays the same (`memoParse`).
 */

/**
 * Character creation, from the concept to the sheet: the three builds offered, the one chosen (or
 * made), and the backstory, its draft or its notes worked in, and what the lore check found.
 */
export interface Creation {
  name: string;
  concept: string;
  /** The three builds offered for the concept, and why they're the class defaults when they are. */
  offer?: Offer;
  /** The build picked out on the choose screen: 0-2 the cards, 3 "Make my own". */
  index: number;
  /** The player's own build, being made: their picks, what they pick from (once the engine has said), which list has the keys, and what it comes to. */
  own?: { picks: OwnPicks; lists?: SrdLists; column: number; option?: BuildOption; making?: boolean };
  /** The build chosen: what the character is made from. */
  chosen?: BuildOption;
  /** The backstory as the box last had it (the box's own while it's on screen). */
  story: string;
  /** Bumped when the box's text is replaced from outside (a draft taken, a fix accepted): the box starts again with it. */
  version: number;
  /** A draft, or the player's notes worked in, shown and waiting: it's never in the box until they take it. */
  proposal?: Proposal;
  /** What the lore check found, one at a time: what doesn't fit, and a fix that keeps its spirit. */
  issues?: LoreIssue[];
  issue: number;
  /** The issue they chose to rewrite themselves: it stays over the box while they do. */
  rewriting?: LoreIssue;
  /** The fixes taken are being checked once more (the issues on show are that second look's): not a third time. */
  again?: boolean;
  /** What the GM is working on for them (the row's busy): builds, pick, own, draft, work, check, traits. */
  busy?: string;
  /** A word for the player: the GM couldn't be reached, the engine couldn't make that one, a draft taken. */
  note?: string;
  /** Why the backstory went into the game without the lore check: the sheet says so over it. */
  unchecked?: string;
  /** The game made from this creation, until they set off: choosing again puts it away. */
  made?: bigint;
}

/** What the screens hold of a creation that the row doesn't: the client's own, until a move says otherwise. */
export interface CreationLocal {
  /** The build picked out on the choose screen: 0-2 the cards, 3 "Make my own". */
  index: number;
  /** Which of the four lists has the keys, making their own: species, class, subclass, background. */
  column: number;
  /** The box's text as typed, and the row's version it was typed over: until it's saved (or the row's story is replaced from outside). */
  typed?: { text: string; version: number };
  /** Their own picks, asked for and not yet back in the row: drawn at once, as the prototype drew them. */
  picks?: OwnPicks;
}

/** How a JSON column is read: jsonOf, or one that gives the same object for the same text (the screens' effects follow objects). */
export type Parse = <T>(text: string | undefined) => T | undefined;

/** A creation row and the screen's own state as the prototype's Creation. A JSON column that won't read is left out. */
export function creationOf(row: CreationRow, local: CreationLocal, parse: Parse = jsonOf): Creation {
  const offer = parse<Offer>(row.offer);
  const chosen = parse<BuildOption>(row.chosen);
  const proposal = parse<Proposal>(row.proposal);
  const issues = parse<LoreIssue[]>(row.issues);
  const rewriting = parse<LoreIssue>(row.rewriting);
  const own = ownOf(row, local, parse);
  return {
    name: row.name,
    concept: row.concept,
    ...(offer ? { offer } : {}),
    index: local.index,
    ...(own ? { own } : {}),
    ...(chosen ? { chosen } : {}),
    story: storyOf(row, local),
    version: row.version,
    ...(proposal ? { proposal } : {}),
    ...(issues?.length ? { issues } : {}),
    issue: row.issue,
    ...(rewriting ? { rewriting } : {}),
    ...(row.again ? { again: true } : {}),
    ...(row.busy ? { busy: row.busy } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.unchecked ? { unchecked: row.unchecked } : {}),
    ...(row.gameId !== undefined ? { made: row.gameId } : {}),
  };
}

/** The box's text: as typed, unless the row's story was replaced from outside since (its version moved on). */
function storyOf(row: CreationRow, local: CreationLocal): string {
  return local.typed && local.typed.version === row.version ? local.typed.text : row.story;
}

/**
 * Their own build: the picks on their way, else the row's; what it comes to (the last the engine
 * made, while it makes the next: the prototype kept it on show too); making while the engine works
 * or a pick hasn't reached the row.
 */
function ownOf(row: CreationRow, local: CreationLocal, parse: Parse): Creation["own"] {
  const own = parse<OwnBuild>(row.own);
  const picks = local.picks ?? own?.picks;
  if (!picks) return undefined;
  return {
    picks,
    ...(own?.lists ? { lists: own.lists } : {}),
    column: local.column,
    ...(own?.option ? { option: own.option } : {}),
    making: row.busy === "own" || !!local.picks,
  };
}

/**
 * jsonOf, giving the same object for the same text while it's among the last few read: a row that
 * changes in one column (the story saved) leaves the others' objects as they were, so a screen's
 * effect that follows one (the issue being rewritten) runs when it changes, not at every save.
 */
export function memoParse(keep = 16): Parse {
  const seen = new Map<string, unknown>();
  return <T>(text: string | undefined): T | undefined => {
    if (!text) return undefined;
    // The most recently read last: the one left out when there are too many is the one read longest ago.
    const value = seen.has(text) ? seen.get(text) as T | undefined : jsonOf<T>(text);
    seen.delete(text);
    if (seen.size >= keep) seen.delete(seen.keys().next().value!);
    seen.set(text, value);
    return value;
  };
}
