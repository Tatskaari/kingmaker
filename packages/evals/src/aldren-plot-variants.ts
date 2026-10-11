import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMarkdown } from "../../lore/src/markdown.js";
import { renderCatalogPrompt, renderPrompt } from "../../prompts/src/index.js";
import { reviewPromptContext } from "../../conversation/src/review-prompt-context.js";
import { reviewDocumentEvidence } from "../../conversation/src/document-review.js";
import { gameMasterTools, queryDocumentsTool } from "../../conversation/src/gm-tools.js";
import { activityTools } from "../../conversation/src/activity-tools.js";
import { directConversationStrategy } from "../../conversation/src/phases.js";
import type { ReviewVariant } from "./review-experiment.js";

const overlay = resolve(import.meta.dirname, "../../../evals/reviews/aldren-plot/variants/prompt/lore");
const template = parseMarkdown(readFileSync(`${overlay}/gm_prompts/conversation/review/review-plot-progress.md`, "utf8")).body;
export const aldrenPlotVariants: ReviewVariant[] = [
  { name: "prompt", prompt: true, sql: false },
  { name: "sql", prompt: false, sql: true },
  { name: "sql-and-prompt", prompt: true, sql: true },
].map(variant => ({ name: variant.name, overlays: variant.prompt ? [overlay] : [], strategies: {
  conversation: directConversationStrategy,
  review: {
    classify: async () => ({ plot_progress: { choice: "flagged" } }),
    resolve: (context, labels, signal, services) => {
      const values = reviewPromptContext(context, services);
      const purpose = variant.prompt ? renderCatalogPrompt({ candidate: template }, "candidate", values)
        : renderPrompt("review-plot-progress", values);
      const tools = gameMasterTools.filter(tool => !activityTools.some(activity => activity.function.name === tool.function.name));
      return reviewDocumentEvidence(context, labels, signal, { ...services, ai: { ...services.ai,
        responses: (request, cancellation, info) => services.ai.responses({ ...request, reasoning: { effort: "high" } },
          cancellation, { ...info, purpose: "conversation_review" }),
      } }, purpose, { systemPrompt: renderPrompt("review-system"), tools: variant.sql ? [...tools, queryDocumentsTool] : tools });
    },
  },
} }));
