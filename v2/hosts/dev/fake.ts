import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";

/**
 * What npm run dev -- --fake plays (v5-design §3.10): fake.json's options for the fake model, a game
 * that looks like one on real models (the GM's golden replies, written notes, suggested lines, and
 * each model call taking about as long as a model's), with KM_AI_FAKE's options on top.
 */

/** fake.json without its `about`. */
export function devFake(): FakeOptions {
  const { about: _about, ...fake } = JSON.parse(readFileSync(join(import.meta.dirname, "fake.json"), "utf8")) as FakeOptions & { about?: string };
  return fake;
}

/**
 * --fake's options: fake.json's, KM_AI_FAKE's (JSON) on top ('{"streamMs":0}' answers at once). The
 * answers and delays by a call's name are put beside fake.json's, name by name, so answers given for
 * character creation's calls (v1's recipe of the prototype's own) keep the notes' answer. Throws,
 * saying so, when KM_AI_FAKE isn't JSON.
 */
export function fakeOptions(own: string | undefined): FakeOptions {
  if (!own) return devFake();
  let options: FakeOptions;
  try {
    options = JSON.parse(own) as FakeOptions;
  } catch {
    throw new Error(`KM_AI_FAKE isn't JSON: ${own}`);
  }
  const fake = devFake();
  return {
    ...fake, ...options,
    ...(options.byName ? { byName: { ...fake.byName, ...options.byName } } : {}),
    ...(options.byNameDelayMs ? { byNameDelayMs: { ...fake.byNameDelayMs, ...options.byNameDelayMs } } : {}),
  };
}
