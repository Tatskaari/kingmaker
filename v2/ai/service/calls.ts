import { fakeFetch, type FakeOptions } from "../llm/fake-openrouter.ts";
import type { CallContext } from "../llm/openrouter.ts";
import type { Usage } from "../../shared/protocol/ai.ts";
import type { CallLog, Ledger } from "./stores.ts";

/**
 * A request's model calls (v0-design §5.4): the model client's call context, made fresh for each
 * request so that nothing of one game's calls reaches another's. Every call goes to the game's call
 * log with the request's key and attempt (so a test can count what a key cost), and every cost to the
 * ledger and to the request's usage, which its answer carries back to the simulation.
 */

/** How a request's calls reach a model: OpenRouter with the key, or a stand-in's fetch. */
export interface Transport { fetch?: typeof fetch; apiKey?: string }

/**
 * How each request's calls go out: to OpenRouter with the key, or to a stand-in made for the request
 * (nothing of it outlives the request), its replies beginning at the turn's number, so that a game on
 * the stand-in hears its replies in turn, and the same turn always hears the same one. Its suggested
 * lines, given as several sets, begin there too: a set is never offered twice running, so the same
 * set every turn would be dropped every other turn as offered last time.
 */
export function transports(model: "openrouter" | "fake", options: { apiKey?: string | undefined; fake: FakeOptions }): (turn: number) => Transport {
  if (model === "openrouter") return () => (options.apiKey ? { apiKey: options.apiKey } : {});
  return turn => ({ fetch: fakeFetch(startingAt(options.fake, turn)).fetch, apiKey: "fake" });
}

/** The stand-in's replies, and its sets of suggested lines, the turn's first. */
function startingAt(fake: FakeOptions, turn: number): FakeOptions {
  const turned = <T>(list: T[]) => { const at = turn % list.length; return [...list.slice(at), ...list.slice(0, at)]; };
  return {
    ...fake,
    ...(fake.replies?.length ? { replies: turned(fake.replies) } : {}),
    ...(Array.isArray(fake.suggestions) && fake.suggestions.length ? { suggestions: turned(fake.suggestions) } : {}),
  };
}

/** Whose calls these are. */
export interface CallsFor { game: string; key: string; attempt: number }

export function callContext(transport: Transport, logs: { calls: CallLog; ledger: Ledger }, owner: CallsFor): { calls: CallContext; usage(): Usage } {
  const usage: Usage = { calls: 0, costUsd: 0, byOperation: {} };
  const stamp = () => ({ at: new Date().toISOString(), key: owner.key, attempt: owner.attempt });

  const calls: CallContext = {
    ...transport,
    log: entry => logs.calls.append(owner.game, { ...stamp(), ...entry }),
    cost: line => {
      count(usage, line.operation, line.costUsd, line.latencyMs);
      logs.ledger.append({ ...stamp(), game: owner.game, ...line });
    },
  };

  return { calls, usage: () => structuredClone(usage) };
}

/**
 * No calls at all: the canned endpoints' usage. (A stored answer is sent again as it was kept, with
 * the usage of the run that made it, and the module counts that once: the run's own answer never
 * reached a commit.)
 */
export const noUsage = (): Usage => ({ calls: 0, costUsd: 0, byOperation: {} });

function count(usage: Usage, operation: string, costUsd: number, ms: number): void {
  const op = (usage.byOperation[operation] ??= { calls: 0, costUsd: 0, ms: 0 });
  op.calls++;
  op.costUsd += costUsd;
  op.ms += Math.round(ms);
  usage.calls++;
  usage.costUsd += costUsd;
}
