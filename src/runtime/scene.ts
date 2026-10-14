import type { WorldScript } from "../world/dsl.ts";
import type { WorldOp, WorldSpec } from "../world/scene-world.ts";

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
  /**
   * What the player calls them until they've heard the name ("the landlady", "the big man with the
   * bandaged hand"). With it, the narration and the dice keep the name back until someone says it.
   */
  called?: string;
  /** Other names people use for them ("Hep" for Hepzibah Grist): hearing one counts as hearing the name. */
  aka?: string[];
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
  /** Their stats when the rules need them (a blow, a spell): an SRD statblock id (commoner, guard, tough, noble, spy, mastiff...). Commoner when omitted. */
  statblock?: string;
  /** What they'd hit someone with (an SRD weapon id: club, dagger, mace...), when it isn't their statblock's usual one. */
  weapon?: string;
  /** A group's members, who stand, fight and fall separately in the world and the rules (the group speaks through its leader). */
  members?: Array<{ id: string; name: string; statblock?: string; weapon?: string; look?: string }>;
}

export interface Check {
  skill: Skill;
  dc: number;
  /** Why this is being rolled, for the player: "to talk Holt down before he snaps". Shown with the dice. */
  reason?: string;
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

/**
 * Something the scene needs the player to come across for its endings to be reachable: a clue,
 * a piece of information, an opportunity. Authors say where it was placed; when play goes
 * elsewhere, the GM and co-GM move it to whatever the player is engaging with.
 */
export interface Essential {
  id: string;
  /** What the player should come to know or have, in a sentence. */
  what: string;
  /** Where the author put it (people, objects, moments). */
  placedWith: string[];
  /** Cast ids among the authored carriers: relocation means someone else. */
  carriers?: string[];
  /** What it opens up once the player has it. */
  unlocks: string;
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
  /**
   * What the world can't offer here: tempting things players reach for that don't exist or
   * can't work in this scene. Lets the GM say "no, but" honestly instead of inventing.
   */
  limits?: string[];
  /** Established facts carried in from earlier scenes. */
  background?: string[];
  /** What the scene needs the player to come across (moved elsewhere when play doesn't go there). */
  essentials?: Essential[];
  /** Named spots world scripts can refer to (e.g. "crossroads", "ditch"). */
  anchors?: string[];
  /** Lore docs about this place and its world (paths under lore/): the GM's always-in entry docs. */
  lore?: string[];
  /** Character creation: on exit, the player's character sheet is extracted from the conversation. */
  createsCharacter?: boolean;
  /** Time passes before this scene opens: the player gets a short rest (an hour) or a long rest (a night). */
  rest?: "short" | "long";
  /** Downtime between scenes, standing in for the map: the playable game, which has a map, skips it. */
  interlude?: boolean;
  /** When it happens, for the map (the time of day it shows). */
  time?: "morning" | "afternoon" | "evening" | "night" | "next-morning";
  /** Reaching this scene is a milestone: the player's character goes up a level as it opens. */
  milestone?: boolean;
  /** The place as a world: areas, things and where people start (src/world/scene-world.ts). */
  world?: WorldSpec;
  /**
   * The GM-only doc of what's in motion in this scene's world (fronts: who wants what, a clock of
   * steps, bills still to come due), e.g. "World/Fronts.md". Its steps tick at this scene's
   * boundary in the session's copy, when play or the time passing has made them true.
   */
  fronts?: string;
  /**
   * What happens to the place offstage once the scene is over, whatever the ending (the body taken
   * away): world ops applied to its world as it ends, so the map shows the place as it's left.
   */
  afterwards?: Array<Pick<WorldOp, "op" | "what"> & Partial<WorldOp>>;
  /**
   * What this scene's prep takes for granted about the story so far, in plain words ("the barge
   * hasn't sailed yet"). Checked when the story reaches the scene: if play has already made one
   * untrue (settled, prevented or bypassed what the scene is about), it's skipped for `overtaken`.
   */
  assumes?: string[];
  /** Where the story goes instead when this scene has been overtaken (a later scene, or the ending). */
  overtaken?: string;
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
