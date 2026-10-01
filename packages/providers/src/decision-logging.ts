import { gameLogger } from "../../observability/src/logging.js";

const log = gameLogger("decisions");

/** Covers direct provider users as well as runtime calls and evals. */
export async function logDecision<T>(provider: string, request: unknown, apiKey: string, call: () => Promise<T>, operation = "unspecified operation"): Promise<T> {
  const requestId = crypto.randomUUID(), started = Date.now();
  const clean = (value: unknown): unknown => {
    let json = JSON.stringify(value) ?? "null";
    for (const key of new Set([apiKey, apiKey.trim()])) {
      if (key) json = json.split(JSON.stringify(key).slice(1, -1)).join("[redacted]");
    }
    return JSON.parse(json.replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]"));
  };
  const callType = provider === "jev" ? "JEV" : "LLM";
  const fields = { requestId, provider, callType, operation };
  log.debug(`${callType}: ${operation} requested`, { ...fields, request: clean(request) });
  try {
    const response = await call();
    log.debug(`${callType}: ${operation} returned`, { ...fields, durationMs: Date.now() - started, response: clean(response) });
    return response;
  } catch (error) {
    log.error(`${callType}: ${operation} failed`, { ...fields, durationMs: Date.now() - started,
      error: clean(error instanceof Error ? error.message : String(error)) });
    throw error;
  }
}
