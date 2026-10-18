import type { FakeOptions } from "../llm/fake-openrouter.ts";
import { CREATION_STEPS, STEPS, type CreationStep, type Step } from "../../shared/protocol/keys.ts";

/**
 * The AI service's configuration (v0-design §5.7), from its environment. Only hosts/ai.ts reads the
 * environment; everything else is handed what it needs from here.
 *
 * | Env | Default | What |
 * |---|---|---|
 * | KM_AI_LISTEN | 127.0.0.1:8787 | comma-separated host:ports (host mode: 11.0.0.1:8787,127.0.0.1:8787) |
 * | KM_AI_TOKEN | required | the bearer the module sends |
 * | KM_AI_STORE | runs/ai | the folder store |
 * | KM_STDB_URL, KM_STDB_DB, KM_STDB_TOKEN | http://127.0.0.1:3300, kingmaker, none | where stream_reply goes, as which identity |
 * | OPENROUTER_API_KEY | ~/secrets/kingmaker-dev-openrouter.txt (the host reads it) | the only key |
 * | KM_AI_MODEL, KM_AI_FAKE | openrouter, {} | fake: the stand-in for OpenRouter, with these options |
 * | KM_AI_GM | pipeline | canned: the thinks with no model at all |
 * | KM_AI_STREAM_MS | 200 | the stream's period |
 * | KM_AI_DAILY_USD | 5 | the daily ceiling on what the models cost, in dollars, from the ledger (0: none) |
 * | KM_AI_FAULTS | none | exit-after-store:<a step, or any> (tests only): open, reactions, reply, settle, suggest, remember, repair, or a creation's offer, pick, own, draft, work, check, traits |
 */
export interface AiConfig {
  listen: Array<{ host: string; port: number }>;
  token: string;
  store: string;
  stdb: { url: string; db: string; token?: string };
  model: "openrouter" | "fake";
  fake: FakeOptions;
  /** OPENROUTER_API_KEY; the host fills it from the key file when the environment has none. */
  apiKey?: string;
  gm: "pipeline" | "canned";
  streamMs: number;
  /** The daily ceiling, in dollars (0: none). */
  dailyUsd: number;
  faults: Faults;
}

/** What the tests ask the process to do wrong on purpose: exit (code 137) right after storing an answer of this step, before sending it. */
export interface Faults { exitAfterStore?: Step | CreationStep | "any" }

export function readConfig(env: Record<string, string | undefined>): AiConfig {
  const token = env.KM_AI_TOKEN?.trim();
  if (!token) throw new Error("KM_AI_TOKEN is required: the bearer the module sends (its AI_TOKEN)");

  return {
    listen: listenOf(env.KM_AI_LISTEN ?? "127.0.0.1:8787"),
    token,
    store: env.KM_AI_STORE || "runs/ai",
    stdb: { url: (env.KM_STDB_URL || "http://127.0.0.1:3300").replace(/\/+$/, ""), db: env.KM_STDB_DB || "kingmaker", ...(env.KM_STDB_TOKEN ? { token: env.KM_STDB_TOKEN } : {}) },
    model: oneOf("KM_AI_MODEL", env.KM_AI_MODEL || "openrouter", ["openrouter", "fake"] as const),
    fake: fakeOf(env.KM_AI_FAKE),
    ...(env.OPENROUTER_API_KEY?.trim() ? { apiKey: env.OPENROUTER_API_KEY.trim() } : {}),
    gm: oneOf("KM_AI_GM", env.KM_AI_GM || "pipeline", ["pipeline", "canned"] as const),
    streamMs: numberOf("KM_AI_STREAM_MS", env.KM_AI_STREAM_MS ?? "200"),
    dailyUsd: dollarsOf("KM_AI_DAILY_USD", env.KM_AI_DAILY_USD || "5"),
    faults: faultsOf(env.KM_AI_FAULTS),
  };
}

/** "11.0.0.1:8787,127.0.0.1:8787", an IPv6 host in brackets ("[::1]:8787"). */
function listenOf(text: string): AiConfig["listen"] {
  return text.split(",").map(s => s.trim()).filter(Boolean).map(address => {
    const m = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(address);
    if (!m) throw new Error(`KM_AI_LISTEN: "${address}" isn't host:port`);
    return { host: m[1] ?? m[2]!, port: Number(m[3]) };
  });
}

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${name}: "${value}" isn't one of ${allowed.join(", ")}`);
  return value as T;
}

function numberOf(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name}: "${value}" isn't a number of milliseconds`);
  return n;
}

function dollarsOf(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name}: "${value}" isn't a number of dollars (0 for no ceiling)`);
  return n;
}

function fakeOf(text: string | undefined): FakeOptions {
  if (!text) return {};
  try { return JSON.parse(text) as FakeOptions; } catch { throw new Error(`KM_AI_FAKE isn't JSON: ${text.slice(0, 80)}`); }
}

/** Every step a fault can name: a turn's think, or a creation's. */
const FAULT_STEPS: readonly string[] = [...STEPS, ...CREATION_STEPS];

function faultsOf(text: string | undefined): Faults {
  if (!text) return {};
  const m = /^exit-after-store:(\w+)$/.exec(text.trim());
  const step = m?.[1];
  if (!step || !(step === "any" || FAULT_STEPS.includes(step))) throw new Error(`KM_AI_FAULTS: "${text}" isn't exit-after-store:<${FAULT_STEPS.join("|")}|any>`);
  return { exitAfterStore: step as Faults["exitAfterStore"] };
}
