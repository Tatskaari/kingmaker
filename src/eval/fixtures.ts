import { readFileSync } from "node:fs";
import { sceneById } from "../../scenes/index.ts";
import { SKILLS, type Skill } from "../runtime/scene.ts";
import type { Entry, SessionState } from "../runtime/session.ts";

/** A hand-built moment in a scene, or a snapshot from a real (QA) session. */
export interface FixtureSpec {
  beat?: string;
  turnsInBeat?: number;
  player?: string;
  modifiers?: Partial<Record<Skill, number>>;
  /** [speaker, text]: speaker is "player", "gm", "roll" or a cast id. */
  transcript?: Array<[string, string]>;
  established?: string[];
  canon?: string[];
  notes?: string;
  /** Beats already passed through (controls who is on stage). */
  visited?: string[];
  /** Load this snapshot instead (path to a snapshots/*.json file). */
  snapshot?: string;
}

export function buildFixture(sceneId: string, spec: FixtureSpec, options: { id: string; approach: string; seed: number }): SessionState {
  if (spec.snapshot) {
    const state = JSON.parse(readFileSync(spec.snapshot, "utf8")) as SessionState;
    return { ...state, id: options.id, approach: options.approach, seed: options.seed, rollCount: 0, notes: spec.notes ?? state.notes };
  }
  const scene = sceneById(sceneId);
  const [name, ...rest] = (spec.player ?? "Wren Ashdown: a quick-witted half-elf ranger with a longbow, a dry sense of humour and a soft spot for underdogs").split(":");
  const transcript: Entry[] = [];
  let turn = 0;
  for (const [speaker, text] of spec.transcript ?? []) {
    if (speaker === "player") turn++;
    transcript.push({
      turn, scene: scene.id, text,
      speaker: speaker === "roll" ? "dice" : speaker,
      kind: speaker === "player" ? "player" : speaker === "gm" ? "narration" : speaker === "roll" ? "roll" : "dialogue",
    });
  }
  const beat = spec.beat ?? scene.start;
  const visited = spec.visited ?? [];
  return {
    id: options.id, sceneId: scene.id, approach: options.approach, seed: options.seed, rollCount: 0,
    player: { name: name!.trim(), concept: rest.join(":").trim(), modifiers: { ...Object.fromEntries(SKILLS.map(s => [s, 2])), ...spec.modifiers } },
    turn, beat, turnsInBeat: spec.turnsInBeat ?? 1,
    path: visited.map((from, i) => ({ turn: i, from, to: visited[i + 1] ?? beat, via: "fixture", source: "pre" as const })),
    established: spec.established ?? [], canon: spec.canon ?? [], notes: spec.notes ?? null, notesTurn: spec.notes ? turn : null,
    patches: [], repairs: [], transcript, metrics: [], history: [],
  };
}
