import type { Endpoint } from "../../shared/protocol/ai.ts";

/**
 * One dispatch of a think (v0-design §3.5): what run_job claims from a job row, and what its POST
 * came to. index.ts's postToAi makes the POST with SpacetimeDB's fetch; the memory host makes it
 * with its own; both read the answer with outcomeOf, so the job loop sees the same outcomes on both.
 */

/** A job claimed for one dispatch (claimJob's answer): the request as the job row stored it. */
export interface Claim {
  jobId: bigint;
  key: string;
  endpoint: Endpoint;
  /** JSON: the POST body. */
  request: string;
  timeoutMs: number;
  /** This dispatch's number, from 1: the X-Km-Attempt header. */
  attempt: number;
}

/**
 * What a POST came to: an answer to commit; something to try again (429, 5xx, a refused or reset
 * connection, a timeout, an answer that isn't JSON); or something trying again won't mend (another
 * status, no AI_URL), which fails the turn.
 */
export type AiOutcome =
  | { kind: "answer"; status: 200; answer: unknown; replayed: boolean }
  | { kind: "retry"; status?: number; reason: string }
  | { kind: "fatal"; status?: number; reason: string };

/** What came back: a status and body (and whether the service answered from its store), or the error the request threw. */
export type AiResponse = { status: number; body: string; replayed?: boolean } | { error: string };

export function outcomeOf(response: AiResponse): AiOutcome {
  if ("error" in response) return { kind: "retry", reason: response.error };

  const { status, body } = response;
  if (status === 200) return answerOf(body, response.replayed ?? false);

  const reason = `${status} ${errorIn(body)}`;
  return status === 429 || status >= 500 ? { kind: "retry", status, reason } : { kind: "fatal", status, reason };
}

/** No AI_URL: nothing to POST to, and trying again won't change that. */
export const NOT_CONFIGURED: AiOutcome = { kind: "fatal", reason: "the AI service isn't configured (no AI_URL)" };

function answerOf(body: string, replayed: boolean): AiOutcome {
  try {
    return { kind: "answer", status: 200, answer: JSON.parse(body) as unknown, replayed };
  } catch {
    return { kind: "retry", status: 200, reason: "200 with an answer that isn't JSON" };
  }
}

/** The AI service's error ({ error: { code, message } }) in a few words, or the body's start. */
function errorIn(body: string): string {
  try {
    const { error } = JSON.parse(body) as { error?: { code?: string; message?: string } };
    if (error?.code) return `${error.code}: ${error.message ?? ""}`.trim();
  } catch {
    // not the service's JSON: a proxy's page, or nothing
  }
  return body.slice(0, 200);
}
