import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { respondJson, LUNA, type Effort } from "../llm/openrouter.ts";
import { currentBeat, effectiveScene, prompt, sceneBrief, scriptTranscript, targetTitle } from "./brief.ts";
import { SKILLS, type Beat, type Scene, type Transition } from "./scene.ts";
import { sessionDir, type RepairResult, type ScenePatch, type SessionState } from "./session.ts";

/** The co-GM: a slower, reasoning model that reviews the scene between turns and leaves notes and patches. */

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const checkSchema = {
  type: "object", additionalProperties: false,
  required: ["skill", "dc", "success", "failure", "on_failure"],
  properties: {
    skill: { type: "string", enum: [...SKILLS] },
    dc: { type: "integer" },
    success: { type: "string", description: "What success looks like in the fiction." },
    failure: { type: "string", description: "What failure looks like in the fiction." },
    on_failure: nullable({ type: "string", description: "Beat or ending id on failure; null to stay." }),
  },
};
const REPAIR_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["assessment", "status", "notes", "canon", "move_to", "add_beat", "add_transitions"],
  properties: {
    assessment: { type: "string", description: "One or two sentences: what the player is doing and how the scene is going." },
    status: { type: "string", enum: ["on_track", "drifting", "stuck"] },
    notes: { type: "string", description: "Whispered notes to the GM for the next few replies." },
    canon: { type: "array", items: { type: "string" }, description: "New improvised details that must now stay true. Only new ones." },
    move_to: nullable({ type: "string", description: "Beat id the story has actually reached, if the tracker is behind." }),
    add_beat: nullable({
      type: "object", additionalProperties: false,
      required: ["id", "title", "direction", "pressure", "transitions"],
      properties: {
        id: { type: "string" }, title: { type: "string" }, direction: { type: "string" }, pressure: { type: "string" },
        transitions: {
          type: "array", items: {
            type: "object", additionalProperties: false, required: ["when", "to"],
            properties: { when: { type: "string" }, to: { type: "string", description: "Existing beat or ending id." } },
          },
        },
      },
    }),
    add_transitions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["beat", "when", "on", "to", "check", "why"],
        properties: {
          beat: { type: "string", description: "Beat id this route leaves from." },
          when: { type: "string", description: "What the player does or what happens, in prose." },
          on: { type: "string", enum: ["attempt", "cue", "outcome"] },
          to: { type: "string", description: "Existing beat or ending id (or the id of add_beat). With a check, the success destination." },
          check: nullable(checkSchema),
          why: { type: "string" },
        },
      },
    },
  },
};

interface RepairJson {
  assessment: string;
  status: "on_track" | "drifting" | "stuck";
  notes: string;
  canon: string[];
  move_to: string | null;
  add_beat: { id: string; title: string; direction: string; pressure: string; transitions: Array<{ when: string; to: string }> } | null;
  add_transitions: Array<{ beat: string; when: string; on: "attempt" | "cue" | "outcome"; to: string; check: null | { skill: typeof SKILLS[number]; dc: number; success: string; failure: string; on_failure: string | null }; why: string }>;
}

function graphOutline(scene: Scene): string {
  return scene.beats.map(b => [
    `### Beat "${b.id}": ${b.title}`,
    b.direction,
    ...b.transitions.map(t => `- [${t.id}${t.check ? `, ${t.check.skill} DC ${t.check.dc}` : ""}] ${t.when} -> ${t.to ?? `${t.check!.onSuccess} on success / ${t.check!.onFailure ?? "stay"} on failure`}`),
  ].join("\n")).join("\n\n") + `\n\n### Endings\n${scene.exits.map(e => `- "${e.id}" (${e.kind}): ${e.title}. ${e.outcome}`).join("\n")}` +
    (scene.anytime?.length ? `\n\n### From anywhere\n${scene.anytime.map(t => `- ${t.when} -> ${t.to}`).join("\n")}` : "");
}

export async function runRepair(authored: Scene, state: SessionState, options: { effort?: Effort; model?: string } = {}): Promise<RepairResult> {
  const scene = effectiveScene(authored, state.patches);
  const beat = currentBeat(scene, state);
  const input = [
    { role: "developer" as const, content: sceneBrief(scene, state) },
    { role: "developer" as const, content: `## The scene's beats and routes (ids in quotes)\n${graphOutline(scene)}` },
    { role: "user" as const, content: [
      `## Tracker: the scene is at beat "${beat.id}" (${beat.title}) and has been there for ${state.turnsInBeat} exchanges.`,
      `## Your previous notes\n${state.notes ?? "(none yet)"}`,
      `## Established so far\n${[...state.established, ...state.canon].map(x => `- ${x}`).join("\n") || "(nothing yet)"}`,
      `## Transcript\n${scriptTranscript(scene, state)}`,
    ].join("\n\n") },
  ];
  const result = await respondJson<RepairJson>({
    operation: "repair", model: options.model ?? LUNA, effort: options.effort ?? "medium",
    instructions: prompt("repair"), input, json: { name: "co_gm_notes", schema: REPAIR_SCHEMA }, maxOutputTokens: 6000,
  });
  return toRepairResult(scene, state, result, result._meta);
}

function toRepairResult(scene: Scene, state: SessionState, json: RepairJson, meta: { costUsd: number; latencyMs: number }): RepairResult {
  const ids = new Set([...scene.beats.map(b => b.id), ...scene.exits.map(e => e.id)]);
  const patches: ScenePatch[] = [];
  const problems: string[] = [];
  let newBeat: Beat | undefined;
  if (json.add_beat && !ids.has(json.add_beat.id)) {
    const valid = json.add_beat.transitions.filter(t => ids.has(t.to));
    if (valid.length) {
      newBeat = {
        id: json.add_beat.id, title: json.add_beat.title, direction: json.add_beat.direction, pressure: json.add_beat.pressure,
        transitions: valid.map((t, i) => ({ id: `${json.add_beat!.id}-to-${t.to}-${i}`, when: t.when, to: t.to })),
      };
      patches.push({ turn: state.turn, beat: newBeat, why: `Bridging beat: ${json.add_beat.title}` });
      ids.add(newBeat.id);
    } else problems.push(`add_beat ${json.add_beat.id} had no valid targets`);
  }
  for (const [i, t] of json.add_transitions.entries()) {
    if (!ids.has(t.beat) || !ids.has(t.to) || scene.exits.some(e => e.id === t.beat)) { problems.push(`transition ${t.beat} -> ${t.to} rejected (unknown id)`); continue; }
    if (t.check?.on_failure && !ids.has(t.check.on_failure)) { problems.push(`transition failure target ${t.check.on_failure} unknown`); continue; }
    const transition: Transition = {
      id: `improv-${state.turn}-${i}`, when: t.when, on: t.on,
      ...(t.check
        ? { check: { skill: t.check.skill, dc: Math.max(5, Math.min(25, t.check.dc)), success: t.check.success, failure: t.check.failure, onSuccess: t.to, ...(t.check.on_failure ? { onFailure: t.check.on_failure } : {}) } }
        : { to: t.to }),
    };
    patches.push({ turn: state.turn, transition: { beat: t.beat, transition }, why: t.why });
  }
  const moveTo = json.move_to && ids.has(json.move_to) && json.move_to !== state.beat && !scene.exits.some(e => e.id === json.move_to) ? json.move_to : undefined;
  return {
    turn: state.turn, assessment: json.assessment + (problems.length ? ` [rejected: ${problems.join("; ")}]` : ""), status: json.status,
    notes: json.notes, canon: json.canon, patches, ...(moveTo ? { moveTo } : {}), costUsd: meta.costUsd, latencyMs: meta.latencyMs,
  };
}

export function repairFile(sessionId: string, turn: number): string {
  return join(sessionDir(sessionId), `repair-${String(turn).padStart(3, "0")}.json`);
}

export function writeRepair(state: SessionState, result: RepairResult): void {
  writeFileSync(repairFile(state.id, result.turn), JSON.stringify({ sceneId: state.sceneId, ...result }, null, 1));
}

/** Merge background repair output that has arrived since the last turn. Returns the merged results. */
export function applyPendingRepairs(scene: Scene, state: SessionState): RepairResult[] {
  const dir = sessionDir(state.id);
  if (!existsSync(dir)) return [];
  const applied = new Set(state.repairs.map(r => r.turn));
  const files = readdirSync(dir).filter(f => /^repair-\d+\.json$/.test(f)).sort();
  const merged: RepairResult[] = [];
  for (const file of files) {
    const result = JSON.parse(readFileSync(join(dir, file), "utf8")) as RepairResult & { sceneId: string };
    if (result.sceneId !== state.sceneId || applied.has(result.turn)) continue;
    applyRepair(scene, state, result);
    merged.push(result);
  }
  return merged;
}

export function applyRepair(scene: Scene, state: SessionState, result: RepairResult): void {
  // Notes are only as fresh as the turn they analysed; newer notes win.
  if (state.notesTurn === null || result.turn >= state.notesTurn) { state.notes = result.notes; state.notesTurn = result.turn; }
  for (const fact of result.canon) if (!state.canon.includes(fact)) state.canon.push(fact);
  state.patches.push(...result.patches);
  if (result.moveTo && result.turn === state.turn) {
    const effective = effectiveScene(scene, state.patches);
    if (effective.beats.some(b => b.id === result.moveTo)) {
      state.path.push({ turn: state.turn, from: state.beat, to: result.moveTo, via: "repair", source: "repair" });
      state.beat = result.moveTo;
      state.turnsInBeat = 0;
    }
  }
  const { patches, canon, ...rest } = result;
  state.repairs.push({ ...rest, patches: patches.length, canon: canon.length });
}

export const describeTarget = targetTitle;
