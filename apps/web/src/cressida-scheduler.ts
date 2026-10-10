import { CRESSIDA_HUMAN_MS, CRESSIDA_COW_MS, CRESSIDA_WARNING_MS } from "../../../packages/core/src/cressida-transformation.js";
import { WaitScheduler } from "./wait-scheduler.js";

export interface CressidaTimer { next: "warning" | "cow" | "human"; dueAt: number }
export type CressidaTransition = "warning" | "human";
/** Reuse the NPC clock, but never wait for model review before changing the body. */
export function cressidaScheduler(options: {
  activeKey(): string | undefined;
  isCow(): boolean;
  transform(signal: AbortSignal): Promise<void>;
  review(stage: CressidaTransition, signal: AbortSignal): Promise<void>;
  error(error: unknown): void;
  changed?(timer: CressidaTimer | null): void;
}) {
  let warned = false, reaction: AbortController | undefined;
  const review = (stage: CressidaTransition, signal: AbortSignal) => {
    reaction?.abort(); reaction = new AbortController();
    const cancellation = AbortSignal.any([signal, reaction.signal]);
    void options.review(stage, cancellation).catch(error => { if (!cancellation.aborted) options.error(error); });
  };
  const scheduler = new WaitScheduler({
    candidates: () => { const key = options.activeKey(); return key === undefined ? new Map() : new Map([["cressida", key]]); },
    busy: () => false,
    delayMs: () => {
      const delay = options.isCow() ? CRESSIDA_COW_MS
        : warned ? CRESSIDA_WARNING_MS : CRESSIDA_HUMAN_MS - CRESSIDA_WARNING_MS;
      options.changed?.({ next: options.isCow() ? "human" : warned ? "cow" : "warning", dueAt: Date.now() + delay });
      return delay;
    },
    run: async (_id, _elapsed, signal) => {
      if (!options.isCow() && !warned) { warned = true; review("warning", signal); return; }
      reaction?.abort();
      await options.transform(signal);
      warned = false;
      if (!signal.aborted && !options.isCow()) review("human", signal);
    },
    error: (_id, error) => options.error(error),
  });
  return { sync: () => scheduler.sync(), stop: () => { scheduler.stop(); reaction?.abort(); warned = false; options.changed?.(null); } };
}
