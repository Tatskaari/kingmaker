import type { Health } from "../../shared/protocol/ai.ts";
import { Failure } from "./context.ts";
import type { Ledger } from "./stores.ts";

/**
 * The daily ceiling on what the models cost (v1-design §3.7): KM_AI_DAILY_USD ($5 unless it's set;
 * 0 for none), held against what the ledger says today's (UTC) calls have cost. Over it, a think
 * that would call a model is refused before it does (402 over_budget), and the game fails the move
 * in these words. An answer kept by its key is still served, and a think already running may go
 * over by its own cost. One ledger's ceiling: right for one process, until a hosted ledger.
 */
export interface Budget {
  /** The ceiling and today's spend so far, for health. */
  health(): Promise<Health["budget"]>;
  /** A 402 over_budget once today's spend has reached the ceiling. */
  check(): Promise<void>;
}

export function budget(dailyUsd: number, ledger: Pick<Ledger, "spentToday">): Budget {
  return {
    async health() {
      return { dailyUsd, spentToday: toMicros(await ledger.spentToday()) };
    },
    async check() {
      if (dailyUsd <= 0) return;
      if ((await ledger.spentToday()) >= dailyUsd) throw new Failure(402, "over_budget", overBudget(dailyUsd));
    },
  };
}

/** What the player is told: the game fails the move with these words. */
export const overBudget = (dailyUsd: number) => `The GM has spent today's budget (${dollars(dailyUsd)}): it starts again at midnight UTC, or raise KM_AI_DAILY_USD.`;

/** Dollars to the cent, or to the hundredth of a cent below one ($0.0010: a ceiling set low to try it). */
export const dollars = (usd: number) => `$${usd.toFixed(usd > 0 && usd < 0.01 ? 4 : 2)}`;

/** To the millionth of a dollar: a sum of costs carries float noise past that. */
const toMicros = (usd: number) => Math.round(usd * 1e6) / 1e6;
