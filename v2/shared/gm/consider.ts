// Copied from the prototype's src/runtime/consider.ts:32-90 (Gets, GETS, RulingOutcome, Judged, Ruling, Verdict) and src/runtime/session.ts:122-147 (RulingRecord) at 44c6d4a: the types alone (and GETS, which the copies read), with Skill and RollResult from shared, so the AI service's consider.ts and the simulation's both read them from here. GETS is exported.

import type { RollResult } from "../dice.ts";
import type { Skill } from "../scene/types.ts";

/** How much of what the player was after an outcome gives them. */
export type Gets = "all" | "some" | "none";
export const GETS: readonly string[] = ["all", "some", "none"] satisfies Gets[];

/** What an outcome changes, as the review wrote it. */
export interface RulingOutcome {
  /** What happens, decided, for the GM to narrate (and all of what comes out, in its own terms). */
  happens: string;
  /** How much of what the player was after it gives them: a success that gives none is a refusal. */
  gets: Gets;
  /** A beat or ending it leads to (undefined: the scene stays where it is). */
  to?: string;
  /** An outcome route of the scene's that this amounts to: its facts come with it, and it leads where it leads. */
  countsAs?: string;
  establishes: string[];
  /** Essentials (ids) that come out, as this outcome says (what lands is what the reply showed: landRuling). */
  reveals: string[];
  /** Ways of trying (routes with a roll, available now) that this rules out for the rest of the scene: a failure's, for a way really tried. */
  closes: string[];
}

/** The review's judgements, as dc-guidance.md has them. */
export interface Judged {
  stakes: "trivial" | "guarded" | "dangerous" | "ruinous";
  approach: "free" | "no_chance" | "weak" | "plausible" | "strong" | "excellent";
  disposition: "hostile" | "wary" | "friendly";
  /** They give this when asked (the beat, their card, or what they've agreed to says so): free, whatever the stakes. */
  freely?: boolean;
  sameAgain: boolean;
  difficulty: "trivial" | "easy" | "moderate" | "hard" | "impossible";
}

/** The GM's ruling on a considered act. */
export interface Ruling {
  act: string;
  /** A cast id, or "world" (a feat). */
  target: string;
  skill: Skill;
  /** The player's turn rests on something they know isn't so (a lie, a bluff, a forgery): Deception. */
  lie: boolean;
  judged: Judged;
  /** The dice line's reason: the goal, as the player sees it (and nothing they haven't heard). */
  reason: string;
  success: RulingOutcome;
  failure: RulingOutcome;
  /** Why its success is no success (a refusal, as the review wrote it): then nothing is rolled, and that refusal is the answer. */
  hollow?: string;
  /** Why the dice don't matter (either way it comes to the same, and it gets them what they were after): then it's a yes. */
  foregone?: string;
  costUsd: number;
  latencyMs: number;
}

/**
 * Roll or not, and at what. A no says which kind (`no`): the same push again (the answer it got
 * before), the review's own refusal (`hollow`: its success gets them nothing), or a plain no from
 * the person or the world (a lever that can't move them, too far, can't be done like this).
 */
export interface Verdict { kind: "roll" | "yes" | "no"; dc?: number; why: string; no?: "same_again" | "hollow" | "refused" }

/**
 * A considered turn's ruling (src/runtime/consider.ts): what the player attempted that no route
 * settled, whether it was rolled and at what, and what each outcome changed. The scene's own, kept
 * for the record and for the next ruling (the same push again gets the same answer).
 */
export interface RulingRecord {
  turn: number;
  /** What the player attempted, as the GM saw it. */
  act: string;
  /** Who they were working on (a cast id), or "world" for a feat. */
  target: string;
  skill: Skill;
  /** "roll", or no roll: "yes" (it works) or "no" (not like this). */
  kind: "roll" | "yes" | "no";
  dc?: number;
  /** Why there was no roll, or what set the DC (the judgements, in a few words). */
  why: string;
  roll?: RollResult;
  /** How it went: the outcome that was played. */
  went: "success" | "failure";
  /** What the played outcome changed: where it went, the facts, what came out, routes opened and closed. */
  changed: string;
  costUsd: number;
  latencyMs: number;
}
