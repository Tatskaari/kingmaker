import type { JsonValue } from "@bufbuild/protobuf";
import type { ScenarioService } from "../../../packages/lore/src/services.js";
import type { RuntimeServices } from "../../../packages/conversation/src/services.js";
import type { OpenRouterMessage, OpenRouterTool } from "../../../packages/providers/src/openrouter.js";
import type { WorldState } from "../../../packages/contracts/src/v2.js";
import { disclosedContext } from "../../../packages/conversation/src/disclosed-context.js";
import { strangerConfiguration, strangerLore } from "./stranger-lore.js";
import { strangerPrompt } from "./stranger-prompt.js";
import { interviewDraft } from "./stranger-draft.js";
import { playerBuildParameter } from "./player-build.js";
import { characterId } from "./world-projection.js";
import { REASONING_MODEL } from "./model-settings.js";

export interface StrangerState {
  history: OpenRouterMessage[];
  draft?: JsonValue;
  replies?: { options: string[]; compelled: false };
}
export function beginStranger(world: WorldState): StrangerState { return { history: [{ role: "assistant", content: strangerConfiguration(world).opening }] }; }
function tools(ids: string[], affiliations: string[]): OpenRouterTool[] {
  const relationships = { type: "array", minItems: ids.length, maxItems: ids.length, items: {
    type: "object", additionalProperties: false, required: ["characterId", "description"],
    properties: { characterId: { type: "string", enum: ids }, description: { type: "string" } },
  } };
  return [{ type: "function", function: { name: "offer_replies", description: "Offer optional first-person player suggestions. Call alone; never select an answer.",
    parameters: { type: "object", additionalProperties: false, required: ["options", "compelled"], properties: {
      options: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" } }, compelled: { const: false, type: "boolean" },
    } },
  } }, { type: "function", function: { name: "create_player", description: "After the player agrees they are ready, prepare an editable draft. Call alone. Only their explicit Save enters court.",
    parameters: { type: "object", additionalProperties: false,
      required: ["name", "gender", "homeland", "embassyRole", "lore", "currentGoal", "relationships", "npcViews", "build"], properties: {
        name: { type: "string" }, gender: { type: "string" }, homeland: { type: "string", enum: affiliations },
        embassyRole: { type: "string" }, lore: { type: "string" }, currentGoal: { type: "string" },
        relationships, npcViews: relationships, build: playerBuildParameter,
      } },
  } }];
}
/** The interview edits only a detached draft. Scenario services supply the live v2 setting. */
export async function strangerTurn(previous: StrangerState, text: string,
  scenario: ScenarioService, services: Pick<RuntimeServices, "ai" | "disclosure">, signal = new AbortController().signal): Promise<StrangerState> {
  if (scenario.info().player || previous.draft) throw new Error("Character creation is already complete or awaiting review.");
  if (!text.trim()) throw new Error("Say something first.");
  const state = structuredClone(previous);
  delete state.replies;
  state.history.push({ role: "user", content: text });
  const world = scenario.snapshot();
  const lore = await strangerLore(scenario);
  const cast = world.characters.map(path => ({ id: characterId(path, world), path }));
  const context = await disclosedContext(lore, [
    { role: "system", content: strangerPrompt },
    { role: "system", content: `Active character IDs for draft relationships (not prior acquaintance):\n${JSON.stringify(cast)}` },
    ...state.history,
  ], services, "gm", signal);
  const setup = context.slice(0, context.length - state.history.length);
  for (let pass = 0; pass < 5; pass++) {
    const reply = await services.ai.responses({ ...REASONING_MODEL, max_tokens: 8000,
      messages: [...setup, ...state.history],
      tools: tools(cast.map(item => item.id), strangerConfiguration(world).affiliations),
    }, signal);
    state.history.push(reply);
    if (!reply.tool_calls?.length) {
      if (!reply.content?.trim()) throw new Error("The Stranger returned an empty reply.");
      return state;
    }
    for (const call of reply.tool_calls) {
      let result: Record<string, unknown>;
      try {
        if (reply.tool_calls.length !== 1) throw new Error("Call a single creation or reply tool alone.");
        const input = JSON.parse(call.function.arguments) as Record<string, unknown>;
        if (call.function.name === "create_player") {
          state.draft = interviewDraft(input, world);
          result = { ok: true, instruction: "Wait for explicit review and Save. Do not narrate arrival." };
        } else if (call.function.name === "offer_replies") {
          if (input.compelled !== false || !Array.isArray(input.options) || input.options.length < 2 || input.options.length > 5
            || input.options.some(item => typeof item !== "string" || !item.trim())) throw new Error("Offer two to five optional replies; compulsion is unavailable.");
          if (state.replies) throw new Error("Replies already offered. Speak as the Stranger and wait.");
          state.replies = { options: input.options as string[], compelled: false };
          result = { ok: true, instruction: "Speak as the Stranger if you have not spoken, then wait. No reply is selected." };
        } else throw new Error("Unknown Stranger tool.");
      } catch (error) { result = { ok: false, error: String(error) }; }
      state.history.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
      if (state.draft) {
        delete state.replies;
        state.history.push({ role: "assistant", content: "Review your character before continuing." });
        return state;
      }
      if (result.ok && reply.content?.trim()) {
        state.history.push({ role: "assistant", content: reply.content });
        return state;
      }
    }
  }
  throw new Error("The Stranger used too many consecutive tool calls.");
}
