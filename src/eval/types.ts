import type { FixtureSpec } from "./fixtures.ts";
import type { Skill } from "../runtime/scene.ts";

/** One player turn at a fixed moment; the reply is judged (and optionally checked mechanically). */
export interface ReplyCase {
  kind: "reply";
  id: string;
  /** The failure mode or behaviour this case reproduces. */
  about: string;
  scene: string;
  setup: FixtureSpec;
  input: string;
  /** Case-specific criterion for the judge: what a good reply does here. */
  criterion: string;
  expect?: {
    /** Acceptable transition ids taken this turn ("none" = stay put). */
    transition?: string[];
    roll?: Skill | "none";
    exit?: string[] | "none";
  };
  approaches?: string[];
  tags?: string[];
}

/** A single decider judgement with known acceptable answers (Jev vs Luna). */
export interface DecisionCase {
  kind: "decision";
  id: string;
  about: string;
  scene: string;
  setup: FixtureSpec;
  input: string;
  /** "before": attempt/cue judged on the input; "after": outcome judged with this GM reply. */
  phase: "before" | "after";
  reply?: string;
  /** Acceptable transition ids, or "none". */
  expect: string[];
  tags?: string[];
}

/** A simulated player plays a whole scene; the transcript is judged. */
export interface TrajectoryCase {
  kind: "trajectory";
  id: string;
  about: string;
  scene: string;
  character?: string;
  persona: string;
  maxTurns: number;
  criterion: string;
  approaches?: string[];
  tags?: string[];
}

export type EvalCase = ReplyCase | DecisionCase | TrajectoryCase;
