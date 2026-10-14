import type { Tile2 } from "../../types.ts";
import { compilePlan, type CompiledPlace } from "./compile.ts";
import type { Problem } from "./normalize.ts";
import { modelPlanner, type PlacePlan, type Planner } from "./plan.ts";
import { errorsOf, validate } from "./validate.ts";

/**
 * A place from a description, at runtime: the model writes a semantic plan (plan.ts), the
 * compiler lays it out (compile.ts), the validators check it as the game will use it
 * (validate.ts), and what's wrong goes back to the model to fix, at most twice. The best round
 * (fewest errors) is kept, so there is always a map, even when the plan never fully passes.
 *
 *   const { ok, place } = await generatePlace("a chandler's shop on the wharves...", { id: "chandler" });
 *   installPlace(place, ...)                     // install.ts: the game can use it like a hand-made place
 */

export interface Round {
  /** The plan as the model wrote it this round. */
  plan: PlacePlan;
  problems: Problem[];
  errors: number;
  /** The model call: wall-clock, tokens and cost; and the compile-and-check that followed. */
  modelMs: number;
  compileMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  failed?: string;
}

export interface Generated {
  /** Passed every check. */
  ok: boolean;
  /** The best place it made (absent only if the model never returned a plan). */
  place?: CompiledPlace;
  problems: Problem[];
  rounds: Round[];
  /** Rounds after the first. */
  repairs: number;
  ms: number;
  costUsd: number;
}

export interface GenerateOptions {
  /** The map's id. */
  id: string;
  sceneId?: string;
  exitTo?: { map: string; at: Tile2; label?: string };
  /** The model by default (the fast one, reasoning low). */
  planner?: Planner;
  /** Repair rounds after the first plan (default 2). */
  maxRepairs?: number;
  /** Called after each round, for progress. */
  onRound?: (round: Round, index: number) => void;
}

/** How many problems to send back in one repair: the first are the ones that matter most. */
const MAX_PROBLEMS = 14;
const ORDER: Problem["check"][] = ["plan", "fit", "door", "reach", "access", "overlap", "hidden", "relation", "world"];

export async function generatePlace(text: string, options: GenerateOptions): Promise<Generated> {
  const planner = options.planner ?? modelPlanner();
  const maxRepairs = options.maxRepairs ?? 2;
  const started = performance.now();
  const rounds: Round[] = [];
  let best: { place: CompiledPlace; problems: Problem[]; errors: number } | undefined;
  let previous: PlacePlan | undefined;
  let problems: Problem[] = [];

  for (let round = 0; round <= maxRepairs; round++) {
    const asked = performance.now();
    let call: Awaited<ReturnType<Planner>>;
    try {
      const errors = errorsOf(problems).sort((a, b) => ORDER.indexOf(a.check) - ORDER.indexOf(b.check)).slice(0, MAX_PROBLEMS).map(p => p.message);
      call = await planner(previous && errors.length ? { text, previous, problems: errors } : { text });
    } catch (error) {
      const failed = error instanceof Error ? error.message : String(error);
      rounds.push({ plan: previous ?? ({} as PlacePlan), problems: [], errors: -1, modelMs: performance.now() - asked, compileMs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, failed });
      options.onRound?.(rounds.at(-1)!, round);
      if (!previous) continue; // the first plan failed: ask again, as a round of its own
      break;
    }
    const modelMs = performance.now() - asked;
    const compiled = performance.now();
    let place: CompiledPlace;
    try {
      place = compilePlan(call.plan, options);
      problems = validate(place);
    } catch (error) {
      // A plan the compiler can't take at all is a failed round; the model hears why.
      const failed = error instanceof Error ? error.message : String(error);
      problems = [{ check: "plan", subject: "plan", message: `The plan couldn't be laid out: ${failed}`, severity: "error" }];
      rounds.push({ plan: call.plan, problems, errors: 1, modelMs, compileMs: performance.now() - compiled, costUsd: call.meta.costUsd, inputTokens: call.meta.inputTokens, outputTokens: call.meta.outputTokens, failed });
      options.onRound?.(rounds.at(-1)!, round);
      previous = call.plan;
      continue;
    }
    const errors = errorsOf(problems).length;
    rounds.push({ plan: call.plan, problems, errors, modelMs, compileMs: performance.now() - compiled, costUsd: call.meta.costUsd, inputTokens: call.meta.inputTokens, outputTokens: call.meta.outputTokens });
    options.onRound?.(rounds.at(-1)!, round);
    if (!best || errors <= best.errors) best = { place, problems, errors };
    if (!errors) break;
    // The model repairs the plan as the compiler understood it (its ids, its compass).
    previous = place.plan;
  }

  const ms = performance.now() - started;
  const costUsd = rounds.reduce((n, r) => n + r.costUsd, 0);
  return {
    ok: !!best && best.errors === 0,
    ...(best ? { place: best.place } : {}),
    problems: best?.problems ?? [],
    rounds,
    repairs: Math.max(0, rounds.length - 1),
    ms,
    costUsd,
  };
}
