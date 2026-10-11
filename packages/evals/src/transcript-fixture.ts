import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../../contracts/src/index.js";
import { documentLore } from "../../conversation/src/document-lore.js";
import type { LoreService } from "../../conversation/src/services.js";
import type { RuntimeConfig } from "./experiment.js";

type Step = { type: "character"; character_id: string }
  | { type: "progressive_disclosure"; docs: string[] }
  | { type: "message"; who: "player" | "agent" | "gm"; message: string };
interface TranscriptFixture { transcript: Step[]; docs_override: string }

/** A review-boundary fixture: normal character setup, fixed disclosed notes, then recorded messages. */
export function loadTranscriptFixture(file: string) {
  const fixture = JSON.parse(readFileSync(file, "utf8")) as TranscriptFixture;
  const first = fixture.transcript?.[0];
  if (first?.type !== "character" || !first.character_id?.trim()) throw new Error("Transcript must start with a character reference.");
  if (typeof fixture.docs_override !== "string" || !fixture.docs_override) throw new Error("Supply docs_override.");
  const characterId = first.character_id, docs: string[] = [];
  const transcript = [];
  for (const step of fixture.transcript.slice(1)) {
    if (step.type === "progressive_disclosure") {
      if (transcript.length) throw new Error("Review-boundary disclosure must precede messages.");
      if (!Array.isArray(step.docs) || step.docs.some(path => typeof path !== "string" || !path.trim())) throw new Error("Invalid disclosure paths.");
      docs.push(...step.docs);
    } else if (step.type === "message") {
      if (!["player", "agent", "gm"].includes(step.who) || typeof step.message !== "string" || !step.message.trim()) throw new Error("Invalid transcript message.");
      transcript.push(create(TranscriptMessageSchema, { role: step.who === "player" ? TranscriptRole.PLAYER
        : step.who === "agent" ? TranscriptRole.CHARACTER : TranscriptRole.GAME_MASTER,
        speakerId: step.who === "player" ? "player" : step.who === "agent" ? characterId : "GM", text: step.message }));
    } else throw new Error("Unknown transcript step.");
  }
  if (!transcript.length) throw new Error("Transcript needs messages.");
  return { characterId, transcript, docs, overlay: resolve(dirname(file), fixture.docs_override) };
}

/** Open only listed reachable notes, through the real scoped lore service. */
export async function openFixtureDocuments(lore: LoreService, paths: readonly string[], signal: AbortSignal) {
  const initial = [...lore.initial];
  for (const path of paths) {
    signal.throwIfAborted();
    if (initial.some(doc => doc.path === path)) continue;
    const link = lore.links(initial).find(link => link.path === path);
    if (!link) throw new Error(`Fixture disclosure is not reachable: ${path}`);
    initial.push(await lore.open(link, signal));
  }
  return initial;
}

/** Both character setup and reviews see the same recorded disclosures; no fresh PD decisions. */
export function withTranscriptFixture(config: RuntimeConfig, fixture: ReturnType<typeof loadTranscriptFixture>): RuntimeConfig {
  return { ...config, async configure() {
    const options = await config.configure();
    return { ...options, recordServices: ["docs", "ai"] as const,
      services: { ...options.services, lore: services => ({ forCharacter: async (characterId, signal) => {
        if (characterId !== fixture.characterId) throw new Error(`Unexpected fixture character: ${characterId}`);
        const lore = await documentLore(services.scenario, characterId);
        return { ...lore, initial: await openFixtureDocuments(lore, fixture.docs, signal) };
      } }), disclosure: () => ({ disclose: async (_lore, _messages, signal) => { signal.throwIfAborted(); return []; } }) },
    };
  } };
}
