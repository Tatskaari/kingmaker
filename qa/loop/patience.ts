import { viewWhen, type Backend } from "../../client/backend.ts";
import * as verbs from "../../client/headless.ts";
import type { SceneView } from "../../client/scene/view.ts";
import type { Wait } from "./record.ts";

/**
 * Waiting on the GM, for the loop's verbs. The game already tries again by itself: the module asks
 * the AI service again (every 15 s for ten minutes) when a model call fails, which is what happens
 * while OpenRouter turns calls away with a 402 because the key's in-flight spending cap is spent
 * (in_flight_budget_exhausted: several games at once hit it for half a minute or so). The headless
 * verbs wait three minutes at most, so the loop waits on, a backoff at a time, carries a failed turn
 * on (retry_turn), and logs each wait on the turn. The day's ceiling (KM_AI_DAILY_USD) isn't waited on.
 */

/** Before each try again: then it's given up. */
export const BACKOFF_MS = [20_000, 40_000, 80_000, 160_000];

/** What the loop waits with: the clock, sleeping (a test's goes at once), and the turn's log of waits. */
export interface Patience { sleep(ms: number): Promise<void>; now(): Date; waits: Wait[]; backoff?: number[] }

/** Where a verb's words go when nobody needs them; or kept, to say what went wrong. */
export const QUIET: verbs.Out = { print: () => {}, progress: () => {} };
export function capture(): verbs.Out & { printed: string } {
  const out = { printed: "", print: (text: string) => { out.printed += `${text}\n`; }, progress: () => {} };
  return out;
}

/** The verbs wait for the world to settle behind a reply, so the next line starts clean. */
export const SETTLED: verbs.Waiting = { settled: true };

/** A verb's outcome: its exit code, or that it stopped waiting before the answer came. */
interface Tried { code: number; timedOut?: boolean }

/**
 * A verb that waits on the GM, run until its answer is in: when it stops waiting first, or the turn
 * (or the story between scenes) failed for anything but the day's ceiling, it waits a backoff and
 * carries on (`carryOn`), each wait logged. The code it ends with, once it needs no more waiting or
 * the backoffs have run out.
 */
export async function patiently(conn: Backend, first: () => Promise<number>, carryOn: (conn: Backend) => Promise<number>, patience: Patience): Promise<number> {
  let tried = await attempt(first);
  for (const ms of patience.backoff ?? BACKOFF_MS) {
    const why = worthWaiting(tried, conn.view());
    if (!why) return tried.code;
    patience.waits.push({ at: patience.now().toISOString(), why, ms });
    await patience.sleep(ms);
    tried = await attempt(() => carryOn(conn));
  }
  return tried.code;
}

/** Why it's worth waiting and trying again, or undefined when it isn't: the answer's in, it was refused, or the day's money is spent. */
export function worthWaiting(tried: Tried, view: SceneView | undefined): string | undefined {
  if (tried.timedOut) return `no answer yet${view?.note ? `: ${view.note}` : ""} (the call log says why)`;
  if (tried.code === 0) return undefined;
  if (view?.phase === "failed" && view.failed !== undefined && !ceiling(view.failed)) return `the turn failed: ${view.failed}`;
  if (view?.story?.onward === "failed") return `the story got stuck between scenes${view.story.note ? `: ${view.story.note}` : ""}`;
  return undefined;
}

/** The day's ceiling on what the models cost (402 over_budget), in the words the game says it in: no wait mends it. */
export const ceiling = (words: string) => /spent today's budget/i.test(words);

/** A turn carried on: a failed one tried again (retry_turn), one in flight waited for until it's done. */
export async function carryTurnOn(conn: Backend): Promise<number> {
  if (conn.view()?.phase === "failed") return await verbs.retry(conn, QUIET, SETTLED);
  const view = await viewWhen(conn, v => v.phase === "failed" || v.over || (!v.ending && v.phase === "done"), verbs.TURN_MS);
  return view.phase === "failed" ? 1 : 0;
}

/** The story between scenes carried on: a boundary that got stuck tried again (go's carry_on); one moving on, waited for; else as a turn. */
export async function carryStoryOn(conn: Backend): Promise<number> {
  const view = conn.view();
  if (view?.story?.onward === "failed") return await verbs.go(conn, QUIET, SETTLED);
  if (view?.over && (view.story?.onward === "moving" || view.story?.onward === "waiting")) {
    await viewWhen(conn, v => v.story?.onward !== "moving" && v.story?.onward !== "waiting", verbs.TURN_MS);
    return 0;
  }
  return await carryTurnOn(conn);
}

/** The verb run, its waiting cut short (the verbs' "No answer in 180 s") told apart from a failure. */
async function attempt(run: () => Promise<number>): Promise<Tried> {
  try {
    return { code: await run() };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No answer in")) return { code: 1, timedOut: true };
    throw error;
  }
}
