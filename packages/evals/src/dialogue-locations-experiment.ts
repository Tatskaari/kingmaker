import { isDeepStrictEqual } from "node:util";
import { WorldHost } from "../../../apps/web/src/world-host.js";
import { setupWorldAgent } from "../../../apps/web/src/agent-setup.js";
import type { AgentSetupHook } from "../../conversation/src/agent-setup.js";
import { prepareConversation } from "../../conversation/src/conversation.js";
import { DisclosureSession } from "../../conversation/src/disclosure.js";
import { runConversation } from "../../conversation/src/phases.js";
import { documentLoreService } from "../../conversation/src/document-lore.js";
import { createScenarioServices } from "../../lore/src/services.js";
import { loadPlayableWorld } from "../../../scripts/lib/playable-world.js";
import type { AiService } from "../../conversation/src/services.js";
import type { WorldState } from "../../contracts/src/v2.js";
import type { Experiment, RunRecording, RuntimeConfig } from "./experiment.js";

const question = "Where can I find Marshal Garran Holt?";
const rubric = [{
  name: "location",
  description: "The character answers with Holt's current location, the Entrance Hall or service entrance, without claiming uncertainty.",
}];

function response(recording: RunRecording): string {
  const call = recording.getServiceRecord("debug").find(call => call.method === "record");
  const output = (call?.args as Array<{ output?: { response?: string } }> | undefined)?.[0]?.output?.response;
  if (!output) throw new Error("No dialogue response recorded");
  return output;
}

export function scoreDialogueLocation(reply: string) {
  const correct = /\b(?:entrance hall|service entrance)\b/i.test(reply);
  return { score: Number(correct), reason: correct
    ? "The reply directs the player to Holt's current entrance location."
    : `The reply does not identify Holt's current entrance location: ${JSON.stringify(reply)}` };
}

/** Reproduce the report through the normal character setup and disclosure path. */
export function createDialogueLocationsExperiment(createAi: () => AiService): Experiment {
  const config = (name: string, setup: AgentSetupHook): RuntimeConfig => ({ name, configure() {
    const backing = createScenarioServices(loadPlayableWorld());
    return {
      recordServices: ["ai", "debug"],
      strategies: { setup: { prepare: setup } },
      services: {
        ai: () => createAi(),
        scenario: () => backing.scenario,
        docs: () => backing.docs,
        inventory: () => backing.inventory,
        map: services => ({ observe: id => new WorldHost(services.scenario.read()).map.observe(id) }),
        lore: services => documentLoreService(services.scenario),
        character: services => ({ respond: (request, signal) => services.ai.responses(request, signal, { purpose: "dialogue" }) }),
        debug: () => ({ record: () => {} }),
      },
    };
  } });
  return {
    name: "guard-holt-location", type: "conversation", rubric,
    getBaseline: () => config("game", setupWorldAgent),
    getVariants: () => [],
    async run(runtime, signal) {
      const world = runtime.services.scenario.read();
      const guard = world.simulation!.map!.actors.find(actor => actor.characterId.startsWith("palace-guard-")
        && actor.roomId === "great_hall")?.characterId;
      if (!guard) throw new Error("No Great Hall palace guard in the fixture");
      const lore = await runtime.services.lore.forCharacter(guard, signal);
      runtime.strategies.conversation = new DisclosureSession(lore, runtime.services.ai).strategy(() => {});
      const request = await prepareConversation({ world, characterId: guard, sources: lore.initial,
        transcript: [], message: question }, runtime.services, signal);
      const reply = await runConversation(request, runtime, signal);
      runtime.services.debug.record({ turn: 1, pass: 1, source: "guard-holt-location", stage: "respond", status: "completed",
        output: { response: reply.content ?? "" } });
    },
    summarise(recording) {
      return recording.error !== undefined ? "Dialogue failed" : response(recording);
    },
    async score(recording) {
      const before = recording.initialState as WorldState | undefined;
      const after = recording.finalState as WorldState | undefined;
      if (before && after && !isDeepStrictEqual(before.simulation!.map, after.simulation!.map)) {
        return { criteria: { location: { score: 0, reason: "Dialogue unexpectedly changed the physical map." } } };
      }
      return { criteria: { location: recording.error !== undefined
        ? { score: 0, reason: "Dialogue execution failed." }
        : scoreDialogueLocation(response(recording)) } };
    },
  };
}
