import type { ChoiceQuestion, Decider, Decision } from "../llm/decide.ts";
import { currentBeat, presentCast, scriptTranscript, sceneEntries } from "./brief.ts";
import { describeRoll, rng, rollCheck, titleCase, type RollResult } from "./dice.ts";
import type { Exit, Scene, Transition } from "./scene.ts";
import type { SessionState } from "./session.ts";

/** What the director decided this turn, and what the GM must make happen. */
export interface Move {
  transition: Transition;
  phase: "attempt" | "cue" | "outcome";
  roll?: RollResult;
  /** Beat or exit id we end up at (may equal the current beat after a failed check). */
  to: string;
  exit?: Exit;
}

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

function question(phase: keyof typeof QUESTION_TEXT, transitions: Transition[]): ChoiceQuestion {
  const none = phase === "cue" ? "not_yet" : "none";
  return {
    instructions: QUESTION_TEXT[phase],
    criteria: {
      ...Object.fromEntries(transitions.map(t => [t.id, t.when])),
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
  return { transition, phase, to, ...(roll ? { roll } : {}), ...(exit ? { exit } : {}) };
}

export interface PreDecision { move?: Move; speaker?: string; decision?: Decision }

/** Before the reply: is the player attempting a transition, or should a pacing cue fire? Plus who speaks first. */
export async function decideBefore(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, options: { speaker: boolean }): Promise<PreDecision> {
  const attempts = transitionsFor(scene, state, "attempt");
  const cues = transitionsFor(scene, state, "cue");
  const questions: Record<string, ChoiceQuestion> = {};
  if (attempts.length) questions.attempt = question("attempt", attempts);
  if (cues.length) questions.cue = question("cue", cues);
  if (options.speaker) {
    const cast = presentCast(scene, state);
    questions.speaker = {
      instructions: "Who should respond first to the player's latest turn? Pick the character the player addressed, or whose reaction matters most. Pick gm when the player's turn is mainly a physical action, a look around, or something only narration can answer.",
      criteria: { ...Object.fromEntries(cast.map(c => [c.id, `${c.name}${c.group ? ` (${c.group})` : ""}`])), gm: "The GM narrates what happens or what the player notices." },
    };
  }
  if (!Object.keys(questions).length) return {};
  const decision = await decider.decide(decisionState(scene, state, playerTurn), questions, "director.before");
  const attempt = attempts.find(t => t.id === decision.answers.attempt?.choice);
  const cue = cues.find(t => t.id === decision.answers.cue?.choice);
  // A player's attempt outranks a pacing cue: the player acted first.
  const chosen = attempt ?? cue;
  const move = chosen ? resolve(scene, state, chosen, attempt ? "attempt" : "cue") : undefined;
  return { ...(move ? { move } : {}), ...(decision.answers.speaker ? { speaker: decision.answers.speaker.choice } : {}), decision };
}

/**
 * After the reply: has an outcome now happened in the fiction? Cues count too: the GM often
 * brings the next beat in on their own, and the tracker should follow rather than replay it.
 */
export async function decideAfter(decider: Decider, scene: Scene, state: SessionState, playerTurn: string, reply: string): Promise<{ move?: Move; decision?: Decision }> {
  const outcomes = [...transitionsFor(scene, state, "outcome"), ...transitionsFor(scene, state, "cue")];
  if (!outcomes.length) return {};
  const decision = await decider.decide(decisionState(scene, state, playerTurn, reply), { outcome: question("outcome", outcomes) }, "director.after");
  const chosen = outcomes.find(t => t.id === decision.answers.outcome?.choice);
  return { ...(chosen ? { move: resolve(scene, state, chosen, "outcome") } : {}), decision };
}

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
  if (move.exit) {
    lines.push(`This reply closes the scene. ${move.exit.outcome} ${move.exit.closing}`);
  } else if (move.to !== state.beat) {
    const beat = scene.beats.find(b => b.id === move.to)!;
    lines.push(`The scene has moved on to "${beat.title}": ${beat.direction} Play the start of this in your reply, growing out of what the player just did, and let the rest unfold over the next exchanges.`);
  }
  return lines;
}
