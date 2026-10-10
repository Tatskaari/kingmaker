import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMarkdown } from "../../lore/src/markdown.js";
import { renderPrompt } from "../../prompts/src/index.js";
import { defaultWorldStrategies } from "../../../apps/web/src/world-strategies.js";
import { loadTranscriptFixture } from "./transcript-fixture.js";
import type { ReviewVariant } from "./review-experiment.js";

/** Temporary file-based prompt comparison; the game's prompt catalog remains unchanged. */
export function corvinInquiryCandidate(): ReviewVariant {
  const fixture = loadTranscriptFixture(resolve(import.meta.dirname, "../../../evals/reviews/corvin-inquiry/fixture.json"));
  const path = resolve(fixture.overlay, "gm_prompts/conversation/review/review-activity.md");
  const override = parseMarkdown(readFileSync(path, "utf8"));
  if (override.error || !override.body.trim()) throw new Error(`Invalid activity prompt override: ${path}`);
  const before = renderPrompt("review-activity");
  return { name: "working-tree", strategies: { setup: { prepare: (context, signal, services) =>
    defaultWorldStrategies.setup.prepare(context.agent === "game_master" ? { ...context,
      messages: context.messages.map(message => message.role === "system" && message.content === before
        ? { ...message, content: override.body } : message),
    } : context, signal, services) } } };
}
