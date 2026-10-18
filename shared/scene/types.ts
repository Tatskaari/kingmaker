// Copied from the prototype's src/runtime/scene.ts at 44c6d4a, whole; an exit's script is its effects (data), a scene's onEnd its effects on every ending (story-design §4.2), and there's no approach. M2 extends it with what the scene format (docs/scene-format.md, document.ts) gives: a beat's revelation, paths, required, establishes and carry, an exit's result, a character's whyHere, limits, roles and lore, and a scene's truth, clock, facts and routes.

import type { BeatData, CastMember, OuterLimit, Path, Reinforcement } from "./document.ts";
import type { Effect } from "./files.ts";
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
  /** Why they're in this scene, now (the scene format's). */
  whyHere?: string;
  /** What never works on them and what they never do. */
  limits?: string;
  /** The co-GM's palette for their conversation role: how they're characterised, the inconsistency that invites a question, the hooks they offer. */
  roles?: CastMember["roles"];
  /** Their lore note in the campaign's lore/ (Cast/Cob/public.md). */
  lore?: string;
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
  /** Scene facts that become true on each outcome (a transition's own `establishes` are true either way). */
  establishes?: { success?: string[]; failure?: string[] };
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
  /**
   * An outcome only someone else can bring about (a secret told when they're ready): judged after
   * the reply, never offered beforehand as something the player's turn simply achieves.
   */
  given?: boolean;
  /**
   * The essential this route brings the player (an id among the scene's essentials). The route is
   * there only while the scene has it (one prepped for if the player missed it in an earlier scene
   * is the scene's only when the boundary brings it over), and once the player has come across it,
   * it isn't offered again.
   */
  essential?: string;
  /**
   * The essential this route is a way towards without bringing it (an id among the scene's
   * essentials): a bribe that gets haggling and leaves the page in the boot, a kindness that counts
   * towards trust. Like `essential`, the route is there only while the scene has it and goes once
   * the player has come across it; taking it brings nothing out.
   */
  towards?: string;
  /** The beats the scene must have reached before this route can be taken (its route's `requires`: the scene format's). */
  requires?: string[];
}

/**
 * A beat, as the scene format has them (load.ts sceneOf): the start (the scene's `start`), an event
 * (a turn the scene takes: no revelation), or a discovery (something the player can come to
 * understand, by any of its paths: it has a revelation). Its transitions are the routes that leave
 * it, as the copied code reads them.
 */
export interface Beat {
  id: string;
  title: string;
  /** What this beat is for and how to play it: the GM's prep note (the node's description). */
  direction: string;
  /** What individual characters are doing or trying to do during this beat (the start's and an event's conversation roles). */
  cast?: Record<string, string>;
  /** Something the world can do to push things along when the scene stalls or drifts. */
  pressure?: string;
  /** An event's fight in the conversation: who fights the player, and beside them, when it's reached. */
  fight?: BeatData["fight"];
  transitions: Transition[];
  /** A discovery's: what the player comes to understand. A beat with one is a discovery. */
  revelation?: string;
  /** A discovery's suggested revelation paths. */
  paths?: Path[];
  /** The scene can't end well without it. */
  required?: boolean;
  /** Fact ids settled when the beat is reached (the scene's `facts` say their sentences). */
  establishes?: string[];
  /** When the rest of the story needs it too: an essential (the beat's id is the essential's). */
  carry?: BeatData["carry"];
  /** Lore notes about it (paths under the campaign's lore/). */
  lore?: string[];
}

/**
 * A route of the scene format (document.ts Route), flat: from a node the scene has reached to
 * another, once every beat it requires is reached; with dice (`skill`, `dc`) the check decides it,
 * a failure going to `onFailure` or nowhere. What play does with them is beats.ts's.
 */
export interface SceneRoute {
  id: string;
  /** Node ids: the start, a beat, an ending. */
  source: string;
  target: string;
  /** The route's name on the graph. */
  label: string;
  /** What has to have happened to take it (empty into a discovery: its revelation landing). */
  condition: string;
  /** outcome: judged on what has happened; cue: a moment the co-GM brings about when it comes. */
  phase: "outcome" | "cue";
  /** Beats that must have been reached first. */
  requires?: string[];
  /** The dice decide it: the check the mouthpiece calls. None: no dice. */
  skill?: Skill;
  dc?: number;
  /** Where a failed check goes; none, and the scene stays where it is. */
  onFailure?: string;
  /** Fact ids settled when it's taken. */
  establishes?: string[];
  /** A cue's outer limit (document.ts OuterLimit): each count's exchanges, from the start or a beat reached, until a beat; none on a route that isn't a cue. */
  limit?: OuterLimit[];
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
  /** What ending this way does to the story and the world (the prototype's exit script, as data). */
  effects?: Effect[];
  /** How it went for the player: good, mixed or bad (the scene format's). */
  result?: "good" | "mixed" | "bad";
  /** Lore notes about it (paths under the campaign's lore/). */
  lore?: string[];
}

/**
 * Something the scene needs the player to come across for its endings to be reachable: a clue,
 * a piece of information, an opportunity. Authors say where it was placed; when play goes
 * elsewhere, the GM and co-GM move it to whatever the player is engaging with.
 *
 * One the rest of the story needs too (`later`) goes on when the scene ends without the player
 * coming across it: into the next scene that holds, as one of its essentials, placed where that
 * scene's people and world can bring it out (src/runtime/owed.ts). A later scene can prep it for
 * itself (`missed`).
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
  /**
   * What later in the story needs it, in a line ("the King's morning needs proof he can hold"). If
   * the player hasn't come across it by the time this scene ends, the story still owes it them: it
   * goes on into the next scene that holds, and on again, until they do.
   */
  later?: string;
  /**
   * The things in this scene's world it's in (their ids: "ledger-page"). They stay where they are:
   * while it's owed, whoever holds them takes them into the next scene's world.
   */
  things?: string[];
  /**
   * This scene's own prep for an earlier scene's essential, for if the player missed it there
   * ("hanged-clerk:page": the scene's id and the essential's). It's this scene's only while that one
   * is still owed and the boundary judges it can come up here, in place of the boundary's own placing.
   */
  missed?: string;
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
  /**
   * What anyone here knows and a newcomer wouldn't, where the public lore doesn't say it: the
   * place's customs, prices, rules and common talk. Never a secret: the notes on the GM's marks
   * explain from it (src/runtime/notes.ts), as from the public lore.
   */
  known?: string[];
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
  /** The place as a world: areas, things and where people start (shared/world/scene-world.ts). A campaign keeps it in places/<key>.kmplace: a host that wants it here puts it here. */
  world?: WorldSpec;
  /**
   * The GM-only doc of what's in motion in this scene's world (fronts: who wants what, a clock of
   * steps, bills still to come due), e.g. "World/Fronts.md". Its steps tick at this scene's
   * boundary in the session's copy, when play or the time passing has made them true.
   */
  fronts?: string;
  /** Who comes when a fight breaks out here, each after so many rounds (the scene format's: document.ts Reinforcement). */
  reinforcements?: Reinforcement[];
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
  /**
   * A word with a companion between scenes (scenes/talk.ts, src/runtime/talk.ts): their cast id.
   * Nothing in it moves the story, and the scene the story is heading for waits until it's over.
   */
  companion?: string;
  /** Effects as the scene comes into the story (the scene format's: its row made, as the lead or opened at once), before it's played. */
  onStart?: Effect[];
  /** Effects of every ending, before the exit's own (v2's: in the prototype, story code in the map module, src/game/map/explore.ts:100-112). */
  onEnd?: Effect[];
  /** What really happened, behind the screen: it comes out through the beats' paths (the scene format's). */
  truth?: string;
  /** What happens if the player dawdles: the pressure, and its outer limit. */
  clock?: string;
  /** Fact ids and the sentence the GM is told when each is settled; `established` holds the sentences. */
  facts?: Record<string, string>;
  /** Every route of the scene, flat, in the file's order (beats[].transitions has them by where they leave from, for the copied code). */
  routes: SceneRoute[];
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
  // Essentials: their ids, the routes that bring them, the things they're in, and what they stand for.
  const essentials = new Set<string>();
  for (const e of scene.essentials ?? []) {
    if (essentials.has(e.id)) problems.push(`duplicate essential ${e.id}`);
    essentials.add(e.id);
    for (const c of e.carriers ?? []) if (!castIds.has(c)) problems.push(`essential ${e.id} carried by unknown ${c}`);
    for (const t of e.things ?? []) if (scene.world && !scene.world.things.some(x => x.id === t)) problems.push(`essential ${e.id} is in unknown thing ${t}`);
    if (e.missed && !/^[\w-]+:[\w-]+$/.test(e.missed)) problems.push(`essential ${e.id} stands for "${e.missed}", not "<scene>:<essential>"`);
  }
  for (const t of [...scene.beats.flatMap(b => b.transitions), ...(scene.anytime ?? [])]) {
    if (t.essential && !essentials.has(t.essential)) problems.push(`${t.id} brings unknown essential ${t.essential}`);
    if (t.towards && !essentials.has(t.towards)) problems.push(`${t.id} is a way towards unknown essential ${t.towards}`);
  }
  return problems;
}
