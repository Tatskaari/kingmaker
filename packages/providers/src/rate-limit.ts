/** Retry-After is either seconds or an HTTP date. Never shorten a server delay. */
export function retryDelay(value: string | null, attempt: number, now = Date.now()): number {
  if (value?.trim()) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  // A minute-window limit needs a meaningful cooldown, not an immediate retry.
  return Math.min(60_000 * 2 ** attempt, 240_000) + Math.floor(Math.random() * 1000);
}

async function waitUntil(deadline: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  // Chunk long HTTP-date delays to avoid setTimeout's signed 32-bit overflow.
  while (Date.now() < deadline) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal!.reason); };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, Math.min(deadline - Date.now(), 2_147_483_647));
      signal?.addEventListener("abort", abort, { once: true });
    });
    signal?.throwIfAborted();
  }
}

/** Retry only rejected requests, never replay a successful response or tool write. */
export async function recoverRateLimit(
  send: () => Promise<Response>,
  signal?: AbortSignal,
  onRetry?: (delayMs: number, retry: number) => void,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const response = await send();
    if (response.status !== 429 || attempt === 5) return response;
    const delay = retryDelay(response.headers.get("Retry-After"), attempt);
    onRetry?.(delay, attempt + 1);
    await response.body?.cancel();
    await waitUntil(Date.now() + delay, signal);
  }
}
