import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import { transports, type Transport } from "../../ai/service/calls.ts";

/**
 * How the AI service's model calls go out from the page host (browser-design §5): to the fake GM
 * (hosts/dev/fake.json's canned replies, which don't answer what's said: no key, no cost), or to
 * OpenRouter with the player's key. The key lives in this closure and goes nowhere but a call's
 * Authorization header: the page posts it in start and key, the client worker never sees it, and
 * nothing the page host says or keeps has it in. Each call goes through guardedFetch: with no key,
 * OpenRouter isn't asked (a 401 made here, as it would answer); a 401 from OpenRouter is the page's
 * to hear (key-refused: it asks for another); and a call that fails is told without the key.
 */
export interface Model {
  readonly name: "openrouter" | "fake";
  /** How a request's calls go out (the AI service's transport). */
  transport(turn: number): Transport;
  /** A new key from the page: the next call carries it. */
  setKey(key: string): void;
  /** Text with the key taken out (and anything else shaped like one). */
  redact(text: string): string;
}

const OPENROUTER = "https://openrouter.ai/";

export function fakeModel(fake: FakeOptions): Model {
  return { name: "fake", transport: transports("fake", { fake }), setKey: () => {}, redact: text => redact(text) };
}

export function keyModel(key: string | undefined, refused: () => void, send: typeof fetch = globalThis.fetch.bind(globalThis)): Model {
  let current = key?.trim() ?? "";

  const guardedFetch: typeof fetch = async (input, init) => {
    const toOpenRouter = urlOf(input).startsWith(OPENROUTER);
    if (toOpenRouter && !current) return noKey();
    const response = await send(input, init).catch((error: unknown) => { throw redacted(error, current); });
    if (toOpenRouter && response.status === 401) refused();
    return response;
  };

  return {
    name: "openrouter",
    transport: () => ({ apiKey: current, fetch: guardedFetch }),
    setKey(next) {
      if (next.trim()) current = next.trim();
    },
    redact: text => redact(text, current),
  };
}

/** Text with `key` taken out, and anything else shaped like an OpenRouter key. */
export function redact(text: string, key = ""): string {
  const without = key ? text.split(key).join("[redacted]") : text;
  return without.replace(/sk-or-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

/** OpenRouter's answer to a call with no key, made here: no request leaves the page. */
function noKey(): Response {
  const body = { error: { message: "There's no OpenRouter key here, so the GM can't speak.", code: 401 } };
  return new Response(JSON.stringify(body), { status: 401, headers: { "content-type": "application/json" } });
}

/** A call's failure as the model client sees it (its name kept: an abort is still an abort), without the key. */
function redacted(error: unknown, key: string): Error {
  const told = new Error(redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error), key));
  if (error instanceof Error) told.name = error.name;
  return told;
}

const urlOf = (input: RequestInfo | URL) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
