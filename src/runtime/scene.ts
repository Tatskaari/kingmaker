import type { WorldScript } from "../world/dsl.ts";

/**
 * A scene is GM prep, not a script: who is here and what they want, the beats the
 * scene is built around, and the only ways it can end. The runtime keeps track of
 * which beat we are in; the GM improvises everything in between.
 */

export const SKILLS = [
  "persuasion", "deception", "intimidation", "insight", "performance", "perception", "investigation",
  "sleight_of_hand", "stealth", "athletics", "acrobatics", "animal_handling", "arcana", "history",
  "nature", "religion", "medicine", "survival",
] as const;
export type Skill = typeof SKILLS[number];

export interface Character {
  id: string;
  name: string;
  /** Appearance and manner, for narration. */
  look: string;
  /** How they talk. */
  voice: string;
  wants: string;
  fears?: string;
  /** What they know and will share when it makes sense to. */
  knows: string[];
  /** What they hide. Revealing these is usually a beat or a roll. */
  secrets?: string[];
  /** Starting attitude towards the party. */
  attitude: string;
  /** Beat id where this character arrives; present from the start when omitted. */
  enters?: string;
  /** A group (e.g. "four goblins") voiced through its leader. */
  group?: string;
}

export interface Check {
  skill: Skill;
  dc: number;
  /** Narration guidance for each outcome. */
  success: string;
  failure: string;
  /** Beat or exit id reached on success. */
  onSuccess: string;
  /** Beat or exit id reached on failure; stays in the current beat when omitted. */
  onFailure?: string;
}

export interface Transition {
  id: string;
  /**
   * Something observed in the fiction, in prose.
   * - "attempt": judged against the player's latest turn before the GM replies, so rolls and
   *   exits shape the reply. Default when the transition has a check.
   * - "cue": a pacing cue judged before the reply on the state of the scene (stalling, the party
   *   setting off); the GM makes the next beat happen in this reply.
   * - "outcome": judged after the reply, on what has now happened in the fiction. The default.
   */
  when: string;
  on?: "attempt" | "cue" | "outcome";
  /** Beat or exit id. Omit when a check decides the destination. */
  to?: string;
  check?: Check;
  /** Scene facts that become true when this transition is taken. */
  establishes?: string[];
}

export interface Beat {
  id: string;
  title: string;
  /** What this beat is for and how to play it: the GM's prep note. */
  direction: string;
  /** What individual characters are doing or trying to do during this beat. */
  cast?: Record<string, string>;
  /** Something the world can do to push things along when the scene stalls or drifts. */
  pressure?: string;
  transitions: Transition[];
}

export type ExitKind = "combat" | "persuaded" | "progress" | "leave" | "other";

export interface Exit {
  id: string;
  kind: ExitKind;
  title: string;
  /** What is true if the scene ends this way. */
  outcome: string;
  /** How the GM should close the scene. */
  closing: string;
  /** Scene id to continue into (the map would sit in between). */
  next?: string;
  /** Authored world update for this exit. */
  script?: WorldScript;
}

export interface Scene {
  id: string;
  title: string;
  /** One line for listings. */
  summary: string;
  /** Where and when, sensory detail. GM-facing. */
  setting: string;
  /** The dramatic question this scene answers. */
  premise: string;
  /** What the player character knows walking in. Player-facing. */
  hook: string;
  /** Direction for the opening narration. */
  opening: string;
  cast: Character[];
  start: string;
  beats: Beat[];
  exits: Exit[];
  /** Transitions available from every beat (e.g. the party attacks, the party walks away). */
  anytime?: Transition[];
  /** Established facts carried in from earlier scenes. */
  background?: string[];
  /** Named spots world scripts can refer to (e.g. "crossroads", "ditch"). */
  anchors?: string[];
  /** Character creation: on exit, the player's character sheet is extracted from the conversation. */
  createsCharacter?: boolean;
}

export function beatOrExit(scene: Scene, id: string): { beat?: Beat; exit?: Exit } {
  const beat = scene.beats.find(b => b.id === id);
  if (beat) return { beat };
  const exit = scene.exits.find(e => e.id === id);
  if (exit) return { exit };
  throw new Error(`Scene ${scene.id}: unknown beat or exit "${id}"`);
}

/** Catch authoring mistakes early: every target must exist and ids must be unique. */
export function validateScene(scene: Scene): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const id of [...scene.beats.map(b => b.id), ...scene.exits.map(e => e.id)]) {
    if (ids.has(id)) problems.push(`duplicate id ${id}`);
    ids.add(id);
  }
  if (!scene.beats.some(b => b.id === scene.start)) problems.push(`start beat ${scene.start} missing`);
  const castIds = new Set(scene.cast.map(c => c.id));
  for (const beat of scene.beats) {
    for (const t of [...beat.transitions]) {
      if (t.to && !ids.has(t.to)) problems.push(`${beat.id}.${t.id} -> unknown ${t.to}`);
      if (!t.to && !t.check) problems.push(`${beat.id}.${t.id} has neither a target nor a check`);
      if (t.check && !ids.has(t.check.onSuccess)) problems.push(`${beat.id}.${t.id} success -> unknown ${t.check.onSuccess}`);
      if (t.check?.onFailure && !ids.has(t.check.onFailure)) problems.push(`${beat.id}.${t.id} failure -> unknown ${t.check.onFailure}`);
    }
    for (const id of Object.keys(beat.cast ?? {})) if (!castIds.has(id)) problems.push(`${beat.id} cast note for unknown ${id}`);
  }
  for (const t of scene.anytime ?? []) if (t.to && !ids.has(t.to)) problems.push(`anytime.${t.id} -> unknown ${t.to}`);
  for (const c of scene.cast) if (c.enters && !scene.beats.some(b => b.id === c.enters)) problems.push(`${c.id} enters at unknown beat ${c.enters}`);
  return problems;
}
