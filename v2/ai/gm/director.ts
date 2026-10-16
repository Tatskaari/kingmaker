// Copied from the prototype's src/runtime/director.ts at 44c6d4a: lines 24-52, 60-93, 95-327, 625-637, 1231-1232 and 1360-1369 as they are (reading a TurnView), freeformCheck (:639-650) as its questions and their reading (freeformQuestions, readFreeform: the roll is the simulation's), and decideBefore (:718-1019) and decideAfter (:1234-1358) trimmed to the v2 approach's questions and split in two each: the questions (beforeQuestions, afterQuestions) and their reading (readBefore, readAfter). With the full GM (full-gm-design §3.1): considered rolls' roll_call and the means in every beat, the co-GM's off_graph, the considered read (:878-880, :896, :902-932), offGraph and byPrep (:987, :1010-1016), and after the reply the rules' left (:1279-1283, :1350). Left out: relocation, pressure rolls, the rules' mechanic, threat and their acts (actSettles, forced: the world bridge's), the speaker, and staged secrets; and the dice: a route's check is picked here (its skill the player's means where both are social) and rolled by the simulation. The directives' words are gm/directives.ts.

import type { ChoiceAnswer, ChoiceQuestion, Decider, Decision as Answers } from "../llm/decide.ts";
import { describeRoll, titleCase } from "../../shared/dice.ts";
import type { SceneStatus } from "../../shared/gm/state.ts";
import type { After, Decision } from "../../shared/protocol/ai.ts";
import { currentBeat, endsScene, IMPROVISED_EXIT_ID, openRoutes, presentCast } from "../../shared/scene/graph.ts";
import type { Essential, Exit, Scene, Skill, Transition } from "../../shared/scene/types.ts";
import { sceneEntries, scriptTranscript } from "./brief.ts";
import type { TurnView } from "./view.ts";

const phaseOf = (t: Transition): "attempt" | "cue" | "outcome" => t.on ?? (t.check ? "attempt" : "outcome");

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

const QUESTION_TEXT = {
  attempt: `A player in a tabletop roleplaying scene has just taken their turn (latest_player_turn). Which of these is the player attempting or doing in that turn? Judge the player's own words and actions in context: ${READ_TURN}. A passing mention is not an attempt. If none clearly applies, choose none.`,
  cue: "Pacing judgement for a tabletop roleplaying scene. Given the scene so far and the player's latest turn, should one of these happen right now? Choose not_yet unless its condition clearly holds now.",
  outcome: "After the latest exchange in a tabletop roleplaying scene (latest_player_turn and latest_gm_reply), which of these has now actually happened in the story? Count only what has happened in the fiction (said, shown, given, decided), not what was merely offered, hinted at or attempted. If none clearly happened, choose none.",
} as const;

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
 * A route with a roll the decider chose this surely is the author's answer to the turn: rolled as
 * written, with its outcomes, whatever the roll call's split between it and another act. On the QA
 * pass's turns where the two disagreed, at 0.74 to 0.91 the route was what the player was doing in
 * all eight (Hobb's mum asked of Nan at 0.81 and of Dilly at 0.85, ruled on instead, and the success
 * lost the route's payoff, Hobb opening up; the holes in Moll's story picked at 0.74; a bluff on the
 * floor at 0.78); at 0.63 to 0.66 the other act was, in all three (a second shilling for Cob's trust,
 * Scrope asked to name the Master with the book already in hand, Hobb asked to block the Crake).
 */
export const ROUTE_CONFIDENCE = 0.7;

/**
 * Unless the roll call is this sure that the roll is for something none of the routes is for: then the
 * player is plainly doing something else risky as well (or instead), and the GM rules on it. (No QA
 * turn had a route read that surely and this beside it.)
 */
const PLAINLY_ANOTHER = 0.8;

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

const OOC_QUESTION: ChoiceQuestion = {
  instructions: "Is the player's latest turn spoken out of character, to the GM rather than in the story (e.g. asking what their options are, how something works in the game, or what they know)? An action in *asterisks* or (parentheses) is in character: it's what their character does.",
  criteria: { in_character: "In character: the player's character speaks or acts in the story.", out_of_character: "Out of character: a question or remark to the GM about the game or the situation." },
};

/**
 * With an ending held for the player's answer: are they answering it (it waits once more), or
 * letting it happen (it lands in this reply)? Asked only then, in the turn's one decision.
 */
function brinkQuestion(exit: Exit): ChoiceQuestion {
  return {
    instructions: `The scene is about to end like this: ${exit.title}. ${exit.outcome} In their latest turn, is the player answering that, or letting it happen?`,
    criteria: {
      lets_it_happen: "Letting it happen: they accept it or go along with it (agreeing, thanking someone, saying goodbye, leaving), or do something that doesn't bear on it.",
      answers: "Answering it: they engage with it some other way: a question or a request to someone here, an objection, a challenge or calling someone out (even just their name, said to them), something new offered or shown, or a try to change it.",
    },
  };
}

/**
 * After the reply, whether an ending found now would leave something hanging: a question or a request
 * the reply hasn't answered. Asked every turn, in the call the turn makes anyway.
 */
const ASK_QUESTION: ChoiceQuestion = {
  instructions: "Did the player's latest turn ask someone in the scene a question, or ask them for something, that the latest GM reply leaves unanswered (neither answered, granted nor refused)?",
  criteria: {
    unanswered: "Yes: they asked someone here something, or asked them for something, and the reply hasn't answered, granted or refused it.",
    none: "No: they asked nothing of anyone here, or the reply answered, granted or refused it.",
  },
};

/** After the reply, whether the scene is ending by the player's own choice (one wind-down turn), or through others (it waits for their answer). */
const OWN_EXIT_QUESTION: ChoiceQuestion = {
  instructions: "Is the player, in their latest turn, choosing to end the scene themselves: leaving or setting off, handing someone or something over, settling it their own way, or saying they're done here? Not if the scene is ending through what someone else decided or did, or how things now stand.",
  criteria: {
    theirs: "Yes: the player's own choice in their latest turn ends it.",
    no: "No: if it's ending, that's other people's doing or how things stand, not the player's choice.",
  },
};

/** Is the player's turn out of character? On its own, for a wind-down turn, which asks nothing else. */
export async function outOfCharacter(decider: Decider, scene: Scene, state: TurnView, playerTurn: string): Promise<{ ooc: boolean; decision: Answers }> {
  const decision = await decider.decide(decisionState(scene, state, playerTurn), { ooc: OOC_QUESTION }, "director.ooc");
  return { ooc: decision.answers.ooc?.choice === "out_of_character", decision };
}

/** The cue the decider chose, if its read clears the bar: a clear read, and a clearer one before its count. */
export function firedCue(cues: Transition[], read: ChoiceAnswer | undefined, exchanges: number): Transition | undefined {
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

function transitionsFor(scene: Scene, state: TurnView, phase: "attempt" | "cue" | "outcome"): Transition[] {
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

/**
 * The same push again (a try that failed, tried again with nothing new on the table), asked in the
 * turn's own decision when something has failed in this scene: a route's roll isn't rolled again
 * for it, as the GM's ruling wouldn't be. Which try it repeats, so that only the same route (or a
 * ruling's same objective) counts: the goals run's first press on the King was read as "the same
 * push" as the catch-out that had failed twice, and got no roll.
 */
function sameAgainQuestion(tried: FailedPush[]): ChoiceQuestion {
  return {
    instructions: "Earlier in this scene the player tried these, and they failed. Is the player's latest turn the same push as one of them again: the same ask of the same person by the same means, reworded or louder, with nothing new on the table? Which one? A new lever (an offer, a threat or a promise not made before, evidence, something learned since), a different ask or person, or a real change in the situation since makes it a new try, and so does pushing for something else, even of the same person.",
    criteria: {
      ...Object.fromEntries(tried.map((t, i) => [`again_${i}`, `The same push as this one again, with nothing new: ${t.line}`])),
      new: "A new try, or not one of these at all.",
    },
  };
}

/**
 * How surely the turn is the same push again as a try that failed on this route, or as a ruling that
 * failed (the decider has matched the turn to both, so they share the objective); with the answer it
 * got then, the most likely one's.
 */
function pushedAgain(tried: FailedPush[], answer: ChoiceAnswer | undefined, route: Transition): { p: number; answer?: string } {
  if (!answer) return { p: 0 };
  const same = tried.map((t, i) => ({ t, p: answer.probabilities?.[`again_${i}`] ?? (answer.choice === `again_${i}` ? 1 : 0) }))
    .filter(({ t }) => t.route === undefined || t.route === route.id);
  const best = [...same].sort((a, b) => b.p - a.p)[0];
  return { p: same.reduce((sum, { p }) => sum + p, 0), ...(best && best.p > 0 ? { answer: best.t.answer } : {}) };
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

// ---------------------------------------------------------------------------------------------
// Before the reply: decideBefore (director.ts:718-1019), as V0 asks it, in two.

/** What beforeQuestions asks, and what the reading needs of how it asked. */
export interface BeforeAsked {
  questions: Record<string, ChoiceQuestion>;
  attempts: Transition[];
  cues: Transition[];
  outcomes: Transition[];
  tried: FailedPush[];
  /** An ending held for the player's answer: the brink question was asked. */
  brink?: Exit;
}

/**
 * Before the reply, the turn's one decision: is the player attempting a route (or doing something
 * that simply happens), by what means, should a pacing cue fire, would a good GM call for a roll
 * (considered rolls), the same push again, a plan off the graph (the co-GM's), earned, daft, out of
 * character, answering an ending on the brink, reaching for a limit. As the prototype's v2 approach
 * asks them, in its order, but for the rules' mechanic (the world bridge's).
 */
export function beforeQuestions(scene: Scene, state: TurnView, brink?: Exit): BeforeAsked {
  const attempts = transitionsFor(scene, state, "attempt");
  const cues = transitionsFor(scene, state, "cue");
  // Outcomes that need no roll are shown as alternatives, so the decider can see that a kind
  // word might simply work; choosing one means "no attempt now" (it's judged after the reply).
  // The built-in improvised ending, and what only someone else can give, are only ever judged
  // after the reply, on what happened.
  const outcomes = transitionsFor(scene, state, "outcome").filter(t => t.to !== IMPROVISED_EXIT_ID && !t.given);
  const questions: Record<string, ChoiceQuestion> = {};
  if (attempts.length || outcomes.length) {
    const q = question("attempt", attempts, scene);
    questions.attempt = {
      // (Two spaces after "choose that.": the prototype's, where its freeform option would go.)
      instructions: `${q.instructions} Some things need no dice: if the player's turn is better described by one of the "simply happens" options, choose that.  Risky things none of the options cover are for the GM to resolve in the story: choose none.`,
      criteria: {
        ...q.criteria,
        none: "Nothing risky and none of the above: the player talks, asks, accepts an offer, looks around or searches at leisure, or does something with no real chance or cost of failure.",
        ...Object.fromEntries(outcomes.map(t => [`plain:${t.id}`, `Simply happens, no dice needed: ${t.when}`])),
      },
    };
  }
  // The method: for a route written for one social means, and (considered rolls) in every beat, so
  // the GM's review hears a lie read as a lie wherever it's told.
  questions.attempt_means = {
    instructions: "If the player is working on someone in their latest turn, by what means?",
    criteria: { persuasion: "Persuading: an appeal, an argument, a bargain, reassurance or flattery.", intimidation: "Intimidating: threats, menace or a show of force.", deception: "Deceiving: a lie, a bluff, a disguise or a trick.", performance: "Performing: a speech, a song or a show for a crowd.", none: "Not working on anyone, or something else." },
  };
  if (cues.length) questions.cue = cueQuestion(cues, state.turnsInBeat);
  // Considered rolls: whether a roll is wanted, and whether a route's roll is for it, in this call.
  questions.roll_call = rollCallQuestion(attempts.filter(t => t.check));
  // The same push that already failed here, again: asked only once something has failed.
  const tried = attempts.some(t => t.check) ? failedPushes(scene, state) : [];
  if (tried.length) questions.same_again = sameAgainQuestion(tried);
  // The co-GM's: a way through the scene that none of its routes describes (the routes as the beat has them, every one).
  const routes = [...currentBeat(scene, state).transitions, ...(scene.anytime ?? [])].map(t => t.when);
  questions.off_graph = {
    instructions: `Is the player, in their latest turn, proposing or pursuing a way to deal with the scene's central situation that none of the scene's routes describes? A plan put as a question ("could we...?", "what if we...?") counts. The routes: ${routes.map(r => `"${r}"`).join("; ")}. Ordinary conversation, questions about the situation and small actions don't.`,
    criteria: { off_graph: "Yes: a real attempt or proposal to resolve or change the situation by a means none of the routes describes.", covered: "No: it matches a route, or it's ordinary play." },
  };
  // Holding back after the player has done the work is the commonest pacing failure we've seen.
  questions.earned = {
    instructions: "Has the player, in their latest turn, done what it takes to get something they've been working towards from someone in this scene: met that person's own terms, shown them the proof, made their case in full, or given the help or leverage that person was waiting for? Judge by what the story so far has established that person needs, not by how hard the player is pushing.",
    criteria: { earned: "Yes: they've just done what it takes; it should land now.", not_yet: "No: they're still working on it, asking, or haven't done what it takes." },
  };
  questions.daft = DAFT_QUESTION;
  questions.ooc = OOC_QUESTION;
  // An ending held for the player's answer: are they answering it, or letting it happen?
  if (brink) questions.brink = brinkQuestion(brink);
  if (scene.limits?.length) {
    // (Considered rolls: a forged warrant is a lie to be judged, not the real warrant the scene can't
    // offer; it has an answer of its own, so faking one isn't read as reaching for it.)
    questions.limit = {
      instructions: "Is the player, in their latest turn, reaching for one of the things this scene can't offer (asking for it, trying to do it, or assuming it exists)? Only choose one if the player's turn clearly depends on getting it. Faking one isn't reaching for it: a forged paper, a fake badge or a lie that they have one of these is a trick the player is attempting on someone (choose pretending), unless what they're after by it is itself one of these.",
      criteria: {
        ...Object.fromEntries(scene.limits.map((l, i) => [`limit_${i}`, l])),
        pretending: "The player fakes or claims one of these as a trick on someone (a forgery, a fake, a lie that they have it), to get something else.",
        none: "No: the player's turn doesn't depend on any of these.",
      },
    };
  }
  return { questions, attempts, cues, outcomes, tried, ...(brink ? { brink } : {}) };
}

/**
 * The decision read as the prototype reads it, its bars and all: the attempt (a route with a check
 * or an ending needs 0.6, anything else 0.45), the plain outcome, a cue (never over a real attempt,
 * an earned payoff, a word out of character, or the player's own way out), a roll wanted that
 * nothing the author wrote settles (considered: then no route is taken and no cue fires, the GM rules
 * on it before the reply), the same push again (no dice), daft, earned, out of character, a limit,
 * an answer on the brink, a plan off the graph, and a plain route the prep's own answer (byPrep).
 * What it picks is the route the turn takes, its check as the simulation will roll it: no die is
 * cast here.
 */
export function readBefore(scene: Scene, state: TurnView, decision: Answers, asked: BeforeAsked): Decision {
  const { attempts, cues, outcomes, tried, brink } = asked;
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
  const fired = attempt || earnedNow || ooc ? undefined : firedCue(cues, decision.answers.cue, state.turnsInBeat);
  // Nor does a cue end the scene over the player's own way out (a fight aside: danger doesn't wait).
  // It waits while an ending is held for their answer, which it would replace, and while they're
  // going for an ending of their own: the routes that settle the scene, read together as an attempt
  // is (0.45), though none surely enough to take (walking off the wharf with the book, 0.56, became
  // "The barge sails"). And when they're plainly leaving (0.6, together) by a way that leads where
  // the cue does, the cue's ending is their own choice, and it closes in this reply ("(I leave the
  // Rat for the Heron)" read 0.57 and 0.16 between two ways out, and the eleventh bell's ending, the
  // second's, was held for the answer they'd just given).
  const pOf = (t: Transition) => decision.answers.attempt?.probabilities?.[t.id] ?? (answer === t.id ? 1 : 0);
  const exitOf = (t: Transition) => t.check ? t.check.onSuccess : t.to;
  const leavingBy = attempts.filter(t => endsScene(scene, t));
  const leaving = leavingBy.reduce((sum, t) => sum + pOf(t), 0);
  const cueEnding = fired && endsScene(scene, fired) && scene.exits.find(e => e.id === exitOf(fired))?.kind !== "combat" ? exitOf(fired) : undefined;
  const theirsToo = !!cueEnding && !brink && leaving >= SCENE_ENDING_CONFIDENCE && leavingBy.some(t => exitOf(t) === cueEnding && pOf(t) >= 0.1);
  const cue = cueEnding && !theirsToo && (brink || leaving >= 0.45) ? undefined : fired;
  // Something the player simply does that settles the scene (setting off, handing it over) is
  // their chosen ending: close it in this reply rather than letting the reply run past it.
  const plainOutcome = plain ? outcomes.find(t => `plain:${t.id}` === answer) : undefined;
  const plainEnding = plainOutcome && endsScene(scene, plainOutcome) && (decision.answers.attempt?.probabilities?.[answer!] ?? 1) >= SCENE_ENDING_CONFIDENCE ? plainOutcome : undefined;
  // A route the author gave no dice, read with an attempt's confidence, is the prep's own answer to
  // the turn (a bribe gets haggling, trust needs no roll): no ruling of the GM's overrides it.
  const plainSettles = !!plainOutcome && (decision.answers.attempt?.probabilities?.[answer!] ?? 1) >= (endsScene(scene, plainOutcome) ? SCENE_ENDING_CONFIDENCE : 0.45);
  const means = decision.answers.attempt_means?.choice;
  const sureMeans = means && means !== "none" && (decision.answers.attempt_means?.probabilities?.[means] ?? 1) >= SCENE_ENDING_CONFIDENCE ? means as Skill : undefined;
  // Saying no wrongly costs as much as ending the scene wrongly: same confidence bar.
  const limitChoice = decision.answers.limit?.choice;
  const limitConfident = (decision.answers.limit?.probabilities?.[limitChoice ?? ""] ?? 1) >= SCENE_ENDING_CONFIDENCE;
  const limit = limitChoice?.startsWith("limit_") && limitConfident ? scene.limits?.[Number(limitChoice.slice(6))] : undefined;
  // No dice for the impossible: if the player is reaching for something the scene can't offer,
  // the "no, but" answers it and nothing is rolled.
  const limitBlocks = decision.answers.limit?.choice?.startsWith("limit_") && (decision.answers.limit?.probabilities?.[decision.answers.limit.choice] ?? 1) >= SCENE_ENDING_CONFIDENCE;
  // Considered rolls: a roll is wanted (a route's "yes" and none's count together), and nothing the
  // author wrote settles it: a route's roll the decider chose surely (unless the roll is plainly for
  // something else), or chose and didn't call the act another's, a route the author gave no dice, or
  // an ending the player simply reaches. Then no route is rolled here, and no cue fires: the GM rules
  // on it before the reply.
  // (A player who has just met someone's terms has earned the payoff: that lands, as ever, without dice.)
  const call = decision.answers.roll_call;
  const yes = (option: string) => call ? call.probabilities?.[option] ?? (call.choice === option ? 1 : 0) : 0;
  const routeSure = !!attempt?.check && probability >= ROUTE_CONFIDENCE && yes("new") < PLAINLY_ANOTHER;
  const settledByPrep = attempt ? !attempt.check || routeSure || yes("route") >= yes("new") : !!plainEnding || plainSettles;
  const earnedRead = decision.answers.earned?.probabilities?.earned ?? (decision.answers.earned?.choice === "earned" ? 1 : 0);
  // (A beat with no route with a roll has a lower bar: there the flag can only say "new" or "none".)
  const bar = attempts.some(t => t.check) ? CONSIDER_CONFIDENCE : CONSIDER_CONFIDENCE_OPEN;
  const considered = yes("route") + yes("new") >= bar && earnedRead < SCENE_ENDING_CONFIDENCE && !settledByPrep && !limitBlocks && !ooc
    ? {
      probability: yes("route") + yes("new"),
      routes: attempts.filter(t => t.check).map(t => ({ id: t.id, p: decision.answers.attempt?.probabilities?.[t.id] ?? 0 })).filter(r => r.p >= 0.05).sort((a, b) => b.p - a.p),
      ...(sureMeans ? { means: sureMeans } : {}),
      ...(earnedRead >= 0.3 ? { earned: earnedRead } : {}),
    }
    : undefined;
  // The same push that already failed here isn't rolled again on a route's dice (the GM's ruling
  // says no to it without them too): it gets the same answer.
  // (Only a push that already failed on this route, or a ruling's same objective: a first press on
  // the King isn't the catch-out that failed before it.)
  const again = attempt?.check ? pushedAgain(tried, decision.answers.same_again, attempt) : { p: 0 };
  const sameAgain = attempt?.check && !considered && again.p >= SCENE_ENDING_CONFIDENCE ? attempt : undefined;
  const chosen = considered || sameAgain ? undefined : attempt ?? plainEnding ?? cue;
  // (a plain action alongside a cue: the cue's beat change carries the reply)
  const method = attempt ? sureMeans : undefined;
  const daft = decision.answers.daft?.choice === "consequential" && (decision.answers.daft?.probabilities?.consequential ?? 1) >= DAFT_CONFIDENCE;
  const earned = decision.answers.earned?.choice === "earned" && (decision.answers.earned?.probabilities?.earned ?? 1) >= SCENE_ENDING_CONFIDENCE;
  const offGraph = decision.answers.off_graph?.choice === "off_graph" && (decision.answers.off_graph?.probabilities?.off_graph ?? 1) >= SCENE_ENDING_CONFIDENCE;
  // The plain route the reply is told of (the prototype's plainTransition): not one that ends the scene now, nor over a roll to rule on.
  const plainTransition = plainOutcome && !plainEnding && !considered ? plainOutcome : undefined;
  return {
    // (The cue's ending is the one the player is leaving by: their choice, as their own route's would be.)
    ...(chosen ? { route: pick(chosen, attempt || plainEnding ? "attempt" : "cue", method, chosen === cue && theirsToo) } : {}),
    ...(plainOutcome ? { plain: plainOutcome.id } : {}),
    ...(sameAgain ? { sameAgain: { route: sameAgain.id, ...(again.answer ? { answer: again.answer } : {}) } } : {}),
    earned, daft, outOfCharacter: ooc,
    ...(limit ? { limit } : {}),
    ...(decision.answers.brink?.choice === "answers" ? { answering: true } : {}),
    ...(considered ? { considered } : {}),
    ...(offGraph ? { offGraph } : {}),
    ...(plainTransition && plainSettles ? { byPrep: true } : {}),
  };
}

/**
 * The route the turn takes, as resolve (director.ts:330-342) began it: its check with the skill the
 * player's means where the route's and theirs are both social ("preserve intent, change method": a
 * threat aimed at a route written for persuasion rolls intimidation). The simulation rolls it and
 * works out where it leads; `theirs`, the cue that is the player's own way out, makes it chosen.
 */
function pick(t: Transition, phase: "attempt" | "cue", means: Skill | undefined, theirs: boolean): NonNullable<Decision["route"]> {
  const check = t.check && { skill: means && means !== t.check.skill && SOCIAL.includes(means) && SOCIAL.includes(t.check.skill) ? means : t.check.skill, dc: t.check.dc, ...(t.check.reason ? { reason: t.check.reason } : {}) };
  return { id: t.id, phase, ...(check ? { check } : {}), ...(theirs ? { theirs } : {}) };
}

// ---------------------------------------------------------------------------------------------
// After the reply: decideAfter (director.ts:1234-1358), as V0 asks it, in two.

/** What afterQuestions asks, and what the reading needs of how it asked. */
export interface AfterAsked {
  questions: Record<string, ChoiceQuestion>;
  outcomes: Transition[];
  endings: Exit[];
  pending: Essential[];
}

/** The player has left the scene's place altogether (asked after each reply in rules sessions). */
export const LEFT_CONFIDENCE = 0.7;

/**
 * After the reply, the turn's second decision: how the scene is going, which ending (if any) the
 * story is at, which essentials the player has come across or been pointed to, whether the player
 * has walked out of the place (asked when their character is the rules engine's: their sheet has a
 * build), which outcome route has happened, whether they asked something left unanswered, and
 * whether an ending would be their own doing. Not asked: staged secrets (off in v2) and the rules'
 * threat and severity (the world bridge's). `hold`: an ending held back this turn for the player's
 * answer, which this reply can't confirm.
 */
export function afterQuestions(scene: Scene, state: TurnView, hold?: string): AfterAsked {
  // An ending held back this turn (the player gets a last chance) can't be confirmed by the same reply.
  const leadsTo = (t: Transition) => [t.to, t.check?.onSuccess, t.check?.onFailure];
  // While an ending is held for the player's response, no other ending (not even the improvised one) can fire.
  const outcomes = [...transitionsFor(scene, state, "outcome"), ...transitionsFor(scene, state, "cue")]
    .filter(t => !hold || (!leadsTo(t).includes(hold) && t.to !== IMPROVISED_EXIT_ID));
  const questions: Record<string, ChoiceQuestion> = { status: STATUS_QUESTION };
  // Which ending is the story at now, if any? Asked over every ending, including ones the player
  // reaches without dice or that no route leads to, as a state rather than "what just happened".
  const endings = scene.exits.filter(e => e.id !== hold && !state.fought?.includes(e.id));
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
  // The rules: has the player walked out of the place altogether? (Its name is the scene's world's,
  // which the AI service has as the world's root: a campaign's scene keeps its place apart.)
  if (state.rules) {
    const place = scene.world?.name ?? (state.world ? state.world.entities[state.world.root]?.name : undefined);
    questions.left = {
      instructions: `Where is the player character at the end of the latest GM reply? This scene is set in ${scene.title}${place ? ` (${place})` : ""}.`,
      criteria: { here: `Still in or around ${scene.title}.`, gone: "Gone somewhere else altogether: another building, across town, down the river, or on their way there." },
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
  // Whether an ending found now waits for the player's answer: something they asked is still hanging,
  // or it isn't their own doing.
  questions.ask = ASK_QUESTION;
  questions.own_exit = OWN_EXIT_QUESTION;
  return { questions, outcomes, endings, pending };
}

/**
 * The after-reply decision read as the prototype reads it: the improvised ending gives way to an
 * authored one read at 0.2 or more; ending on an outcome needs 0.6 (the improvised ending's share
 * added to an authored one's); an outcome route is returned with its check for the simulation to
 * roll; landed and hinted; a question left unanswered; the player's own exit at 0.6; and the
 * player gone from the place at 0.7.
 */
export function readAfter(scene: Scene, decision: Answers, asked: AfterAsked): After {
  const { outcomes, endings, pending } = asked;
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
  const instead = chosen && !chosen.check && chosen.to === IMPROVISED_EXIT_ID && endingAnswer ? endings.filter(e => e.id !== IMPROVISED_EXIT_ID).map(e => ({ e, p: endingAnswer.probabilities?.[e.id] ?? 0 })).sort((a, b) => b.p - a.p)[0] : undefined;
  let ending = endingAnswer && endingAnswer.choice !== "not_yet" ? { exitId: endingAnswer.choice, probability: endingAnswer.probabilities?.[endingAnswer.choice] ?? 0 } : undefined;
  // The improvised ending is a last resort here too: prefer a plausible authored ending (its script knows what it means).
  if (ending?.exitId === IMPROVISED_EXIT_ID && endingAnswer) {
    const authored = endings.filter(e => e.id !== IMPROVISED_EXIT_ID).map(e => ({ id: e.id, p: endingAnswer.probabilities?.[e.id] ?? 0 })).sort((a, b) => b.p - a.p)[0];
    if (authored && authored.p >= 0.2) ending = { exitId: authored.id, probability: authored.p + ending.probability };
  }
  const landed = pending.filter(e => decision.answers[`landed_${e.id}`]?.choice === "landed").map(e => e.id);
  const hinted = pending.filter(e => decision.answers[`landed_${e.id}`]?.choice === "hinted").map(e => e.id);
  const left = decision.answers.left?.choice === "gone" && (decision.answers.left?.probabilities?.gone ?? 1) >= LEFT_CONFIDENCE;
  // (Unsure reads wait: a question left hanging on an even read, and only a clear read is the player's own exit.)
  const unanswered = decision.answers.ask?.choice === "unanswered";
  const theirs = decision.answers.own_exit?.choice === "theirs" && (decision.answers.own_exit?.probabilities?.theirs ?? 1) >= SCENE_ENDING_CONFIDENCE;
  return {
    ...(left ? { left } : {}),
    ...(chosen ? { outcome: { route: chosen.id, ...(chosen.check ? { check: { skill: chosen.check.skill, dc: chosen.check.dc, ...(chosen.check.reason ? { reason: chosen.check.reason } : {}) } } : {}), ...(instead && instead.p >= 0.2 ? { exit: instead.e.id } : {}) } } : {}),
    ...(ending ? { ending } : {}), ...(status ? { status } : {}),
    landed, hinted, unanswered, theirs,
  };
}
