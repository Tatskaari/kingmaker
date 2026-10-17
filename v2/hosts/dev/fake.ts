import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import file from "./fake.json" with { type: "json" };

/**
 * What npm run dev -- --fake plays (v5-design §3.10): fake.json's options for the fake model, a game
 * that looks like one on real models (the GM's golden replies, written notes, suggested lines, and
 * each model call taking about as long as a model's), with KM_AI_FAKE's options on top. fake.json is
 * a JSON module, so nothing here touches Node: the page's server worker plays the same fake.
 */

/** fake.json without its `about`: a copy of its own, for a caller to change. */
export function devFake(): FakeOptions {
  const { about: _about, ...fake } = structuredClone(file) as FakeOptions & { about?: string };
  return fake;
}

/**
 * What KM_AI_FAKE adds to rather than replaces, name by name: the answers and delays by a call's name,
 * the decider's choices by question, and the tool loops' calls by their first tool.
 */
const BY_NAME = ["byName", "byNameDelayMs", "choices", "toolCalls"] as const;

/**
 * --fake's options: fake.json's, KM_AI_FAKE's (JSON) on top ('{"streamMs":0}' answers at once), as
 * onTop puts them: so answers given for character creation's calls (v1's recipe of the prototype's
 * own) keep the notes' answer, and '{"choices":{"roll_call":"new"}}' keeps the full GM's quiet
 * defaults (full-gm-design §4.4). Throws, saying so, when KM_AI_FAKE isn't JSON.
 */
export function fakeOptions(own: string | undefined): FakeOptions {
  if (!own) return devFake();
  let options: FakeOptions;
  try {
    options = JSON.parse(own) as FakeOptions;
  } catch {
    throw new Error(`KM_AI_FAKE isn't JSON: ${own}`);
  }
  return onTop(devFake(), options);
}

/**
 * Options on top of others, as KM_AI_FAKE goes on fake.json's: key by key, but the answers, delays,
 * choices and tool calls by name go beside the ones under them, name by name. A test's recipe goes on
 * fake.json's (or on quietGm's) this way, so a choice of its own keeps the full GM's quiet ones. A
 * choice that's a list goes in as it is (the whole story's recipe, story-design §1.1: the endings
 * "open-case", "hobb-talks", "fight", "caught-in-the-act" and "justice", each scene ending at the
 * first of them it has).
 */
export function onTop(under: FakeOptions, over: FakeOptions): FakeOptions {
  const below = under as Record<string, unknown>, above = over as Record<string, unknown>;
  const merged = { ...below, ...above };
  for (const key of BY_NAME) if (above[key]) merged[key] = { ...below[key] as object, ...above[key] as object };
  return merged as FakeOptions;
}

/**
 * fake.json's quiet answers for the full GM alone (full-gm-design §4.4, §6): the attention filter's
 * choices, the memories agent's call, the co-GM's answer and the ruling. A test that plays three
 * turns or more on a fake of its own puts them under it (onTop), or every line fires both memory
 * reviews and the co-GM moves the scene back to its first beat.
 */
export function quietGm(): FakeOptions {
  const fake = devFake() as FakeOptions & { toolCalls?: unknown };
  return { choices: fake.choices!, byName: { co_gm_notes: fake.byName!.co_gm_notes, ruling: fake.byName!.ruling }, ...(fake.toolCalls ? { toolCalls: fake.toolCalls } : {}) } as FakeOptions;
}
