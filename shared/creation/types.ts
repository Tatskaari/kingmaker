// Moved from v2/ai/docs/backstory.ts (Who, LoreIssue, Asked) and v2/ai/docs/types.ts (Backstory), unchanged, which re-export them; the rest is v1-design §3.1 and §3.9's.
import type { BuildOption, OwnPicks, SrdLists } from "../rules/types.ts";

/**
 * Character creation's types, as the simulation, the AI service and the client share them: who a
 * backstory is for, what the lore check finds, what the model's part comes to, the backstory itself,
 * the world it's written for, and the JSON in a `creation` row's columns.
 */

/** Who the backstory is for, as the model is told: their name, concept, and build in a line. */
export interface Who { name: string; concept: string; build?: string }

/** A part of a backstory that contradicts canon, and a fix that keeps its spirit. */
export interface LoreIssue {
  /** The backstory's own words that don't fit, as written; undefined when they couldn't be found in it (rewrite it, then). */
  quote?: string;
  /** What's wrong, in terms anyone in Caerwyn could know (the check is never told a secret of the GM's). */
  problem: string;
  /** Words to put in the quote's place: the same spirit, fitting the world. */
  fix: string;
}

/**
 * What asking came to: the text, or why there's none (offline, or the GM couldn't be reached): in a
 * sentence for the player, and as a reason to go in one of the game's own ("the GM is offline").
 */
export type Asked<T> = { ok: true; value: T } | { ok: false; why: string; reason?: string };

/**
 * The player's backstory, written (or drafted, or worked in from their notes) at character creation
 * and checked against the world's lore: the whole of it, and what it says of them.
 */
export interface Backstory {
  /** The whole of it, in the player's words (with any lore fix they accepted). */
  text: string;
  /** Who they are, in a sentence or two (in the third person): what every GM brief says of them. */
  summary: string;
  personality: string[];
  ideals: string[];
  bonds: string[];
  flaws: string[];
}

/**
 * The world a backstory is written for and checked against: the scenario's `creation` block, which
 * the AI service hands the backstory's calls. Only what anyone in the world could know: the lore
 * check's words go straight to the player.
 */
export interface CreationWorld {
  /** The world's name, for a primer doc without a title: "Caerwyn". */
  name: string;
  /** The story the backstory leads into: why they took this case, and that the story's people don't know them yet. */
  premise: string;
  /** The doc that tells of the world, for drafting one: "World/Caerwyn.md". */
  primer: string;
  /** The World docs the lore check doesn't read (how the world stands now, its fronts, the index), though every other one is canon. */
  notCanon: string[];
  /** The places' public docs, by the words that call them up: a regular expression's source, read with the i flag. */
  places: Array<{ doc: string; words: string }>;
}

// ---------------------------------------------------------------------------------------------
// A `creation` row's words and JSON (simulation/src/schema.ts).

/** How the character's build is chosen: from three the GM offers, by the GM alone, or the player's own. */
export type CreationHow = "three" | "model" | "own";
/** Where the player is in making one (creation.step). */
export type CreationStage = "concept" | "choose" | "custom" | "backstory" | "made";
/** What the GM is working on for them (creation.busy). */
export type CreationBusy = "builds" | "pick" | "own" | "draft" | "work" | "check" | "traits";

/** creation.own: the player's own build, being made: their picks, what it comes to, and what they pick from. */
export interface OwnBuild { picks: OwnPicks; option?: BuildOption; lists?: SrdLists }

/** creation.proposal: a draft, or the player's notes worked in, shown and waiting; never in the box until they take it. */
export interface Proposal { kind: "draft" | "work"; text: string }
