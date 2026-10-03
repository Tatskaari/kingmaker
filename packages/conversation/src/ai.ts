import { OutputTokenLimitError, ProviderResponseError } from "../../providers/src/openrouter.js";
import type { AiService } from "./services.js";

/** Retry a failed response once without replaying gameplay or presentation effects. */
export function retryResponses(respond: AiService["responses"]): AiService["responses"] {
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
      const response = await respond(truncated
        ? { ...request, max_tokens: (request.max_tokens ?? 2000) * 2 } : request, signal, info);
      signal?.throwIfAborted();
      return response;
    }
  };
}
