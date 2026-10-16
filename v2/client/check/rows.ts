import { Timestamp } from "spacetimedb";
import type { LoreIssue, OwnBuild, Proposal } from "../../shared/creation/types.ts";
import type { BuildOption, Offer, SheetData, SrdLists } from "../../shared/rules/types.ts";
import type { CreationRow, GameRow, SheetRow } from "../backend.ts";
import fighter from "./fixtures/fighter-sheet.json" with { type: "json" };
import lists from "./fixtures/lists.json" with { type: "json" };
import offer from "./fixtures/offer.json" with { type: "json" };
import own from "./fixtures/own.json" with { type: "json" };
import wizard from "./fixtures/wizard-sheet.json" with { type: "json" };

/**
 * Fixture rows for the title, character creation and the sheet, as the simulation would write them:
 * built from what the prototype's rules engine made (client/check/fixtures/, recorded at 44c6d4a),
 * for the screen check, the demo and the client's tests. No engine, no server.
 */

/** The create screen's first example: the concept the fixtures' builds were made for. */
export const NAME = "Tamsin Vell";
export const CONCEPT = "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier";
/** The three builds offered for it, offline (the class defaults that best match its words). */
export const OFFER = offer as Offer;
/** What the player picks their own from, at level 3. */
export const LISTS = lists as SrdLists;
/** Their own: an orc rogue (Thief), a criminal. */
export const OWN = own as BuildOption;
/** Ready-made sheets: Pell Marrow the wizard, and Wren Ashdown the fighter. */
export const WIZARD = wizard as SheetData;
export const FIGHTER = fighter as SheetData;

/** The prototype's screen check's story, and what the lore check says of it (screens-check.tsx:906-922). */
export const NEPHEW = "I'm the King's nephew, though nobody at court will say so. I owe Fat Jory three crowns.";
export const NEPHEW_ISSUE: LoreIssue = { quote: "I'm the King's nephew", problem: "King Aldren's family is known to all Caerwyn, and there's no nephew in it.", fix: "I'm a cousin of a minor courtier, twice removed" };
export const DRAFT = "I was born above a chandler's shop on Tallow Lane, where the candles were cheap and the arguments cheaper.\n\nI kept a factor's books for nine years, until the night I found an error that wasn't one.";
export const WORKED = "I grew up in the Nine Furrows, where Mum drowned in the flood of '89. I still owe Fat Jory three crowns.";

/** A creation row for Tamsin at a step: the choose screen's, with `more` laid over. JSON columns are given as values. */
export function creationRow(more: Partial<Omit<CreationRow, "offer" | "own" | "chosen" | "proposal" | "issues" | "rewriting">> & {
  offer?: Offer; own?: OwnBuild; chosen?: BuildOption; proposal?: Proposal; issues?: LoreIssue[]; rewriting?: LoreIssue;
} = {}): CreationRow {
  const { offer: o = OFFER, own: mine, chosen, proposal, issues, rewriting, ...rest } = more;
  return {
    campaign: "caerwyn", name: NAME, concept: CONCEPT, how: "three", step: "choose", busy: undefined, rev: 1,
    offer: JSON.stringify(o), own: mine && JSON.stringify(mine), chosen: chosen && JSON.stringify(chosen), story: "", version: 1,
    proposal: proposal && JSON.stringify(proposal), issues: issues && JSON.stringify(issues), issue: 0, rewriting: rewriting && JSON.stringify(rewriting),
    again: false, note: undefined, unchecked: undefined, backstory: undefined, gameId: undefined,
    ...rest,
  };
}

/** A sheet as its row has it: the engine's data without the purse and what else they carry, which are the pockets. */
export function sheetRow(sheet: SheetData): SheetRow {
  const { purse, carrying, ...data } = sheet;
  return { data: JSON.stringify(data), pockets: JSON.stringify({ purse, carrying }), build: `${sheet.species} ${sheet.classes[0]?.name ?? ""}`.toLowerCase(), statusLine: `HP ${sheet.hp.current}/${sheet.hp.max}` };
}

/** One of the player's games as my_games lists it, played `minutes` ago (of `now`). */
export function gameRow(id: bigint, name: string, where: string, minutes: number, now = Date.now(), begun = true): GameRow {
  return {
    gameId: id, name, time: "morning", where, begun,
    hook: "This morning a palace clerk, Wendell Prout, was found hanged behind the Caerwyn granary, and the Watch Captain has already called it suicide.",
    lastPlayedAt: Timestamp.fromDate(new Date(now - minutes * 60_000)),
  };
}
