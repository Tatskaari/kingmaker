import { renderPrompt } from "../../../packages/prompts/src/index.js";
import { PRESENTATION_GUIDANCE } from "../../../packages/lore/src/presentation.js";
import type { ChatCompletionRequest } from "../../../packages/providers/src/openrouter.js";
import type { ModelCallKind } from "./model-transcripts.js";

export const GM_BASE_PROMPT = renderPrompt("gm-prompt-gm_base_prompt");

export const GM_ADJUDICATION_GUIDANCE = renderPrompt("gm-prompt-gm_adjudication_guidance", { PRESENTATION_GUIDANCE: PRESENTATION_GUIDANCE });

// Every new model-call kind must explicitly declare whether it speaks as GM.
const gmCalls: Record<ModelCallKind, boolean> = {
  conversation_attention: false, conversation_tree: false,
  skill_check: false, skill_difficulty: false, prog_disc: false,
  game_master: true, gm_consultation: true, conversation_review: true,
  npc_resolution: true, outcome_review: true, world_event: true,
  dialogue: false, dialogue_flavour: false, npc_request: false, event_decision: false, jev: false, conversation_check: false, conversation_expression: false,
};

export function withGmBasePrompt(kind: ModelCallKind, request: ChatCompletionRequest): ChatCompletionRequest {
  if (!gmCalls[kind]) return request;
  return { ...request, messages: [
    { role: "system", content: GM_BASE_PROMPT },
    { role: "system", content: GM_ADJUDICATION_GUIDANCE },
    ...request.messages.filter(message => message.role !== "system" || ![GM_BASE_PROMPT, GM_ADJUDICATION_GUIDANCE].includes(message.content ?? "")),
  ] };
}
