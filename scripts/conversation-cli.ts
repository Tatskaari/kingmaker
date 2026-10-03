import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../packages/contracts/src/index.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { conversationRequest, type ConversationInput } from "../packages/conversation/src/conversation.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { aiService, loreService } from "../packages/conversation/src/adapters.js";
import { DisclosureSession } from "../packages/conversation/src/disclosure.js";
import { loadCharacterLore } from "../packages/conversation/src/lore.js";
import { runConversationCli } from "../apps/conversation-cli/app.js";

const args = process.argv.slice(2);
const options = new Map<string, string>();
const usage = "npm run conversation -- [--character corvin] [--scenario 'Centennial Assembly'] [--snapshot path] [--output path] [--threshold 0.7]";
if (args.includes("--help")) { console.log(usage); process.exit(0); }
for (let index = 0; index < args.length; index += 2) {
  const name = args[index]!, value = args[index + 1];
  if (!["--character", "--scenario", "--snapshot", "--output", "--threshold"].includes(name) || !value || value.startsWith("--")) throw new Error(usage);
  options.set(name, value);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("The conversation debugger requires an interactive terminal.");
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY before starting the conversation debugger.");
const source = JSON.parse(readFileSync(options.get("--snapshot") ?? new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
const lore = loadCharacterLore(fileURLToPath(new URL("../lore", import.meta.url)), options.get("--scenario") ?? "Centennial Assembly", options.get("--character") ?? "corvin");
const jev = new JevClient(apiKey);
const client = new OpenRouterClient(apiKey);
const ai = aiService(client, jev);
const disclosure = new DisclosureSession(loreService(lore), ai,
  Number(options.get("--threshold") ?? "0.7"));
const input: ConversationInput = {
  snapshot: source.scenario ? source : { scenario: source }, characterId: options.get("--character") ?? "corvin",
  sources: disclosure.sources,
  transcript: [], message: "",
};
conversationRequest(input); // Validate the snapshot and selected character before entering the terminal UI.
const result = await runConversationCli(input, ai.responses, disclosure);
const output = resolve(options.get("--output") ?? `test-output/conversation-${Date.now()}.json`);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ ...result, transcript: result.transcript.map(message => toJson(TranscriptMessageSchema, message)) }, null, 2));
console.log(`Conversation ready for review: ${output}`);
