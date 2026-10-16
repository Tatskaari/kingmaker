// Copied from the prototype at 44c6d4a: the directives' words from src/runtime/director.ts:1021-1035, 1096-1097, 1190-1191, 1201-1211, 1387-1410 and src/runtime/engine.ts:225-228, 255-328, 586, 706, 728, 1329 (openingDirective without its after-a-boundary branch: V0 plays one scene). directivesFor is new: the list engine.ts's playerTurn builds step by step (:577-738), rebuilt from the decision and what the decide commit (and on a considered turn, the consider commit) did.

import type { RollResult } from "../../shared/dice.ts";
import { describeRoll, titleCase } from "../../shared/dice.ts";
import type { Decision, Outcome } from "../../shared/protocol/ai.ts";
import { presentCast } from "../../shared/scene/graph.ts";
import type { Exit, Scene, Skill, Transition } from "../../shared/scene/types.ts";
import type { TurnView } from "./view.ts";

/**
 * Every word the GM is told to do in a reply. Some are matched by their opening words elsewhere
 * ("This reply closes the scene", "The scene is ending": brief.ts's `closes`), so each string is
 * the prototype's exactly: a reworded directive breaks a match without an error.
 */

/** What the director decided this turn, and what the GM must make happen (director.ts's Move). */
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

/**
 * The reply's directives, in the prototype's order and with its overwrites (engine.ts:577-738): the
 * urgent memory, then a move's lines (which replace it) or the same push again; on a considered turn
 * the ruling's lines after it (or, with no ruling, the plain check's); an ending near, the bill, the
 * payoff, out of character or the plain route, a limit, the loop broken (none of the five over a
 * ruling: it decided the turn), a held ending, and a last chance before a close. `s` is the view
 * after the decide commit (the consider commit, on a considered turn); `o` what they did. `ruled`:
 * the ruling's lines as gm/consider.ts's ruledLines words them, when `o.ruled` is there; an ending
 * the dice decided plays its moment now and closes on the next reply, as a route's does (moveTaken).
 */
export function directivesFor(scene: Scene, s: TurnView, d: Decision, o: Outcome, ruled: string[] = []): string[] {
  if (o.windDown) return windDownLines(scene, s, d, exitOf(scene, o.windDown.exit));

  let lines: string[] = d.remembered ? [rememberedLine(d.remembered)] : [];
  if (o.move) {
    // Told as before it was applied: the beat it moved from.
    lines = moveDirective(scene, { ...s, beat: o.move.from }, moveOf(scene, o.move));
    if (o.taken?.closing) lines = [...lines.filter(l => !l.startsWith("This reply closes the scene")), diceDecided(exitOf(scene, o.move.exit!))];
  } else if (d.sameAgain) {
    lines = [sameAgainDirective(routeOf(scene, s.beat, d.sameAgain.route), d.sameAgain.answer)];
  }
  // A considered turn (engine.ts:656-701): the ruling, or the plain check rolled without one.
  const r = o.ruled;
  if (r) {
    const exit = scene.exits.find(e => e.id === (r.exit ?? r.to));
    const decided = !!exit && r.chosen && !!r.roll && exit.kind !== "combat";
    lines.push(...(decided ? [...ruled.filter(l => !l.startsWith("This reply closes the scene")), diceDecided(exit)] : ruled));
  } else if (o.freeform) {
    lines.push(freeformDirective(o.freeform));
  }

  const lead = s.endingLead && !o.move && !r && !s.closing && !d.outOfCharacter ? scene.exits.find(e => e.id === s.endingLead!.exitId) : undefined;
  if (lead) lines.push(`The scene may be reaching its end (${lead.title}). Stay at the threshold: don't narrate journeys or arrivals somewhere else; if the player is leaving or the matter is settled, let it close here.`);
  // A ruling decided this turn's consequences, and its payoff: no bill or payoff on top of it.
  if (d.daft && !d.outOfCharacter && !r && !o.move?.roll) lines.push(CONSEQUENCE_DIRECTIVE);
  if (d.earned && !d.outOfCharacter && !o.move?.roll && !r) lines.push(EARNED_DIRECTIVE);
  if (d.outOfCharacter) lines.push(OOC_DIRECTIVE);
  else if (d.plain && d.route?.id !== d.plain && !d.considered && !d.limit && !o.move && !r) lines.push(plainDirective(routeOf(scene, s.beat, d.plain)));
  if (d.limit && !d.outOfCharacter) lines.push(limitDirective(d.limit));
  if (o.wasStuck && !o.move && !r && !d.outOfCharacter && !d.sameAgain) lines.push(STUCK);
  if (o.held && o.pending) lines.push(heldLine(o.held, exitOf(scene, o.pending.exit)));

  const closes = o.closes ? exitOf(scene, o.closes) : undefined;
  const last = closes && closes.kind !== "combat" ? lastChance(scene, s) : undefined;
  if (last) lines.push(last);
  return lines;
}

/** The wind-down turn (engine.ts:487-496): a word out of character is answered and the close waits; otherwise the close, with a last chance. */
function windDownLines(scene: Scene, s: TurnView, d: Decision, exit: Exit): string[] {
  if (d.outOfCharacter) return [OOC_DIRECTIVE, oocHold(exit, "closing")];
  const last = exit.kind === "combat" ? undefined : lastChance(scene, s);
  return [closingDirective(exit), ...(last ? [last] : [])];
}

/** The operation a reply's call goes as: the wind-down's close, or an ordinary reply (out of character, the close waits). */
export const replyOperation = (d: Decision, o: Outcome) => (o.windDown && !d.outOfCharacter ? "gm.closing" : "gm.reply");

/** The move the decide commit made, as the prototype's director had it: the route as it was in the beat it was taken from. */
function moveOf(scene: Scene, m: NonNullable<Outcome["move"]>): Move {
  const exit = m.exit ? exitOf(scene, m.exit) : undefined;
  return { transition: routeOf(scene, m.from, m.route), phase: m.phase, to: m.to, chosen: m.chosen, ...(m.roll ? { roll: m.roll } : {}), ...(exit ? { exit } : {}) };
}

/** A route by id: the beat's own first (beats can share an id: the yard's catch-moll and the doubt beat's), then the anytime ones. */
export function routeOf(scene: Scene, beat: string, id: string): Transition {
  const route = [...(scene.beats.find(b => b.id === beat)?.transitions ?? []), ...(scene.anytime ?? [])].find(t => t.id === id)
    ?? scene.beats.flatMap(b => b.transitions).find(t => t.id === id);
  if (!route) throw new Error(`${scene.id} has no route ${id}`);
  return route;
}

export function exitOf(scene: Scene, id: string): Exit {
  const exit = scene.exits.find(e => e.id === id);
  if (!exit) throw new Error(`${scene.id} has no exit ${id}`);
  return exit;
}

// ---------------------------------------------------------------------------------------------
// The words (the prototype's, exactly).

/**
 * How a scene opens: all of its opening, none of which has happened yet. (The prototype's other
 * branch, picking up from how the last scene ended, comes with the boundary vertical.)
 */
export function openingDirective(scene: Scene): string {
  return `Open the scene. ${scene.opening} Keep it to a short paragraph or two and end on something the player can respond to.`;
}

/** A note opened at p ≥ 0.9 bears on this moment (engine.ts:584-586): whose memory it is, when it's someone's. */
const rememberedLine = (owners: string[]) => `Something from before bears on this moment${owners.length ? `: ${owners.join(" and ")} remember${owners.length === 1 ? "s" : ""} it` : ""} (see the notes just opened under "What people remember"). Let it show in how they respond, in their own words.`;

/** An ending the dice decided before the reply: its moment now, the close on the next reply (engine.ts:258). */
const diceDecided = (exit: Exit) => `The dice have decided it: this is heading to ${exit.title} (${exit.outcome}). Play the decisive moment and people's immediate reactions, including anyone who saw it; the scene closes on your next reply, so don't wrap everything up yet.`;

/** The scene judged stuck after the last reply (engine.ts:728). */
const STUCK = "The scene has been going in circles. Break the loop in this reply with something new: someone acts on what they want or gives ground, a consequence lands, or something is revealed that opens a way forward. Don't replay an earlier push or repeat the last exchange.";

const FIGHT_CLOSE = " A fight starts here and is played out blow by blow on the map: end on the moment it breaks out, before any blow lands, any shot hits or any spell takes hold.";

/**
 * The player's turn with an ending held for their answer (engine.ts:276-286, the line of each way
 * it goes: the simulation decides which). A word out of character leaves it as it was; a turn that
 * answers it holds it once more; any other turn lets it land in this reply.
 */
function heldLine(held: NonNullable<Outcome["held"]>, exit: Exit): string {
  if (held === "ooc") return oocHold(exit, "held");
  if (held === "brink") return `The scene is on the brink of: ${exit.title} (${exit.outcome}). It hasn't closed: the player is answering it, and their response may change that. Answer what they ask, let whoever they challenge or call on answer, and let what they do change things if it would; play it honestly.`;
  return `This reply closes the scene: ${exit.outcome} ${LAST_WORD} Land it on a moment that belongs to the player. What this ending should feel like: ${exit.closing} ${ONCE} ${STORY_VOICE} Don't narrate beyond the ending into what comes next.${exit.kind === "combat" ? FIGHT_CLOSE : ""}`;
}

/** A word out of character while an ending is held or winding down: answered, and nothing moves on. */
function oocHold(exit: Exit, how: "held" | "closing"): string {
  const where = how === "held"
    ? `the scene is on the brink of ${exit.title}, which hasn't happened yet: the player's next turn in character is their answer to it`
    : `the scene has come to ${exit.title}, and it closes on the player's next turn in character, not in this reply`;
  return `Nothing in the story moves on while you answer: ${where}. Then give the turn back.`;
}

/**
 * A closing tells what's left, once: Kell's arrest of Hobb, narrated as it happened, came again
 * word for word in the close, from the exit's "Kell's proper words".
 */
const ONCE = "What the scene has already shown has happened: don't show it again or say any line of it twice; if this ending's moment has already played, close from where it stands.";

/**
 * A closing is told in the story's voice: the last one read as bookkeeping ("what came of it is not
 * established here… the King's promise cannot bring them back into this room", of a promise never made).
 */
const STORY_VOICE = "Tell it in the story's own voice: what became of people, said plainly as what became of them (what isn't settled yet is how things stand: \"Hobb waits in the cells for the Assizes\"), and only the promises actually made in play; never the game's words (established, the story, this scene, between scenes).";

/**
 * What the scene still holds as it closes: an essential the player hasn't come across (not one the
 * story carries on anyway: `later`, or brought over), with someone here who has it. Before the
 * close, one of them lets it reach the player in their own way. In the Rat, once Hobb clammed up
 * about the Heron, Nan, Dilly and Cob, who had it too, never said a word, and the boundary had no
 * truthful way to the wharf.
 */
export function lastChance(scene: Scene, state: TurnView): string | undefined {
  const here = new Set(presentCast(scene, state).map(c => c.id));
  const landed = new Set(state.landed ?? []);
  const open = (scene.essentials ?? []).filter(e => !landed.has(e.id) && !e.later && !e.missed)
    .map(e => ({ what: e.what, by: (e.carriers ?? []).filter(id => here.has(id)) })).filter(x => x.by.length).slice(0, 2);
  if (!open.length) return undefined;
  const one = open.length === 1;
  return `Before it closes: the player hasn't come across ${one ? "this" : "these"}, and the story goes on without ${one ? "it" : "them"} unless they do: ${open.map(x => `${x.what} (${x.by.map(id => nameIn(scene, state, id)).join(" or ")} could let it out)`).join("; ")}. If one of them would, as things stand (a word as the player goes, something they'd say anyway, a thing in plain sight), let it reach the player in this reply, once, in their own way; nobody who has refused it gives it up for nothing.`;
}

/** Someone as the player knows them: what they're called until the name is heard (engine.ts:1329). */
const nameIn = (scene: Scene, state: TurnView, id: string) => state.rules?.aliases?.[id] ?? scene.cast.find(c => c.id === id)?.name ?? state.world?.entities[id]?.name ?? id;

/** The wind-down reply: the player's last turn answered (a challenge to someone in the room lands), then the close. */
function closingDirective(exit: Exit): string {
  return `The scene is ending: ${exit.outcome} ${LAST_WORD} Then bring the scene to a close in a few sentences, landing on a moment that belongs to the player. What this ending should feel like: ${exit.closing} ${ONCE} ${STORY_VOICE} Add nothing beyond what their turn brings on, don't narrate beyond the ending into what comes next, and don't contradict anything already narrated.`;
}

/**
 * No dice for the same push again: it gets the answer it got then (the route's authored failure, or
 * the ruling's), and being pushed again shows, but nothing more comes of it. (Told only "the same
 * answer", the GM had the King release Sallow outright on a press the author answers with "nothing is
 * settled yet, but the morning is going".)
 */
export function sameAgainDirective(t: Transition, answer?: string): string {
  const then = answer ? ` it got before: ${answer.trim().replace(/([^.!?'"’”])$/, "$1.")}` : "";
  return `No dice: the player is pushing for the same thing that already failed (${t.when.replace(/\.$/, "")}), with nothing new on the table, and it gets the same answer${then || "."} Play that answer again, in this moment's own words: whoever they're pushing reacts to being pushed again (patience wearing thin, a sharper no), but nothing more comes of it than that answer: nothing changes hands, nobody gives way or decides anything new, and nothing already said is taken back.`;
}

/** Say yes: no roll needed, so what the player is doing simply works. */
export function plainDirective(t: Transition): string {
  return `No dice needed: what the player is doing simply works (${t.when.replace(/\.$/, "")}). Let it land in this reply, in a way that fits the people involved.`;
}

/** The player has done the work: the payoff lands now, not after another round of asking. */
export const EARNED_DIRECTIVE = "The player has just done what it takes for what they've been working towards. Let it land in this reply: the person gives it, shows it or agrees, in their own way, and people react to it. Don't ask the player for it again or add a new condition. (Only what they've earned: anything else stays for later.)";

export const CONSEQUENCE_DIRECTIVE = "What the player just did is the kind of thing people in this world would really answer. Let it happen, and follow its logic through to a consequence in this reply, or one that is plainly on its way: whoever it touches reacts as they truly would (offence, alarm, opportunism, admiration), and it changes something, for better or worse. Not every consequence is bad, but this one isn't free.";

export const OOC_DIRECTIVE = "The player has stepped out of character to ask you something. Answer truthfully, out of character, in at most two sentences, using the table rules in your prep and only what their character could perceive or reasonably guess. If they're stuck or ask what they can do, name two or three concrete things in front of them (who is here and what they've shown they want or fear, where things and people are, something to look at or try), not the answers, and never tell them to drop what they're after: say what might get it. You don't decide the game's structure (scene order, when dice are rolled, the rules), so never agree to change it: if the game can't do something, say so plainly and offer the in-fiction way. Keep your prep behind the screen (the scene's aims, secrets and endings). Then hand the moment back to the scene; if their turn also had an in-character part, answer that in the fiction.";

/** "No, but": the world answers honestly and keeps the player's underlying idea alive. */
export function limitDirective(limit: string): string {
  return `The player is reaching for something this scene can't offer: ${limit} Respect exactly what that says: what it rules out doesn't happen (not even halfway), and anything it allows (setting off, trying later) can. Answer in the fiction with a reason that fits this world (a consequence, or a character who would know), not a flat refusal, and give the player's underlying intent somewhere real to go with what is here.`;
}

/** A risky attempt none of the scene's routes cover: rolled, narrated, but it moves no beat (director.ts:22). */
export interface FreeformCheck { skill: Skill; dc: number; roll: RollResult }

/** The roll a considered turn made without a ruling (the review failed, or ran past its deadline): narrated as the dice have it. */
export function freeformDirective(check: FreeformCheck): string {
  return `The player's attempt called for a ${titleCase(check.skill)} check. ${describeRoll(check.roll)}. Narrate the result: on a success they get what they were going for, within this scene; on a failure it costs them or complicates things, without taking back anything already offered or agreed, and the story keeps going. This roll doesn't end the scene by itself.`;
}

/**
 * A reply that closes the scene answers the player's turn first: what they ask someone here is
 * answered, and a challenge to someone in the room lands (Brother Ambrose's "Sallow." to the man in
 * the doorway got a polite nod and the procession).
 */
export const LAST_WORD = "Answer the player's turn first: if they ask someone here something, or challenge or call someone out, that person hears it and answers in their own way and character (a reaction, a retort, a slip), so it lands, though the ending stands.";

/** How the GM is told about a move. */
export function moveDirective(scene: Scene, state: Pick<TurnView, "beat">, move: Move): string[] {
  const lines: string[] = [];
  if (move.roll && move.transition.check) {
    const check = move.transition.check;
    lines.push(`The player's attempt called for a ${titleCase(move.roll.skill)} check${check.reason ? ` ${check.reason.replace(/\.$/, "")}` : ` (${move.transition.when.replace(/\.$/, "")})`}. ${describeRoll(move.roll)}. ${move.roll.success ? check.success : check.failure}${move.roll.skill !== check.skill ? ` The player went about it by ${move.roll.skill} rather than ${check.skill}: the outcome is the same, but it lands the way their method would (a threat that works frightens and leaves resentment; a lie that works is believed, for now).` : ""} Narrate this result so the player can see what was at stake and why it went the way it did.`);
  }
  if (move.exit && !move.chosen) {
    lines.push(`Things are escalating towards this: ${move.exit.outcome} Don't let it happen yet. In this reply, escalate (a warning, a last demand, a countdown, a weapon raised) and stop with the moment hanging: the next move is the player's.`);
  } else if (move.exit) {
    lines.push(`This reply closes the scene: ${move.exit.outcome} ${LAST_WORD} Land it on a moment that belongs to the player. What this ending should feel like: ${move.exit.closing} Don't narrate beyond the ending into what comes next.${move.exit.kind === "combat" ? " A fight starts here and is played out blow by blow on the map: end on the moment it breaks out, before any blow lands, any shot hits or any spell takes hold." : ""}`);
  } else if (move.to !== state.beat) {
    const beat = scene.beats.find(b => b.id === move.to)!;
    lines.push(`The scene has moved on to "${beat.title}": ${beat.direction} Play the start of this in your reply, growing out of what the player just did, and let the rest unfold over the next exchanges.`);
  }
  return lines;
}
