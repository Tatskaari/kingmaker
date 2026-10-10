import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { parseConversationTree } from "../packages/lore/src/conversation-tree.js";
import { ConversationTreeSession } from "../packages/conversation/src/conversation-tree.js";
import { helloWorld } from "../packages/conversation/src/tree-scripts/hello-world.js";
import { ConversationReviews, liveConversationStrategy } from "../packages/conversation/src/live-conversation-strategy.js";
import { documentLoreService } from "../packages/conversation/src/document-lore.js";
import { traceAiService } from "../packages/conversation/src/ai-tracing.js";
import { retryResponses } from "../packages/conversation/src/ai.js";
import { ModelTranscripts, type ModelCallKind } from "../apps/web/src/model-transcripts.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromJson, toJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../packages/contracts/src/index.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { conversationRequest, type ConversationInput } from "../packages/conversation/src/conversation.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { aiService } from "../packages/conversation/src/adapters.js";
import { DisclosureSession } from "../packages/conversation/src/disclosure.js";
import { documentLore } from "../packages/conversation/src/document-lore.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { loadConversationWorld } from "./lib/conversation-world.js";
import { runConversationCli } from "../apps/conversation-cli/app.js";

const args = process.argv.slice(2);
const options = new Map<string, string>();
const usage = "npm run conversation -- [--character corvin] [--scenario 'Centennial Assembly'] [--snapshot path] [--player document.md] [--output path] [--threshold 0.7] [--strategy game] [--conversation_trees]";
if (args.includes("--help")) { console.log(usage); process.exit(0); }
for (let index = 0; index < args.length; index += 2) {
  if (args[index] === "--conversation_trees") { options.set("--conversation_trees", "true"); index--; continue; }
  const name = args[index]!, value = args[index + 1];
  if (!["--character", "--scenario", "--snapshot", "--output", "--threshold", "--player", "--strategy"].includes(name) || !value || value.startsWith("--")) throw new Error(usage);
  options.set(name, value);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("The conversation debugger requires an interactive terminal.");
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY before starting the conversation debugger.");
const treeEnabled = options.has("--conversation_trees");
const characterId = options.get("--character") ?? (treeEnabled ? "aldren" : "corvin");
const snapshotPath = options.get("--snapshot");
if (treeEnabled && (snapshotPath || characterId !== "aldren" || (options.get("--scenario") ?? "Centennial Assembly") !== "Centennial Assembly")) {
  throw new Error("--conversation_trees currently requires a fresh Centennial Assembly conversation with Aldren.");
}
const source = snapshotPath ? JSON.parse(readFileSync(snapshotPath, "utf8")) : undefined;
const services = createScenarioServices(source
  ? fromJson(WorldStateSchema, source.world ?? source)
  : loadConversationWorld(fileURLToPath(new URL("../lore", import.meta.url)), options.get("--scenario") ?? "Centennial Assembly", options.get("--player")));
const lore = await documentLore(services.scenario, characterId);
const jev = new JevClient(apiKey);
const client = new OpenRouterClient(apiKey);
const traces = new ModelTranscripts(apiKey);
const conversationId = traces.start("character", characterId, characterId, undefined, [characterId, "player"]);
let turnId = crypto.randomUUID();
const traced = traceAiService(aiService(client, jev, false), () => ({ characterId, participantIds: [characterId, "player"],
  conversationId, turnId, scenario: services.scenario.info().scenario,
}), (span, request, call) => traces.record(span.operation as ModelCallKind, characterId, request, call, conversationId, characterId, span), "dialogue");
const ai = { ...traced, responses: retryResponses(traced.responses) };
const disclosure = new DisclosureSession(lore, ai,
  Number(options.get("--threshold") ?? "0.7"));
let conversationTree: ConversationTreeSession | undefined;
if (treeEnabled) {
  const tree = parseConversationTree(readFileSync(new URL("../content/conversation-trees/aldren.md", import.meta.url), "utf8"));
  await services.quests.register(tree.quest);
  conversationTree = new ConversationTreeSession(tree, services.quests, { "hello-world.ts": signal => helloWorld(services.quests, signal) });
}
const input: ConversationInput = {
  world: services.scenario.read(), characterId,
  sources: disclosure.sources,
  transcript: conversationTree ? [conversationTree.goal()] : [], message: "",
};
conversationRequest(input); // Validate the snapshot and selected character before entering the terminal UI.
const player = services.scenario.info().player;
const build = services.scenario.read().simulation!.runtimeCharacters.player?.dnd;
const strategyName = options.get("--strategy") ?? "game";
if (strategyName !== "game") throw new Error("Unknown conversation strategy");
const reviews = new ConversationReviews();
const result = await runConversationCli(input, ai.responses, disclosure, { ai, build, ...(conversationTree ? { conversationTree } : {}),
  services: new ConversationRuntime({ services: { ai, inventory: services.inventory, docs: services.docs, scenario: services.scenario, lore: documentLoreService(services.scenario) } }).services,
  beforeTurn: async () => { await reviews.drain(); return new DisclosureSession(await documentLore(services.scenario, characterId), ai, Number(options.get("--threshold") ?? "0.7")); },
  response: report => liveConversationStrategy({ characterId, reviews, report }),
  beginTurn: () => { turnId = crypto.randomUUID(); } });
await reviews.drain();
traces.finish(conversationId);
const output = resolve(options.get("--output") ?? `test-output/conversation-${Date.now()}.json`);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ ...result, requests: traces.recent(), agentRuns: traces.runs(), world: toJson(WorldStateSchema, services.scenario.read()), transcript: result.transcript.map(message => toJson(TranscriptMessageSchema, message)) }, null, 2));
console.log(`Conversation ready for review: ${output}`);
