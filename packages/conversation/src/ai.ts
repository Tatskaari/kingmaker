import { OutputTokenLimitError, ProviderResponseError } from "../../providers/src/openrouter.js";
import { gameLogger } from "../../observability/src/logging.js";
import type { AiService } from "./services.js";

export function warnResponseRetry(model: string, error: unknown, onWarning: (message: string) => void = () => {}) {
  const reason = error instanceof Error ? error.message : String(error);
  const adjustment = error instanceof OutputTokenLimitError ? " with twice the output token limit" : "";
  const message = `AI provider, ${model}: retry 1/1${adjustment}. ${reason}`;
  gameLogger("providers").warning(message, { model, retry: 1 });
  onWarning(message);
}

/** Retry a failed response once without replaying gameplay or presentation effects. */
export function retryResponses(respond: AiService["responses"], onWarning: (message: string) => void = () => {}): AiService["responses"] {
  return async (request, signal, info) => {
    signal?.throwIfAborted();
    try {
      const response = await respond(request, signal, info);
      signal?.throwIfAborted();
      return response;
    } catch (error) {
      signal?.throwIfAborted();
      const truncated = error instanceof OutputTokenLimitError;
      if (!truncated && !(error instanceof ProviderResponseError && error.retryable) && !(error instanceof TypeError)
        && !(error instanceof Error && error.name === "TimeoutError")) throw error;
      warnResponseRetry(request.model, error, onWarning);
      const response = await respond(truncated
        ? { ...request, max_tokens: (request.max_tokens ?? 2000) * 2 } : request, signal, info);
      signal?.throwIfAborted();
      return response;
    }
  };
}
