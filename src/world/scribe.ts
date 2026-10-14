import { readFileSync } from "node:fs";
import { join } from "node:path";
import { respondJson, LUNA, type Effort } from "../llm/openrouter.ts";
import { prompt, sceneBrief, scriptTranscript } from "../runtime/brief.ts";
import type { Scene } from "../runtime/scene.ts";
import type { SessionState } from "../runtime/session.ts";
import { ASSETS } from "./assets.ts";
import type { Operation } from "./dsl.ts";
import { checkScript, type ScriptCheck } from "./sandbox.ts";

/** Phase 2: after a scene ends, an agent writes a world-update script from what was narrated. */

const API_REFERENCE = (() => {
  const source = readFileSync(join(import.meta.dirname, "dsl.ts"), "utf8");
  const start = source.indexOf("export type AssetKind");
  const end = source.indexOf("export type WorldScript");
  return source.slice(start, end).trim();
})();

export const describeOperations = (operations: Operation[]) => operations.map(o => `- ${o.op}(${JSON.stringify(o.args)})`).join("\n") || "- (none)";

export interface ScribeResult {
  changes: Array<{ what: string; why: string }>;
  check: ScriptCheck & { body: string };
  attempts: number;
  costUsd: number;
  latencyMs: number;
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["changes", "code"],
  properties: {
    changes: { type: "array", items: { type: "object", additionalProperties: false, required: ["what", "why"], properties: { what: { type: "string" }, why: { type: "string", description: "What in the story establishes it." } } } },
    code: { type: "string", description: "The body of function update(world: WorldApi): void" },
  },
};

export async function scribe(scene: Scene, state: SessionState, authored: Operation[], options: { effort?: Effort; model?: string } = {}): Promise<ScribeResult> {
  const exit = scene.exits.find(e => e.id === state.ended?.exitId);
  const context = { assets: ASSETS, characters: [...scene.cast.map(c => c.id), "player"], anchors: scene.anchors ?? [] };
  const input = [
    { role: "developer" as const, content: `## World API\n\`\`\`ts\n${API_REFERENCE}\n\`\`\`\n\n## Asset catalogue (id: name [tags])\n${ASSETS.map(a => `- ${a.id} (${a.kind}): ${a.name} [${a.tags.join(", ")}]`).join("\n")}` },
    { role: "developer" as const, content: `${sceneBrief(scene, state, { secrets: true })}\n\n## Ids you can use\nCharacters: ${context.characters.join(", ")}\nAnchors (named spots in this place): ${context.anchors.join(", ") || "(none)"}` },
    { role: "user" as const, content: [
      `## How the scene ended\n${exit ? `${exit.title}: ${exit.outcome}` : "(unknown)"}`,
      `## Already applied by the authored ending script\n${describeOperations(authored)}`,
      `## Established during play\n${[...state.established, ...state.canon].map(f => `- ${f}`).join("\n") || "- (nothing recorded)"}`,
      `## The scene as played\n${scriptTranscript(scene, state)}`,
    ].join("\n\n") },
  ];
  let costUsd = 0, latencyMs = 0, attempts = 0;
  let last: { changes: ScribeResult["changes"]; check: ScriptCheck & { body: string } } | undefined;
  for (; attempts < 3; ) {
    attempts++;
    const result = await respondJson<{ changes: ScribeResult["changes"]; code: string }>({
      operation: "scribe", model: options.model ?? LUNA, effort: options.effort ?? "medium",
      instructions: prompt("scribe"), input: last ? [...input, { role: "user" as const, content: `Your script had problems; fix them and return the whole script again.\n${[...last.check.typeErrors, ...(last.check.runtimeError ? [last.check.runtimeError] : []), ...last.check.warnings].join("\n")}\n\nYour previous script:\n${last.check.body}` }] : input,
      json: { name: "world_update", schema: SCHEMA }, maxOutputTokens: 8000,
    });
    costUsd += result._meta.costUsd; latencyMs += result._meta.latencyMs;
    last = { changes: result.changes, check: checkScript(result.code, context) };
    if (last.check.ok && !last.check.warnings.length) break;
  }
  return { changes: last!.changes, check: last!.check, attempts, costUsd, latencyMs };
}
