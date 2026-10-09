import { ProviderResponseError } from "../../providers/src/openrouter.js";
import { gameLogger } from "../../observability/src/logging.js";
import type { AiService } from "./services.js";

export function warnResponseRetry(model: string, error: unknown, onWarning: (message: string) => void = () => {}) {
  const reason = error instanceof Error ? error.message : String(error);
  const message = `AI provider, ${model}: retry 1/1. ${reason}`;
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
      if (!(error instanceof ProviderResponseError && error.retryable) && !(error instanceof TypeError)
        && !(error instanceof Error && error.name === "TimeoutError")) throw error;
      warnResponseRetry(request.model, error, onWarning);
      const response = await respond(request, signal, info);
      signal?.throwIfAborted();
      return response;
    }
  };
}
