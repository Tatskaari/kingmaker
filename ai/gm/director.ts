// Copied from the prototype's src/runtime/director.ts at 44c6d4a: lines 24-52 (decisionState) as they are (reading a TurnView), which the questions below read. The rest of decideBefore (:718-1019, the turn's one decision: the route, the cue, the roll call, the same push again, a plan off the graph, earned, daft, out of character, an ending on the brink, a limit) went with the old pipeline's decide (docs/migration-log.md, M2's "The old pipeline's salvage"), but for the rules' mechanic question (:793-809, with the world bridge: world-bridge-design §2.2) and the act's details call (:988-1009, withMechanic's), parked for combat as mechanicQuestion, readMechanic and mechanicOf, and asked again of a line in a scene since "After the migration: spells and blows said in a scene" (the act step: service/endpoints/act.ts), offering the acts a scene's rules resolve (SCENE_ACTS); freeformCheck (:639-650, the plain check a considered turn rolled when its ruling failed) and the tries that failed (:1231-1232 and 1360-1369, failedTries) went with considered rolls; decideAfter (:1234-1358, the read after the reply) went with the old pipeline's settle, but for its threat and severity (:1284-1295, :1343-1349), parked for combat as threatQuestions and readThreat; a talk's settings and its staged secrets after the reply (:1219-1229, :1263-1275, :1324) went with the old pipeline's talk. The details' questions are gm/mechanics.ts.

import type { ChoiceQuestion, Decider, Decision as Answers } from "../llm/decide.ts";
import { castNamed } from "../../shared/rules/acting.ts";
import { HAZARD_KINDS } from "../../shared/rules/acts.ts";
import type { Mechanic, ThreatRead } from "../../shared/rules/types.ts";
import { currentBeat, presentCast } from "../../shared/scene/graph.ts";
import type { Character, Scene } from "../../shared/scene/types.ts";
import { sceneEntries, scriptTranscript } from "./brief.ts";
import { mechanicDetails, RULED_ACTS, type RuledAct, type RulesOptions } from "./mechanics.ts";
import type { TurnView } from "./view.ts";

/** What every decision is shown (the state the Decisions API judges by): the scene, where it is, who's here, the last twelve entries and the latest turn (and reply). */
export function decisionState(scene: Scene, state: TurnView, latestPlayerTurn: string, reply?: string) {
  const beat = currentBeat(scene, state);
  const entries = sceneEntries(state);
  return {
    scene: `${scene.title}: ${scene.premise}`,
    current_situation: `${beat.title}. ${beat.direction}`,
    exchanges_at_this_point: state.turnsInBeat,
    characters_present: presentCast(scene, state).map(c => c.name),
    recent_transcript: scriptTranscript(scene, state, entries.slice(-12)),
    latest_player_turn: latestPlayerTurn,
    ...(reply === undefined ? {} : { latest_gm_reply: reply }),
  };
}

/**
 * How players write a turn (the convention the game gives them): talking is the default, and an
 * action goes in *asterisks* or (parentheses), though plenty just narrate. Said in the question that
 * turns on it (what the rules resolve), not in every decision's state, where it only unsettles
 * judgements that don't turn on it.
 */
const READ_TURN = "plain words are what their character says out loud, and what they do is in *asterisks* or (parentheses), or plainly narrated (\"I open the door\")";

/** A clear read (the prototype's SCENE_ENDING_CONFIDENCE, its bar for what costs most to get wrong): what the rules resolve, and a threat left hanging. */
const SCENE_ENDING_CONFIDENCE = 0.6;

// ---------------------------------------------------------------------------------------------
// What the player's line does that the D&D rules resolve, as decideBefore asked it
// (director.ts:793-809) in the turn's one decision and read it (:887-893, a rest at once), then asked
// the act's details in a second small call (:988-1009, withMechanic's). The old pipeline's decide
// asked it of every line, for a character with a build; it was parked for combat when that decide
// went (docs/migration-log.md, M2's "The old pipeline's salvage"), and since "After the migration:
// spells and blows said in a scene" the act step asks it of a line in a scene that might be an act
// (the simulation's line check, shared/rules/acting.ts), offering the acts a scene's rules resolve.
// The route an act held back (alsoQuestion) and the act that's only the means to something risky
// (meansQuestion) can ride along in the details call (mechanicDetails' `extra`), parked for combat:
// in a scene the GM's mouthpiece calls the checks.

/** What the mechanic question can offer: the acts the rules resolve (gm/mechanics.ts RULED_ACTS), and the rests. */
export type MechanicChoice = RuledAct | "short_rest" | "long_rest";

/** Every act the rules resolve, as the old pipeline's decide offered them (parked for combat: a line typed in a fight, V13). */
export const EVERY_ACT: readonly MechanicChoice[] = ["cast", "attack", "grapple", "shove", "jump", "feature", "short_rest", "long_rest"];

/**
 * The acts the rules resolve of a line in a scene of the story: a spell, a blow (a stab, a shot, a
 * thrown thing), a class feature. A grab, a shove or a jump is the GM's to roll for there (Athletics,
 * as the reply's format has it: two-part.ts FORMAT), and a rest is the map's (its action menu's, once
 * a time of day: town-design §3.3).
 */
export const SCENE_ACTS: readonly MechanicChoice[] = ["cast", "attack", "feature"];

/** Whether the player, in their latest turn, is doing one of the things the game's rules resolve (`offered`, of a spell, a blow, a grab, a shove, a jump, a class feature, a rest), or none of them. */
export function mechanicQuestion(rules: RulesOptions, offered: readonly MechanicChoice[] = EVERY_ACT): ChoiceQuestion {
  const criteria: Record<MechanicChoice, string | undefined> = {
    // Offered to everyone: a character without magic who tries it gets the rules' "it doesn't come", not a fireball.
    cast: "Casting a spell now (naming a spell, or plainly working new magic). Not using what a spell already running gives them (seeing through a familiar's eyes, keeping up an illusion, a light already lit).",
    attack: "Attacking someone or something right now, to hurt a person or break a thing: a blow, a stab, a punch, a kick, a shot or a thrown weapon. Threats, grabs, shoves and drawing a weapon aren't attacks, and nor is tossing something to someone or working on something in hand.",
    grapple: "Grabbing hold of someone who'd resist, to hold or restrain them: a grapple, a headlock, pinning them, or a hold in a wrestling bout (a sparring partner resists too).",
    shove: "Shoving someone who'd resist: to knock them down, or push them back or away.",
    jump: "Jumping: across a gap or over something, up onto something, or down from it.",
    feature: rules.features?.length ? `Using one of their class features: ${rules.features.map(f => f.name).join(", ")}.` : undefined,
    short_rest: "Stopping to rest for an hour or so: catching their breath, binding wounds, a meal and a sit-down.",
    long_rest: "Sleeping the night, or resting for many hours.",
  };
  return {
    instructions: `Is the player, in their latest turn, doing one of these things the game's rules resolve? (In a turn, ${READ_TURN}.)`,
    criteria: { ...Object.fromEntries(offered.flatMap(o => (criteria[o] ? [[o, criteria[o]]] : []))), none: "None of these." },
  };
}

/** mechanicQuestion's answer on a clear read (0.6): an act whose details the rules still need, or a rest, which needs none; nothing on an unsure read. */
export function readMechanic(decision: Answers): RuledAct | Extract<Mechanic, { kind: "rest" }> | undefined {
  const named = decision.answers.mechanic?.choice;
  if (!named || named === "none" || (decision.answers.mechanic?.probabilities?.[named] ?? 1) < SCENE_ENDING_CONFIDENCE) return undefined;
  if (named === "short_rest" || named === "long_rest") return { kind: "rest", length: named === "short_rest" ? "short" : "long" };
  return RULED_ACTS.includes(named) ? named as RuledAct : undefined;
}

/**
 * What the rules resolve of the player's line, for a character with a build (`rules`: rulesOptions,
 * gm/mechanics.ts): the mechanic question in a call of its own (`director.rules`), offering the acts
 * `offered` (all of them unless it's said: a scene's are SCENE_ACTS), then, for a spell, a blow, a
 * grab, a shove, a jump or a feature, its details in a second small call (mechanicDetails: which
 * spell at whom, which blow, where they act from), `extra` questions riding along in it. A line that
 * casts one of the sheet's spells by its name (acting.ts castNamed: "(I cast thunderwave at the
 * constables)") isn't asked the question: it's that spell, and only its details are asked. None when
 * the line does nothing the rules resolve.
 */
export async function mechanicOf(decider: Decider, scene: Scene, state: TurnView, line: string, rules: RulesOptions, extra: Record<string, ChoiceQuestion> = {}, offered: readonly MechanicChoice[] = EVERY_ACT): Promise<{ mechanic?: Mechanic; details?: Answers }> {
  const cast = offered.includes("cast") ? castNamed(line, rules.spells) : undefined;
  const named = cast && rules.spells.find(sp => sp.id === cast.id);
  const act = named ? "cast" : readMechanic(await decider.decide(decisionState(scene, state, line), { mechanic: mechanicQuestion(rules, offered) }, "director.rules"));
  if (!act) return {};
  if (typeof act !== "string") return { mechanic: act };
  const detailed = await mechanicDetails(decider, scene, state, line, act, rules, extra, named);
  return { ...(detailed.mechanic ? { mechanic: detailed.mechanic } : {}), details: detailed.decision };
}

// ---------------------------------------------------------------------------------------------
// Parked for combat (docs/migration-log.md, M2's "The old pipeline's salvage"): what a reply left
// hanging over the player, as decideAfter asked it (director.ts:1284-1295) and read it (:1343-1349).
// The old pipeline asked it in its read after every reply, for a character with a build, and its
// settle commit kept the threat for the next turn's start to land (rules/play.ts rulesFirst lands one
// still); nothing asks it since the old pipeline's settle went with the rest of its scene steps.

/**
 * Whether the reply ends with the player in immediate physical danger: someone here in the act of
 * striking them (`attack:<id>`, for each of `present`), or a danger about to catch them
 * (`hazard:<kind>`, shared/rules/acts.ts HAZARD_KINDS); and how bad it would be.
 */
export function threatQuestions(present: Character[]): Record<string, ChoiceQuestion> {
  return {
    threat: {
      instructions: "Does the latest GM reply end with the player character in immediate physical danger that hasn't been resolved yet: someone in the act of striking, shooting or lunging at them, or a danger about to catch them (a fall, fire, poison, cold water, being grabbed or dragged, something working on their mind)? Only something already under way, not a threat in words, a warning or a possibility.",
      criteria: {
        ...Object.fromEntries(present.map(c => [`attack:${c.id}`, `${c.name} is in the act of attacking them`])),
        ...Object.fromEntries(Object.entries(HAZARD_KINDS).map(([k, text]) => [`hazard:${k}`, `About to be caught by ${text}`])),
        none: "No: nothing physical is about to hit them.",
      },
    },
    threat_severity: {
      instructions: "If something is about to hit the player character, how bad would it be?",
      criteria: { glancing: "A knock, a scare, a ducking: it could hurt a bit.", serious: "Serious: it could badly hurt someone." },
    },
  };
}

/**
 * threatQuestions' answers, read at 0.6: someone here's blow, or a danger with its severity; and the
 * threat question's raw choice, which lets go of a hold the reply no longer has the player in
 * (threats.ts holdAfterReply).
 */
export function readThreat(decision: Answers, present: Character[]): { threat?: ThreatRead; threatRead?: string } {
  const t = decision.answers.threat;
  if (!t) return {};
  let threat: ThreatRead | undefined;
  if (t.choice !== "none" && (t.probabilities?.[t.choice] ?? 1) >= SCENE_ENDING_CONFIDENCE) {
    const [kind, what] = t.choice.split(":");
    if (kind === "attack" && present.some(c => c.id === what)) threat = { kind: "attack", by: what! };
    if (kind === "hazard" && what) threat = { kind: "hazard", hazard: what, severity: decision.answers.threat_severity?.choice === "serious" ? "serious" : "glancing" };
  }
  return { ...(threat ? { threat } : {}), threatRead: t.choice };
}
