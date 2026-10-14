import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { respondJson, LUNA, type Effort } from "../llm/openrouter.ts";
import { currentBeat, effectiveScene, presentCast, prompt, sceneBrief, scriptTranscript, targetTitle } from "./brief.ts";
import { SKILLS, type Beat, type Scene, type Transition } from "./scene.ts";
import { sessionDir, type RepairResult, type ScenePatch, type SessionState } from "./session.ts";

/**
 * The co-GM: a slower, reasoning model that reviews the scene between turns. Its output is
 * steering, not plot: short-lived notes for the GM, whispers to individual characters (their
 * wants this moment), canon to keep true, and additive routes that only lead to existing beats or
 * endings. Notes expire so they can't harden into a plan the scene railroads towards.
 */

export const NOTE_TTL_TURNS = 3;
export const WHISPER_TTL_TURNS = 2;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** Ids are enums built from this scene, so the agent can only point at things that exist. */
function repairSchema(scene: Scene) {
  const beats = scene.beats.map(b => b.id);
  const targets = [...beats, ...scene.exits.map(e => e.id), "new_beat"];
  const cast = scene.cast.map(c => c.id);
  const essentials = (scene.essentials ?? []).map(e => e.id);
  return {
    type: "object", additionalProperties: false,
    required: ["assessment", "status", "notes", "whispers", "relocations", "no_but", "canon", "move_to", "add_beat", "add_transitions"],
    properties: {
      relocations: {
        type: "array", description: "Things the scene needs that the player is missing because play went elsewhere, and where you're moving them.",
        items: { type: "object", additionalProperties: false, required: ["essential", "technique", "to", "how"], properties: {
          essential: essentials.length ? { type: "string", enum: essentials } : { type: "string" },
          technique: { type: "string", enum: ["move", "soft_nudge", "improvise"], description: "move: give it to another carrier; soft_nudge: a hint, remark or telltale detail; improvise: a new way to the same place." },
          to: { type: "string", enum: [...cast, "world"], description: "Who carries it now (a character) or 'world' (an object, event or detail the GM narrates)." },
          how: { type: "string", description: "Concretely how it reaches the player through what they're doing." },
        } },
      },
      assessment: { type: "string", description: "One or two sentences: what the player is doing or enjoying, and how the scene is going." },
      status: { type: "string", enum: ["on_track", "drifting", "stuck"] },
      notes: { type: "string", description: "Whispered notes to the GM for the next couple of replies. Empty if things are going well." },
      whispers: {
        type: "array", description: "What individual characters want or should try in the next exchange or two (a want, a concession, an offer, a deadline). Not lines of dialogue.",
        items: { type: "object", additionalProperties: false, required: ["to", "note"], properties: { to: { type: "string", enum: cast }, note: { type: "string" } } },
      },
      no_but: {
        type: "array", description: "Player approaches the world can't support: the in-fiction reason and the real alternative they can act on now.",
        items: { type: "object", additionalProperties: false, required: ["approach", "reason_in_fiction", "alternative", "alternative_route"], properties: {
          approach: { type: "string" }, reason_in_fiction: { type: "string" }, alternative: { type: "string" },
          alternative_route: { type: "string", enum: targets.filter(t => t !== "new_beat"), description: "Beat or ending the alternative leads towards." },
        } },
      },
      canon: { type: "array", items: { type: "string" }, description: "New improvised details that must now stay true. Only new ones." },
      move_to: nullable({ type: "string", enum: beats, description: "Beat the story has actually reached, if the tracker is behind." }),
      add_beat: nullable({
        type: "object", additionalProperties: false,
        required: ["id", "title", "direction", "pressure", "transitions"],
        properties: {
          id: { type: "string" }, title: { type: "string" }, direction: { type: "string" }, pressure: { type: "string" },
          transitions: { type: "array", items: { type: "object", additionalProperties: false, required: ["when", "to"], properties: { when: { type: "string" }, to: { type: "string", enum: targets.filter(t => t !== "new_beat") } } } },
        },
      }),
      add_transitions: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["beat", "when", "on", "to", "check", "why"],
          properties: {
            beat: { type: "string", enum: [...beats, "new_beat"], description: "Beat this route leaves from." },
            when: { type: "string", description: "What the player does or what happens, in prose." },
            on: { type: "string", enum: ["attempt", "cue", "outcome"] },
            to: { type: "string", enum: targets, description: "Beat or ending (or new_beat). With a check, the success destination." },
            check: nullable({
              type: "object", additionalProperties: false, required: ["skill", "dc", "reason", "success", "failure", "on_failure"],
              properties: {
                skill: { type: "string", enum: [...SKILLS] }, dc: { type: "integer" },
                reason: { type: "string", description: "Why the player is rolling, for the player, e.g. 'to talk Skrag into a trade'." },
                success: { type: "string" }, failure: { type: "string" },
                on_failure: nullable({ type: "string", enum: targets.filter(t => t !== "new_beat") }),
              },
            }),
            why: { type: "string" },
          },
        },
      },
    },
  };
}

interface RepairJson {
  relocations: Array<{ essential: string; technique: "move" | "soft_nudge" | "improvise"; to: string; how: string }>;
  assessment: string;
  status: "on_track" | "drifting" | "stuck";
  notes: string;
  whispers: Array<{ to: string; note: string }>;
  no_but: Array<{ approach: string; reason_in_fiction: string; alternative: string; alternative_route: string }>;
  canon: string[];
  move_to: string | null;
  add_beat: { id: string; title: string; direction: string; pressure: string; transitions: Array<{ when: string; to: string }> } | null;
  add_transitions: Array<{ beat: string; when: string; on: "attempt" | "cue" | "outcome"; to: string; check: null | { skill: typeof SKILLS[number]; dc: number; reason: string; success: string; failure: string; on_failure: string | null }; why: string }>;
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
  const sinceMove = state.turn - Math.max(0, ...state.path.filter(p => p.to !== p.from).map(p => p.turn));
  const input = [
    { role: "developer" as const, content: sceneBrief(scene, state) },
    { role: "developer" as const, content: `## The scene's beats and routes (ids in quotes)\n${graphOutline(scene)}` },
    { role: "user" as const, content: [
      `## Tracker: the scene is at beat "${beat.id}" (${beat.title}); ${state.turnsInBeat} exchanges here, ${sinceMove} since anything moved.`,
      `## Your notes still in effect\n${state.notes ?? "(none)"}${state.whispers?.length ? `\n${state.whispers.map(w => `- to ${w.to}: ${w.note}`).join("\n")}` : ""}`,
      `## Established so far\n${[...state.established, ...state.canon].map(x => `- ${x}`).join("\n") || "(nothing yet)"}`,
      ...(scene.essentials?.length ? [`## What the player needs to come across (essentials)\n${scene.essentials.map(e => `- [${e.id}] ${e.what} (placed with: ${e.placedWith.join("; ")}; opens up: ${e.unlocks}) ${state.landed?.includes(e.id) ? "LANDED" : "NOT YET"}`).join("\n")}`] : []),
      `## Transcript\n${scriptTranscript(scene, state)}`,
    ].join("\n\n") },
  ];
  const result = await respondJson<RepairJson>({
    operation: "repair", model: options.model ?? LUNA, effort: options.effort ?? "medium",
    instructions: prompt("repair"), input, json: { name: "co_gm_notes", schema: repairSchema(scene) }, maxOutputTokens: 8000,
  });
  return toRepairResult(scene, state, result, result._meta);
}

function toRepairResult(scene: Scene, state: SessionState, json: RepairJson, meta: { costUsd: number; latencyMs: number }): RepairResult {
  const ids = new Set([...scene.beats.map(b => b.id), ...scene.exits.map(e => e.id)]);
  const patches: ScenePatch[] = [];
  const problems: string[] = [];
  let newBeatId: string | undefined;
  if (json.add_beat) {
    const id = ids.has(json.add_beat.id) ? `${json.add_beat.id}-improv-${state.turn}` : json.add_beat.id;
    const valid = json.add_beat.transitions.filter(t => ids.has(t.to));
    if (valid.length) {
      const beat: Beat = {
        id, title: json.add_beat.title, direction: json.add_beat.direction, pressure: json.add_beat.pressure,
        transitions: valid.map((t, i) => ({ id: `${id}-to-${t.to}-${i}`, when: t.when, to: t.to })),
      };
      patches.push({ turn: state.turn, beat, why: `Bridging beat: ${json.add_beat.title}` });
      newBeatId = id;
      ids.add(id);
    } else problems.push(`add_beat ${json.add_beat.id} had no valid targets`);
  }
  const resolveId = (id: string) => id === "new_beat" ? newBeatId : id;
  for (const [i, t] of json.add_transitions.entries()) {
    const from = resolveId(t.beat), to = resolveId(t.to);
    if (!from || !to || !ids.has(from) || !ids.has(to) || scene.exits.some(e => e.id === from)) { problems.push(`transition ${t.beat} -> ${t.to} rejected`); continue; }
    const transition: Transition = {
      id: `improv-${state.turn}-${i}`, when: t.when, on: t.on,
      ...(t.check
        ? { check: { skill: t.check.skill, dc: Math.max(5, Math.min(25, t.check.dc)), reason: t.check.reason, success: t.check.success, failure: t.check.failure, onSuccess: to, ...(t.check.on_failure && ids.has(t.check.on_failure) ? { onFailure: t.check.on_failure } : {}) } }
        : { to }),
    };
    patches.push({ turn: state.turn, transition: { beat: from, transition }, why: t.why });
  }
  const noBut = json.no_but.map(n => `"No, but" for ${n.approach}: ${n.reason_in_fiction} Instead: ${n.alternative} (towards ${targetTitle(scene, n.alternative_route)}).`);
  const relocations = (json.relocations ?? []).filter(r => !state.landed?.includes(r.essential));
  const worldMoves = relocations.filter(r => r.to === "world").map(r => `Let this reach the player through the world: ${r.how}`);
  const notes = [json.notes.trim(), ...noBut, ...worldMoves].filter(Boolean).join("\n");
  const relocationWhispers = relocations.filter(r => r.to !== "world").map(r => ({ to: r.to, note: `If it fits the moment, this reaches the player through you: ${r.how}` }));
  const present = new Set(presentCast(scene, state).map(c => c.id));
  const moveTo = json.move_to && ids.has(json.move_to) && json.move_to !== state.beat ? json.move_to : undefined;
  return {
    turn: state.turn, assessment: json.assessment + (problems.length ? ` [rejected: ${problems.join("; ")}]` : ""), status: json.status,
    notes, whispers: [...json.whispers, ...relocationWhispers].filter(w => present.has(w.to) || scene.cast.some(c => c.id === w.to)), relocations, canon: json.canon, patches,
    ...(moveTo ? { moveTo } : {}), costUsd: meta.costUsd, latencyMs: meta.latencyMs,
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
  expireNotes(state);
  return merged;
}

/** Notes and whispers are short-lived steering, not a plan. */
export function expireNotes(state: SessionState): void {
  if (state.notesTurn !== null && state.turn - state.notesTurn >= NOTE_TTL_TURNS) { state.notes = null; state.notesTurn = null; }
  if (state.whispers?.length) state.whispers = state.whispers.filter(w => state.turn - w.turn < WHISPER_TTL_TURNS);
}

export function applyRepair(scene: Scene, state: SessionState, result: RepairResult): void {
  if (state.notesTurn === null || result.turn >= state.notesTurn) {
    state.notes = result.notes || null;
    state.notesTurn = result.notes ? result.turn : null;
    state.whispers = (result.whispers ?? []).map(w => ({ ...w, turn: result.turn }));
  }
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
  const { patches, canon, whispers, ...rest } = result;
  state.repairs.push({ ...rest, patches: patches.length, canon: canon.length, whispers: whispers?.length ?? 0 });
  state.lastRepairTurn = result.turn;
}

/** Gate: repair when the scene isn't on track, or periodically as a backstop. */
export function shouldRepair(state: SessionState, every = 3): boolean {
  if (state.ended || state.closing) return false;
  if (state.sceneStatus && state.sceneStatus !== "on_track") return true;
  return state.turn - (state.lastRepairTurn ?? 0) >= every;
}

export const describeTarget = targetTitle;
