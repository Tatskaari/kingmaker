import type { ChoiceQuestion, Decider, Decision } from "../llm/decide.ts";
import { currentBeat, offstageCast, presentCast, scriptTranscript, sceneEntries } from "./brief.ts";
import { describeRoll, rng, rollCheck, titleCase, type RollResult } from "./dice.ts";
import { SKILLS, type Exit, type Scene, type Skill, type Transition } from "./scene.ts";
import type { SceneStatus, SessionState } from "./session.ts";

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

const QUESTION_TEXT = {
  attempt: "A player in a tabletop roleplaying scene has just taken their turn (latest_player_turn). Which of these is the player attempting or doing in that turn? Judge the player's own words and actions in context; a passing mention is not an attempt. If none clearly applies, choose none.",
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

function question(phase: keyof typeof QUESTION_TEXT, transitions: Transition[], scene?: Scene): ChoiceQuestion {
  const none = phase === "cue" ? "not_yet" : "none";
  const describe = (t: Transition) => phase === "attempt" && scene && endsScene(scene, t)
    ? `${t.when} (This would settle the whole scene: only if the player is clearly committing to it right now, not asking about it, examining things or thinking aloud.)`
    : t.when;
  return {
    instructions: QUESTION_TEXT[phase],
    criteria: {
      ...Object.fromEntries(transitions.map(t => [t.id, describe(t)])),
      [none]: phase === "cue" ? "None of these should happen yet." : "None of the above clearly applies.",
    },
  };
}

function transitionsFor(scene: Scene, state: SessionState, phase: "attempt" | "cue" | "outcome"): Transition[] {
  const beat = currentBeat(scene, state);
  return [...beat.transitions, ...(scene.anytime ?? [])].filter(t => phaseOf(t) === phase);
}

function resolve(scene: Scene, state: SessionState, transition: Transition, phase: Move["phase"]): Move {
  let to = transition.to ?? state.beat;
  let roll: RollResult | undefined;
  if (transition.check) {
    const random = rng(state.seed + 7919 * ++state.rollCount);
    roll = rollCheck(random, transition.check.skill, transition.check.dc, state.player.modifiers[transition.check.skill] ?? 0);
    to = roll.success ? transition.check.onSuccess : transition.check.onFailure ?? state.beat;
  }
  const exit = scene.exits.find(e => e.id === to);
  const chosen = phase === "attempt" && (!roll || roll.success);
  return { transition, phase, to, chosen, ...(roll ? { roll } : {}), ...(exit ? { exit } : {}) };
}

export interface PreDecision {
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

async function freeformCheck(decider: Decider, scene: Scene, state: SessionState, playerTurn: string): Promise<{ check: FreeformCheck; decision: Decision }> {
  const decision = await decider.decide(decisionState(scene, state, playerTurn), {
    skill: { instructions: "The player is attempting something risky in a tabletop roleplaying scene (latest_player_turn). Which skill best decides whether it works?", criteria: SKILL_TEXT },
    difficulty: { instructions: "How hard is what the player is attempting, given the situation and the people involved?", criteria: {
      easy: "Easy: most people could manage it; only bad luck stops it.", moderate: "Moderate: a real chance of failure for most people.", hard: "Hard: it would take skill and luck.",
    } },
  }, "director.freeform");
  const skill = (decision.answers.skill?.choice ?? "persuasion") as Skill;
  const dc = DIFFICULTY[(decision.answers.difficulty?.choice ?? "moderate") as keyof typeof DIFFICULTY] ?? 13;
  const random = rng(state.seed + 7919 * ++state.rollCount);
  return { check: { skill, dc, roll: rollCheck(random, skill, dc, state.player.modifiers[skill] ?? 0) }, decision };
}

/** Before the reply: is the player attempting a transition, or should a pacing cue fire? Plus who speaks first. */
export async function decideBefore(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, options: { speaker: boolean; freeform?: boolean }): Promise<PreDecision> {
  const attempts = transitionsFor(scene, state, "attempt");
  const cues = transitionsFor(scene, state, "cue");
  // Outcomes that need no roll are shown as alternatives, so the decider can see that a kind
  // word might simply work; choosing one means "no attempt now" (it's judged after the reply).
  const outcomes = transitionsFor(scene, state, "outcome");
  const questions: Record<string, ChoiceQuestion> = {};
  if (options.freeform !== false || attempts.length) {
    const q = question("attempt", attempts, scene);
    questions.attempt = {
      instructions: `${q.instructions} Some things need no dice: if the player's turn is better described by one of the "simply happens" options, choose that. Choose other_risky only for a genuinely uncertain attempt that none of the listed options covers.`,
      criteria: {
        ...q.criteria,
        none: "Nothing risky and none of the above: the player talks, asks, accepts an offer, looks around or searches at leisure, or does something with no real chance or cost of failure.",
        ...Object.fromEntries(outcomes.map(t => [`plain:${t.id}`, `Simply happens, no dice needed: ${t.when}`])),
        ...(options.freeform !== false ? { other_risky: "The player attempts something risky whose outcome is genuinely uncertain (sneaky, physical, magical or social), where failure would change the situation, and that none of the options above covers. Not risky: ordinary talk and questions, accepting something someone has just offered, looking around or searching when nothing is pressing, or anything where failing would only mean trying again." } : {}),
      },
    };
  }
  if (cues.length) questions.cue = question("cue", cues);
  questions.ooc = {
    instructions: "Is the player's latest turn spoken out of character, to the GM rather than in the story (e.g. asking what their options are, how something works in the game, or what they know)?",
    criteria: { in_character: "In character: the player's character speaks or acts in the story.", out_of_character: "Out of character: a question or remark to the GM about the game or the situation." },
  };
  if (scene.limits?.length) {
    questions.limit = {
      instructions: "Is the player, in their latest turn, reaching for one of the things this scene can't offer (asking for it, trying to do it, or assuming it exists)? Only choose one if the player's turn clearly depends on it.",
      criteria: { ...Object.fromEntries(scene.limits.map((l, i) => [`limit_${i}`, l])), none: "No: the player's turn doesn't depend on any of these." },
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
  const probability = candidate ? decision.answers.attempt?.probabilities?.[candidate.id] ?? 1 : 0;
  const attempt = candidate && (!endsScene(scene, candidate) || probability >= SCENE_ENDING_CONFIDENCE) ? candidate : undefined;
  const plain = answer?.startsWith("plain:") ?? false;
  // A player's attempt (or something they simply do) outranks a pacing cue: the player acted first.
  const cue = attempt || plain ? undefined : cues.find(t => t.id === decision.answers.cue?.choice);
  // Something the player simply does that settles the scene (setting off, handing it over) is
  // their chosen ending: close it in this reply rather than letting the reply run past it.
  const plainOutcome = plain ? outcomes.find(t => `plain:${t.id}` === answer) : undefined;
  const plainEnding = plainOutcome && endsScene(scene, plainOutcome) && (decision.answers.attempt?.probabilities?.[answer!] ?? 1) >= SCENE_ENDING_CONFIDENCE ? plainOutcome : undefined;
  const chosen = attempt ?? plainEnding ?? cue;
  const move = chosen ? resolve(scene, state, chosen, attempt || plainEnding ? "attempt" : "cue") : undefined;
  let freeform: FreeformCheck | undefined;
  let combined = decision;
  if (answer === "other_risky" && !move) {
    const extra = await freeformCheck(decider, scene, state, playerTurn);
    freeform = extra.check;
    combined = { ...decision, answers: { ...decision.answers, ...extra.decision.answers }, latencyMs: decision.latencyMs + extra.decision.latencyMs, costUsd: decision.costUsd + extra.decision.costUsd };
  }
  const ooc = decision.answers.ooc?.choice === "out_of_character";
  const plainTransition = plain && !plainEnding ? plainOutcome : undefined;
  const limitChoice = decision.answers.limit?.choice;
  const limit = limitChoice?.startsWith("limit_") ? scene.limits?.[Number(limitChoice.slice(6))] : undefined;
  return {
    ...(move ? { move } : {}), ...(decision.answers.speaker ? { speaker: decision.answers.speaker.choice } : {}), decision: combined,
    ...(plain ? { plain } : {}), ...(plainTransition ? { plainTransition } : {}), ...(freeform ? { freeform } : {}), ...(limit ? { limit } : {}), ...(ooc ? { ooc } : {}),
  };
}

/** Say yes: no roll needed, so what the player is doing simply works. */
export function plainDirective(t: Transition): string {
  return `No dice needed: what the player is doing simply works (${t.when.replace(/\.$/, "")}). Let it land in this reply, in a way that fits the people involved.`;
}

export const OOC_DIRECTIVE = "The player has stepped out of character to ask you something. Answer briefly and helpfully as the GM, out of character, using only what their character could perceive or reasonably guess: don't reveal what anyone is hiding and don't talk about dice or game mechanics. Then hand the moment back to the scene.";

/** "No, but": the world answers honestly and keeps the player's underlying idea alive. */
export function limitDirective(limit: string): string {
  return `The player is reaching for something this scene can't offer: ${limit} Don't let it happen or half-happen. Answer in the fiction with a reason that fits this world (a consequence, or a character who would know), not a flat refusal, and give the player's underlying intent somewhere real to go with what is here.`;
}

export function freeformDirective(check: FreeformCheck): string {
  return `The player's attempt called for a ${titleCase(check.skill)} check. ${describeRoll(check.roll)}. Narrate the result: on a success they get what they were going for, within this scene; on a failure it costs them or complicates things, but the story keeps going. This roll doesn't end the scene by itself.`;
}

/**
 * After the reply: has an outcome now happened in the fiction? Cues count too: the GM often
 * brings the next beat in on their own, and the tracker should follow rather than replay it.
 */
export async function decideAfter(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, reply: string, options: { hold?: string } = {}): Promise<{ move?: Move; decision?: Decision; status?: SceneStatus }> {
  // An ending held back this turn (the player gets a last chance) can't be confirmed by the same reply.
  const leadsTo = (t: Transition) => [t.to, t.check?.onSuccess, t.check?.onFailure];
  const outcomes = [...transitionsFor(scene, state, "outcome"), ...transitionsFor(scene, state, "cue")]
    .filter(t => !options.hold || !leadsTo(t).includes(options.hold));
  const questions: Record<string, ChoiceQuestion> = { status: STATUS_QUESTION };
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
  const chosen = outcomes.find(t => t.id === decision.answers.outcome?.choice);
  const status = decision.answers.status?.choice as SceneStatus | undefined;
  return { ...(chosen ? { move: resolve(scene, state, chosen, "outcome") } : {}), decision, ...(status ? { status } : {}) };
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
    lines.push(`The player's attempt called for a ${titleCase(move.roll.skill)} check (${move.transition.when.replace(/\.$/, "")}). ${describeRoll(move.roll)}. ${move.roll.success ? move.transition.check.success : move.transition.check.failure} Narrate this result.`);
  }
  if (move.exit && !move.chosen) {
    lines.push(`Things are escalating towards this: ${move.exit.outcome} Don't let it happen yet. In this reply, escalate (a warning, a last demand, a countdown, a weapon raised) and stop with the moment hanging: the next move is the player's.`);
  } else if (move.exit) {
    lines.push(`This reply closes the scene: ${move.exit.outcome} Land it on a moment that belongs to the player. What this ending should feel like: ${move.exit.closing} Don't narrate beyond the ending into what comes next.`);
  } else if (move.to !== state.beat) {
    const beat = scene.beats.find(b => b.id === move.to)!;
    lines.push(`The scene has moved on to "${beat.title}": ${beat.direction} Play the start of this in your reply, growing out of what the player just did, and let the rest unfold over the next exchanges.`);
  }
  return lines;
}
