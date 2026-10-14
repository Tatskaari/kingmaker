import type { Tile2 } from "../../types.ts";
import type { Stage } from "./compact.ts";
import { compilePlan, compileShell, type CompiledPlace, type Shell } from "./compile.ts";
import { inventLooks, inventThings, type LookSpend } from "./looks.ts";
import type { Problem } from "./normalize.ts";
import { modelPlanner, type CastMember, type PlacePlan, type Planner } from "./plan.ts";
import { errorsOf, validate } from "./validate.ts";

/**
 * A place from a description, at runtime: the model writes a semantic plan (plan.ts), the
 * compiler lays it out (compile.ts), the validators check it as the game will use it
 * (validate.ts), and what's wrong goes back to the model to fix, at most twice. The best round
 * (fewest errors) is kept, so there is always a map, even when the plan never fully passes.
 *
 * The plan streams in (compact.ts): when the rooms are in and the things begin, the building is
 * laid out (onShell: a caller can show its walls and floors while it's furnished); when the things
 * are in and the people begin, the look layer is asked for the things it can't draw yet, while the
 * model is still writing.
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
  /** From the call: when the structure (the rooms) was in and the building laid out, and when the things were in. */
  shellMs?: number;
  thingsMs?: number;
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
  /** All of it: the plan's rounds and the looks. */
  ms: number;
  /** When the first building was laid out (the first round's rooms), from the start. */
  shellMs?: number;
  costUsd: number;
  /** The look layer's model calls for the names it didn't know (in ms and costUsd too, where they didn't overlap the plan). */
  looks?: LookSpend;
}

export interface GenerateOptions {
  /** The map's id. */
  id: string;
  sceneId?: string;
  /** The scene's cast: the planner is told who they are, and the plan's people use their ids. */
  cast?: CastMember[];
  exitTo?: { map: string; at: Tile2; label?: string };
  /** Varies the layout (default: from the id). */
  seed?: number;
  /** The model by default (the fast one, reasoning none, the compact plan). */
  planner?: Planner;
  /** Repair rounds after the first plan (default 2). */
  maxRepairs?: number;
  /** Called after each round, for progress. */
  onRound?: (round: Round, index: number) => void;
  /** The building, laid out from the rooms while the things are still being written (each round). */
  onShell?: (shell: Shell, ms: number) => void;
  /** Ask the look layer's model for the looks it doesn't have yet, before the place is shown (default true). */
  looks?: boolean;
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
  let firstShell: number | undefined;
  // Look calls started while the plan was still streaming.
  const early: Array<Promise<LookSpend>> = [];

  for (let round = 0; round <= maxRepairs; round++) {
    const asked = performance.now();
    let call: Awaited<ReturnType<Planner>>;
    let shellMs: number | undefined;
    const onPartial = (stage: Stage, partial: PlacePlan) => {
      try {
        if (stage === "structure") {
          const shell = compileShell(partial, options);
          shellMs = performance.now() - asked;
          firstShell ??= performance.now() - started;
          options.onShell?.(shell, shellMs);
        }
        if (stage === "things" && options.looks !== false) early.push(inventThings(partial.things));
      } catch { /* a part that won't compile yet: the whole plan will say why */ }
    };
    try {
      const errors = errorsOf(problems).sort((a, b) => ORDER.indexOf(a.check) - ORDER.indexOf(b.check)).slice(0, MAX_PROBLEMS).map(p => p.message);
      const cast = options.cast?.length ? { cast: options.cast } : {};
      call = await planner(previous && errors.length ? { text, ...cast, previous, problems: errors, onPartial } : { text, ...cast, onPartial });
    } catch (error) {
      const failed = error instanceof Error ? error.message : String(error);
      rounds.push({ plan: previous ?? ({} as PlacePlan), problems: [], errors: -1, modelMs: performance.now() - asked, compileMs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, failed });
      options.onRound?.(rounds.at(-1)!, round);
      if (!previous) continue; // the first plan failed: ask again, as a round of its own
      break;
    }
    const modelMs = performance.now() - asked;
    const timing = { ...(shellMs !== undefined ? { shellMs } : {}), ...(call.stages?.things !== undefined ? { thingsMs: call.stages.things } : {}) };
    const compiled = performance.now();
    let place: CompiledPlace;
    try {
      place = compilePlan(call.plan, options);
      problems = validate(place);
    } catch (error) {
      // A plan the compiler can't take at all is a failed round; the model hears why.
      const failed = error instanceof Error ? error.message : String(error);
      problems = [{ check: "plan", subject: "plan", message: `The plan couldn't be laid out: ${failed}`, severity: "error" }];
      rounds.push({ plan: call.plan, problems, errors: 1, modelMs, compileMs: performance.now() - compiled, costUsd: call.meta.costUsd, inputTokens: call.meta.inputTokens, outputTokens: call.meta.outputTokens, ...timing, failed });
      options.onRound?.(rounds.at(-1)!, round);
      previous = call.plan;
      continue;
    }
    const errors = errorsOf(problems).length;
    rounds.push({ plan: call.plan, problems, errors, modelMs, compileMs: performance.now() - compiled, costUsd: call.meta.costUsd, inputTokens: call.meta.inputTokens, outputTokens: call.meta.outputTokens, ...timing });
    options.onRound?.(rounds.at(-1)!, round);
    if (!best || errors <= best.errors) best = { place, problems, errors };
    if (!errors) break;
    // The model repairs the plan as the compiler understood it (its ids, its compass).
    previous = place.plan;
  }

  // The looks the place still needs (a brick oven nobody has drawn before), before it's shown: what
  // was asked while the plan streamed, then anything the final place has that wasn't.
  let looks: LookSpend | undefined;
  if (best && options.looks !== false) {
    const asked = await Promise.all(early);
    const rest = await inventLooks(best.place);
    looks = [...asked, rest].reduce((a, b) => ({ landed: a.landed + b.landed, calls: a.calls + b.calls, costUsd: a.costUsd + b.costUsd, ms: a.ms + b.ms, names: [...a.names, ...b.names] }));
  }
  const ms = performance.now() - started;
  const costUsd = rounds.reduce((n, r) => n + r.costUsd, 0) + (looks?.costUsd ?? 0);
  return {
    ok: !!best && best.errors === 0,
    ...(best ? { place: best.place } : {}),
    problems: best?.problems ?? [],
    rounds,
    repairs: Math.max(0, rounds.length - 1),
    ms,
    ...(firstShell !== undefined ? { shellMs: firstShell } : {}),
    costUsd,
    ...(looks ? { looks } : {}),
  };
}
