import type { Message } from "../../src/llm/openrouter.ts";
import type { SceneWorld } from "../../src/world/scene-world.ts";

/**
 * A stage-manager eval case: one exchange from real play, the world exactly as the stage manager
 * read it, and what the reply established (hand-labelled). Expectations are predicates over the
 * world before and after, so any system (operations, tools, a decider) is scored the same way.
 */
export interface WorldCase {
  id: string;
  /** Where it came from: session id and turn. */
  source: string;
  scene: string;
  turn: number;
  player: { name: string };
  /** The world as the stage manager read it: after this turn's rules and fire. */
  world: SceneWorld;
  playerTurn: string;
  /** The dice lines the GM narrated from (rules already applied to the world). */
  rules: string[];
  reply: string;
  /** What the reply established that the world must now show. */
  expect: Expectation[];
  /** Changes that are fine either way (judgement calls): neither required nor penalised. */
  allow?: Expectation[];
  /** Changes that are wrong in an instructive way, with the failure they illustrate. */
  forbid?: Array<Expectation & { fail: FailureClass }>;
  /** Notes that must no longer be visible to the GM afterwards (they've stopped being true). */
  stale?: Array<{ id: string; text: string }>;
  /** Why the labels are what they are, for whoever reads a failure. */
  why?: string;
  /** The player moved and then cast or struck in the same turn (the rules used the old position). */
  moveThenAct?: boolean;
  /** The GM's own call for this reply (for the GM-writes-the-operations variant). */
  gm?: { instructions: string; input: Message[] };
  tags?: string[];
}

/** A predicate on the world after the exchange that didn't hold before it. Regexes are case-insensitive strings. */
export type Expectation =
  /** Someone or something is somewhere new: in an area, and/or within `within` feet (default 12) of something. */
  | { move: string; to?: string | string[]; near?: string; within?: number; awayFrom?: string; beyond?: number; why?: string }
  /** Now carried by a person or held in a container. */
  | { held: string; by: string | string[]; why?: string }
  /** Was carried or held, now put down (optionally near something). */
  | { drop: string; near?: string; within?: number; why?: string }
  /** Gains any of `add`, or loses all of `remove`. */
  | { state: string; add?: string | string[]; remove?: string | string[]; why?: string }
  /** Someone or something new, by name. */
  | { create: string; kind?: string | string[]; to?: string | string[]; near?: string; within?: number; heldBy?: string; count?: number; why?: string }
  /** Has left the scene. */
  | { gone: string; why?: string }
  /** A note on it saying this. */
  | { note: string; text: string; why?: string };

export type FailureClass =
  | "missed-move" | "wrong-place" | "missed-transfer" | "missed-state" | "missed-arrival" | "missed-exit" | "missed-note"
  | "spurious-move" | "spurious-transfer" | "spurious-state" | "over-creation" | "duplicate" | "spurious-exit"
  | "wrong-id" | "contradicts-rules" | "stale-note" | "false-note";

/** What a system did with one case. */
export interface SystemRun {
  world: SceneWorld;
  /** Operations or tool calls, for reading failures. */
  trace: unknown;
  /** Selectors that matched nothing, invalid calls. */
  problems: string[];
  costUsd: number;
  latencyMs: number;
  calls: number;
  inputTokens?: number;
  outputTokens?: number;
}
