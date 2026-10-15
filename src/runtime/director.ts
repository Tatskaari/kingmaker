import type { ChoiceAnswer, ChoiceQuestion, Decider, Decision } from "../llm/decide.ts";
import { currentBeat, IMPROVISED_EXIT_ID, offstageCast, openRoutes, presentCast, scriptTranscript, sceneEntries } from "./brief.ts";
import { describeRoll, titleCase, type RollResult } from "./dice.ts";
import { HAZARD_KINDS, rollFor, type SpellChoice, type WeaponChoice } from "../rules/dnd.ts";
import { SKILLS, type Character, type Exit, type Scene, type Skill, type Transition } from "./scene.ts";
import type { SceneStatus, SessionState } from "./session.ts";
import { worldView } from "../world/scene-world.ts";

/** What the director decided this turn, and what the GM must make happen. */
export interface Move {
  transition: Transition;
  phase: "attempt" | "cue" | "outcome";
  roll?: RollResult;
  /** Beat or exit id we end up at (may equal the current beat after a failed check). */
  to: string;
  exit?: Exit;
  /** The player chose this outcome (their own attempt, and the dice didn't say otherwise). */
  chosen: boolean;
}

/** A risky attempt none of the scene's routes cover: rolled, narrated, but it moves no beat. */
export interface FreeformCheck { skill: Skill; dc: number; roll: RollResult }

const phaseOf = (t: Transition): "attempt" | "cue" | "outcome" => t.on ?? (t.check ? "attempt" : "outcome");

function decisionState(scene: Scene, state: SessionState, latestPlayerTurn: string, reply?: string) {
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

const QUESTION_TEXT = {
  attempt: `A player in a tabletop roleplaying scene has just taken their turn (latest_player_turn). Which of these is the player attempting or doing in that turn? Judge the player's own words and actions in context: ${READ_TURN}. A passing mention is not an attempt. If none clearly applies, choose none.`,
  cue: "Pacing judgement for a tabletop roleplaying scene. Given the scene so far and the player's latest turn, should one of these happen right now? Choose not_yet unless its condition clearly holds now.",
  outcome: "After the latest exchange in a tabletop roleplaying scene (latest_player_turn and latest_gm_reply), which of these has now actually happened in the story? Count only what has happened in the fiction (said, shown, given, decided), not what was merely offered, hinted at or attempted. If none clearly happened, choose none.",
} as const;

/** Does taking this transition (on success, for a check) end the scene? */
export function endsScene(scene: Scene, t: Transition): boolean {
  const target = t.check ? t.check.onSuccess : t.to;
  return scene.exits.some(e => e.id === target);
}

/** The bar for a mistake scales with its cost: ending the scene needs a committed attempt. */
const SCENE_ENDING_CONFIDENCE = 0.6;

/**
 * A considered turn costs the player seconds, so the flag wants a clear read: on the QA runs' turns
 * every act a table would roll for read 0.84 or more ("route" and "new" together), and small honest
 * asks and making a case 0.62 to 0.64.
 */
const CONSIDER_CONFIDENCE = 0.7;

/**
 * In a beat with no route with a roll the flag can only say "new" or "none", and reads lower: big
 * asks of Moll in the motive beat read 0.57 to 0.63 and went unflagged. There the bar is lower,
 * set where the controls (plain questions, making the case) still stay under it.
 */
export const CONSIDER_CONFIDENCE_OPEN = 0.5;

/**
 * A pacing cue moves the scene on without the player's say, so it fires only on a clear read, as a
 * route with a roll does. It had no bar: the Heron's Master came in at 0.57 against 0.43, one
 * exchange after the player got inside. In the decision suite the cues that should fire read 0.87
 * and 0.98 (and goblins losing patience at a roared threat 0.65, where the threat outranks it).
 */
export const CUE_CONFIDENCE = 0.6;

/**
 * A cue that counts exchanges ("at least five exchanges at this point") is checked against the
 * engine's own count, the exchanges at this point (`turnsInBeat`, which an out-of-character turn
 * doesn't add to). Before its count, only the rest of its condition can fire it ("or is lying low
 * and waiting"), and only when that clearly holds.
 */
export const CUE_EARLY_CONFIDENCE = 0.8;

const NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const HOW_MANY = `\\d+|an?|a couple of|${NUMBERS.join("|")}`;
/** How cues count exchanges: "at least five exchanges", "two exchanges have gone by", "has waited an exchange". */
const COUNTED = [
  new RegExp(`\\bat least (${HOW_MANY}) exchanges?\\b`, "i"),
  new RegExp(`\\b(${HOW_MANY}) exchanges? (?:has|have) (?:gone by|passed)\\b`, "i"),
  new RegExp(`\\bwaited (${HOW_MANY}) exchanges?\\b`, "i"),
];

/** The exchanges a cue's condition counts ("at least five exchanges"), if it counts them ("several" doesn't). */
export function cueCount(t: Transition): number | undefined {
  const n = COUNTED.map(re => re.exec(t.when)?.[1]?.toLowerCase()).find(Boolean);
  if (!n) return undefined;
  if (/^\d+$/.test(n)) return Number(n);
  return n === "a" || n === "an" ? 1 : n === "a couple of" ? 2 : NUMBERS.indexOf(n) + 1;
}

/**
 * The pacing cues, each that counts exchanges with the engine's count beside it: whether that much
 * holds is the game's to say, and the decider judges the rest.
 */
function cueQuestion(cues: Transition[], exchanges: number): ChoiceQuestion {
  const q = question("cue", cues);
  const counted = (t: Transition) => {
    const n = cueCount(t);
    if (n === undefined) return t.when;
    const so = exchanges >= n ? "so that much holds" : "so that part doesn't hold yet: choose this only if the rest of it clearly holds on its own";
    return `${t.when} [The game's count: ${exchanges} exchange${exchanges === 1 ? "" : "s"} at this point so far, against the ${n} this asks for, ${so}.]`;
  };
  return { ...q, criteria: { ...Object.fromEntries(cues.map(t => [t.id, counted(t)])), not_yet: q.criteria.not_yet! } };
}

/**
 * Something daft, reckless or cheeky that the world would answer (the consequences flag): what the
 * player does or says, not what they ask for. A courteous ask, an honest offer, a case made or a plan
 * is never billed, however bold. Brother Ambrose's polite look at the evidence (the granary's T18),
 * eel for a look in Cob's boot (the Rat's T43) and a safe house for Hobb's mother (T57) were billed at
 * 0.60 to 0.63 under the old wording, and read 0.02 to 0.38 under this one (pressing the King, 0.59);
 * the absurd round's daft acts read 0.93 to 0.99 under it, but for a purse of buttons (0.56, and
 * 0.44 before). Hence the bar: 0.7.
 */
export const DAFT_CONFIDENCE = 0.7;

const DAFT_QUESTION: ChoiceQuestion = {
  instructions: "Does the player's latest turn include something daft, reckless or cheeky that people in this world would really react to: a stunt or showing off where there's danger, mocking someone or what they hold dear, an insult, taking, using or spoiling what's someone else's without asking, a scam, a bluff or a lie, or going back on their word? Judge what the player actually does or says, by how the people here would take it, not by whether it's funny. Earnest play isn't daft, however bold: asking for something (to see it, for help, for evidence), an honest offer (food, coin, a trade), making a case or an accusation from what they've seen, pressing someone for answers, or proposing a plan (where someone could hide, what to do tonight), even one the others turn down.",
  criteria: {
    consequential: "Yes: something daft, reckless or cheeky that in this world would provoke a real reaction or carry a real risk.",
    harmless: "It's playful, but nobody here would mind or be put at risk.",
    none: "Nothing daft or reckless in it: ordinary talk and questions, or earnest play (an ask, an honest offer, a case made, a plan).",
  },
};

/** The cue the decider chose, if its read clears the bar: a clear read, and a clearer one before its count. */
function firedCue(cues: Transition[], read: ChoiceAnswer | undefined, exchanges: number): Transition | undefined {
  const cue = cues.find(t => t.id === read?.choice);
  if (!cue) return undefined;
  const count = cueCount(cue);
  const bar = count !== undefined && exchanges < count ? CUE_EARLY_CONFIDENCE : CUE_CONFIDENCE;
  return (read!.probabilities?.[cue.id] ?? 1) >= bar ? cue : undefined;
}

/**
 * A check is rolled for the act it tests, so the attempt is judged against that act: getting to
 * where it can be done (getting him down, getting the door open) is an act of its own, for the
 * rules or the story, not a reason to roll this.
 */
function rollNote(t: Transition): string {
  const check = t.check!;
  return `(The ${titleCase(check.skill)} check is ${check.reason ? check.reason.trim().replace(/\.$/, "") : "for this act itself"}: only when the player is doing that now, not something that comes first.)`;
}

function question(phase: keyof typeof QUESTION_TEXT, transitions: Transition[], scene?: Scene): ChoiceQuestion {
  const none = phase === "cue" ? "not_yet" : "none";
  const describe = (t: Transition) => {
    if (!(phase === "attempt" && scene)) return t.when;
    const when = t.check ? `${t.when} ${rollNote(t)}` : t.when;
    if (!endsScene(scene, t)) return when;
    const exit = scene.exits.find(e => e.id === (t.check ? t.check.onSuccess : t.to));
    const violence = exit?.kind === "combat" ? " Only if they are actually trying to hurt someone right now: threats, grabs and taking a hostage are leverage, not an attack." : "";
    return `${when} (This would settle the whole scene: only if the player is clearly committing to it right now, not asking about it, examining things or thinking aloud.${violence})`;
  };
  return {
    instructions: QUESTION_TEXT[phase],
    criteria: {
      ...Object.fromEntries(transitions.map(t => [t.id, describe(t)])),
      [none]: phase === "cue" ? "None of these should happen yet." : "None of the above clearly applies.",
    },
  };
}

function transitionsFor(scene: Scene, state: SessionState, phase: "attempt" | "cue" | "outcome"): Transition[] {
  if (state.fought?.length) return transitionsFor({ ...scene, beats: scene.beats.map(b => ({ ...b, transitions: b.transitions.filter(t => !state.fought!.includes(t.to ?? "")) })), anytime: (scene.anytime ?? []).filter(t => !state.fought!.includes(t.to ?? "")) }, { ...state, fought: [] }, phase);
  const beat = currentBeat(scene, state);
  return openRoutes([...beat.transitions, ...(scene.anytime ?? [])], state).filter(t => phaseOf(t) === phase);
}

/** Social means are interchangeable ways to reach the same goal: the roll follows the player's method. */
export const SOCIAL: Skill[] = ["persuasion", "intimidation", "deception", "performance"];

/**
 * Considered rolls' flag (asked in the decision the turn makes anyway): would a good GM call for a
 * roll, and is it what one of the scene's routes with a roll is for? Its "yes" is split in two (a
 * route's, or none's), and the two count together for whether a roll is wanted at all.
 */
function rollCallQuestion(checks: Transition[]): ChoiceQuestion {
  const routes = checks.map(t => `[${t.id}] ${titleCase(t.check!.skill)} ${t.check!.reason ? t.check!.reason.trim().replace(/\.$/, "") : `(${t.when.replace(/\.$/, "")})`}`);
  return {
    instructions: `A good tabletop GM calls for a roll when what the player attempts could go either way and failing would cost something or change things, and otherwise just says yes or no. In the player's latest turn (${READ_TURN}), are they attempting something like that? Either working on someone for something that matters to that person (their safety, what they own or hold, what they know or hide, their loyalty, their pride), by whatever means: persuading, bargaining, bribing, threatening, lying, bluffing, forging, reading them, performing. Or a physical or sneaky feat that could fail (climbing, forcing, palming, sneaking past someone), or dredging up something obscure. Judge what they actually do and ask for, and what giving it would cost the other person, not how boldly or kindly it's put.`,
    criteria: {
      ...(routes.length ? { route: `Yes, and it's squarely what one of these is for: the same person, the same thing asked or tried, and its payoff is what the player is after: ${routes.join("; ")}.` } : {}),
      new: routes.length
        ? "Yes, but none of those is for it: someone else, a different ask, a different payoff, or another kind of attempt."
        : "Yes: an attempt like that, whose outcome is genuinely uncertain.",
      none: "No roll needed: ordinary talk, questions someone would happily answer, accepting what's offered, keeping a promise already made, a small ask nobody would think twice about, looking properly, searching or working out what's in front of them, something that simply works, or something that plainly can't.",
    },
  };
}

/**
 * The tries that failed in this scene, in a line each: the routes' rolls that went against the
 * player, and (`rulings`) the GM's considered rulings that did, or said no without dice. The same
 * push again gets the same answer, however it's rolled.
 */
export function failedTries(scene: Scene, state: SessionState, options: { rulings?: boolean } = {}): string[] {
  // The route as it was where it was rolled (beats can share an id: the yard's threat and the doubt beat's).
  const route = (from: string, id: string) => [...(scene.beats.find(b => b.id === from)?.transitions ?? []), ...(scene.anytime ?? [])].find(t => t.id === id && t.check);
  const rolled = state.path.flatMap(p => {
    const t = p.roll && !p.roll.success ? route(p.from, p.via) : undefined;
    return t ? [`turn ${p.turn}: ${t.when.replace(/\.$/, "")} (${describeRoll(p.roll!, t.check!.reason)}): ${t.check!.failure}`] : [];
  });
  const ruled = options.rulings === false ? [] : (state.rulings ?? []).filter(r => r.went === "failure")
    .map(r => `turn ${r.turn}: ${r.act.replace(/\.$/, "")} (${r.roll ? describeRoll(r.roll) : "no roll: it couldn't work like that"}): ${r.changed}`);
  return [...rolled, ...ruled];
}

/**
 * The same push again (a try that failed, tried again with nothing new on the table), asked in the
 * turn's own decision when something has failed in this scene: a route's roll isn't rolled again
 * for it, as the GM's ruling wouldn't be.
 */
function sameAgainQuestion(tried: string[]): ChoiceQuestion {
  return {
    instructions: `Earlier in this scene the player tried these, and they failed:\n${tried.map(t => `- ${t}`).join("\n")}\nIs the player's latest turn the same push as one of those again: the same ask of the same person by the same means, reworded or louder, with nothing new on the table? A new lever (an offer, a threat or a promise not made before, evidence, something learned since), a different ask or person, or a real change in the situation since makes it a new try.`,
    criteria: { same: "The same push again, with nothing new.", new: "A new try, or not one of these at all." },
  };
}

/** A route's check, rolled for the move (its method swapped for the player's, among social means). */
export async function resolve(scene: Scene, state: SessionState, transition: Transition, phase: Move["phase"], means?: Skill): Promise<Move> {
  let to = transition.to ?? state.beat;
  let roll: RollResult | undefined;
  if (transition.check) {
    // Preserve intent, change method: a threat aimed at a route written for persuasion rolls intimidation.
    const skill = means && means !== transition.check.skill && SOCIAL.includes(means) && SOCIAL.includes(transition.check.skill) ? means : transition.check.skill;
    roll = await rollFor(state, skill, transition.check.dc);
    to = roll.success ? transition.check.onSuccess : transition.check.onFailure ?? state.beat;
  }
  const exit = scene.exits.find(e => e.id === to);
  const chosen = phase === "attempt" && (!roll || roll.success);
  return { transition, phase, to, chosen, ...(roll ? { roll } : {}), ...(exit ? { exit } : {}) };
}

/**
 * The player pressing someone for what they're hiding (docs/research/dc-guidance.md). The ruling
 * comes from what telling would cost them (stakes), what the player says, offers or shows
 * (approach) and how they feel about the player now (disposition): say yes, say no and show what
 * would reach them, or roll at DC 12/15/18.
 */
export interface PressureCheck {
  target: string; skill: Skill; stakes: string; approach: string; disposition: string;
  /** Which of their secrets the player is after (index), when it's clear: only that one comes out. */
  secret?: number;
  ruling: "yes" | "no" | "roll";
  /** Why there's no roll: they'd tell anyway, the lever can't move them, too far, the same push again, or already won. */
  why?: "free" | "lever" | "too_far" | "same_again" | "won";
  dc?: number; roll?: RollResult;
  band?: "yes_and" | "yes" | "no_but" | "no_and";
}

export interface PreDecision {
  /** The player did something daft or reckless that the world would really answer. */
  daft?: boolean;
  /** The player has just done what it takes to get what they've been working towards: let it land. */
  earned?: boolean;
  /** A pressure roll for a character's secret. */
  pressure?: PressureCheck;
  /** Essentials to bring to the player now, and through whom (decider relocation). */
  relocate?: Array<{ essential: string; carrier: string }>;
  /** The player is pursuing a way through the scene that none of its routes covers. */
  offGraph?: boolean;
  /** The player stepped out of character (a question to the GM, not the world). */
  ooc?: boolean;
  /** The outcome route the player's action simply achieves, no dice needed. */
  plainTransition?: Transition;
  /** The player is reaching for something the scene says it can't offer. */
  limit?: string;
  move?: Move;
  speaker?: string;
  decision?: Decision;
  /** The player is doing something that simply happens (an outcome route), no dice. */
  plain?: boolean;
  /** A risky attempt outside the scene's routes, already rolled. */
  freeform?: FreeformCheck;
  /** Something the rules resolve (rules sessions): a spell, a blow, a rest. */
  mechanic?: Mechanic;
  /**
   * Considered rolls: the player is attempting something a roll should settle that none of the
   * scene's routes does (another person, another ask, another payoff), so the GM rules on it before
   * replying. Nothing was rolled or moved for it here. `routes`: the routes with a roll the decider
   * leant towards, nearest first; `means`: the method, when it's sure (asked in every beat when
   * rolls are considered); `earned`: how far it thought the player had already met the person's
   * terms, when it half thought so.
   */
  considered?: { probability: number; routes: Array<{ id: string; p: number }>; means?: Skill; earned?: number };
  /** The route the player chose, not rolled again: the same push that already failed in this scene, with nothing new. */
  sameAgain?: Transition;
}

/** What the player is doing that the D&D rules resolve, and with what. */
export type Mechanic =
  | { kind: "cast"; spell: string; targets: string[]; from?: ActFrom }
  | { kind: "wrestle"; target: string; how: "grapple" | "prone" | "push"; from?: ActFrom }
  | { kind: "attack"; target: string; weapon?: string; from?: ActFrom }
  | { kind: "rest"; length: "short" | "long" }
  | { kind: "feature"; feature: string; target?: string }
  | Jumping;

/**
 * A jump (the same rule in a scene, on the map and in a fight): where to (an area, or by
 * something), over what if they fall short, and how far, from the world when it knows.
 */
export interface Jumping { kind: "jump"; how: "long" | "high" | "down"; runUp: boolean; to?: ActFrom; over?: string; water?: boolean; feet?: number; drop: number }

/**
 * Where the player acts from, when they move first in the same turn ("I stride thirty feet down
 * the lane and cast Fireball at the elm"): the world moves them there before the rules roll, or
 * the spell goes off from where they were.
 */
export interface ActFrom { area?: string; near?: string; backOff?: number }

/** The player's spells and weapons, and what's around them in the world, for the decider (rules sessions only). */
export interface RulesOptions {
  spells: SpellChoice[];
  weapons: WeaponChoice[];
  /** Class features they can use (Second Wind, Rage...). */
  features?: Array<{ id: string; name: string; target: "self" | "creature" }>;
  /** Things near the player a spell or a blow could be aimed at (scenes with a world). */
  things?: Array<{ id: string; name: string }>;
  /** People in the world who aren't in the cast (a crowd, someone who walked in). */
  bystanders?: Array<{ id: string; name: string }>;
  /** The place's areas, and what in it someone could walk over to: where the player might act from. */
  places?: Array<{ id: string; name: string }>;
  landmarks?: Array<{ id: string; name: string }>;
}

const ORDINAL = ["cantrip", "1st-level", "2nd-level", "3rd-level", "4th-level", "5th-level", "6th-level", "7th-level", "8th-level", "9th-level"];

/** The player's acts the rules resolve in a scene (a rest aside): on those turns, the act is the turn's resolution. */
type RuledAct = "cast" | "attack" | "grapple" | "shove" | "jump" | "feature";
const RULED_ACTS: readonly string[] = ["cast", "attack", "grapple", "shove", "jump", "feature"] satisfies RuledAct[];
const ACT_NAMES: Record<RuledAct, string> = { cast: "the spell", attack: "the attack", grapple: "the grab", shove: "the shove", jump: "the jump", feature: "the class feature" };

/**
 * On a turn the rules resolve the player's act, a route's check is rolled as well only when the
 * player is also doing exactly what that check is for, and it doesn't hang on how the act turns
 * out ("I throw my javelin at the rope" isn't examining the body it may bring down: that waits until
 * it's down). Asked in the act's details call, so ordinary turns pay nothing for it.
 */
function alsoQuestion(t: Transition, act: RuledAct): ChoiceQuestion {
  const check = t.check!;
  const what = check.reason?.trim().replace(/\.$/, "") || t.when.replace(/\.$/, "");
  return {
    instructions: `The game's rules settle ${ACT_NAMES[act]} in the player's latest turn. Besides that, is the player also, in the same turn, doing what this ${titleCase(check.skill)} check is for (${what})? Only if they're doing that act itself now, whatever comes of ${ACT_NAMES[act]}: not if it's what ${ACT_NAMES[act]} is meant to make possible, or something for after it.`,
    criteria: { yes: "Yes: they're doing that too, this turn, and it doesn't wait on how the rules' act turns out.", no: "No: the rules' act is what they're doing now; that can come after it." },
  };
}

/**
 * Which spell, at whom; or which blow, at whom: a second small call, only on those turns. Any
 * `extra` questions about the same turn ride along in it.
 */
async function mechanicDetails(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, kind: RuledAct, rules: RulesOptions, extra: Record<string, ChoiceQuestion> = {}): Promise<{ mechanic?: Mechanic; decision: Decision }> {
  if (kind === "jump") return jumpDetails(decider, scene, state, playerTurn, rules, extra);
  const present = [...presentCast(scene, state), ...(rules.bystanders ?? []).map(b => ({ ...b, group: undefined }))];
  if (kind === "feature") {
    const features = rules.features ?? [];
    const q: Record<string, ChoiceQuestion> = { ...extra, feature: { instructions: "The player is using a class feature in their latest turn. Which?", criteria: Object.fromEntries(features.map(f => [f.id, f.name])) } };
    if (features.some(f => f.target === "creature")) q.feature_for = { instructions: "If it's one they give to someone else, who?", criteria: { ...Object.fromEntries(present.map(c => [c.id, `${c.name}${c.group ? ` (${c.group})` : ""}`])), nobody: "Nobody else: themselves, or it isn't that kind." } };
    const decision = await decider.decide(decisionState(scene, state, playerTurn), q, "director.feature");
    const feature = features.find(f => f.id === decision.answers.feature?.choice);
    const target = decision.answers.feature_for?.choice;
    return feature ? { mechanic: { kind: "feature", feature: feature.id, ...(feature.target === "creature" && target && target !== "nobody" ? { target } : {}) }, decision } : { decision };
  }
  // No spells at all: whatever they reach for isn't theirs (no call needed for which).
  if (kind === "cast" && !rules.spells.length) {
    const decision = Object.keys(extra).length ? await decider.decide(decisionState(scene, state, playerTurn), extra, "director.mechanic") : { answers: {}, latencyMs: 0, costUsd: 0, decider: decider.name };
    return { mechanic: { kind: "cast", spell: "not_theirs", targets: [] }, decision };
  }
  const things = rules.things ?? [];
  const q: Record<string, ChoiceQuestion> = { ...extra };
  if (kind === "cast") {
    q.spell = {
      instructions: "The player is casting a spell in their latest turn. Which of their spells is it?",
      criteria: { ...Object.fromEntries(rules.spells.map(sp => [sp.id, `${sp.name} (${ORDINAL[sp.level]})`])), not_theirs: "A spell or kind of magic that isn't one of these." },
    };
    for (const c of present) q[`aim_${c.id}`] = { instructions: `Is ${c.group ? `anyone in this group (${c.group})` : c.name} a target of the spell?`, criteria: { yes: "Yes", no: "No" } };
    q.aim_self = { instructions: "Is the player casting the spell on themselves?", criteria: { yes: "Yes", no: "No" } };
    if (things.length) q.aim_thing = {
      instructions: "Is the spell aimed at a thing or a spot rather than a person (its target, or where its area is centred)? Which?",
      criteria: { ...Object.fromEntries(things.map(t => [t.id, t.name])), none: "No: it's aimed at people, at the player, or at nothing in particular." },
    };
  } else if (kind === "grapple" || kind === "shove") {
    q.target = { instructions: `Whom is the player trying to ${kind === "grapple" ? "grab" : "shove"}?`, criteria: Object.fromEntries(present.map(c => [c.id, `${c.name}${c.group ? ` (${c.group})` : ""}`])) };
    if (kind === "shove") q.shove_mode = { instructions: "To do what?", criteria: { prone: "Knock them down", push: "Push them back or away" } };
  } else {
    q.target = {
      instructions: "The player is attacking someone or something in their latest turn. Who or what?",
      criteria: { ...Object.fromEntries(present.map(c => [c.id, `${c.name}${c.group ? ` (${c.group})` : ""}`])), ...Object.fromEntries(things.map(t => [t.id, `${t.name} (a thing)`])) },
    };
    q.weapon = {
      instructions: "With what?",
      criteria: { ...Object.fromEntries(rules.weapons.map(w => [w.id, w.name])), other: "Something else (an improvised weapon, a thrown object), or not clear" },
    };
  }
  // Where they act from: moving first in the same turn changes who an area catches (two more
  // questions in this call; on the eval's turns Jev placed the player right 48/48, Luna decisions
  // 42/48 with the confidence floor below, against 27/48 for the old spot).
  if (rules.places?.length) {
    q.act_from = {
      instructions: "The player is casting a spell or striking in their latest turn. Where are they when they do it? If they move first in the same turn (walk, climb, cross the room, back off), it's where they end up.",
      criteria: {
        here: "Where they are now: they don't move first (turning, standing up or steadying themselves on the spot doesn't count).",
        ...Object.fromEntries(rules.places.map(p => [`area:${p.id}`, `They move first: somewhere in ${p.name}, not by anything in particular.`])),
        ...Object.fromEntries((rules.landmarks ?? []).map(l => [`near:${l.id}`, `They move first: to ${l.name}.`])),
      },
    };
    q.act_back_off = {
      instructions: "Before acting, does the player back off or walk away from what they're aiming at? If so, about how far from it do they end up?",
      criteria: { no: "No: they don't back away from it.", "15": "About ten to fifteen feet from it.", "30": "About twenty to thirty feet from it.", "50": "Forty feet or more from it." },
    };
  }
  // The world, so "where they are now" means something.
  const decision = await decider.decide({ ...decisionState(scene, state, playerTurn), ...(q.act_from && state.world ? { world: worldView(state.world) } : {}) }, q, "director.mechanic");
  // An unsure answer leaves the player where they are (as before) rather than somewhere wrong.
  const sure = (id: string, otherwise: string) => { const a = decision.answers[id]; return a && (a.probabilities?.[a.choice] ?? 1) >= 0.5 ? a.choice : otherwise; };
  const actFrom = (aim: string | undefined): ActFrom | undefined => {
    const where = sure("act_from", "here");
    const back = sure("act_back_off", "no");
    const from: ActFrom = {
      ...(where.startsWith("area:") ? { area: where.slice(5) } : {}),
      ...(where.startsWith("near:") ? { near: where.slice(5) } : {}),
      // A named spot wins over backing off (to the door, behind the butt); backing off from the target itself is a distance.
      ...(back !== "no" && aim && (!where.startsWith("near:") || where.slice(5) === aim) ? { backOff: Number(back) } : {}),
    };
    return Object.keys(from).length ? from : undefined;
  };
  if (kind === "cast") {
    const spell = decision.answers.spell?.choice;
    if (!spell) return { decision };
    const thing = decision.answers.aim_thing?.choice;
    // The thing first: an area spell centres on what it's aimed at.
    const targets = [...(thing && thing !== "none" ? [thing] : []), ...present.filter(c => decision.answers[`aim_${c.id}`]?.choice === "yes").map(c => c.id), ...(decision.answers.aim_self?.choice === "yes" ? ["self"] : [])];
    const from = actFrom(targets.find(t => t !== "self"));
    return { mechanic: { kind, spell, targets, ...(from ? { from } : {}) }, decision };
  }
  const target = decision.answers.target?.choice;
  if (kind === "grapple" || kind === "shove") {
    if (!target || !present.some(c => c.id === target)) return { decision };
    return { mechanic: { kind: "wrestle", target, how: kind === "grapple" ? "grapple" : decision.answers.shove_mode?.choice === "push" ? "push" : "prone" }, decision };
  }
  if (!target || !(present.some(c => c.id === target) || things.some(t => t.id === target))) return { decision };
  const weapon = decision.answers.weapon?.choice;
  const from = actFrom(target);
  // "Something else" (a thrown stone, a bottle) is an improvised weapon, not their main one.
  return { mechanic: { kind, target, ...(weapon === "other" ? { weapon: "improvised" } : weapon ? { weapon } : {}), ...(from ? { from } : {}) }, decision };
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

/** A risky attempt no route covers, rolled on the decider's skill and difficulty (and the fallback for a considered turn whose review failed). */
export async function freeformCheck(decider: Decider, scene: Scene, state: SessionState, playerTurn: string): Promise<{ check: FreeformCheck; decision: Decision }> {
  const decision = await decider.decide(decisionState(scene, state, playerTurn), {
    skill: { instructions: "The player is attempting something risky in a tabletop roleplaying scene (latest_player_turn). Which skill best decides whether it works?", criteria: SKILL_TEXT },
    difficulty: { instructions: "How hard is what the player is attempting, given the situation and the people involved?", criteria: {
      easy: "Easy: most people could manage it; only bad luck stops it.", moderate: "Moderate: a real chance of failure for most people.", hard: "Hard: it would take skill and luck.",
    } },
  }, "director.freeform");
  const skill = (decision.answers.skill?.choice ?? "persuasion") as Skill;
  const dc = DIFFICULTY[(decision.answers.difficulty?.choice ?? "moderate") as keyof typeof DIFFICULTY] ?? 13;
  return { check: { skill, dc, roll: await rollFor(state, skill, dc) }, decision };
}

/** Before the reply: is the player attempting a transition, or should a pacing cue fire? Plus who speaks first. */
/**
 * The pressure details (means, approach, disposition, stakes), asked in a second small call only
 * when someone is being pressed: in the main decision they cost every turn ~0.7 s.
 */
async function pressureDetails(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, target: Character): Promise<Decision> {
  const q: Record<string, ChoiceQuestion> = {};
  if ((target.secrets?.length ?? 0) > 1) {
    q.pressure_secret = {
      instructions: `Which of the things ${target.name} is hiding is the player after?`,
      criteria: { ...Object.fromEntries(target.secrets!.map((t, i) => [`secret_${i}`, t])), several: "More than one of these, or it's unclear which." },
    };
  }
  q.pressure_means = {
    instructions: `The player is pressing ${target.name} for what they're hiding. How?`,
    criteria: { persuasion: "An honest appeal, an argument, a bargain or reassurance.", intimidation: "Threats or a show of force.", deception: "A lie, a bluff or a trick.", insight: "Reading them: watching for tells, catching them out." },
  };
  const cards = [target].map(c => `${c.name}: wants ${c.wants.replace(/\.$/, "")}; fears ${(c.fears ?? "nothing in particular").replace(/\.$/, "")}; how they deal with people: ${c.attitude ?? "as their wants and fears suggest"}`).join("\n");
  q.pressure_approach = {
    instructions: `The player is pressing ${target.name} for what they're hiding. Judge what the player's character says, offers or shows, against who ${target.name} is. Judge the content, not how long or polished the writing is: a terse line with real leverage is strong; a fine speech with no reason in it is plausible at best.\n${cards}`,
    criteria: {
      free: "No roll needed: they'd tell this person anyway. It costs them nothing to say, their card says they'll share it if asked, or the player has already given them what they wanted.",
      no_chance: "It can't work on them: it pulls a lever that, by who they are, doesn't move them (their card says so, or no one could get it out of them this way), and nothing has changed that.",
      weak: "No real reason to tell: a bare demand or a repeat, a bribe or threat with no grip on this person, or a lie they can see through.",
      plausible: "A fair appeal, offer, threat or bluff that gives them some reason, but isn't aimed at what this person in particular wants or fears.",
      strong: "Real leverage on this person: it offers what they want, protects what they fear for, or uses evidence or something learned in play that they can't brush off.",
      excellent: "Strong leverage, played in character and aimed squarely at this person (their wants, their fears, what they just said): the kind of case that would sway a real person.",
    },
  };
  q.pressure_disposition = {
    instructions: `How does ${target.name} feel about the player right now? Judge by the scene so far: their starting attitude, then what has happened.`,
    criteria: { hostile: "Dislikes, distrusts or fears the player right now, or wants them gone.", wary: "Neutral, guarded, or not yet sure of them.", friendly: "Likes or trusts them, owes them, or has been won over in this scene." },
  };
  if (lastPressure(state, target.id)?.band?.startsWith("no")) {
    q.pressure_new_angle = {
      instructions: `The player already pressed ${target.name} once in this scene and it didn't work. Is this a new angle?`,
      criteria: { new: "A new angle: new leverage or evidence, a different lever, or something important has changed since the last try.", same: "The same push again, reworded or louder." },
    };
  }
  for (const c of [target]) {
    q[`stakes_${c.id}`] = {
      instructions: `What would it cost ${c.name}, as they see it, to give up what the player is after? (What they're hiding: ${c.secrets!.join(" ")})`,
      criteria: {
        trivial: "Costs them nothing much to say: gossip, a mild embarrassment, something they'd tell anyone who asked nicely.",
        guarded: "Costs them something real but survivable: pride, a scolding, money, a favour or a deal, a friend's annoyance.",
        dangerous: "Puts something big at risk: their safety, livelihood or standing, or someone they protect.",
        ruinous: "Could destroy them: their life, a sworn oath or their deepest loyalty, or the person they love most.",
      },
    };
  }
  return decider.decide({ ...decisionState(scene, state, playerTurn), person_being_pressed: target.name }, q, "director.pressure");
}

/** The decider's name for what a mechanic is, as the mechanic question would have answered it. */
function rulingOf(m: Mechanic): string {
  switch (m.kind) {
    case "wrestle": return m.how === "grapple" ? "grapple" : "shove";
    case "rest": return m.length === "short" ? "short_rest" : "long_rest";
    default: return m.kind;
  }
}

/**
 * Before the reply: is the player attempting a transition, should a pacing cue fire, and what do the
 * rules resolve? `forced`: what the rules resolve this turn, chosen already (the map's action menu),
 * in place of asking.
 */
export async function decideBefore(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, options: { speaker: boolean; freeform?: boolean; offGraph?: boolean; relocate?: boolean; pressure?: boolean; consequences?: boolean; considered?: boolean; rules?: RulesOptions; forced?: Mechanic }): Promise<PreDecision> {
  const attempts = transitionsFor(scene, state, "attempt");
  const cues = transitionsFor(scene, state, "cue");
  // Outcomes that need no roll are shown as alternatives, so the decider can see that a kind
  // word might simply work; choosing one means "no attempt now" (it's judged after the reply).
  // The built-in improvised ending, and what only someone else can give, are only ever judged
  // after the reply, on what happened.
  const outcomes = transitionsFor(scene, state, "outcome").filter(t => t.to !== IMPROVISED_EXIT_ID && !t.given);
  const questions: Record<string, ChoiceQuestion> = {};
  if (attempts.length || outcomes.length || options.freeform === true) {
    const q = question("attempt", attempts, scene);
    questions.attempt = {
      instructions: `${q.instructions} Some things need no dice: if the player's turn is better described by one of the "simply happens" options, choose that. ${options.freeform === true ? " Choose other_risky only for a genuinely uncertain attempt that none of the listed options covers." : " Risky things none of the options cover are for the GM to resolve in the story: choose none."}`,
      criteria: {
        ...q.criteria,
        none: "Nothing risky and none of the above: the player talks, asks, accepts an offer, looks around or searches at leisure, or does something with no real chance or cost of failure.",
        ...Object.fromEntries(outcomes.map(t => [`plain:${t.id}`, `Simply happens, no dice needed: ${t.when}`])),
        ...(options.freeform === true ? { other_risky: "The player attempts something risky whose outcome is genuinely uncertain (sneaky, physical, magical or social), where failure would change the situation, and that none of the options above covers. Not risky: ordinary talk and questions, accepting something someone has just offered, looking around or searching when nothing is pressing, or anything where failing would only mean trying again." } : {}),
      },
    };
  }
  // The method: for a route written for one social means, and (considered rolls) in every beat, so
  // the GM's review hears a lie read as a lie wherever it's told.
  if (options.considered || attempts.some(t => t.check && SOCIAL.includes(t.check.skill))) {
    questions.attempt_means = {
      instructions: "If the player is working on someone in their latest turn, by what means?",
      criteria: { persuasion: "Persuading: an appeal, an argument, a bargain, reassurance or flattery.", intimidation: "Intimidating: threats, menace or a show of force.", deception: "Deceiving: a lie, a bluff, a disguise or a trick.", performance: "Performing: a speech, a song or a show for a crowd.", none: "Not working on anyone, or something else." },
    };
  }
  if (cues.length) questions.cue = cueQuestion(cues, state.turnsInBeat);
  // Considered rolls: whether a roll is wanted, and whether a route's roll is for it, in this call.
  if (options.considered) questions.roll_call = rollCallQuestion(attempts.filter(t => t.check));
  // The same push that already failed here, again: asked only once something has failed.
  const tried = attempts.some(t => t.check) ? failedTries(scene, state) : [];
  if (tried.length) questions.same_again = sameAgainQuestion(tried);
  if (options.offGraph) {
    const routes = [...currentBeat(scene, state).transitions, ...(scene.anytime ?? [])].map(t => t.when);
    questions.off_graph = {
      instructions: `Is the player, in their latest turn, proposing or pursuing a way to deal with the scene's central situation that none of the scene's routes describes? A plan put as a question ("could we...?", "what if we...?") counts. The routes: ${routes.map(r => `"${r}"`).join("; ")}. Ordinary conversation, questions about the situation and small actions don't.`,
      criteria: { off_graph: "Yes: a real attempt or proposal to resolve or change the situation by a means none of the routes describes.", covered: "No: it matches a route, or it's ordinary play." },
    };
  }
  // Relocation is for when play has gone elsewhere: not before the player has had a fair chance
  // at where the author placed it (early reveals through the original carrier aren't relocation).
  const playerTurns = sceneEntries(state).filter(e => e.kind === "player").length;
  const missing = options.relocate && playerTurns >= 2 ? (scene.essentials ?? []).filter(e => !state.landed?.includes(e.id)).slice(0, 3) : [];
  const present = presentCast(scene, state);
  for (const e of missing) {
    // Relocation means a new carrier: delivery through the authored one belongs to its authored edge.
    const others = present.filter(c => !(e.carriers ?? []).includes(c.id));
    questions[`relocate_${e.id}`] = {
      instructions: `In a roleplaying scene the player needs to come across this: "${e.what}" The author placed it with: ${e.placedWith.join("; ")}. Has the player passed up or turned away from where it was placed (ignoring or refusing that person, not looking at that place) while busy with something else? If so, should it now reach them through someone or something else they are engaging with in their latest turn? The carrier must plausibly know or show it (nobody gains knowledge they couldn't have) and must never be someone the player is avoiding. Choose not_now if the player hasn't passed it up, is still heading towards it, if it has nothing to do with what they're doing, or if in doubt.`,
      criteria: {
        ...Object.fromEntries(others.map(c => [c.id, `${c.name}: the player is engaging with them now, and they could plausibly know it or let it slip`])),
        world: "Something in the scene itself (an object, a sound, a telltale detail) shows it, through what the player is doing.",
        not_now: "Not now.",
      },
    };
  }
  // Pressure: is the player pressing someone for what they're keeping to themselves?
  const keepers = options.pressure ? presentCast(scene, state).filter(c => c.secrets?.length) : [];
  if (keepers.length) {
    questions.pressure = {
      instructions: "Is the player, in their latest turn, pressing someone to give up something they're keeping to themselves (a secret, a hidden reason, something they've refused or dodged), by persuading, threatening, tricking or reading them? Ordinary questions someone would happily answer don't count.",
      criteria: { ...Object.fromEntries(keepers.map(c => [c.id, `Pressing ${c.name} for what they're hiding`])), none: "No: nobody is being pressed for something they're keeping back." },
    };
  }
  // Holding back after the player has done the work is the commonest pacing failure we've seen.
  questions.earned = {
    instructions: "Has the player, in their latest turn, done what it takes to get something they've been working towards from someone in this scene: met that person's own terms, shown them the proof, made their case in full, or given the help or leverage that person was waiting for? Judge by what the story so far has established that person needs, not by how hard the player is pushing.",
    criteria: { earned: "Yes: they've just done what it takes; it should land now.", not_yet: "No: they're still working on it, asking, or haven't done what it takes." },
  };
  if (options.consequences) {
    questions.daft = DAFT_QUESTION;
  }
  if (options.rules && !options.forced) {
    questions.mechanic = {
      instructions: `Is the player, in their latest turn, doing one of these things the game's rules resolve? (In a turn, ${READ_TURN}.)`,
      criteria: {
        // Offered to everyone: a character without magic who tries it gets the rules' "it doesn't come", not a fireball.
        cast: "Casting a spell now (naming a spell, or plainly working new magic). Not using what a spell already running gives them (seeing through a familiar's eyes, keeping up an illusion, a light already lit).",
        attack: "Attacking someone or something right now, to hurt a person or break a thing: a blow, a stab, a punch, a kick, a shot or a thrown weapon. Threats, grabs, shoves and drawing a weapon aren't attacks, and nor is tossing something to someone or working on something in hand.",
        grapple: "Grabbing hold of someone who'd resist, to hold or restrain them: a grapple, a headlock, pinning them, or a hold in a wrestling bout (a sparring partner resists too).",
        shove: "Shoving someone who'd resist: to knock them down, or push them back or away.",
        jump: "Jumping: across a gap or over something, up onto something, or down from it.",
        ...(options.rules.features?.length ? { feature: `Using one of their class features: ${options.rules.features.map(f => f.name).join(", ")}.` } : {}),
        short_rest: "Stopping to rest for an hour or so: catching their breath, binding wounds, a meal and a sit-down.",
        long_rest: "Sleeping the night, or resting for many hours.",
        none: "None of these.",
      },
    };
  }
  questions.ooc = {
    instructions: "Is the player's latest turn spoken out of character, to the GM rather than in the story (e.g. asking what their options are, how something works in the game, or what they know)? An action in *asterisks* or (parentheses) is in character: it's what their character does.",
    criteria: { in_character: "In character: the player's character speaks or acts in the story.", out_of_character: "Out of character: a question or remark to the GM about the game or the situation." },
  };
  if (scene.limits?.length) {
    questions.limit = {
      // (Considered rolls: a forged warrant is a lie to be judged, not the real warrant the scene can't
      // offer; it has an answer of its own, so faking one isn't read as reaching for it.)
      instructions: `Is the player, in their latest turn, reaching for one of the things this scene can't offer (asking for it, trying to do it, or assuming it exists)? Only choose one if the player's turn clearly depends on getting it.${options.considered ? " Faking one isn't reaching for it: a forged paper, a fake badge or a lie that they have one of these is a trick the player is attempting on someone (choose pretending), unless what they're after by it is itself one of these." : ""}`,
      criteria: {
        ...Object.fromEntries(scene.limits.map((l, i) => [`limit_${i}`, l])),
        ...(options.considered ? { pretending: "The player fakes or claims one of these as a trick on someone (a forgery, a fake, a lie that they have it), to get something else." } : {}),
        none: "No: the player's turn doesn't depend on any of these.",
      },
    };
  }
  if (options.speaker) {
    const cast = presentCast(scene, state);
    const offstage = offstageCast(scene, state);
    questions.speaker = {
      instructions: "Who should respond first to the player's latest turn? Pick the character the player addressed, or whose reaction matters most. Pick gm when the player's turn is mainly a physical action, a look around, or something only narration can answer.",
      criteria: {
        ...Object.fromEntries(cast.map(c => [c.id, `${c.name}${c.group ? ` (${c.group})` : ""}`])),
        ...Object.fromEntries(offstage.map(c => [c.id, `${c.name}${c.group ? ` (${c.group})` : ""}, not yet on stage: only if the player's turn would plausibly bring them in now (calling out to them, finding them).`])),
        gm: "The GM narrates what happens or what the player notices.",
      },
    };
  }
  if (!Object.keys(questions).length) return {};
  const decision = await decider.decide(decisionState(scene, state, playerTurn), questions, "director.before");
  const answer = decision.answers.attempt?.choice;
  const candidate = attempts.find(t => t.id === answer);
  // Two routes for the same check (the co-GM's beside another, or one refreshed as things changed)
  // split the read between them, and neither clears the bar: it's the same roll either way, so their
  // shares count together. Not towards ending the scene, which needs the player committed to that.
  const sameRoll = (t: Transition) => !!candidate?.check && t.check?.skill === candidate.check.skill && !endsScene(scene, t);
  const shared = candidate && sameRoll(candidate) ? attempts.filter(t => t !== candidate && sameRoll(t)).reduce((sum, t) => sum + (decision.answers.attempt?.probabilities?.[t.id] ?? 0), 0) : 0;
  const probability = candidate ? (decision.answers.attempt?.probabilities?.[candidate.id] ?? 1) + shared : 0;
  // Every attempt needs some confidence (a 0.39 match shouldn't take over a turn); endings need more.
  // A roll forces its outcome into the reply (a reveal, a cost), so it needs the same confidence as
  // an ending: a weak read of an announcement shouldn't hand over a secret.
  const attempt = candidate && probability >= (endsScene(scene, candidate) || candidate.check ? SCENE_ENDING_CONFIDENCE : 0.45) ? candidate : undefined;
  const plain = answer?.startsWith("plain:") ?? false;
  // A player's attempt (or something they simply do) outranks a pacing cue: the player acted first.
  // Only a real attempt outranks a pacing cue: talking or simply doing things doesn't hold the world back.
  // A pacing cue never interrupts a payoff the player has just earned: the world can wait a reply.
  // Nor does one fire on a word out of character: that isn't time passing in the scene.
  const earnedNow = decision.answers.earned?.choice === "earned" && (decision.answers.earned?.probabilities?.earned ?? 1) >= SCENE_ENDING_CONFIDENCE;
  const ooc = decision.answers.ooc?.choice === "out_of_character";
  const cue = attempt || earnedNow || ooc ? undefined : firedCue(cues, decision.answers.cue, state.turnsInBeat);
  // Something the player simply does that settles the scene (setting off, handing it over) is
  // their chosen ending: close it in this reply rather than letting the reply run past it.
  const plainOutcome = plain ? outcomes.find(t => `plain:${t.id}` === answer) : undefined;
  const plainEnding = plainOutcome && endsScene(scene, plainOutcome) && (decision.answers.attempt?.probabilities?.[answer!] ?? 1) >= SCENE_ENDING_CONFIDENCE ? plainOutcome : undefined;
  const means = decision.answers.attempt_means?.choice;
  const sureMeans = means && means !== "none" && (decision.answers.attempt_means?.probabilities?.[means] ?? 1) >= SCENE_ENDING_CONFIDENCE ? means as Skill : undefined;
  // Saying no wrongly costs as much as ending the scene wrongly: same confidence bar.
  const limitChoice = decision.answers.limit?.choice;
  const limitConfident = (decision.answers.limit?.probabilities?.[limitChoice ?? ""] ?? 1) >= SCENE_ENDING_CONFIDENCE;
  const limit = limitChoice?.startsWith("limit_") && limitConfident ? scene.limits?.[Number(limitChoice.slice(6))] : undefined;
  // What the rules resolve this turn, on a confident read: not when the scene can't offer it, or
  // when the player is out of character.
  const forced = options.rules && options.forced ? rulingOf(options.forced) : undefined;
  const asked = forced ?? decision.answers.mechanic?.choice;
  const sure = !!forced || (asked && asked !== "none" && (decision.answers.mechanic?.probabilities?.[asked] ?? 1) >= SCENE_ENDING_CONFIDENCE);
  const ruling = options.rules && sure && !limit && (!ooc || forced) ? asked : undefined;
  const act = ruling && RULED_ACTS.includes(ruling) ? ruling as RuledAct : undefined;
  // No dice for the impossible: if the player is reaching for something the scene can't offer,
  // the "no, but" answers it and nothing is rolled.
  const limitBlocks = decision.answers.limit?.choice?.startsWith("limit_") && (decision.answers.limit?.probabilities?.[decision.answers.limit.choice] ?? 1) >= SCENE_ENDING_CONFIDENCE;
  // An act on the world the rules resolve is its own resolution (no Arcana check to cast a cantrip,
  // no Athletics check for a throw already rolled to hit), and a roll needs a confident read. (A
  // class feature isn't such an act: something risky alongside it can still call for a roll.)
  const ruled = forced ?? decision.answers.mechanic?.choice;
  const actSettles = !!ruled && ruled !== "feature" && RULED_ACTS.includes(ruled) && (!!forced || (decision.answers.mechanic?.probabilities?.[ruled] ?? 1) >= SCENE_ENDING_CONFIDENCE);
  // Considered rolls: a roll is wanted (a route's "yes" and none's count together), and nothing the
  // author wrote settles it: a route's roll the decider chose and didn't call the act another's, a
  // route the author gave no dice, or an ending the player simply reaches. Then no route is rolled
  // here, and no cue fires: the GM rules on it before the reply.
  // (A player who has just met someone's terms has earned the payoff: that lands, as ever, without dice.)
  const call = decision.answers.roll_call;
  const yes = (option: string) => call ? call.probabilities?.[option] ?? (call.choice === option ? 1 : 0) : 0;
  const settledByPrep = attempt ? !attempt.check || yes("route") >= yes("new") : !!plainEnding;
  const earnedRead = decision.answers.earned?.probabilities?.earned ?? (decision.answers.earned?.choice === "earned" ? 1 : 0);
  // (A beat with no route with a roll has a lower bar: there the flag can only say "new" or "none".)
  const bar = attempts.some(t => t.check) ? CONSIDER_CONFIDENCE : CONSIDER_CONFIDENCE_OPEN;
  const considered = options.considered && yes("route") + yes("new") >= bar && earnedRead < SCENE_ENDING_CONFIDENCE && !settledByPrep && !limitBlocks && !actSettles && !ooc && !forced
    ? {
      probability: yes("route") + yes("new"),
      routes: attempts.filter(t => t.check).map(t => ({ id: t.id, p: decision.answers.attempt?.probabilities?.[t.id] ?? 0 })).filter(r => r.p >= 0.05).sort((a, b) => b.p - a.p),
      ...(sureMeans ? { means: sureMeans } : {}),
      ...(earnedRead >= 0.3 ? { earned: earnedRead } : {}),
    }
    : undefined;
  // The same push that already failed here isn't rolled again on a route's dice (the GM's ruling
  // says no to it without them too): it gets the same answer.
  const again = decision.answers.same_again;
  const sameAgain = attempt?.check && !considered && again?.choice === "same" && (again.probabilities?.same ?? 1) >= SCENE_ENDING_CONFIDENCE ? attempt : undefined;
  const chosen = considered || sameAgain ? undefined : attempt ?? plainEnding ?? cue;
  // (a plain action alongside a cue: the cue's beat change carries the reply)
  const method = attempt ? sureMeans : undefined;
  // When the rules resolve the player's act, that act is the turn: a route's check waits for the
  // act's details, and is rolled only if the player is also doing what the check is for. Otherwise
  // the route stays open for when they do.
  const held = act && attempt?.check && !considered && !sameAgain ? attempt : undefined;
  let move = chosen && !held ? await resolve(scene, state, chosen, attempt || plainEnding ? "attempt" : "cue", method) : undefined;
  let freeform: FreeformCheck | undefined;
  let combined = decision;
  if (answer === "other_risky" && !move && !considered && !limitBlocks && !actSettles && (decision.answers.attempt?.probabilities?.other_risky ?? 1) >= SCENE_ENDING_CONFIDENCE) {
    const extra = await freeformCheck(decider, scene, state, playerTurn);
    freeform = extra.check;
    combined = { ...decision, answers: { ...decision.answers, ...extra.decision.answers }, latencyMs: decision.latencyMs + extra.decision.latencyMs, costUsd: decision.costUsd + extra.decision.costUsd };
  }
  const daft = decision.answers.daft?.choice === "consequential" && (decision.answers.daft?.probabilities?.consequential ?? 1) >= DAFT_CONFIDENCE;
  const earned = decision.answers.earned?.choice === "earned" && (decision.answers.earned?.probabilities?.earned ?? 1) >= SCENE_ENDING_CONFIDENCE;
  let pressure: PressureCheck | undefined;
  const pressed = decision.answers.pressure?.choice;
  const target = pressed && pressed !== "none" && (decision.answers.pressure?.probabilities?.[pressed] ?? 1) >= SCENE_ENDING_CONFIDENCE && !move && !held && !considered && !sameAgain ? scene.cast.find(c => c.id === pressed) : undefined;
  if (target) {
    const details = await pressureDetails(decider, scene, state, playerTurn, target);
    combined = { ...combined, answers: { ...combined.answers, ...details.answers }, latencyMs: combined.latencyMs + details.latencyMs, costUsd: combined.costUsd + details.costUsd };
    const answers = details.answers;
    // An uncertain judgement steps towards the middle (plausible, wary).
    const settled = (q: string, toward: Record<string, string>) => {
      const a = answers[q];
      if (!a) return undefined;
      return (a.probabilities?.[a.choice] ?? 1) < 0.5 ? (toward[a.choice] ?? a.choice) : a.choice;
    };
    const skill = (answers.pressure_means?.choice ?? "persuasion") as Skill;
    const stakes = answers[`stakes_${target.id}`]?.choice ?? "guarded";
    const approach = settled("pressure_approach", { weak: "plausible", strong: "plausible", excellent: "strong" }) ?? "plausible";
    const disposition = settled("pressure_disposition", { hostile: "wary", friendly: "wary" }) ?? "wary";
    const last = lastPressure(state, target.id);
    const retry = last?.band?.startsWith("no") ? { newAngle: answers.pressure_new_angle?.choice !== "same" } : undefined;
    const ruled = last && (last.band === "yes" || last.band === "yes_and") ? { kind: "yes" as const, why: "won" as const } : pressureRuling(stakes, approach, disposition, retry);
    const which = answers.pressure_secret?.choice?.startsWith("secret_") && (answers.pressure_secret.probabilities?.[answers.pressure_secret.choice] ?? 1) >= 0.5 ? Number(answers.pressure_secret.choice.slice(7)) : undefined;
    pressure = { target: target.id, skill, stakes, approach, disposition, ...(which !== undefined ? { secret: which } : {}), ruling: ruled.kind, ...(ruled.kind !== "roll" && ruled.why ? { why: ruled.why } : {}) };
    if (ruled.kind === "roll") {
      const roll = await rollFor(state, skill, ruled.dc);
      const band = roll.success
        ? (roll.critical === "success" || roll.total - ruled.dc >= 5 ? "yes_and" : "yes")
        : (roll.critical === "failure" || ruled.dc - roll.total >= 5 ? "no_and" : "no_but");
      pressure = { ...pressure, dc: ruled.dc, roll, band };
    } else pressure = { ...pressure, band: ruled.kind === "yes" ? "yes" : "no_but" };
  }
  // One at a time: several essentials in one reply reads as an info dump.
  const relocate = missing.map(e => ({ e, a: decision.answers[`relocate_${e.id}`] }))
    .filter(({ a }) => a && a.choice !== "not_now" && (a.probabilities?.[a.choice] ?? 1) >= SCENE_ENDING_CONFIDENCE)
    .sort((x, y) => (y.a!.probabilities?.[y.a!.choice] ?? 0) - (x.a!.probabilities?.[x.a!.choice] ?? 0))
    .slice(0, 1)
    .map(({ e, a }) => ({ essential: e.id, carrier: a!.choice }));
  const offGraph = decision.answers.off_graph?.choice === "off_graph" && (decision.answers.off_graph?.probabilities?.off_graph ?? 1) >= SCENE_ENDING_CONFIDENCE;
  const plainTransition = plain && !plainEnding && !considered ? plainOutcome : undefined;
  // The rules: a spell or a blow gets its details in a second small call; a rest needs none. Not
  // when it starts a fight for the map.
  let mechanic: Mechanic | undefined;
  if (options.rules && ruling && move?.exit?.kind !== "combat") {
    // Chosen already: no details to ask for (a route's check waits for a turn of its own).
    if (options.forced) mechanic = options.forced;
    else if (ruling === "short_rest" || ruling === "long_rest") mechanic = { kind: "rest", length: ruling === "short_rest" ? "short" : "long" };
    else if (act) {
      const details = await mechanicDetails(decider, scene, state, playerTurn, act, options.rules, held ? { also: alsoQuestion(held, act) } : {});
      combined = { ...combined, answers: { ...combined.answers, ...details.decision.answers }, latencyMs: combined.latencyMs + details.decision.latencyMs, costUsd: combined.costUsd + details.decision.costUsd };
      mechanic = details.mechanic;
      const also = details.decision.answers.also;
      if (held && also?.choice === "yes" && (also.probabilities?.yes ?? 1) >= SCENE_ENDING_CONFIDENCE) {
        move = await resolve(scene, state, held, "attempt", method);
        // A check that tips the scene into a fight hands it to the map, blow and all.
        if (move.exit?.kind === "combat") mechanic = undefined;
      }
    }
  }
  return {
    ...(mechanic ? { mechanic } : {}),
    ...(move ? { move } : {}), ...(decision.answers.speaker ? { speaker: decision.answers.speaker.choice } : {}), decision: combined,
    ...(plain ? { plain } : {}), ...(plainTransition ? { plainTransition } : {}), ...(freeform ? { freeform } : {}), ...(limit ? { limit } : {}), ...(ooc ? { ooc } : {}),
    ...(offGraph ? { offGraph } : {}), ...(relocate.length ? { relocate } : {}), ...(pressure ? { pressure } : {}), ...(daft ? { daft } : {}), ...(earned ? { earned } : {}),
    ...(considered ? { considered } : {}), ...(sameAgain ? { sameAgain } : {}),
  };
}

/** No dice for the same push again: it gets the same answer, and being pushed again shows. */
export function sameAgainDirective(t: Transition): string {
  return `No dice: the player is pushing for the same thing that already failed (${t.when.replace(/\.$/, "")}), with nothing new on the table, and it gets the same answer. Whoever they're pushing reacts to being pushed again, in their own way and words (patience wearing thin, a sharper no, a door closing); nothing changes hands, nobody gives way, and nothing already said is taken back.`;
}

/** Say yes: no roll needed, so what the player is doing simply works. */
export function plainDirective(t: Transition): string {
  return `No dice needed: what the player is doing simply works (${t.when.replace(/\.$/, "")}). Let it land in this reply, in a way that fits the people involved.`;
}

const RESIST: Record<string, number> = { guarded: 1, dangerous: 2, ruinous: 3 };
const LEVERAGE: Record<string, number> = { weak: -1, plausible: 0, strong: 1, excellent: 2 };
const WARMTH: Record<string, number> = { hostile: -1, wary: 0, friendly: 1 };

/** docs/research/dc-guidance.md §3.2: say yes, say no (and show what would reach them), or roll at 12/15/18. */
export function pressureRuling(stakes: string, approach: string, disposition: string, retry?: { newAngle: boolean }):
  { kind: "yes"; why?: "free" } | { kind: "no"; why: "lever" | "too_far" | "same_again" } | { kind: "roll"; dc: number } {
  if (approach === "free" || stakes === "trivial") return { kind: "yes", why: "free" };
  if (approach === "no_chance") return { kind: "no", why: "lever" };
  if (retry && !retry.newAngle) return { kind: "no", why: "same_again" };
  const gap = (RESIST[stakes] ?? 1) - (LEVERAGE[approach] ?? 0) - (WARMTH[disposition] ?? 0);
  if (gap <= 0) return { kind: "yes" };
  if (gap >= 4) return { kind: "no", why: "too_far" };
  return { kind: "roll", dc: 9 + 3 * gap };
}

/** The most recent pressure on this person in the current scene (from the path). */
export function lastPressure(state: SessionState, target: string): { band?: string } | undefined {
  const step = [...state.path].reverse().find(p => p.via.startsWith(`pressure:${target}:`));
  return step ? { band: step.via.split(":")[2] } : undefined;
}

const PRESSURE_GOAL: Record<string, (name: string) => string> = {
  persuasion: n => `to talk ${n} into telling you what they're holding back`,
  intimidation: n => `to frighten ${n} into talking`,
  deception: n => `to trick ${n} into letting it slip`,
  insight: n => `to read what ${n} isn't saying`,
};
const STAKES_GLOSS: Record<string, string> = { guarded: "a sore point", dangerous: "dangerous to admit", ruinous: "it could ruin them" };
const MODIFIER_GLOSS: Record<string, string> = { strong: "your leverage helps", excellent: "you've given them every reason", weak: "you've given them no reason to", hostile: "they don't trust you", friendly: "they like you" };

/** The dice line's reason: the goal, then what's at stake for them and what helped or hurt (§3.6). */
/** A pressure roll's reason, for its dice line: by what the player calls them, until they've heard their name (`aliases`). */
export function pressureReason(scene: Scene, p: PressureCheck, aliases: Record<string, string> = {}): string {
  const name = aliases[p.target] ?? scene.cast.find(c => c.id === p.target)?.name ?? p.target;
  const goal = (PRESSURE_GOAL[p.skill] ?? PRESSURE_GOAL.persuasion!)(name);
  const modifier = MODIFIER_GLOSS[p.approach] ?? MODIFIER_GLOSS[p.disposition];
  const gloss = [STAKES_GLOSS[p.stakes], modifier].filter(Boolean).join("; ");
  return gloss ? `${goal} (${gloss})` : goal;
}

export function pressureDirective(scene: Scene, p: PressureCheck): string {
  const c = scene.cast.find(x => x.id === p.target);
  const name = c?.name ?? p.target;
  // Only the secret the player is after: the rest stay theirs until they're asked about too.
  const secret = p.secret !== undefined && c?.secrets?.[p.secret] ? `${c.secrets[p.secret]} (Only this: what else they're hiding stays hidden until the player gets to it.)` : `${c?.secrets?.join(" ") ?? ""} (Only what the question reaches, one thing at a time.)`;
  const always = "Nothing already said is taken back. If this is something the scene needs, leave a way to it.";
  const costly = p.stakes === "dangerous" || p.stakes === "ruinous" ? " It still costs them: they ask something in return, or make the player promise." : "";
  const remembers = p.skill === "intimidation" || p.skill === "deception" ? " They talk, but they'll remember how: cooler towards the player from here on." : "";
  if (p.ruling === "yes") return p.why === "won"
    ? `${name} has already given this up to the player: they answer follow-up questions about it, in their own way and voice. What they're hiding: ${secret}`
    : `No dice needed: ${name} gives up what fits the question, in their own way and voice, as far as the question reaches.${costly} What they're hiding: ${secret}`;
  if (p.ruling === "no") return `${name} doesn't give it up${p.why === "same_again" ? ": the same push again gets the same answer, and their patience is wearing thin" : ""}. Don't reveal what they're hiding. Their reaction shows their own concerns (what they want, what they fear), in their own words; they never tell the player what would work. ${always}`;
  if (p.band === "yes_and") return `The player pressed ${name}, and the dice favour them handsomely (${describeRoll(p.roll!)}). ${name} gives up what fits the question, and a little more than asked: a name, a detail, the next thing they know.${remembers} What they're hiding: ${secret}`;
  if (p.band === "yes") return `The player pressed ${name}, and the dice favour them (${describeRoll(p.roll!)}). ${name} gives up what fits the question, in their own way and voice.${remembers} What they're hiding: ${secret}`;
  if (p.band === "no_but") return `The player pressed ${name}, and the dice go narrowly against them (${describeRoll(p.roll!)}). Not yet, but nearly: ${name} doesn't give it up, but asks a price of their own, or lets slip a partial truth that points somewhere useful. Don't reveal the secret itself. ${always}`;
  return `The player pressed ${name}, and the dice go against them (${describeRoll(p.roll!)}). ${name} holds firm and it costs the player: their attitude hardens and they shut this line down for now (they might call for someone, walk off or warn someone). Their own concerns still show in how they react; they never tell the player what would work. ${always}`;
}

/** The player has done the work: the payoff lands now, not after another round of asking. */
export const EARNED_DIRECTIVE = "The player has just done what it takes for what they've been working towards. Let it land in this reply: the person gives it, shows it or agrees, in their own way, and people react to it. Don't ask the player for it again or add a new condition. (Only what they've earned: anything else stays for later.)";

/** The bill for a daft act: real consequences, in the world's own logic (comic house style). */
/** A jump's details: where to, over what, how far (one small call, only on jump turns). */
async function jumpDetails(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, rules: RulesOptions, extra: Record<string, ChoiceQuestion> = {}): Promise<{ mechanic?: Mechanic; decision: Decision }> {
  const world = !!rules.places?.length;
  const q: Record<string, ChoiceQuestion> = {
    ...extra,
    jump_how: { instructions: "The player is jumping in their latest turn. What kind of jump?", criteria: { long: "Across or over: a gap, a ditch, a table, from one roof or boat to another.", high: "Up: onto something, over something tall, to reach something high.", down: "Down: off something, into somewhere lower." } },
    jump_run: { instructions: "Do they take a run-up (ten feet or more on foot) before they jump?", criteria: { yes: "Yes, a run-up", no: "No: from a standstill, or there's no room to run" } },
    jump_drop: { instructions: "If they fell short (or jumped down), how far would they fall?", criteria: { "0": "No real drop: they'd land on the same floor, or in a puddle.", "10": "About a storey, ten feet or so: into a hold, a ditch, the water below a quay.", "20": "Two storeys, twenty feet or so.", "30": "Higher than that." } },
    jump_water: { instructions: "Is what they'd fall into, if they fell short, water (a river, a canal, a mill-race, a pond)?", criteria: { yes: "Yes, water", no: "No" } },
  };
  if (world) {
    q.jump_to = {
      instructions: "Where do they mean to land?",
      criteria: { ...Object.fromEntries((rules.places ?? []).map(p => [`area:${p.id}`, `Somewhere in ${p.name}.`])), ...Object.fromEntries((rules.landmarks ?? []).map(l => [`near:${l.id}`, `On or by ${l.name}.`])), here: "Nowhere in particular: they jump on the spot, or it isn't clear." },
    };
    if (rules.things?.length) q.jump_over = { instructions: "What are they jumping over or across, that they'd land in or on if they fell short?", criteria: { ...Object.fromEntries((rules.things ?? []).map(t => [t.id, t.name])), nothing: "Nothing of these: open ground, or a gap that isn't one of them." } };
  }
  q.jump_feet = { instructions: "How far is the jump, as the scene has it (across, or up)?", criteria: { "5": "A step: five feet or less.", "10": "About ten feet.", "15": "About fifteen feet.", "20": "About twenty feet.", "30": "Thirty feet or more." } };
  const decision = await decider.decide({ ...decisionState(scene, state, playerTurn), ...(world && state.world ? { world: worldView(state.world) } : {}) }, q, "director.jump");
  const a = (id: string) => decision.answers[id]?.choice;
  const to = a("jump_to");
  const where: ActFrom | undefined = to?.startsWith("area:") ? { area: to.slice(5) } : to?.startsWith("near:") ? { near: to.slice(5) } : undefined;
  const over = a("jump_over");
  return {
    mechanic: {
      kind: "jump", how: (a("jump_how") as Jumping["how"]) ?? "long", runUp: a("jump_run") === "yes", drop: Number(a("jump_drop") ?? 0), water: a("jump_water") === "yes",
      feet: Number(a("jump_feet") ?? 10), ...(where ? { to: where } : {}), ...(over && over !== "nothing" ? { over } : {}),
    },
    decision,
  };
}

// ---------------------------------------------------------------------------------------------
// Reactions: violence draws one from everyone present (the user's gameplay notes, BG3-style).

/** How someone takes the player's violence, in the moment. */
export type Reaction = "fight" | "flee" | "raise_alarm" | "cower" | "intervene" | "join_player" | "unmoved";

/** What the player did that people react to: who it hurt or caught, what it burned or broke. */
export interface Act { what: string; victims: string[]; property: string[] }

/** Someone who saw it, and what the decider should know about them (their temper, their place here). */
export interface Witness { id: string; name: string; about: string }

const REACTIONS: Record<Reaction, string> = {
  fight: "Fights: goes for the player (or whoever did it), now, with whatever they have.",
  flee: "Flees: gets out of this place, now.",
  raise_alarm: "Runs or shouts for help (the watch, guards, their friends): gets out to fetch them.",
  cower: "Cowers or hides where they are: out of it, hands up, under a table.",
  intervene: "Steps in to stop it without fighting: an order, a shout, getting between.",
  join_player: "Takes the player's side against whoever comes for them.",
  unmoved: "Carries on: it doesn't touch them, they didn't see it, or they've seen worse.",
};

/** Everyone present reacts to what the player just did, each by their own lights: one decider call. */
export async function decideReactions(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, act: Act, witnesses: Witness[], name: (id: string) => string): Promise<{ reactions: Record<string, Reaction>; decision?: Decision }> {
  const q: Record<string, ChoiceQuestion> = {};
  for (const w of witnesses) q[`react_${w.id}`] = { instructions: `How does ${w.name} react, right now, to what the player just did? By who they are, not by what would be dramatic: someone hurt or caught by it takes it hardest, the timid get out, the hard and the angry fight, and the law steps in.`, criteria: REACTIONS };
  const decision = await decider.decide({
    ...decisionState(scene, state, playerTurn),
    what_the_player_did: act.what,
    ...(act.victims.length ? { hurt_or_caught: act.victims.map(name) } : {}),
    ...(act.property.length ? { burned_or_broken: act.property.map(name) } : {}),
    people_here: witnesses.map(w => `${w.name}: ${w.about}`),
  }, q, "director.reactions").catch(() => undefined);
  const reactions: Record<string, Reaction> = {};
  for (const w of witnesses) {
    const choice = decision?.answers[`react_${w.id}`]?.choice as Reaction | undefined;
    // Undecided: the hurt hit back if they can, everyone else gets out of the way.
    reactions[w.id] = choice && choice in REACTIONS ? choice : act.victims.includes(w.id) ? "fight" : "cower";
  }
  return { reactions, ...(decision ? { decision } : {}) };
}

const REACTION_TEXT: Record<Reaction, string> = {
  fight: "fights: goes for the player",
  flee: "flees: gets out of the place",
  raise_alarm: "runs for help (the watch, their friends): gets out to fetch them",
  cower: "cowers where they are",
  intervene: "steps in to stop it, without fighting",
  join_player: "takes the player's side",
  unmoved: "carries on as if nothing happened",
};

/** The GM's direction for the reactions the decider chose. */
export function reactionDirective(reactions: Record<string, Reaction>, name: (id: string) => string): string {
  const fight = Object.values(reactions).includes("fight");
  const lines = Object.entries(reactions).filter(([, r]) => r !== "unmoved").map(([id, r]) => `${name(id)} ${REACTION_TEXT[r]}`);
  return `Rules: that was violence, and everyone here reacts at once, each in their own way (decided: play it so): ${lines.join("; ")}. Show each reaction briefly, in the same reply as the act itself, and keep everyone to their reaction.${fight ? " It's a fight now: end on the moment it breaks out, before anyone's blow lands." : ""}`;
}

export const CONSEQUENCE_DIRECTIVE = "What the player just did is the kind of thing people in this world would really answer. Let it happen, and follow its logic through to a consequence in this reply, or one that is plainly on its way: whoever it touches reacts as they truly would (offence, alarm, opportunism, admiration), and it changes something, for better or worse. Not every consequence is bad, but this one isn't free.";

export function relocateDirective(scene: Scene, item: { essential: string; carrier: string }): string {
  const e = scene.essentials?.find(x => x.id === item.essential);
  const who = item.carrier === "world" ? "something in the scene the player is engaging with (an object, a sound, a telltale detail)" : scene.cast.find(c => c.id === item.carrier)?.name ?? item.carrier;
  return `Something the scene needs is within reach of what the player is doing: ${e?.what ?? item.essential} Let it reach them in this reply through ${who}, naturally, as if it was always there. Don't make it a lecture.`;
}

export const STALL_DIRECTIVE = "The player is trying something the scene's prep didn't plan for. Give a short, natural first beat that takes it seriously and buys a moment: show it being considered or set in motion (a reaction, a pause, a first step, a telling detail). Don't resolve it yet and don't refuse it. One to three sentences, ending mid-moment.";
export const FOLLOW_UP_DIRECTIVE = "Carry straight on from your short beat just now, without repeating it: now resolve what the player is attempting.";

export const OOC_DIRECTIVE = "The player has stepped out of character to ask you something. Answer truthfully, out of character, in at most two sentences, using the table rules in your prep and only what their character could perceive or reasonably guess. You don't decide the game's structure (scene order, when dice are rolled, the rules), so never agree to change it: if the game can't do something, say so plainly and offer the in-fiction way. Keep your prep behind the screen (the scene's aims, secrets and endings). Then hand the moment back to the scene; if their turn also had an in-character part, answer that in the fiction.";

/** "No, but": the world answers honestly and keeps the player's underlying idea alive. */
export function limitDirective(limit: string): string {
  return `The player is reaching for something this scene can't offer: ${limit} Respect exactly what that says: what it rules out doesn't happen (not even halfway), and anything it allows (setting off, trying later) can. Answer in the fiction with a reason that fits this world (a consequence, or a character who would know), not a flat refusal, and give the player's underlying intent somewhere real to go with what is here.`;
}

export function freeformDirective(check: FreeformCheck): string {
  return `The player's attempt called for a ${titleCase(check.skill)} check. ${describeRoll(check.roll)}. Narrate the result: on a success they get what they were going for, within this scene; on a failure it costs them or complicates things, without taking back anything already offered or agreed, and the story keeps going. This roll doesn't end the scene by itself.`;
}

/**
 * After the reply: has an outcome now happened in the fiction? Cues count too: the GM often
 * brings the next beat in on their own, and the tracker should follow rather than replay it.
 */
/** Where the story now stands with respect to the scene's endings (a state, not an event). */
export interface EndingRead { exitId: string; probability: number }

export const GUARD_STAGES = ["surface", "tell", "stirred", "torn", "settled"] as const;
export type GuardStage = typeof GUARD_STAGES[number];

/** Staged secrets: who to ask about (people present with secrets, those in the latest exchange first; three at most). */
function guardHolders(scene: Scene, state: SessionState, text: string): Character[] {
  const holders = presentCast(scene, state).filter(c => c.secrets?.length && state.guard?.[c.id]?.stage !== "settled");
  const named = (c: Character) => text.includes(c.name.split(" ").at(-1)!) || text.includes(c.name.split(" ")[0]!);
  return [...holders.filter(named), ...holders.filter(c => !named(c))].slice(0, 3);
}

export type ThreatRead = { kind: "attack"; by: string } | { kind: "hazard"; hazard: string; severity: "glancing" | "serious" };
/** The player has left the scene's place altogether (asked after each reply in rules sessions). */
export const LEFT_CONFIDENCE = 0.7;

export async function decideAfter(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, reply: string, options: { hold?: string; staging?: boolean; rules?: boolean } = {}): Promise<{ move?: Move; decision?: Decision; status?: SceneStatus; ending?: EndingRead; landed?: string[]; hinted?: string[]; guard?: Record<string, GuardStage>; threat?: ThreatRead; left?: boolean }> {
  // An ending held back this turn (the player gets a last chance) can't be confirmed by the same reply.
  const leadsTo = (t: Transition) => [t.to, t.check?.onSuccess, t.check?.onFailure];
  // While an ending is held for the player's response, no other ending (not even the improvised one) can fire.
  const outcomes = [...transitionsFor(scene, state, "outcome"), ...transitionsFor(scene, state, "cue")]
    .filter(t => !options.hold || (!leadsTo(t).includes(options.hold) && t.to !== IMPROVISED_EXIT_ID));
  const questions: Record<string, ChoiceQuestion> = { status: STATUS_QUESTION };
  // Which ending is the story at now, if any? Asked over every ending, including ones the player
  // reaches without dice or that no route leads to, as a state rather than "what just happened".
  const endings = scene.exits.filter(e => e.id !== options.hold && !state.fought?.includes(e.id));
  questions.ending = {
    instructions: "Judging by the whole scene so far (recent_transcript, latest_player_turn and latest_gm_reply), has the scene's central situation now reached one of these endings, so that nothing more needs to happen here for it to be true? Consider the state the story is in now, not only what happened in the last exchange. Offers, threats and plans that haven't happened don't count. Choose not_yet if the situation is still open.",
    criteria: {
      ...Object.fromEntries(endings.map(e => [e.id, `${e.title}: ${e.outcome}`])),
      not_yet: "Not yet: the situation is still open, or still being negotiated or played out.",
    },
  };
  // Which of the scene's essentials has the player now come across (by any route)?
  const pending = (scene.essentials ?? []).filter(e => !state.landed?.includes(e.id));
  for (const e of pending) {
    questions[`landed_${e.id}`] = {
      instructions: "In this roleplaying scene, has the player now come across this, by any means (told, shown, found, worked out), as of the latest exchange?",
      criteria: {
        landed: `Yes: the player now knows or has this: ${e.what}`,
        hinted: "Not yet, but the latest GM reply pointed towards it: a sign, a telltale detail or a remark the player could follow up.",
        not_yet: "Not yet: it hasn't reached the player, and the latest reply didn't point towards it.",
      },
    };
  }
  const holders = options.staging ? guardHolders(scene, state, `${playerTurn}\n${reply}`) : [];
  for (const c of holders) {
    questions[`guard_${c.id}`] = {
      instructions: `Judge only what has actually happened in the story so far. How far has ${c.name} come towards giving up what they're keeping to themselves (${c.secrets!.join(" ").slice(0, 300)})?`,
      criteria: {
        surface: `Nothing has shown: ${c.name} is still their usual public self about it.`,
        tell: "Something that doesn't fit has shown (a dodge, a slip, a reaction they couldn't hide), and the player could pick at it.",
        stirred: `The player has picked at it; ${c.name} has got defensive, and something personal has shown (someone or something they care about).`,
        torn: `${c.name}'s own conflict is out in the open: in their own words, what telling would cost them or what they're torn between.`,
        settled: "It's settled: they've told it, bargained over it, or refused for good and turned against the player.",
      },
    };
  }
  // The rules: did the reply leave a blow or a danger hanging over the player? It lands at the
  // start of their next turn, so they get to answer it, as at the table.
  const present = options.rules ? presentCast(scene, state) : [];
  if (options.rules) {
    questions.left = {
      instructions: `Where is the player character at the end of the latest GM reply? This scene is set in ${scene.title}${scene.world ? ` (${scene.world.name})` : ""}.`,
      criteria: { here: `Still in or around ${scene.title}.`, gone: "Gone somewhere else altogether: another building, across town, down the river, or on their way there." },
    };
    questions.threat = {
      instructions: "Does the latest GM reply end with the player character in immediate physical danger that hasn't been resolved yet: someone in the act of striking, shooting or lunging at them, or a danger about to catch them (a fall, fire, poison, cold water, being grabbed or dragged, something working on their mind)? Only something already under way, not a threat in words, a warning or a possibility.",
      criteria: {
        ...Object.fromEntries(present.map(c => [`attack:${c.id}`, `${c.name} is in the act of attacking them`])),
        ...Object.fromEntries(Object.entries(HAZARD_KINDS).map(([k, text]) => [`hazard:${k}`, `About to be caught by ${text}`])),
        none: "No: nothing physical is about to hit them.",
      },
    };
    questions.threat_severity = {
      instructions: "If something is about to hit the player character, how bad would it be?",
      criteria: { glancing: "A knock, a scare, a ducking: it could hurt a bit.", serious: "Serious: it could badly hurt someone." },
    };
  }
  if (outcomes.length) {
    // A cue's text describes its trigger ("they set off..."); after the reply, ask about its effect.
    const effect = (t: Transition) => {
      if (phaseOf(t) !== "cue") return t.when;
      const target = t.to ?? t.check?.onSuccess ?? "";
      const beat = scene.beats.find(b => b.id === target);
      const exit = scene.exits.find(e => e.id === target);
      return beat ? `The story has already moved on to "${beat.title}": ${beat.direction.split(/(?<=\.)\s/)[0]}` : exit ? `It has already happened: ${exit.outcome}` : t.when;
    };
    const q = question("outcome", outcomes);
    questions.outcome = { ...q, criteria: { ...Object.fromEntries(outcomes.map(t => [t.id, effect(t)])), none: q.criteria.none! } };
  }
  const decision = await decider.decide(decisionState(scene, state, playerTurn, reply), questions, "director.after");
  const probabilities = decision.answers.outcome?.probabilities ?? {};
  let picked = outcomes.find(t => t.id === decision.answers.outcome?.choice);
  // The built-in improvised ending is a last resort: if any authored ending is plausible, prefer it
  // (its script knows what that ending means for the world).
  if (picked?.to === IMPROVISED_EXIT_ID) {
    const authored = outcomes.filter(t => t.to !== IMPROVISED_EXIT_ID && endsScene(scene, t)).sort((a, b) => (probabilities[b.id] ?? 0) - (probabilities[a.id] ?? 0))[0];
    if (authored && (probabilities[authored.id] ?? 0) >= 0.2) picked = authored;
  }
  // Ending the scene on an outcome needs the same confidence as ending it on an attempt.
  const confidence = picked ? (probabilities[picked.id] ?? 1) + (picked.to !== IMPROVISED_EXIT_ID ? probabilities[outcomes.find(t => t.to === IMPROVISED_EXIT_ID)?.id ?? ""] ?? 0 : 0) : 0;
  const chosen = picked && endsScene(scene, picked) && confidence < SCENE_ENDING_CONFIDENCE ? undefined : picked;
  const status = decision.answers.status?.choice as SceneStatus | undefined;
  const endingAnswer = decision.answers.ending;
  // The improvised ending defers to any authored ending the ending-state read finds plausible,
  // even one with no route (a holed scene, or an approach nobody authored).
  let move = chosen ? await resolve(scene, state, chosen, "outcome") : undefined;
  if (move?.exit?.id === IMPROVISED_EXIT_ID && endingAnswer) {
    const best = endings.filter(e => e.id !== IMPROVISED_EXIT_ID).map(e => ({ e, p: endingAnswer.probabilities?.[e.id] ?? 0 })).sort((a, b) => b.p - a.p)[0];
    if (best && best.p >= 0.2) move = { ...move, to: best.e.id, exit: best.e };
  }
  let ending = endingAnswer && endingAnswer.choice !== "not_yet" ? { exitId: endingAnswer.choice, probability: endingAnswer.probabilities?.[endingAnswer.choice] ?? 0 } : undefined;
  // The improvised ending is a last resort here too: prefer a plausible authored ending (its script knows what it means).
  if (ending?.exitId === IMPROVISED_EXIT_ID && endingAnswer) {
    const authored = endings.filter(e => e.id !== IMPROVISED_EXIT_ID).map(e => ({ id: e.id, p: endingAnswer.probabilities?.[e.id] ?? 0 })).sort((a, b) => b.p - a.p)[0];
    if (authored && authored.p >= 0.2) ending = { exitId: authored.id, probability: authored.p + ending.probability };
  }
  const landed = pending.filter(e => decision.answers[`landed_${e.id}`]?.choice === "landed").map(e => e.id);
  const hinted = pending.filter(e => decision.answers[`landed_${e.id}`]?.choice === "hinted").map(e => e.id);
  const guard = Object.fromEntries(holders.map(c => [c.id, decision.answers[`guard_${c.id}`]?.choice as GuardStage | undefined]).filter(([, g]) => g)) as Record<string, GuardStage>;
  let threat: ThreatRead | undefined;
  const t = decision.answers.threat;
  if (t && t.choice !== "none" && (t.probabilities?.[t.choice] ?? 1) >= SCENE_ENDING_CONFIDENCE) {
    const [kind, what] = t.choice.split(":");
    if (kind === "attack" && present.some(c => c.id === what)) threat = { kind: "attack", by: what! };
    if (kind === "hazard" && what) threat = { kind: "hazard", hazard: what, severity: decision.answers.threat_severity?.choice === "serious" ? "serious" : "glancing" };
  }
  const left = decision.answers.left?.choice === "gone" && (decision.answers.left?.probabilities?.gone ?? 1) >= LEFT_CONFIDENCE;
  return { ...(left ? { left } : {}), ...(threat ? { threat } : {}), ...(move ? { move } : {}), decision, ...(status ? { status } : {}), ...(ending ? { ending } : {}), ...(landed.length ? { landed } : {}), ...(hinted.length ? { hinted } : {}), ...(Object.keys(guard).length ? { guard } : {}) };
}

/** Tier-one scene health, asked alongside the outcome check at no extra latency. */
const STATUS_QUESTION: ChoiceQuestion = {
  instructions: "How is this tabletop roleplaying scene going right now, judging by the recent transcript and the latest exchange?",
  criteria: {
    on_track: "Moving: the player is engaged with what the scene is about, or something new and promising is developing.",
    drifting: "The player is off on a tangent the scene hasn't absorbed yet; it isn't connecting back to anything.",
    stuck: "The same exchange is repeating, someone keeps refusing or deferring, or the player seems unsure what to do next.",
    uncovered: "The player is pursuing a reasonable approach to the scene's central problem that the scene doesn't seem to have a way to resolve.",
  },
};

/** Next speaker in the actors approach, after someone has spoken. */
export async function decideNextSpeaker(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, spoken: string[]): Promise<string> {
  const cast = presentCast(scene, state);
  const decision = await decider.decide({ ...decisionState(scene, state, playerTurn), already_responded_this_turn: spoken }, {
    next: {
      instructions: "In a tabletop roleplaying scene, the player took a turn and some characters have already responded (already_responded_this_turn, see the end of recent_transcript). Should anyone else react before the player acts again? Usually the answer is player: hand back to the player unless someone present would clearly jump in, or the GM needs to narrate a consequence.",
      criteria: {
        player: "Hand back to the player now.",
        ...Object.fromEntries(cast.map(c => [c.id, `${c.name} reacts or replies before the player acts.`])),
        gm: "The GM narrates something that happens or changes before the player acts.",
      },
    },
  }, "director.next");
  return decision.answers.next!.choice;
}

/** How the GM is told about a move. */
export function moveDirective(scene: Scene, state: SessionState, move: Move): string[] {
  const lines: string[] = [];
  if (move.roll && move.transition.check) {
    const check = move.transition.check;
    lines.push(`The player's attempt called for a ${titleCase(move.roll.skill)} check${check.reason ? ` ${check.reason.replace(/\.$/, "")}` : ` (${move.transition.when.replace(/\.$/, "")})`}. ${describeRoll(move.roll)}. ${move.roll.success ? check.success : check.failure}${move.roll.skill !== check.skill ? ` The player went about it by ${move.roll.skill} rather than ${check.skill}: the outcome is the same, but it lands the way their method would (a threat that works frightens and leaves resentment; a lie that works is believed, for now).` : ""} Narrate this result so the player can see what was at stake and why it went the way it did.`);
  }
  if (move.exit && !move.chosen) {
    lines.push(`Things are escalating towards this: ${move.exit.outcome} Don't let it happen yet. In this reply, escalate (a warning, a last demand, a countdown, a weapon raised) and stop with the moment hanging: the next move is the player's.`);
  } else if (move.exit) {
    lines.push(`This reply closes the scene: ${move.exit.outcome} Land it on a moment that belongs to the player. What this ending should feel like: ${move.exit.closing} Don't narrate beyond the ending into what comes next.${move.exit.kind === "combat" ? " A fight starts here and is played out blow by blow on the map: end on the moment it breaks out, before any blow lands, any shot hits or any spell takes hold." : ""}`);
  } else if (move.to !== state.beat) {
    const beat = scene.beats.find(b => b.id === move.to)!;
    lines.push(`The scene has moved on to "${beat.title}": ${beat.direction} Play the start of this in your reply, growing out of what the player just did, and let the rest unfold over the next exchanges.`);
  }
  return lines;
}
