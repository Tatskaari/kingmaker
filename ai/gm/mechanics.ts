// Copied from the prototype at 44c6d4a: src/runtime/director.ts:433-623 (RulesOptions, the acts' words, alsoQuestion, meansQuestion, mechanicDetails, aimedPeople, aimedThing, namedThing), 1100-1131 (jumpDetails) and 1133-1190 (Witness, decideReactions, reactionDirective), and src/runtime/engine.ts:1329 (nameIn), 1360-1369 (witnessesOf) and 1391-1409 (aimable), with the usual edits: a TurnView for the SessionState, the scene passed in for sceneById (aimable), SpellRef and WeaponRef for SpellChoice and WeaponChoice, Mechanic, Jumping, ActFrom, Reaction and Act from v2/shared/rules/types.ts (A's copies), worldView from v2/shared/world; alsoQuestion, meansQuestion, mechanicDetails, RuledAct, RULED_ACTS, nameIn, witnessesOf and aimable exported, for the director's details call (director.ts mechanicOf, withMechanic's) and the reactions endpoint; rulesOptions is the old decide endpoint's (engine.ts:559). It was parked for combat when the old pipeline's decide went (docs/migration-log.md, M2's "The old pipeline's salvage"), and since "After the migration: spells and blows said in a scene" a scene asks it again: the act step's details call (service/endpoints/act.ts) on what rulesOptions offers, and the reactions endpoint when the act was violence. Of it, alsoQuestion, meansQuestion and jumpDetails stay parked (a scene's GM calls its own checks, and a jump is one of them), and so does a fight reaction's brawl (scene-acts.ts react): reactionDirective's fight ends the reply as they turn on the player.

import type { ChoiceQuestion, Decider, Decision } from "../llm/decide.ts";
import { titleCase } from "../../shared/dice.ts";
import type { Act, ActFrom, Jumping, Mechanic, Reaction, SpellFacts, WeaponRef } from "../../shared/rules/types.ts";
import { deedsIn, spellNamed } from "../../shared/rules/acting.ts";
import { presentCast } from "../../shared/scene/graph.ts";
import type { Scene, Transition } from "../../shared/scene/types.ts";
import { heldBy, within, worldView, type Entity } from "../../shared/world/scene-world.ts";
import { decisionState } from "./director.ts";
import type { TurnView } from "./view.ts";

/**
 * What the D&D rules resolve in a scene, as the decider is asked it (world-bridge-design §2.2): the
 * act's details on a turn the rules resolve (which spell at whom, which blow at whom, a grab or a
 * shove, a jump, a class feature), with where the player acts from; and how everyone who saw the
 * player's violence takes it (the reactions endpoint). The simulation's rules resolve what's chosen
 * here, on the world rebuilt from its rows.
 */

/** The player's spells and weapons, and what's around them in the world, for the decider (rules sessions only). */
export interface RulesOptions {
  /** With what the rules say of each one's reach, when the sheet has worked it out (needsAim reads it). */
  spells: SpellFacts[];
  weapons: WeaponRef[];
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
export type RuledAct = "cast" | "attack" | "grapple" | "shove" | "jump" | "feature";
export const RULED_ACTS: readonly string[] = ["cast", "attack", "grapple", "shove", "jump", "feature"] satisfies RuledAct[];
const ACT_NAMES: Record<RuledAct, string> = { cast: "the spell", attack: "the attack", grapple: "the grab", shove: "the shove", jump: "the jump", feature: "the class feature" };

/**
 * On a turn the rules resolve the player's act, a route's check is rolled as well only when the
 * player is also doing exactly what that check is for, and it doesn't hang on how the act turns
 * out ("I throw my javelin at the rope" isn't examining the body it may bring down: that waits until
 * it's down). Asked in the act's details call, so ordinary turns pay nothing for it.
 */
export function alsoQuestion(t: Transition, act: RuledAct): ChoiceQuestion {
  const check = t.check!;
  const what = check.reason?.trim().replace(/\.$/, "") || t.when.replace(/\.$/, "");
  return {
    instructions: `The game's rules settle ${ACT_NAMES[act]} in the player's latest turn. Besides that, is the player also, in the same turn, doing what this ${titleCase(check.skill)} check is for (${what})? Only if they're doing that act itself now, whatever comes of ${ACT_NAMES[act]}: not if it's what ${ACT_NAMES[act]} is meant to make possible, or something for after it.`,
    criteria: { yes: "Yes: they're doing that too, this turn, and it doesn't wait on how the rules' act turns out.", no: "No: the rules' act is what they're doing now; that can come after it." },
  };
}

/**
 * Parked for combat, as considered rolls asked it (they went with the old pipeline), on a turn the
 * rules resolve the player's act and a roll is wanted: is the act only the means to something risky
 * the rules don't settle? A Mage Hand pinching the page from a boy who's
 * watching (the spell is cast; whether he notices isn't the spell's), a lunge to catch the body the
 * axe brings down, a threat made with a fist in someone's collar. Then the GM rules on that, knowing
 * how the act went. A blow, a shot, a grab, or a spell doing what it does, stays the rules' alone.
 * Asked in the act's details call, so other turns pay nothing for it.
 */
export function meansQuestion(act: RuledAct): ChoiceQuestion {
  const name = ACT_NAMES[act];
  return {
    instructions: `The game's rules settle ${name} in the player's latest turn: whether it works and what it does. Is ${name} only the means to something else risky the player is attempting in the same turn, which the rules' act doesn't settle by itself and which could go either way? For example: the spell does the lifting, but taking something from someone who's watching turns on not being noticed; the blow cuts the rope, but catching what falls is a feat of its own; a threat or a lie rides on the grab.`,
    criteria: {
      yes: `Yes: besides ${name}, the turn has a risky attempt of its own, which turns on someone noticing, resisting or being won over, or on a feat the rules' act doesn't decide.`,
      no: `No: ${name} is the whole of it (a blow, a shot, a grab, or the spell doing what it does), and the rest is talk or simply follows from it.`,
    },
  };
}

/**
 * Which spell, at whom; or which blow, at whom: a second small call, only on those turns. Any
 * `extra` questions about the same turn ride along in it. `named`: the spell the player's words cast
 * by its name (acting.ts castNamed), which is the spell, with no question for which.
 */
export async function mechanicDetails(decider: Decider, scene: Scene, state: TurnView, playerTurn: string, kind: RuledAct, rules: RulesOptions, extra: Record<string, ChoiceQuestion> = {}, named?: SpellFacts): Promise<{ mechanic?: Mechanic; decision: Decision }> {
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
    if (!named) q.spell = {
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
    const spell = named?.id ?? decision.answers.spell?.choice;
    if (!spell) return { decision };
    const thing = aimedThing(decision, things, playerTurn);
    // Aimed at the thing the player's words name, a person is a target too only on a sure read or by
    // name: the elm the player named had burned down, and Cob at .66 took the Fire Bolt.
    const aimedAt = aimedPeople(decision, present, thing && thing === namedThing(things, playerTurn) ? playerTurn : undefined);
    // Nobody read as aimed at, and nothing: whoever the player's deeds name, for a spell that's aimed
    // or fills an area. "(I cast thunderwave at the constables)" read no for Tull's group at .77 (a
    // spell from the caster "targets" nobody), and the cube went off round the player.
    const facts = rules.spells.find(sp => sp.id === spell);
    const deeds = deedsIn(playerTurn).join(" ");
    const people = aimedAt.length || thing || decision.answers.aim_self?.choice === "yes" || !(needsAim(facts) || facts?.area) ? aimedAt : present.filter(c => namesPerson(c, deeds)).map(c => c.id);
    // The thing first: an area spell centres on what it's aimed at.
    const targets = [...(thing ? [thing] : []), ...people, ...(decision.answers.aim_self?.choice === "yes" ? ["self"] : [])];
    const from = actFrom(targets.find(t => t !== "self"));
    if (!targets.length && needsAim(facts)) {
      // A spell that has to be aimed, at nothing: by its name, the rules ask at what; read from words
      // that don't name it ("I summon some fire to my fingertips"), it's the GM's to narrate, not a
      // Fire Bolt loosed at nobody.
      if (!named && !spellNamed(rules.spells, playerTurn)) return { decision };
      return { mechanic: { kind, spell, targets, ...(from ? { from } : {}), unclear: true }, decision };
    }
    // Aimed at a thing, on a read too weak to act on, and nothing the player named: ask, rather than hit the wrong one.
    const unclear = !targets.length && decision.answers.aim_thing?.choice !== undefined && decision.answers.aim_thing.choice !== "none";
    return { mechanic: { kind, spell, targets, ...(from ? { from } : {}), ...(unclear ? { unclear: true } : {}) }, decision };
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

/**
 * Who a spell is aimed at: a sure yes; and with someone surely aimed at, a doubtful yes is dropped
 * (Magic Missile at the Crake, not split onto Sallow at .56). With a thing aimed at (`said`: the
 * player's words), a doubtful yes is dropped too unless the words name them: "(I cast a firebolt at
 * the elm)" isn't at Cob, read at .66.
 */
function aimedPeople(decision: Decision, present: Array<{ id: string; name: string; group?: string }>, said?: string): string[] {
  const yes = (id: string) => { const a = decision.answers[`aim_${id}`]; return a?.choice === "yes" ? a.probabilities?.yes ?? 1 : 0; };
  const aimed = present.filter(c => yes(c.id) >= 0.5 && (said === undefined || yes(c.id) >= 0.9 || namesPerson(c, said)));
  return (aimed.some(c => yes(c.id) >= 0.9) ? aimed.filter(c => yes(c.id) >= 0.7) : aimed).map(c => c.id);
}

/**
 * Whether the words name someone: a word of their name or their group's ("Kell", "the constables";
 * not what the group comes "with": the dead-cart isn't Tull), not a title or a little word.
 */
function namesPerson(c: { name: string; group?: string }, said: string): boolean {
  const words = new Set(said.toLowerCase().split(/[^a-z]+/).map(w => w.replace(/(?<=..)s$/, "")));
  const own = `${c.name} ${c.group?.split(/\bwith\b/i)[0] ?? ""}`.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !NOT_A_NAME.has(w)).map(w => w.replace(/(?<=..)s$/, ""));
  return own.some(w => words.has(w));
}

const NOT_A_NAME = new Set(["the", "and", "with", "for", "two", "three", "four", "sergeant", "corporal", "captain", "master", "mistress", "old", "young"]);

/**
 * Whether a spell has to be aimed at someone or something to do anything: one with a range beyond
 * the caster (not Self) that attacks, strikes, or makes someone save or fall (Fire Bolt, Magic
 * Missile, Sleep, Hold Person). Not one that works from the caster (Thunderwave, Shield), nor one
 * whose reach the sheet hasn't worked out.
 */
export function needsAim(spell: SpellFacts | undefined): boolean {
  return !!spell?.range && !/^self\b/i.test(spell.range) && (spell.effects ?? []).some(e => AIMED_EFFECTS.has(e));
}

const AIMED_EFFECTS = new Set(["attack", "auto-hit", "save", "hp-pool-knockout", "hp-threshold"]);

/**
 * The thing a spell is aimed at. A read under one in two isn't acted on as it stands: the thing the
 * player's words name is (a Fire Bolt at "the padlocked yard doors' hasp" is at the yard doors, not
 * the loft door read at .44), or a clear lead (.3 and twice the next), or nothing.
 */
function aimedThing(decision: Decision, things: Array<{ id: string; name: string }>, said: string): string | undefined {
  const a = decision.answers.aim_thing;
  const top = a?.choice && a.choice !== "none" ? a.choice : undefined;
  const p = (id: string) => a?.probabilities?.[id] ?? (a?.choice === id ? 1 : 0);
  if (top && p(top) >= 0.5) return top;
  const named = namedThing(things, said);
  if (named) return named;
  const next = Math.max(0, ...things.filter(t => t.id !== top).map(t => p(t.id)));
  return top && p(top) >= 0.3 && p(top) >= 2 * next ? top : undefined;
}

/** The thing the player's words name best: most of its name's words in theirs (a plural for a singular too), and no tie. */
export function namedThing(things: Array<{ id: string; name: string }>, said: string): string | undefined {
  const words = new Set(said.toLowerCase().replace(/['’]s\b/g, "").split(/[^a-z]+/).filter(Boolean).map(w => w.replace(/(?<=..)(es|s)$/, "")));
  const score = (name: string) => {
    const own = name.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !["the", "and", "with", "for"].includes(w)).map(w => w.replace(/(?<=..)(es|s)$/, ""));
    return own.length ? own.filter(w => words.has(w)).length / own.length : 0;
  };
  const ranked = things.map(t => ({ id: t.id, s: score(t.name) })).filter(t => t.s >= 0.5).sort((x, y) => y.s - x.s);
  return ranked[0] && ranked[0].s > (ranked[1]?.s ?? 0) ? ranked[0].id : undefined;
}
/** A jump's details: where to, over what, how far (one small call, only on jump turns). */
async function jumpDetails(decider: Decider, scene: Scene, state: TurnView, playerTurn: string, rules: RulesOptions, extra: Record<string, ChoiceQuestion> = {}): Promise<{ mechanic?: Mechanic; decision: Decision }> {
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

/** What someone the story needs here may do: anything but leave the place (they cower, step in, fight…). */
const STAYING: Record<string, string> = Object.fromEntries(Object.entries(REACTIONS).filter(([k]) => k !== "flee" && k !== "raise_alarm"));

/**
 * Everyone present reacts to what the player just did, each by their own lights: one decider call.
 * Those in `stays` (the story needs them here: shared/scene/beats.ts storyNeeds, and the companion)
 * aren't offered leaving the place, and one decided gone anyway cowers instead.
 */
export async function decideReactions(decider: Decider, scene: Scene, state: TurnView, playerTurn: string, act: Act, witnesses: Witness[], name: (id: string) => string, stays: ReadonlySet<string> = new Set()): Promise<{ reactions: Record<string, Reaction>; decision?: Decision }> {
  const q: Record<string, ChoiceQuestion> = {};
  for (const w of witnesses) q[`react_${w.id}`] = { instructions: `How does ${w.name} react, right now, to what the player just did? By who they are, not by what would be dramatic: someone hurt or caught by it takes it hardest, the timid get out, the hard and the angry fight, and the law steps in.${stays.has(w.id) ? ` ${w.name} stays in this place, whatever happens: hiding, cowering or stepping in, never leaving it.` : ""}`, criteria: stays.has(w.id) ? STAYING : REACTIONS };
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
    const decided = choice && choice in REACTIONS ? choice : act.victims.includes(w.id) ? "fight" : "cower";
    reactions[w.id] = stays.has(w.id) && (decided === "flee" || decided === "raise_alarm") ? "cower" : decided;
  }
  return { reactions, ...(decision ? { decision } : {}) };
}

/** Each reaction as the GM is told it: the reply's direction, and the co-GM's note of the act (two-part.ts actNote). */
export const REACTION_TEXT: Record<Reaction, string> = {
  fight: "turns on the player, ready to fight",
  flee: "flees: gets out of the place",
  raise_alarm: "runs for help (the watch, their friends): gets out to fetch them",
  cower: "cowers where they are",
  intervene: "steps in to stop it, without fighting",
  join_player: "takes the player's side",
  unmoved: "carries on as if nothing happened",
};

/**
 * The GM's direction for the reactions the decider chose. Someone who'd fight turns on the player, and
 * the reply ends there, before any blow: in a scene the reactions start no fight (scene-acts.ts
 * react), and whether it comes to one is the scene's.
 */
export function reactionDirective(reactions: Record<string, Reaction>, name: (id: string) => string): string {
  const fight = Object.values(reactions).includes("fight");
  const lines = Object.entries(reactions).filter(([, r]) => r !== "unmoved").map(([id, r]) => `${name(id)} ${REACTION_TEXT[r]}`);
  return `Rules: that was violence, and everyone here reacts at once, each in their own way (decided: play it so): ${lines.join("; ")}. Show each reaction briefly, in the same reply as the act itself, and keep everyone to their reaction.${fight ? " End on the moment they turn on the player, before anyone's blow lands: whether it comes to a fight is for the story to decide, not this reply." : ""}`;
}
/** Someone by the name the player knows them by (engine.ts:1329). */
export const nameIn = (scene: Scene, state: TurnView, id: string) => state.rules?.aliases?.[id] ?? scene.cast.find(c => c.id === id)?.name ?? state.world?.entities[id]?.name ?? id;
/** Who saw it: everyone present who isn't out of it (down, gone), the hurt first. */
export function witnessesOf(scene: Scene, state: TurnView, act: Act): Witness[] {
  const world = state.world;
  const out = (id: string) => !!world?.entities[id] && ["down", "gone", "dead"].some(s => world.entities[id]!.states.includes(s));
  const cast = presentCast(scene, state).filter(c => !out(c.id)).map(c => ({ id: c.id, name: c.name, about: `${c.statblock ?? "commoner"}${c.group ? `, ${c.group}` : ""}. ${c.attitude.slice(0, 280)}${c.fears ? ` Fears: ${c.fears.slice(0, 160)}` : ""}` }));
  const cast_ = new Set(scene.cast.map(c => c.id));
  const others = world ? Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !cast_.has(e.id) && !out(e.id))
    .map(e => ({ id: e.id, name: e.name, about: `${e.stats?.statblock ?? (e.kind === "creature" ? "beast" : "commoner")}. ${e.description ?? ""}`.trim() })) : [];
  return [...cast, ...others].sort((a, b) => Number(act.victims.includes(b.id)) - Number(act.victims.includes(a.id))).slice(0, 10);
}
/**
 * What the decider offers the rules' act (engine.ts:559), for a character with a build: their spells,
 * weapons and features from the sheet, and from the world what's near enough to aim at, the people
 * outside the cast, and where they might act from. None without a build. (The old pipeline's decide
 * endpoint made it; the act step's now: service/endpoints/act.ts.)
 */
export function rulesOptions(scene: Scene, view: TurnView, line: string): RulesOptions | undefined {
  if (!view.rules) return undefined;
  return { spells: view.rules.spells ?? [], weapons: view.rules.weapons ?? [], features: view.rules.features ?? [], ...(view.world ? aimable(scene, view, line) : {}) };
}

/** What the player could aim a spell or a blow at in the world: things near them (the one their words name first), and people outside the cast. */
export function aimable(scene: Scene, state: TurnView, said = ""): { things: Array<{ id: string; name: string }>; bystanders: Array<{ id: string; name: string }>; places: Array<{ id: string; name: string }>; landmarks: Array<{ id: string; name: string }> } {
  const world = state.world!;
  const cast = new Set(scene.cast.map(c => c.id));
  // Anything in reach of a spell or a blow, except what other people are holding.
  const inOthersHands = (e: Entity) => { const h = heldBy(world, e); return !!h && (h.kind === "person" || h.kind === "creature") && !h.player; };
  // Not what the player carries (their coins took the slots), nor what nobody can see yet.
  const ownOrHidden = (e: Entity) => !!heldBy(world, e)?.player || e.states.includes("hidden") || e.tags.includes("hidden");
  const reach = within(world, "player", 60, e => (e.kind === "object" || e.kind === "item" || e.kind === "feature" || e.kind === "surface") && !inOthersHands(e) && !ownOrHidden(e));
  // What's destroyed is no aim, but for the one the player's words name: the old elm burned down at
  // the turn's start, and a Fire Bolt "at the elm" went to Cob for want of it.
  const named = namedThing(reach.map(e => ({ id: e.id, name: e.name })), said);
  const near = reach.filter(e => e.id === named || !e.states.includes("destroyed")).map(e => ({ id: e.id, name: e.name }));
  const things = [...near.filter(t => t.id === named), ...near.filter(t => t.id !== named)].slice(0, 16);
  const bystanders = Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !cast.has(e.id) && !e.states.includes("gone"))
    .map(e => ({ id: e.id, name: e.name }));
  // Where they might act from: an area, or anything in the place someone could walk over to.
  const live = Object.values(world.entities).filter(e => !e.states.includes("gone") && !e.player);
  const places = live.filter(e => e.kind === "area").map(e => ({ id: e.id, name: e.name }));
  const landmarks = live.filter(e => (e.kind === "feature" || e.kind === "object" || e.kind === "person" || e.kind === "creature") && !heldBy(world, e)).map(e => ({ id: e.id, name: e.name }));
  return { things, bystanders, places, landmarks };
}
