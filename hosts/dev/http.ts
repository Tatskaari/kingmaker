/**
 * HTTP for the stack's tools: an answer or why there was none, never a throw, so each caller says
 * in its own words what didn't answer.
 */

export type Answer = { status: number; body: string; headers: Headers } | { error: string };

export async function request(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Answer> {
  const { timeoutMs = 10_000, ...rest } = init;
  try {
    const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: await res.text(), headers: res.headers };
  } catch (e) {
    return { error: reason(e) };
  }
}

/** A fetch failure as words: "connect ECONNREFUSED 127.0.0.1:8787", not "fetch failed". */
export function reason(e: unknown): string {
  const err = e as Error & { cause?: Error & { code?: string } };
  if (err.name === "TimeoutError") return "no answer in time";
  return err.cause?.message ?? err.message ?? String(e);
}

/** The bearer header for a token. */
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Waits until `ready()` says so, polling; false when the time runs out or `gaveUp()` says to stop (the process died). */
export async function waitFor(ready: () => Promise<boolean>, options: { timeoutMs: number; everyMs?: number; gaveUp?: () => boolean }): Promise<boolean> {
  const until = Date.now() + options.timeoutMs;
  while (Date.now() < until) {
    if (await ready()) return true;
    if (options.gaveUp?.()) return false;
    await new Promise(r => setTimeout(r, options.everyMs ?? 200));
  }
  return ready();
}
