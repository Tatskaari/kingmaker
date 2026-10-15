import { deciderFor, type ChoiceQuestion, type Decider, type Decision } from "../../llm/decide.ts";
import { modelOffline } from "../../llm/openrouter.ts";
import { approachById } from "../../runtime/approaches.ts";
import type { SessionState } from "../../runtime/session.ts";
import { inFights } from "../../rules/spells.ts";
import type { Action } from "../play.ts";
import type { TacticalFight } from "./fights.ts";
import { clearShot, FEET, feetBetween, steps } from "./grid.ts";
import type { CheckSkill, InfluenceSkill, Mood, PlayerOptions, Prop, Unit, Urge } from "./model.ts";
import { health } from "./rules.ts";
import { SEARCH_SKILLS, type Skirmish } from "./skirmish.ts";

/**
 * A line typed in a fight, read onto the player's turn (src/app/README.md, "Typing in a fight").
 * Plain words are said aloud; *asterisks* or (brackets) are done, and so is a plain command
 * ("attack sallow", "cast fire bolt at the nearest crake", "move to the brazier", "end turn").
 *
 * - The plain commands are read here with no model, online and off: two or three of them joined
 *   by "and" or "then" too ("move to the brazier and kick it over").
 * - Anything else is the decider's, with this turn's own actions as its options (which act, at
 *   whom, which spell, which slot; a move first or after; a bonus action; a word to someone on the
 *   other side), so it chooses rather than invents.
 * - Either way it comes out as the fight's own action ids, checked against the action economy (an
 *   action, a bonus action, movement) before anything's done, and done by the fight as a click or a
 *   key does them, so the rules resolve it.
 * - What can't be done is refused with the reason, and nothing is spent: a spell they haven't got,
 *   nobody in reach, two things that each take the action.
 * - Offline, a line that isn't a plain command says the GM is offline.
 */

/** What a typed line comes to. */
export interface Reading {
  /** The fight's action ids to do, in order (a move, the act, a bonus action, a move after). */
  steps: string[];
  /** Words said aloud, and to whom: a unit's id, or "room" (everyone, or nobody in particular). */
  speech?: { words: string; to: string };
  /** Why nothing happens: said as it stands, and nothing is spent. */
  refusal?: string;
  /** A word from the rules alongside what's done (an urge that stays words: no action left for it). */
  note?: string;
  /** No model about: the plain commands only, and no voice. */
  offline?: boolean;
  /** Who read it: the plain commands, or the decider. */
  by: "parser" | "decider";
  /** The decider's answers, for the record (the tests and the tour read them). */
  decision?: Decision;
}

/** One of the fight's action ids, and what of the turn it uses. */
interface Step { id: string; uses: "action" | "attack" | "bonus" | "move" | "end" }

/**
 * What a reading of a command can come to. `unread`: its words didn't name anything the parser
 * knows (a name, a spell, a weapon), which the decider may yet make out ("the big lad").
 */
type Read = { steps: Step[]; target?: Target } | { refusal: string; unread?: boolean };

type Target = { kind: "unit"; u: Unit } | { kind: "prop"; p: Prop } | { kind: "self" } | { kind: "door" };

/** The player's turn as a reading needs it: the board as the rules see it, and what can be done now. */
interface Turn {
  s: Skirmish;
  me: Unit;
  o: PlayerOptions;
  actions: Action[];
  /** Everyone on the board but the player (the fallen too: they can be named, if not hit). */
  others: Unit[];
  props: Prop[];
}

/** Plain commands, for the offline word and a refusal's hint. */
export const EXAMPLES = "attack sallow, cast fire bolt at the nearest crake, move to the brazier, knock over the brazier, shove the crake over, end turn";

const OFFLINE = `The GM is offline, so a fight only takes plain commands just now: ${EXAMPLES}. Nothing's spent.`;

/** The decider for a session's fights: its approach's, or none when there's no model to be had. */
export function deciderOf(session: SessionState): Decider | null {
  if (modelOffline()) return null;
  return deciderFor(approachById(session.approach).decider);
}

/**
 * Read a typed line onto the player's turn: the plain commands first (no model), then the
 * decider, which chooses among the turn's own actions. `decider` null: offline.
 */
export async function readLine(line: string, fight: TacticalFight, decider: Decider | null): Promise<Reading> {
  const text = line.trim();
  if (!text) return { steps: [], refusal: "Say something, or do something: the box is empty.", by: "parser" };
  const turn = turnOf(fight);
  const plain = parseCommand(text, turn, !decider);
  if (plain) return plain;
  if (!decider) return { steps: [], refusal: OFFLINE, offline: true, by: "parser" };
  try {
    return await decided(text, turn, decider);
  } catch (error) {
    return { steps: [], refusal: `The GM couldn't make that out just now (${message(error).slice(0, 120)}). Try again, or a plain command: ${EXAMPLES}. Nothing's spent.`, by: "decider" };
  }
}

function turnOf(fight: TacticalFight): Turn {
  const c = fight.controller;
  const s = c.look();
  const me = s.pc();
  return {
    s, me, o: c.options(), actions: fight.actions(),
    others: s.units.filter(u => u.id !== me.id && u.state !== "fled"),
    props: Object.values(c.state().props).filter(p => !p.carriedBy),
  };
}

// ---------------------------------------------------------------------------------------------
// The plain commands.

const END = /^(?:end(?: (?:my|the))? turn|end it|done|pass|i'?m done|that'?s (?:it|all)|nothing|wait)$/;
const SIMPLE = /^(dash|dodge|disengage)$/;
const LEAVE = /^(?:leave|flee|escape|get out|run for it|leave the fight|go out(?: through)?(?: the (?:door|gate|way out))?)$/;
const BACK = /^(?:back off|back away|retreat|fall back|step back|get clear)$/;
const STEP = /^step (north|south|east|west|northeast|northwest|southeast|southwest)$/;
const MOVE = /^(?:move|go|walk|run|head|get|step|hurry|dash)(?: over)? (?:to|towards?|up to|next to|beside|by|over to|for)\s+(.+)$|^(?:close in on|close on|approach|charge(?: at)?|rush|make for)\s+(.+)$/;
const USE = /^(?:knock over|kick over|tip over|topple|bring down|knock down|pull down|upend|overturn)\s+(.+)$|^(?:knock|kick|tip|bring|pull)\s+(.+?)\s+(?:over|down)$/;
const SHOVE = /^(?:shove|push|trip|knock down)\s+(.+?)(?:\s+(over|down|back|away))?$|^(?:knock|shove|push)\s+(.+?)\s+(over|down|back|away)$/;
const GRAPPLE = /^(?:grapple|grab|seize|tackle|pin|grab hold of|get hold of|wrestle)\s+(.+)$/;
const ATTACK = /^(?:attack|hit|strike|stab|slash|swing at|shoot(?: at)?|fire at|punch|kick|smack|whack|thump|clobber|bash|cut|fight)\s+(.+?)(?:\s+with\s+(.+))?$/;
const CAST = /^cast\s+(.+)$/;
const URGE = /^(intimidate|threaten|scare|frighten|menace|persuade|convince|talk round|talk down|deceive|bluff|trick|fool|charm)\s+(.+?)(?:\s+(?:into|to)\s+(.+))?$/;
const URGE_SKILL: Record<string, InfluenceSkill> = { intimidate: "intimidation", threaten: "intimidation", scare: "intimidation", frighten: "intimidation", menace: "intimidation", persuade: "persuasion", convince: "persuasion", "talk round": "persuasion", "talk down": "persuasion", charm: "persuasion", deceive: "deception", bluff: "deception", trick: "deception", fool: "deception" };

/**
 * The plain commands, read with no model. Undefined when the line isn't one (or isn't one whole):
 * it's the decider's then, or offline the GM's absence. `strict` (offline): words that name nobody
 * it knows are refused here; otherwise they're the decider's to make out.
 */
export function parseCommand(text: string, turn: Turn, strict = true): Reading | undefined {
  const bare = commandText(text);
  if (bare === undefined) return undefined;
  const parts = bare.split(/\s*,?\s+(?:and then|and|then)\s+|\s*[,;]\s*/).filter(Boolean);
  if (!parts.length || parts.length > 3) return undefined;
  const plan: Step[] = [];
  let last: Target | undefined;
  for (const part of parts) {
    const read = command(part, turn, last);
    if (!read || ("refusal" in read && read.unread && !strict)) return undefined;
    if ("refusal" in read) return { steps: [], refusal: read.refusal, by: "parser" };
    plan.push(...read.steps);
    last = read.target ?? last;
  }
  return checked(plan, turn, { by: "parser" });
}

/** The line as a command: lowercase, a whole-line bracket or asterisks off, "I" and politeness off. Undefined if it's words with a deed in them. */
function commandText(text: string): string | undefined {
  let t = text.trim();
  const wrapped = /^\*([^*]+)\*$|^\(([^()]+)\)$/.exec(t);
  if (wrapped) t = (wrapped[1] ?? wrapped[2])!.trim();
  else if (/[*()"“”]/.test(t)) return undefined;
  t = t.toLowerCase().replace(/[.!]+$/, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:i'll |i will |i |let me |now i |then i |please )+/, "").replace(/ please$/, "");
  // "I attack" reads as "attack"; "attacks" (as written in asterisks) too.
  return t.replace(/^([a-z]+?)s\b(?=\s|$)/, (all, verb: string) => (KNOWN_VERBS.has(verb) ? verb : all));
}

const KNOWN_VERBS = new Set(["attack", "hit", "strike", "stab", "slash", "shoot", "punch", "kick", "cast", "move", "walk", "run", "head", "shove", "push", "grab", "grapple", "tackle", "dash", "dodge", "disengage", "intimidate", "threaten", "persuade", "deceive", "approach", "charge", "knock", "topple", "trip", "smack", "whack", "bash"]);

/** One command of a line: its steps (and what it was aimed at, for an "it" or a "him" after), a refusal, or undefined if it isn't one. */
function command(part: string, turn: Turn, last: Target | undefined): Read | undefined {
  if (END.test(part)) return { steps: [{ id: "end_turn", uses: "end" }] };
  let m = SIMPLE.exec(part);
  if (m) return simpleSteps(m[1] as "dash" | "dodge" | "disengage", turn);
  if (LEAVE.test(part)) return leaveSteps(turn);
  if (BACK.test(part)) return turn.actions.some(a => a.id === "back_off") ? { steps: [{ id: "back_off", uses: "move" }] } : { refusal: turn.o.movementLeft < FEET ? "You've no movement left this turn." : "There's nobody beside you to back away from." };
  m = STEP.exec(part);
  if (m) return turn.actions.some(a => a.id === `step_${m![1]}`) ? { steps: [{ id: `step_${m[1]}`, uses: "move" }] } : { refusal: `You can't step ${m[1]} from here this turn.` };
  m = MOVE.exec(part);
  if (m) return moveSteps(m[1] ?? m[2]!, turn, last);
  m = USE.exec(part);
  if (m) {
    const t = target(m[1] ?? m[2]!, turn, last, "prop");
    if (t?.kind === "unit") return wrestleSteps(t, "prone", turn);
    return useSteps(t, m[1] ?? m[2]!, turn);
  }
  m = SHOVE.exec(part);
  if (m) {
    const words = m[1] ?? m[3]!;
    const how = /back|away/.test(m[2] ?? m[4] ?? "") ? "push" : "prone";
    const t = target(words, turn, last, "unit");
    return t?.kind === "prop" ? useSteps(t, words, turn) : wrestleSteps(t, how, turn, words);
  }
  m = GRAPPLE.exec(part);
  if (m) return wrestleSteps(target(m[1]!, turn, last, "unit"), "grapple", turn, m[1]);
  m = URGE.exec(part);
  if (m) return urgeSteps(target(m[2]!, turn, last, "unit"), URGE_SKILL[m[1]!]!, urgeOf(m[3] ?? ""), turn, m[2]);
  m = CAST.exec(part);
  if (m) return castCommand(m[1]!, turn, last);
  m = ATTACK.exec(part);
  if (m) {
    const verb = part.split(" ")[0]!;
    const weapon = m[2] ?? (verb === "punch" || verb === "kick" ? "fists" : undefined);
    return attackSteps(target(m[1]!, turn, last, "unit"), weapon, turn, m[1]);
  }
  return undefined;
}

/** What an urge asks for, by its words: give up (the default), go, or hold back. */
function urgeOf(words: string): Urge {
  if (/\b(run|leave|go|flee|clear off|get out|scarper|bugger off|push off)\b/.test(words)) return "go";
  if (/\b(wait|hold|stop|stay|back off|stand still|think)\b/.test(words)) return "hold";
  return "yield";
}

// ---------------------------------------------------------------------------------------------
// Who and what the words mean.

const STOP = new Set(["the", "a", "an", "that", "this", "nearest", "closest", "near", "other", "one", "my", "your", "his", "her", "their", "of", "on", "in", "at", "over", "there", "here", "guy", "fellow", "chap", "bloke", "mister", "mr", "poor", "old", "dear"]);
const norm = (t: string) => t.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const wordsOf = (t: string) => norm(t).split(" ").filter(w => w && !STOP.has(w)).map(singular);
/** The word a name is about ("a porter with a sack-needle": porter; "the talking Crake": crake). */
const headOf = (name: string) => { const ws = norm(name.split(/\b(?:with|from|of|in|on|at|by|who|that|hung|hanging)\b/i)[0] ?? name).split(" ").filter(Boolean); return singular(ws.at(-1) ?? ""); };

function namesOfUnit(u: Unit): { words: string[]; heads: string[] } {
  return { words: [...wordsOf(u.name), ...wordsOf(u.called), ...wordsOf(u.id.replace(/-/g, " ")), ...(u.castId ? wordsOf(u.castId.replace(/-/g, " ")) : [])], heads: [headOf(u.name), headOf(u.called), ...wordsOf(u.id.replace(/-\d+$/, "").replace(/-/g, " ")).slice(-1)] };
}

function namesOfProp(p: Prop): { words: string[]; heads: string[] } {
  return { words: [...wordsOf(p.name), ...wordsOf(p.id.replace(/-/g, " ")), p.kind], heads: [p.kind, headOf(p.name)] };
}

/** How well the words name it: 0 not at all; more for the word it's about, and for each word. */
function score(query: string[], names: { words: string[]; heads: string[] }): number {
  if (!query.length) return 0;
  const hit = (q: string) => names.words.some(n => n === q || (q.length >= 3 && n.startsWith(q)));
  if (!query.every(hit)) return 0;
  return query.length + (query.some(q => names.heads.some(h => h === q || (q.length >= 3 && h.startsWith(q)))) ? 2 : 0);
}

/**
 * Who or what the words name: yourself, the way out, someone on the board, or a thing (a lantern,
 * the brazier), the best named first and then the nearest ("the nearest crake": the nearest of the
 * Crakes). `prefer` breaks a tie between someone and something. An "it" or a "him" is the last one named.
 */
function target(words: string, turn: Turn, last: Target | undefined, prefer: "unit" | "prop"): Target | undefined {
  const w = norm(words);
  if (/^(?:it|him|her|them|that|this one|that one)$/.test(w)) return last;
  if (/^(?:me|myself|self|yourself)$/.test(w)) return { kind: "self" };
  if (/\b(?:door|gate|exit|way out)\b/.test(w)) return { kind: "door" };
  const query = wordsOf(words);
  const nearest = /\b(?:nearest|closest)\b/.test(w);
  const me = turn.me.at;
  const units = turn.others.map(u => ({ t: { kind: "unit" as const, u }, at: u.at, s: score(query, namesOfUnit(u)) }));
  const props = turn.props.map(p => ({ t: { kind: "prop" as const, p }, at: p.at, s: score(query, namesOfProp(p)) }));
  const found = [...units, ...props].filter(c => c.s > 0);
  if (!found.length) return query.length && wordsOf(turn.me.name).some(n => query.includes(n)) ? { kind: "self" } : undefined;
  const best = Math.max(...found.map(c => c.s));
  return found.filter(c => nearest || c.s === best)
    .sort((a, b) => steps(me, a.at) - steps(me, b.at) || Number(b.t.kind === prefer) - Number(a.t.kind === prefer))[0]!.t;
}

const nameOf = (t: Target): string => (t.kind === "unit" ? t.u.called : t.kind === "prop" ? `the ${t.p.name}` : t.kind === "self" ? "yourself" : "the way out");
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const unknown = (words: string | undefined): { refusal: string; unread: true } => ({ refusal: `There's nobody and nothing here called "${(words ?? "that").trim()}".`, unread: true });

/** A tile beside them the player can still get to this turn (or none). */
function besideThem(at: { x: number; y: number }, turn: Turn): boolean {
  return turn.o.movementLeft >= FEET && turn.o.moves.some(t => steps(t, at) === 1);
}

/** Can the player make an attack now: their action free, or attacks left in the one they've begun. */
function attacksLeft(turn: Turn): number {
  const use = turn.s.usage(turn.me);
  if (!use || !turn.o.ready) return 0;
  const per = turn.s.attacksPerAction(turn.me);
  if (!use.actionUsed) return per;
  return use.attacksMadeThisTurn > 0 ? Math.max(0, per - use.attacksMadeThisTurn) : 0;
}

/** Someone the player could hit at all this turn: standing, on the other side, and in the fight (not a child running for the door). */
function foeOrWhyNot(t: Target | undefined, turn: Turn, words?: string): { u: Unit } | { refusal: string; unread?: boolean } {
  if (!t) return unknown(words);
  if (t.kind === "self") return { refusal: "Attacking yourself is a matter for the Assizes." };
  if (t.kind === "door") return { refusal: "The way out hasn't done anything to you." };
  if (t.kind === "prop") return { refusal: `The ${t.p.name} isn't someone to lay hands on.` };
  const u = t.u;
  if (u.side === "ally" || u.side === "player") return { refusal: `${cap(u.called)} is on your side.` };
  if (u.side === "neutral") return { refusal: `${cap(u.called)} isn't in this fight.` };
  if (u.state !== "fighting") return { refusal: `${cap(u.called)} ${u.state === "surrendered" ? "has given up" : u.state === "down" ? "is down already" : "is out of it"}: there's no need.` };
  if (u.role === "coward") return { refusal: `${cap(u.called)} isn't fighting anyone: there's nothing to hit them for.` };
  return { u };
}

// ---------------------------------------------------------------------------------------------
// What each command comes to, by the fight's own options.

function simpleSteps(kind: "dash" | "dodge" | "disengage", turn: Turn): Read {
  return turn.o[kind] ? { steps: [{ id: kind, uses: "action" }] } : { refusal: turn.o.actionUsed ? `You've already used your action this turn: no ${kind === "dodge" ? "dodging" : kind === "dash" ? "dashing" : "disengaging"}.` : `You can't ${kind} again this turn.` };
}

function leaveSteps(turn: Turn): Read {
  if (turn.o.leave) return { steps: [{ id: "leave", uses: "move" }] };
  if (turn.actions.some(a => a.id === "make_for_the_door")) return { steps: [{ id: "make_for_the_door", uses: "move" }, { id: "leave", uses: "move" }] };
  return { refusal: turn.o.movementLeft < FEET ? "You've no movement left to get out with this turn." : "There's no way out from here." };
}

function moveSteps(words: string, turn: Turn, last: Target | undefined): Read {
  const t = target(words, turn, last, "prop");
  if (!t) return unknown(words);
  if (turn.o.movementLeft < FEET) return { refusal: "You've no movement left this turn." };
  if (t.kind === "self") return { refusal: "You're already where you are." };
  if (t.kind === "door") return turn.actions.some(a => a.id === "make_for_the_door") ? { steps: [{ id: "make_for_the_door", uses: "move" }], target: t } : turn.o.leave ? { refusal: "You're standing in the way out already: leave, if you're going." } : { refusal: "There's no way out to make for." };
  const at = t.kind === "unit" ? t.u.at : t.p.at;
  if (steps(turn.me.at, at) <= 1) return { refusal: `You're right beside ${nameOf(t)} already.` };
  if (!besideThem(at, turn)) return { refusal: `You can't get next to ${nameOf(t)} this turn (${feetBetween(turn.me.at, at)} ft off, ${turn.o.movementLeft} ft of movement left): try the blue tiles nearer it.` };
  return { steps: [{ id: `close_${t.kind === "unit" ? t.u.id : t.p.id}`, uses: "move" }], target: t };
}

function useSteps(t: Target | undefined, words: string, turn: Turn): Read {
  if (!t) return unknown(words);
  if (t.kind !== "prop") return { refusal: `${cap(nameOf(t))} isn't something to knock over.` };
  const p = t.p;
  if (p.state !== "standing") return { refusal: `The ${p.name} is down already.` };
  if (turn.o.props.some(x => x.id === p.id)) return { steps: [{ id: `use_${p.id}`, uses: "action" }], target: t };
  if (turn.o.actionUsed) return { refusal: "You've already used your action this turn." };
  if (besideThem(p.at, turn)) return { steps: [{ id: `close_${p.id}`, uses: "move" }, { id: `use_${p.id}`, uses: "action" }], target: t };
  return { refusal: `The ${p.name} is out of reach (${feetBetween(turn.me.at, p.at)} ft), and you can't get to it this turn.` };
}

function wrestleSteps(t: Target | undefined, how: "grapple" | "prone" | "push", turn: Turn, words?: string): Read {
  const foe = foeOrWhyNot(t, turn, words);
  if ("refusal" in foe) return foe;
  const id = `${how === "grapple" ? "grapple" : how === "prone" ? "shove" : "push"}_${foe.u.id}`;
  if (turn.o.wrestle.some(w => w.id === foe.u.id)) return { steps: [{ id, uses: "action" }], target: t };
  if (turn.o.actionUsed) return { refusal: "You've already used your action this turn." };
  if (besideThem(foe.u.at, turn)) return { steps: [{ id: `close_${foe.u.id}`, uses: "move" }, { id, uses: "action" }], target: t };
  return { refusal: `${cap(foe.u.called)} is out of reach (${feetBetween(turn.me.at, foe.u.at)} ft), and you can't get beside them this turn.` };
}

function urgeSteps(t: Target | undefined, skill: InfluenceSkill, urge: Urge, turn: Turn, words?: string, mood: Mood = "hostile"): Read {
  const foe = foeOrWhyNot(t, turn, words);
  if ("refusal" in foe) return foe;
  const heard = turn.o.hear.find(h => h.id === foe.u.id);
  if (turn.o.actionUsed) return { refusal: "Urging them takes your action, and you've used it this turn." };
  if (!heard) return { refusal: `${cap(foe.u.called)} is too far off to hear it (${feetBetween(turn.me.at, foe.u.at)} ft).` };
  if (skill !== "intimidation" && !heard.understands) return { refusal: `${cap(foe.u.called)} doesn't understand a word of it: only a threat gets through.` };
  return { steps: [{ id: `urge_${skill}_${urge}_${mood}_${foe.u.id}`, uses: "action" }], target: t };
}

const IMPROVISED = /\b(?:improvis\w*|bottle|stool|chair|bench|plank|stick|fists?|hands?|bare|tankard|mug|jug|anything|elbow|head|knee|boot|foot|feet|chain|pole|brick|stone|rock|candlestick|pan|poker)\b/;

function attackSteps(t: Target | undefined, weaponWords: string | undefined, turn: Turn, words?: string): Read {
  // A thing to hit (a lantern in the beams): as the fight offers it.
  if (t?.kind === "prop") {
    const offered = turn.o.attacks.find(a => a.target === t.p.id);
    return offered ? { steps: [{ id: `attack_${t.p.id}`, uses: "attack" }], target: t } : { refusal: t.p.state !== "standing" ? `The ${t.p.name} is down already.` : `You can't hit the ${t.p.name} from here (knock it over from beside it, or try something with range).` };
  }
  const foe = foeOrWhyNot(t, turn, words);
  if ("refusal" in foe) return foe;
  const u = foe.u;
  if (!attacksLeft(turn)) return { refusal: "Your attack's spent this turn: your action's gone." };
  const improvised = !!weaponWords && IMPROVISED.test(norm(weaponWords));
  const weapon = weaponWords && !improvised ? weaponNamed(weaponWords, turn) : undefined;
  if (weaponWords && !improvised && !weapon) return { refusal: `You haven't got "${weaponWords.trim()}" to hand: ${turn.me.weapons.map(w => turn.s.namer().weapon(w)).join(" or ") || "only your fists"}.`, unread: true };
  const slug = weapon ? slugOf(turn.s.namer().weapon(weapon)) : undefined;
  const id = improvised ? `attack_${u.id}_with_improvised` : slug ? `attack_${u.id}_with_${slug}` : `attack_${u.id}`;
  const now = improvised ? steps(turn.me.at, u.at) <= 1 : turn.o.attacks.some(a => a.target === u.id && (!weapon || a.weapon === weapon));
  if (now) return { steps: [{ id, uses: "attack" }], target: t };
  // Not from here: in close first, with a blade or a fist, if there's a way to get beside them.
  const blade = improvised ? undefined : weapon ? (turn.s.t.item(weapon)?.attackKind !== "ranged" ? weapon : undefined) : turn.me.weapons.find(w => turn.s.t.item(w)?.attackKind !== "ranged");
  const melee = improvised || !!blade;
  const closing = improvised ? id : `attack_${u.id}_with_${slugOf(turn.s.namer().weapon(blade ?? ""))}`;
  if (melee && !turn.o.actionUsed && besideThem(u.at, turn)) return { steps: [{ id: `close_${u.id}`, uses: "move" }, { id: closing, uses: "attack" }], target: t };
  const why = turn.s.attackCheck(turn.me, u, weapon ?? turn.me.weapons[0] ?? "").error ?? `${cap(u.called)} is out of reach`;
  return { refusal: `${why.replace(/\.$/, "")}${melee && turn.o.movementLeft >= FEET ? ", and you can't get beside them this turn" : ""}.` };
}

const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** One of the player's weapons by its name ("sword", "the longbow", "bow"). */
function weaponNamed(words: string, turn: Turn): string | undefined {
  const q = wordsOf(words).filter(w => !["weapon", "trusty", "good", "own"].includes(w));
  if (!q.length) return undefined;
  return turn.me.weapons.find(w => { const name = norm(turn.s.namer().weapon(w)).replace(/ /g, ""); return q.every(x => name.includes(x)); });
}

/** "fire bolt at the nearest crake with a 2nd-level slot": the spell, at whom, and from which slot. */
function castCommand(rest: string, turn: Turn, last: Target | undefined): Read {
  let words = rest;
  let slot: number | undefined;
  const upcast = /\s+(?:with|using|from|in|at)\s+(?:a |an |my )?(\d)(?:st|nd|rd|th)?(?:[- ]level)?(?:\s+slot)?$|\s+(?:upcast(?:\s+to)?|at level)\s+(\d)$/.exec(words);
  if (upcast) { slot = Number(upcast[1] ?? upcast[2]); words = words.slice(0, upcast.index); }
  const aimed = /^(.+?)\s+(?:at|on|into|towards?|against|upon)\s+(.+)$/.exec(words);
  const spellWords = aimed ? aimed[1]! : words;
  const t = aimed ? target(aimed[2]!, turn, last, "unit") : undefined;
  if (aimed && !t) return unknown(aimed[2]);
  return castSteps(spellWords, t, slot, turn);
}

/** A spell by its name, whoever's it is: the engine's own list. */
function spellNamed(words: string, turn: Turn): { id: string; name: string; level: number } | undefined {
  const key = (t: string) => norm(t).replace(/^(?:a|an|the|my|some|another) /, "").replace(/ /g, "");
  const q = key(words);
  if (q.length < 3) return undefined;
  const all = [...turn.s.t.kit.engine.content.spells.values()];
  return all.find(sp => key(sp.name) === q) ?? all.find(sp => key(sp.name).startsWith(q) && q.length >= 5);
}

/** Why a spell of the player's can't be cast now (it isn't ready, the fight doesn't play it, no slot, no action). */
function whyNotCast(id: string, turn: Turn): string {
  const sheet = turn.s.t.sheet(turn.me.engineId);
  const def = turn.s.t.kit.engine.content.spells.get(id)!;
  const theirs = (sheet.spellcasting?.spellsByLevel ?? []).flatMap(g => g.spells).find(sp => sp.spellId === id);
  if (!theirs) return `${def.name} isn't one of your spells: the sheet (s) shows what you have.`;
  if (def.level > 0 && !theirs.prepared && !theirs.alwaysPrepared) return `${def.name} isn't one of the spells you have prepared today.`;
  if (!inFights(def)) return `${def.name} isn't a spell a fight on the map can play out (its page on the sheet says so).`;
  if (def.level > 0 && ![1, 2, 3, 4, 5, 6, 7, 8, 9].some(l => l >= def.level && turn.s.freeSlots(turn.me, l) > 0)) return `You've no slot left for ${def.name}: a long rest brings them back.`;
  const bonus = /bonus/i.test(def.castingTime);
  if (bonus ? turn.o.bonusActionUsed : turn.o.actionUsed) return `You've already used your ${bonus ? "bonus action" : "action"} this turn.`;
  return `${def.name} can't be cast just now.`;
}

function castSteps(spellWords: string, t: Target | undefined, slot: number | undefined, turn: Turn): Read {
  const spell = spellNamed(spellWords, turn);
  if (!spell) return { refusal: `There's no spell called "${spellWords.trim()}".`, unread: true };
  const choice = turn.o.spells.find(s => s.id === spell.id);
  if (!choice) return { refusal: whyNotCast(spell.id, turn) };
  const uses: Step["uses"] = /bonus/i.test(turn.s.t.kit.engine.content.spells.get(spell.id)!.castingTime) ? "bonus" : "action";
  const suffix = slotSuffix(choice, slot, turn);
  if (typeof suffix === "object") return suffix;
  const step = (id: string): Step => ({ id: `${id}${suffix}`, uses });
  if (choice.targeting === "self") {
    if (t && t.kind !== "self") return { refusal: `${choice.name} is only for yourself.` };
    return { steps: [step(`cast_${choice.id}`)], target: { kind: "self" } };
  }
  if (t?.kind === "door") return { refusal: `${choice.name} at the way out would only frighten the hinges.` };
  if (choice.targeting === "area") return areaSteps(choice, t, step, turn);
  // At someone: one of the spell's targets this turn (the nearest, unsaid: yourself, for a heal); in close first for a touch.
  const nearest = nearestOf(choice.targets, turn);
  const aim = t ?? (nearest ? (nearest.id === turn.me.id ? { kind: "self" as const } : { kind: "unit" as const, u: nearest }) : undefined);
  if (!aim) return { refusal: `There's nobody ${choice.name} can reach from here.` };
  const who = aim.kind === "self" ? turn.me : aim.kind === "unit" ? aim.u : undefined;
  if (!who) return { refusal: `${choice.name} is cast at someone, not at the ${aim.kind === "prop" ? aim.p.name : "floor"}.` };
  if (choice.targets.some(x => x.id === who.id)) return { steps: [step(`cast_${choice.id}_${who.id}`)], target: aim };
  if (choice.range <= FEET && who.id !== turn.me.id && besideThem(who.at, turn) && who.state === "fighting") return { steps: [{ id: `close_${who.id}`, uses: "move" }, step(`cast_${choice.id}_${who.id}`)], target: aim };
  return { refusal: spellReachWhy(choice, who, turn) };
}

/** The nearest of a spell's targets this turn. */
function nearestOf(targets: Array<{ id: string }>, turn: Turn): Unit | undefined {
  return targets.map(x => turn.s.unit(x.id)).filter((u): u is Unit => !!u).sort((a, b) => steps(turn.me.at, a.at) - steps(turn.me.at, b.at))[0];
}

/** An area: at whoever or whatever it's aimed at (the nearest it can reach, when unsaid), as the fight lays it on the tiles. */
function areaSteps(choice: PlayerOptions["spells"][number], t: Target | undefined, step: (id: string) => Step, turn: Turn): Read {
  if (t?.kind === "self") return { refusal: `${choice.name} is aimed somewhere: at whom?` };
  if (!t || (t.kind !== "unit" && t.kind !== "prop")) {
    const first = nearestOf(choice.targets, turn);
    return first ? { steps: [step(`cast_${choice.id}_at_${first.id}`)], target: { kind: "unit", u: first } } : { refusal: `There's nobody ${choice.name} can reach from here.` };
  }
  const at = t.kind === "unit" ? t.u : t.p;
  const fromSelf = !!choice.area && choice.range === 0;
  const far = feetBetween(turn.me.at, at.at);
  if (!fromSelf && far > choice.range) return { refusal: `That's ${far} ft away; ${choice.name} reaches ${choice.range} ft.` };
  if (!fromSelf && !clearShot(turn.s.G.map, turn.me.at, at.at)) return { refusal: `There's no clear line to ${nameOf(t)} from here.` };
  if (fromSelf && far > (choice.area?.size ?? FEET)) return { refusal: `${choice.name} goes out ${choice.area?.size ?? FEET} ft from you; ${nameOf(t)} is ${far} ft off.` };
  return { steps: [step(`cast_${choice.id}_at_${at.id}`)], target: t };
}

function spellReachWhy(choice: PlayerOptions["spells"][number], who: Unit, turn: Turn): string {
  if (who.side === "ally" && !choice.targets.some(x => x.id === who.id)) return `${choice.name} isn't for ${who.called}: ${cap(who.called)}'s on your side.`;
  if (who.state !== "fighting") return `${cap(who.called)} ${who.state === "surrendered" ? "has given up" : "is down"}: ${choice.name} can wait.`;
  if (who.role === "coward") return `${cap(who.called)} isn't fighting anyone: there's no call for ${choice.name}.`;
  const far = feetBetween(turn.me.at, who.at);
  if (far > Math.max(choice.range, FEET)) return `${cap(who.called)} is ${far} ft away; ${choice.name} reaches ${Math.max(choice.range, FEET)} ft.`;
  if (!clearShot(turn.s.G.map, turn.me.at, who.at)) return `There's no clear line to ${who.called} from here.`;
  return `${choice.name} can't be aimed at ${who.called} this turn.`;
}

/** "_slot3" for a slot above the lowest, "" for the lowest, or why not (a slot it can't take, or one that's gone). */
function slotSuffix(choice: PlayerOptions["spells"][number], slot: number | undefined, turn: Turn): string | { refusal: string } {
  if (slot === undefined || choice.level === 0 || slot === choice.slot) return "";
  if (slot < choice.level) return { refusal: `${choice.name} takes a ${ORDINAL[choice.level]}-level slot at the least.` };
  if (slot > 9 || turn.s.freeSlots(turn.me, slot) <= 0) return { refusal: `You've no ${ORDINAL[slot] ?? `${slot}th`}-level slot left.` };
  return `_slot${slot}`;
}

const ORDINAL = ["cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

// ---------------------------------------------------------------------------------------------
// The action economy: an action (its attacks), a bonus action, and moving, in order.

/**
 * The steps as one turn: nothing after the end of it, the same move twice running once, and no
 * more than the turn has (one action, however many attacks it gives; one bonus action). More than
 * that is refused before anything's done.
 */
function checked(plan: Step[], turn: Turn, extra: Omit<Reading, "steps">): Reading {
  const end = plan.findIndex(s => s.uses === "end");
  const kept = (end >= 0 ? plan.slice(0, end + 1) : plan).filter((s, i, all) => i === 0 || s.uses !== "move" || s.id !== all[i - 1]!.id);
  const actions = kept.filter(s => s.uses === "action").length;
  const attacks = kept.filter(s => s.uses === "attack").length;
  const bonus = kept.filter(s => s.uses === "bonus").length;
  const refuse = (why: string): Reading => ({ ...extra, steps: [], refusal: `${why} Nothing's spent.` });
  if (actions + (attacks ? 1 : 0) > 1) return refuse("That's more than one thing that takes your action: you've one action a turn.");
  if (actions && turn.o.actionUsed) return refuse("You've already used your action this turn.");
  if (attacks > attacksLeft(turn)) return refuse(attacksLeft(turn) ? `You've ${attacksLeft(turn)} attack${attacksLeft(turn) === 1 ? "" : "s"} left this turn.` : "Your attack's spent this turn.");
  if (bonus > 1 || (bonus && turn.o.bonusActionUsed)) return refuse(bonus > 1 ? "That's two bonus actions: you've one." : "You've already used your bonus action this turn.");
  return { ...extra, steps: kept.map(s => s.id) };
}

// ---------------------------------------------------------------------------------------------
// The decider: this turn's own actions as its options.

/** One thing the player could do this turn, as the decider is offered it. */
interface Deed { key: string; label: string; steps?: Step[]; refusal?: string }

const READ = "plain words are what their character says out loud; what they do is in *asterisks* or (parentheses), or plainly narrated (\"I swing at him\"), or a bare command (\"attack the crake\")";

async function decided(text: string, turn: Turn, decider: Decider): Promise<Reading> {
  const deeds = deedsOf(turn);
  const decision = await decider.decide(stateOf(text, turn), questionsFor(turn, deeds), "fight.typed");
  const reading = await readingOf(decision, text, turn, deeds, decider);
  return { ...reading, decision: reading.decision ?? decision };
}

/** Everything the player could do this turn (and, for a spell or someone out of reach, why not), as the decider's options. */
function deedsOf(turn: Turn): Deed[] {
  const out: Deed[] = [];
  const { o, me, s } = turn;
  const canAttack = attacksLeft(turn) > 0;
  for (const u of turn.others.filter(v => v.side === "enemy" && v.state === "fighting" && v.role !== "coward")) {
    const offered = o.attacks.filter(a => a.target === u.id);
    for (const a of offered) out.push({ key: `attack:${u.id}:${slugOf(a.weaponName)}`, label: `Attack ${u.name} with your ${a.weaponName} (${a.bonus >= 0 ? "+" : ""}${a.bonus}${a.advantage ? `, ${a.advantage}` : ""}${a.note ? `, ${a.note}` : ""})`, steps: [{ id: `attack_${u.id}_with_${slugOf(a.weaponName)}`, uses: "attack" }] });
    const beside = steps(me.at, u.at) <= 1;
    const reach = beside || besideThem(u.at, turn);
    const close: Step[] = beside ? [] : [{ id: `close_${u.id}`, uses: "move" }];
    const melee = me.weapons.find(w => s.t.item(w)?.attackKind !== "ranged");
    if (canAttack && reach && melee && !offered.some(a => a.weapon === melee)) out.push({ key: `attack:${u.id}:close`, label: `Close in on ${u.name} and attack with your ${s.namer().weapon(melee)}`, steps: [...close, { id: `attack_${u.id}_with_${slugOf(s.namer().weapon(melee))}`, uses: "attack" }] });
    if (canAttack && reach) out.push({ key: `improvised:${u.id}`, label: `Hit ${u.name} with something to hand, not a weapon (a stool, a bottle, a fist, a kick)${beside ? "" : ", closing in first"}`, steps: [...close, { id: `attack_${u.id}_with_improvised`, uses: "attack" }] });
    if (!offered.length && !reach) out.push({ key: `cannot:attack:${u.id}`, label: `Attack ${u.name} (not this turn: out of reach)`, refusal: `${cap(u.called)} is out of reach (${feetBetween(me.at, u.at)} ft), and you can't get beside them this turn.` });
    if (!o.actionUsed && reach) {
      out.push({ key: `shove:${u.id}`, label: `Shove ${u.name} over, to the floor (they save or go down)${beside ? "" : ", closing in first"}`, steps: [...close, { id: `shove_${u.id}`, uses: "action" }] });
      out.push({ key: `push:${u.id}`, label: `Shove ${u.name} away, back 5 ft (they save or go)${beside ? "" : ", closing in first"}`, steps: [...close, { id: `push_${u.id}`, uses: "action" }] });
      out.push({ key: `grapple:${u.id}`, label: `Grab hold of ${u.name}, to stop them going anywhere (they save or they're held)${beside ? "" : ", closing in first"}`, steps: [...close, { id: `grapple_${u.id}`, uses: "action" }] });
    }
  }
  for (const a of o.attacks.filter(a => turn.props.some(p => p.id === a.target))) out.push({ key: `attack:${a.target}`, label: `Hit the ${turn.props.find(p => p.id === a.target)!.name} with your ${a.weaponName}${a.note ? ` (${a.note})` : ""}`, steps: [{ id: `attack_${a.target}`, uses: "attack" }] });
  for (const p of turn.props.filter(p => p.state === "standing" && p.lit)) {
    const beside = o.props.some(x => x.id === p.id);
    if (beside) out.push({ key: `use:${p.id}`, label: `${p.kind === "brazier" ? "Kick over" : "Bring down"} the ${p.name}${turn.s.G.dust.length ? " (fire, near the dust)" : ""}`, steps: [{ id: `use_${p.id}`, uses: "action" }] });
    else if (!o.actionUsed && besideThem(p.at, turn)) out.push({ key: `use:${p.id}`, label: `Get to the ${p.name} and ${p.kind === "brazier" ? "kick it over" : "bring it down"}`, steps: [{ id: `close_${p.id}`, uses: "move" }, { id: `use_${p.id}`, uses: "action" }] });
  }
  for (const sp of o.spells) {
    const uses: Step["uses"] = /bonus/i.test(s.t.kit.engine.content.spells.get(sp.id)?.castingTime ?? "") ? "bonus" : "action";
    const slot = sp.slot ? ` (${ORDINAL[sp.slot]}-level slot${uses === "bonus" ? ", a bonus action" : ""})` : ` (cantrip${uses === "bonus" ? ", a bonus action" : ""})`;
    if (sp.targeting === "self") out.push({ key: `cast:${sp.id}`, label: `Cast ${sp.name} on yourself${slot}`, steps: [{ id: `cast_${sp.id}`, uses }] });
    else for (const t of sp.targets) out.push({ key: `cast:${sp.id}:${t.id}`, label: `Cast ${sp.name}${sp.area ? ` (a ${sp.area.size}-foot ${sp.area.shape})` : ""} ${sp.area ? "centred on" : t.id === me.id ? "on" : "at"} ${t.id === me.id ? "yourself" : t.name}${slot}`, steps: [{ id: sp.targeting === "area" ? `cast_${sp.id}_at_${t.id}` : `cast_${sp.id}_${t.id}`, uses }] });
  }
  // Their own spells that can't be cast now, and why: a refusal in its own words, not a fizzle.
  const sheet = s.t.sheet(me.engineId);
  for (const sp of (sheet.spellcasting?.spellsByLevel ?? []).flatMap(g => g.spells)) if (!o.spells.some(x => x.id === sp.spellId) && !out.some(d => d.key === `cannot:cast:${sp.spellId}`)) out.push({ key: `cannot:cast:${sp.spellId}`, label: `Cast ${sp.name} (not now)`, refusal: whyNotCast(sp.spellId, turn) });
  // With the action gone, whatever would take it says so.
  if (o.actionUsed && !canAttack) out.push({ key: "spent", label: "Anything that takes their action: an attack, a spell, a shove or a grab, knocking something over, dodging, dashing (not now: their action's spent this turn)", refusal: `Your action's spent this turn: you can still move${o.bonusActionUsed ? "" : ", use a bonus action"}, or end your turn.` });
  if (o.dash) out.push({ key: "dash", label: "Dash: double movement this turn (the action)", steps: [{ id: "dash", uses: "action" }] });
  if (o.dodge) out.push({ key: "dodge", label: "Dodge: attacks on them have disadvantage until their next turn (the action)", steps: [{ id: "dodge", uses: "action" }] });
  if (o.disengage) out.push({ key: "disengage", label: "Disengage: move away this turn without being swung at (the action)", steps: [{ id: "disengage", uses: "action" }] });
  if (o.leave) out.push({ key: "leave", label: `Leave the fight, out through ${o.leave}`, steps: [{ id: "leave", uses: "move" }] });
  else if (turn.actions.some(a => a.id === "make_for_the_door")) out.push({ key: "leave", label: "Run for the way out and leave the fight", steps: [{ id: "make_for_the_door", uses: "move" }, { id: "leave", uses: "move" }] });
  if (o.movementLeft >= FEET) out.push({ key: "move_only", label: "Only move: go somewhere on the floor (the move_first answer says where), and nothing else", steps: [] });
  out.push({ key: "end", label: "End their turn, or wait and do nothing", steps: [{ id: "end_turn", uses: "end" }] });
  out.push({ key: "check:search", label: "Look for something, or read someone: Perception, Insight, Medicine or Survival (the Search action)" });
  out.push({ key: "check:study", label: "Work something out, or recall what they know: Arcana, History, Investigation, Nature or Religion (the Study action)" });
  out.push({ key: "speak_only", label: "Nothing done: only words said aloud (a taunt, a question, an order, a threat, a plea)" });
  out.push({ key: "ooc", label: "A question to the GM about the game, out of character (what can I do, how far can I move)" });
  out.push({ key: "not_theirs", label: "Casting a spell, or working magic, that isn't any of the spells listed here" });
  out.push({ key: "not_possible", label: "Something none of these is: an act the fight can't play, or aimed at someone or something that isn't here" });
  return out;
}

/** Where they could move to this turn, by what's on the floor (for a move before or after the deed). */
function movesOf(turn: Turn): Record<string, string> {
  if (turn.o.movementLeft < FEET) return {};
  const out: Record<string, string> = {};
  for (const u of turn.others.filter(v => v.state !== "dead" && steps(turn.me.at, v.at) > 1 && besideThem(v.at, turn))) out[`close:${u.id}`] = `Next to ${u.name}`;
  for (const p of turn.props.filter(p => steps(turn.me.at, p.at) > 1 && besideThem(p.at, turn))) out[`close:${p.id}`] = `To the ${p.name}`;
  if (turn.actions.some(a => a.id === "make_for_the_door")) out["door"] = "To the way out";
  if (turn.actions.some(a => a.id === "back_off")) out["away"] = "Away from them: back off, as far as this turn takes them";
  return out;
}

function questionsFor(turn: Turn, deeds: Deed[]): Record<string, ChoiceQuestion> {
  const moves = movesOf(turn);
  const foes = turn.o.hear;
  const earshot = turn.others.filter(u => u.state === "fighting" && feetBetween(turn.me.at, u.at) <= 60);
  const bonus = deeds.filter(d => d.steps?.some(s => s.uses === "bonus"));
  // The slots above a castable spell's lowest that are left: an upcast to ask about.
  const higher = [2, 3, 4, 5, 6, 7, 8, 9].filter(l => turn.s.freeSlots(turn.me, l) > 0 && turn.o.spells.some(sp => sp.level > 0 && sp.slot < l));
  const q: Record<string, ChoiceQuestion> = {
    deed: {
      instructions: `A player in a tactical tabletop fight has typed their turn (latest_line): ${READ}. Which of these is what their character does with this turn? Choose by what they mean, not the exact words: a spell by its name, a weapon by what it is, a person by what they're called or where they stand. If they only talk, choose speak_only. If it's none of these, choose not_possible (or not_theirs for magic they haven't got).`,
      criteria: Object.fromEntries(deeds.map(d => [d.key, d.label])),
    },
    move_first: {
      instructions: "Before the deed, does the line have them move somewhere: stepping back or away, closing in on someone, going over to something? Choose where. (A deed that says it closes in first has that already.)",
      criteria: { no: "No: they don't move before it.", ...moves },
    },
    move_after: {
      instructions: "After the deed, does the line have them move: backing off, running for it, going on somewhere? Choose where.",
      criteria: { no: "No: they don't move after it.", ...moves },
    },
    said_to: {
      instructions: "Whom are the words they say out loud addressed to (what's outside any *asterisks* or (brackets), or what's in quotes)?",
      criteria: { nobody: "They say nothing aloud: it's all deeds.", room: "Everyone, or nobody in particular.", ...Object.fromEntries(earshot.map(u => [u.id, `${u.name} (${u.side === "enemy" ? "on the other side" : "on their side"})`])) },
    },
    urge: {
      instructions: "Do their words (or what they do) urge someone on the other side to stop fighting? It counts whether or not it would work: a demand to surrender (\"Give it up!\", \"Drop it!\"), a threat, an offer, an argument or a lie meant to make them stop, run or hold off. Only a taunt or a battle cry with no such demand in it doesn't.",
      criteria: { no: "No: nobody is being urged to stop.", yield: "To give up: surrender, drop their weapon, put their hands up, give it up.", go: "To leave the fight: run, clear off, get out, walk away.", hold: "To hold back: stop, wait, stay where they are, think again for a moment." },
    },
  };
  if (foes.length) {
    q.urged = { instructions: "If so, whom?", criteria: { none: "Nobody, or nobody in earshot.", ...Object.fromEntries(foes.map(f => [f.id, `${turn.s.unit(f.id)?.name ?? f.name}${f.understands ? "" : " (an animal: only a threat gets through)"}`])) } };
    q.urge_how = { instructions: "If so, by what means?", criteria: { none: "Not trying to.", intimidation: "Intimidation: threats, menace, a show of force.", persuasion: "Persuasion: an honest appeal, an argument, an offer.", deception: "Deception: a lie, a bluff, a trick.", performance: "Performance: a show, a joke, putting them off their stroke." } };
    q.urge_mood = {
      instructions: "If so, how would that person take it, given who they are, what they're here for and how the fight is going for them (their friends down, their own hurts, who pays them)?",
      criteria: {
        none: "Not trying to.",
        willing: "Gladly: it's what they want anyway (a hireling whose paymaster is down, someone looking for a way out).",
        wavering: "In two minds: the fight is going against them, or they're hurt or alone.",
        hostile: "Only under real pressure: they're still keen on the fight, or it's going their way.",
        unwilling: "Never: it's against who they are or what they're here for, or they can't make sense of it.",
      },
    };
  }
  if (bonus.length) q.bonus = { instructions: "Do they also cast a spell as a bonus action, besides the deed? Only if the line says so.", criteria: { none: "No.", ...Object.fromEntries(bonus.map(d => [d.key, d.label])) } };
  if (higher.length) q.slot = { instructions: "If they cast a levelled spell, do they say they use a higher-level slot for it than its lowest?", criteria: { lowest: "No: the lowest it takes (or they cast no levelled spell).", ...Object.fromEntries(higher.map(l => [`slot${l}`, `A ${ORDINAL[l]}-level slot`])) } };
  return q;
}

/** The fight as the decider needs it: the turn, where everyone is and how, what's about, what just happened, the line. */
function stateOf(text: string, turn: Turn): Record<string, unknown> {
  const { s, me, o } = turn;
  const G = s.G;
  const use = s.usage(me);
  const near = (at: { x: number; y: number }) => (steps(me.at, at) <= 1 ? "right beside you" : `${feetBetween(me.at, at)} ft away`);
  return {
    fight: `${G.place ?? "the Heron"}, round ${G.round}`,
    your_turn: [`HP ${me.hp}/${me.maxHp}`, `${o.movementLeft} ft of movement left`, `action ${o.actionUsed ? "used" : "ready"}`, `bonus action ${use?.bonusActionUsed ? "used" : "ready"}`, ...(me.conditions.filter(c => !/active$/.test(c)).length ? [me.conditions.filter(c => !/active$/.test(c)).join(", ")] : [])].join("; "),
    you: `${me.name}, with ${me.weapons.map(w => s.namer().weapon(w)).join(" and ") || "bare hands"}`,
    others: turn.others.map(u => `${u.name} (${u.side === "enemy" ? "on the other side" : u.side === "ally" ? "on your side" : "not in it"}; ${u.state === "fighting" ? health(u) : u.state}${u.conditions.filter(c => !/active$/.test(c)).length ? `, ${u.conditions.filter(c => !/active$/.test(c)).join(", ")}` : ""}): ${near(u.at)}`),
    things: turn.props.map(p => `the ${p.name} (${p.state}${p.lit && p.state === "standing" ? ", lit" : ""}): ${near(p.at)}`),
    ...(G.dust.length ? { hazards: "grain dust hangs over part of the floor: fire in it explodes" } : {}),
    recent: G.log.slice(-8).map(l => l.text),
    latest_line: text,
  };
}

const answer = (d: Decision, id: string) => d.answers[id]?.choice;

/**
 * The parts of a turn the line may or may not ask for (a move before or after, a bonus spell, a
 * higher slot, an urge, who it's said to): taken only on a clear read, since a wrong one spends
 * something or moves the player unasked. Unclear, it's the quiet answer.
 */
const CLEAR = 0.5;
function clear(d: Decision, id: string, quiet: string): string {
  const a = d.answers[id];
  return a && (a.probabilities?.[a.choice] ?? 1) >= CLEAR ? a.choice : quiet;
}

/** A deed's kind, whoever it's at: "cast:fire-bolt" for Fire Bolt at anyone, "attack:longsword" for a sword at anyone. */
function kindOf(key: string): string {
  const [verb, a, b] = key.split(":");
  if (verb === "attack") return b ? `attack:${b}` : "attack:thing";
  if (verb === "cast") return `cast:${a}`;
  if (verb === "cannot") return `cannot:${a}`;
  return verb === "improvised" || verb === "shove" || verb === "push" || verb === "grapple" || verb === "use" ? verb : key;
}

/**
 * How sure the read of the deed is: the chance of its kind, whoever it's aimed at ("a fire bolt at
 * the one in the good coat" splits between three people who might be in a good coat, but it's a
 * Fire Bolt all the same). The one aimed at is the decider's best.
 */
function sure(d: Decision, id: string): number {
  const a = d.answers[id];
  if (!a) return 0;
  const kind = kindOf(a.choice);
  return Object.entries(a.probabilities ?? { [a.choice]: 1 }).filter(([k]) => kindOf(k) === kind).reduce((n, [, p]) => n + p, 0);
}

/** The decider's answers as steps: the deed, a move before and after, a bonus spell, an upcast, a word with weight; then the economy. */
async function readingOf(decision: Decision, text: string, turn: Turn, deeds: Deed[], decider: Decider): Promise<Reading> {
  const key = answer(decision, "deed") ?? "not_possible";
  const deed = deeds.find(d => d.key === key);
  const to = clear(decision, "said_to", key === "speak_only" ? "room" : "nobody");
  const speech = to !== "nobody" || key === "speak_only" ? { words: text, to: to === "nobody" ? "room" : to } : undefined;
  const base = { by: "decider" as const, decision, ...(speech ? { speech } : {}) };
  if (key === "ooc") return { ...base, steps: [], refusal: oocAnswer(turn, deeds) };
  if (key === "not_theirs") return { ...base, steps: [], refusal: "That isn't magic you have: the sheet (s) shows your spells. Nothing's spent." };
  if (key === "not_possible") return { ...base, steps: [], refusal: `That isn't something this fight can do: m lists every option, or try a plain command (${EXAMPLES}). Nothing's spent.` };
  if (deed?.refusal) return { ...base, steps: [], refusal: `${deed.refusal} Nothing's spent.` };
  // A deed that spends something wants a confident read; words cost nothing, and an unsure read of them is still words.
  if (key !== "speak_only" && sure(decision, "deed") < 0.4) return { ...base, steps: [], refusal: `Not sure what you mean to do there: try plainer words (${EXAMPLES}), or m for every option. Nothing's spent.` };
  let plan: Step[] = [...(deed?.steps ?? [])];
  if (key.startsWith("check:")) plan = await checkSteps(key.slice(6) as "search" | "study", text, turn, decider);
  const first = clear(decision, "move_first", "no");
  if (first !== "no" && !plan.some(s => s.uses === "move")) plan.unshift(moveStep(first));
  const bonus = deeds.find(d => d.key === clear(decision, "bonus", "none"));
  if (bonus?.steps && bonus.key !== key) plan.push(...bonus.steps);
  const after = clear(decision, "move_after", "no");
  if (after !== "no") plan.push(moveStep(after));
  plan = upcastIn(plan, clear(decision, "slot", "lowest"));
  if (key === "move_only" && !plan.length) return { ...base, steps: [], refusal: "Move where? Click a blue tile, or say where to (\"move to the brazier\"). Nothing's spent." };
  const urged = urgeOfDecision(decision, turn, plan);
  if (urged.step) plan.push(urged.step);
  const reading = checked(plan, turn, { ...base, ...(urged.note ? { note: urged.note } : {}) });
  if (!reading.steps.length && !reading.refusal && !speech) return { ...base, steps: [], refusal: "Nothing to do there: say something, or do something. Nothing's spent." };
  return reading;
}

const moveStep = (where: string): Step => ({ id: where === "door" ? "make_for_the_door" : where === "away" ? "back_off" : `close_${where.slice(6)}`, uses: "move" });

/** An upcast asked for: the levelled spell in the plan from that slot. */
function upcastIn(plan: Step[], slot: string | undefined): Step[] {
  const n = slot?.startsWith("slot") ? Number(slot.slice(4)) : undefined;
  if (!n) return plan;
  return plan.map(s => (s.id.startsWith("cast_") && !/_slot\d$/.test(s.id) ? { ...s, id: `${s.id}_slot${n}` } : s));
}

/**
 * A word with weight (the Influence action): urging someone on the other side to give it up. It
 * takes the action, so it's words only if the deed has the action, or it's unwilling ears.
 */
function urgeOfDecision(d: Decision, turn: Turn, plan: Step[]): { step?: Step; note?: string } {
  const urge = clear(d, "urge", "no");
  const who = clear(d, "urged", "none");
  if (urge === "no" || who === "none") return {};
  const u = turn.s.unit(who);
  if (!u) return {};
  const how = (answer(d, "urge_how") ?? "none") === "none" ? "intimidation" : answer(d, "urge_how") as InfluenceSkill;
  const mood = answer(d, "urge_mood") ?? "hostile";
  if (mood === "unwilling") return { note: `${cap(u.called)} won't hear of it: that's just words, and costs nothing.` };
  if (plan.some(s => s.uses === "action" || s.uses === "attack")) return { note: `Urging ${u.called} would take your action too: it's just words this turn.` };
  const read = urgeSteps({ kind: "unit", u }, how, urge as Urge, turn, u.called, (mood === "none" ? "hostile" : mood) as Mood);
  return "refusal" in read ? { note: `${read.refusal.replace(/\.$/, "")}: it's just words.` } : { step: read.steps[0]! };
}

/** A look or a think: a second small call for which skill, and how hard (only on those turns). */
async function checkSteps(kind: "search" | "study", text: string, turn: Turn, decider: Decider): Promise<Step[]> {
  const skills: readonly CheckSkill[] = kind === "search" ? SEARCH_SKILLS : ["investigation", "arcana", "history", "nature", "religion"];
  const TEXT: Record<CheckSkill, string> = {
    perception: "Perception: spotting, noticing, listening", insight: "Insight: reading someone, catching a lie or a mood", medicine: "Medicine: seeing how badly someone's hurt", survival: "Survival: tracks, signs, a way through",
    investigation: "Investigation: working out how something works or what it's for", arcana: "Arcana: magic, spells, what's enchanted", history: "History: who someone is, what happened here", nature: "Nature: animals, plants, the weather", religion: "Religion: gods, rites, the holy and unholy",
  };
  const d = await decider.decide(stateOf(text, turn), {
    skill: { instructions: "The player's character is looking for something or working something out (latest_line). Which skill decides it?", criteria: Object.fromEntries(skills.map(s => [s, TEXT[s]])) },
    difficulty: { instructions: "How hard is it, in the middle of a fight, given what they're after?", criteria: { easy: "Easy: most people would manage it.", moderate: "Moderate: a real chance of missing it.", hard: "Hard: it would take skill and luck." } },
  }, "fight.check");
  const skill = (answer(d, "skill") ?? skills[0]) as CheckSkill;
  const dc = { easy: 10, moderate: 13, hard: 16 }[answer(d, "difficulty") ?? "moderate"] ?? 13;
  return [{ id: `check_${skill}_${dc}`, uses: "action" }];
}

/** Out of character, "what can I do?": the turn's options, from the rules. */
function oocAnswer(turn: Turn, deeds: Deed[]): string {
  const doable = deeds.filter(d => d.steps?.length && !d.key.startsWith("cannot")).map(d => d.label.replace(/ \(.*\)$/, "").toLowerCase());
  const head = `${turn.o.movementLeft} ft of movement, your action ${turn.o.actionUsed ? "spent" : "ready"}`;
  return `This turn you have ${head}. You could ${doable.slice(0, 5).join("; ") || "end your turn"}${doable.length > 5 ? "; and more" : ""}. m lists every option.`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
