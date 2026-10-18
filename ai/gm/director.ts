// Copied from the prototype's src/runtime/director.ts at 44c6d4a: lines 24-52 (decisionState) as they are (reading a TurnView), freeformCheck (:639-650) as its questions and their reading (freeformQuestions, readFreeform: the roll is the simulation's), and the tries that failed (:1231-1232 and 1360-1369, failedTries) that considered rolls read. The rest of decideBefore (:718-1019, the turn's one decision: the route, the cue, the roll call, the same push again, a plan off the graph, earned, daft, out of character, an ending on the brink, a limit) went with the old pipeline's decide (docs/migration-log.md, M2's "The old pipeline's salvage"), but for the rules' mechanic question (:793-809, with the world bridge: world-bridge-design §2.2) and the act's details call (:988-1009, withMechanic's), parked for combat as mechanicQuestion, readMechanic and mechanicOf; decideAfter (:1234-1358, the read after the reply) went with the old pipeline's settle, but for its threat and severity (:1284-1295, :1343-1349), parked for combat as threatQuestions and readThreat; a talk's settings and its staged secrets after the reply (:1219-1229, :1263-1275, :1324) went with the old pipeline's talk. The details' questions are gm/mechanics.ts.

import type { ChoiceQuestion, Decider, Decision as Answers } from "../llm/decide.ts";
import { describeRoll } from "../../shared/dice.ts";
import { HAZARD_KINDS } from "../../shared/rules/acts.ts";
import type { Mechanic, ThreatRead } from "../../shared/rules/types.ts";
import { currentBeat, presentCast } from "../../shared/scene/graph.ts";
import type { Character, Scene, Skill } from "../../shared/scene/types.ts";
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
 * action goes in *asterisks* or (parentheses), though plenty just narrate. Said in the questions it
 * decides (what they're attempting, what the rules resolve, out of character), not in every
 * decision's state, where it only unsettles judgements that don't turn on it.
 */
const READ_TURN = "plain words are what their character says out loud, and what they do is in *asterisks* or (parentheses), or plainly narrated (\"I open the door\")";

/** A clear read (the prototype's SCENE_ENDING_CONFIDENCE, its bar for what costs most to get wrong): what the rules resolve, and a threat left hanging. */
const SCENE_ENDING_CONFIDENCE = 0.6;

/** Social means are interchangeable ways to reach the same goal: the roll follows the player's method. */
export const SOCIAL: Skill[] = ["persuasion", "intimidation", "deception", "performance"];

/**
 * The tries that failed in this scene, in a line each: the routes' rolls that went against the
 * player, and (`rulings`) the GM's considered rulings that did, or said no without dice. The same
 * push again gets the same answer, however it's rolled.
 */
export function failedTries(scene: Scene, state: TurnView, options: { rulings?: boolean } = {}): string[] {
  return failedPushes(scene, state, options).map(p => p.line);
}

/** A try that failed in this scene: a route's roll (`route`) or one of the GM's rulings, in a line, and the answer it got. */
interface FailedPush { route?: string; line: string; answer: string }

function failedPushes(scene: Scene, state: TurnView, options: { rulings?: boolean } = {}): FailedPush[] {
  // The route as it was where it was rolled (beats can share an id: the yard's threat and the doubt beat's).
  const route = (from: string, id: string) => [...(scene.beats.find(b => b.id === from)?.transitions ?? []), ...(scene.anytime ?? [])].find(t => t.id === id && t.check);
  const rolled = state.path.flatMap(p => {
    const t = p.roll && !p.roll.success ? route(p.from, p.via) : undefined;
    return t ? [{ route: t.id, line: `turn ${p.turn}: ${t.when.replace(/\.$/, "")} (${describeRoll(p.roll!, t.check!.reason)}): ${t.check!.failure}`, answer: t.check!.failure }] : [];
  });
  const ruled = options.rulings === false ? [] : (state.rulings ?? []).filter(r => r.went === "failure")
    .map(r => ({ line: `turn ${r.turn}: ${r.act.replace(/\.$/, "")} (${r.roll ? describeRoll(r.roll) : "no roll: it couldn't work like that"}): ${r.changed}`, answer: r.changed }));
  return [...rolled, ...ruled];
}

const SKILL_TEXT: Record<Skill, string> = {
  persuasion: "Persuasion: winning someone over honestly, appeals, bargaining", deception: "Deception: lying, bluffing, disguises, tricks",
  intimidation: "Intimidation: threats and shows of force", insight: "Insight: reading someone's intentions or lies",
  performance: "Performance: music, poetry, acting, entertaining a crowd", perception: "Perception: noticing, spotting, listening",
  investigation: "Investigation: searching, deducing, examining clues", sleight_of_hand: "Sleight of hand: pickpocketing, palming, planting objects",
  stealth: "Stealth: sneaking, hiding", athletics: "Athletics: climbing, jumping, grappling, shoving, lifting",
  acrobatics: "Acrobatics: balance, tumbling, nimble escapes", animal_handling: "Animal handling: calming or controlling animals",
  arcana: "Arcana: magical lore, spells, enchanted objects", history: "History: knowledge of past events, peoples and places",
  nature: "Nature: plants, animals, weather, the land", religion: "Religion: gods, rites, holy objects",
  medicine: "Medicine: treating wounds, diagnosing", survival: "Survival: tracking, foraging, finding a way",
};
const DIFFICULTY = { easy: 10, moderate: 13, hard: 16 } as const;

/**
 * A risky attempt no route covers, as freeformCheck (director.ts:639-650) asks it, on
 * decisionState and as director.freeform: which skill decides it, and how hard (the fallback for a
 * considered turn whose review failed). The roll is the simulation's.
 */
export function freeformQuestions(): Record<string, ChoiceQuestion> {
  return {
    skill: { instructions: "The player is attempting something risky in a tabletop roleplaying scene (latest_player_turn). Which skill best decides whether it works?", criteria: SKILL_TEXT },
    difficulty: { instructions: "How hard is what the player is attempting, given the situation and the people involved?", criteria: {
      easy: "Easy: most people could manage it; only bad luck stops it.", moderate: "Moderate: a real chance of failure for most people.", hard: "Hard: it would take skill and luck.",
    } },
  };
}

/** freeformQuestions' answers as freeformCheck reads them: the skill, and the DC its difficulty sets (persuasion at 13 when it doesn't say). */
export function readFreeform(decision: Answers): { skill: Skill; dc: number } {
  const skill = (decision.answers.skill?.choice ?? "persuasion") as Skill;
  const dc = DIFFICULTY[(decision.answers.difficulty?.choice ?? "moderate") as keyof typeof DIFFICULTY] ?? 13;
  return { skill, dc };
}

// ---------------------------------------------------------------------------------------------
// Parked for combat (docs/migration-log.md, M2's "The old pipeline's salvage"): what the player's
// line does that the D&D rules resolve, as decideBefore asked it (director.ts:793-809) in the turn's
// one decision and read it (:887-893, a rest at once), then asked the act's details in a second small
// call (:988-1009, withMechanic's). The old pipeline's decide asked it for a character with a build;
// nothing asks it since its decide went with the rest of its scene steps, and a scene of the story
// resolves only the map's act (its mechanic chosen already, the turn's), narrating a spell said in
// words. The route an act held back (alsoQuestion) and the act that's only the means to something
// risky (meansQuestion) can ride along in the details call (mechanicDetails' `extra`).

/** Whether the player, in their line, is doing one of the things the game's rules resolve: a spell, a blow, a grab, a shove, a jump, a class feature, a rest. */
export function mechanicQuestion(rules: RulesOptions): ChoiceQuestion {
  return {
    instructions: `Is the player, in their latest turn, doing one of these things the game's rules resolve? (In a turn, ${READ_TURN}.)`,
    criteria: {
      // Offered to everyone: a character without magic who tries it gets the rules' "it doesn't come", not a fireball.
      cast: "Casting a spell now (naming a spell, or plainly working new magic). Not using what a spell already running gives them (seeing through a familiar's eyes, keeping up an illusion, a light already lit).",
      attack: "Attacking someone or something right now, to hurt a person or break a thing: a blow, a stab, a punch, a kick, a shot or a thrown weapon. Threats, grabs, shoves and drawing a weapon aren't attacks, and nor is tossing something to someone or working on something in hand.",
      grapple: "Grabbing hold of someone who'd resist, to hold or restrain them: a grapple, a headlock, pinning them, or a hold in a wrestling bout (a sparring partner resists too).",
      shove: "Shoving someone who'd resist: to knock them down, or push them back or away.",
      jump: "Jumping: across a gap or over something, up onto something, or down from it.",
      ...(rules.features?.length ? { feature: `Using one of their class features: ${rules.features.map(f => f.name).join(", ")}.` } : {}),
      short_rest: "Stopping to rest for an hour or so: catching their breath, binding wounds, a meal and a sit-down.",
      long_rest: "Sleeping the night, or resting for many hours.",
      none: "None of these.",
    },
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
 * gm/mechanics.ts): the mechanic question in a call of its own (`director.rules`), then, for a spell,
 * a blow, a grab, a shove, a jump or a feature, its details in a second small call (mechanicDetails:
 * which spell at whom, which blow, where they act from), `extra` questions riding along in it. None
 * when the line does nothing the rules resolve.
 */
export async function mechanicOf(decider: Decider, scene: Scene, state: TurnView, line: string, rules: RulesOptions, extra: Record<string, ChoiceQuestion> = {}): Promise<{ mechanic?: Mechanic; details?: Answers }> {
  const asked = await decider.decide(decisionState(scene, state, line), { mechanic: mechanicQuestion(rules) }, "director.rules");
  const act = readMechanic(asked);
  if (!act) return {};
  if (typeof act !== "string") return { mechanic: act };
  const detailed = await mechanicDetails(decider, scene, state, line, act, rules, extra);
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
