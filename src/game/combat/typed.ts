import { deciderFor, type Decider, type Decision } from "../../llm/decide.ts";
import { modelOffline } from "../../llm/openrouter.ts";
import { approachById } from "../../runtime/approaches.ts";
import type { SessionState } from "../../runtime/session.ts";
import type { TacticalFight } from "./fights.ts";
import type { InfluenceSkill, Urge } from "./model.ts";
import { decided } from "./typed-decider.ts";
import { planned } from "./typed-plan.ts";
import { attackSteps, castCommand, examplesFor, leaveSteps, moveSteps, simpleSteps, spellNamed, target, turnOf, urgeSteps, useSteps, wrestleSteps, type Read, type Step, type Target, type Turn } from "./typed-turn.ts";

/**
 * A line typed in a fight, read onto the player's turn (src/app/README.md, "Typing in a fight").
 * Plain words are said aloud; *asterisks* or (brackets) are done, and so is a plain command
 * ("attack sallow", "cast fire bolt at the nearest crake", "move to the brazier", "end turn").
 *
 * - The plain commands are read here with no model, online and off: two or three of them joined
 *   by "and" or "then" too ("move to the brazier and kick it over").
 * - Anything else is the decider's (typed-decider.ts), with this turn's own actions as its options
 *   (which act, at whom, which spell, which slot; a move and whether it's before or after; a second
 *   act; a bonus action; a word to someone on the other side), so it chooses rather than invents.
 * - Either way it comes out as the fight's own action ids (typed-turn.ts says what each act comes
 *   to), checked against the action economy and walked on the board before anything's done
 *   (typed-plan.ts: a step back that would lose the line on Sallow is made to somewhere that keeps
 *   it), and done by the fight as a click or a key does them, so the rules resolve it.
 * - What can't be done is refused with the reason, and nothing is spent: a spell they haven't got,
 *   nobody in reach, two things that each take the action, a way out too far to get through.
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
  /** Worth a second thought before it's done (an area that catches a friend): said first, and done when said again. */
  warn?: string;
  /** No model about: the plain commands only, and no voice. */
  offline?: boolean;
  /** Who read it: the plain commands, or the decider. */
  by: "parser" | "decider";
  /** The decider's answers, for the record (the tests and the tour read them). */
  decision?: Decision;
}

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
  if (!decider) return { steps: [], refusal: `The GM is offline, so a fight only takes plain commands just now: ${examplesFor(turn)}. Nothing's spent.`, offline: true, by: "parser" };
  try {
    return await decided(text, turn, decider);
  } catch (error) {
    return { steps: [], refusal: `The GM couldn't make that out just now (${message(error).slice(0, 120)}). Try again, or a plain command: ${examplesFor(turn)}. Nothing's spent.`, by: "decider" };
  }
}

// ---------------------------------------------------------------------------------------------
// The plain commands.

const END = /^(?:end(?: (?:my|the))? turn|end it|done|pass|i'?m done|that'?s (?:it|all))$/;
const SIMPLE = /^(dash|dodge|disengage)$/;
const LEAVE = /^(?:leave|flee|escape|run for it|run away|get out|leave the fight|go out(?: through)?(?: the (?:door|gate|way out))?)$/;
const BACK = /^(?:back off|back away|retreat|fall back|step back|get clear)$/;
/**
 * Commands that are as often shouted at someone else ("Back off!", "Flee, you fools!", "Done!"):
 * shouted, they're the decider's to read (or, offline, the GM's absence), never the player's own move.
 */
const SHOUTABLE = [END, LEAVE, BACK];
const STEP = /^step (north|south|east|west|northeast|northwest|southeast|southwest)$/;
const MOVE = /^(?:move|go|walk|run|head|get|step|hurry|dash)(?: over)? (?:to|towards?|up to|next to|beside|by|over to|for)\s+(.+)$|^(?:close in on|close on|approach|charge(?: at)?|rush|make for)\s+(.+)$/;
const USE = /^(?:knock over|kick over|tip over|topple|bring down|knock down|pull down|upend|overturn)\s+(.+)$|^(?:knock|kick|tip|bring|pull)\s+(.+?)\s+(?:over|down)$/;
const SHOVE = /^(?:shove|push|trip|knock down)\s+(.+?)(?:\s+(over|down|back|away))?$|^(?:knock|shove|push)\s+(.+?)\s+(over|down|back|away)$/;
const GRAPPLE = /^(?:grapple|grab|seize|tackle|pin|grab hold of|get hold of|wrestle)\s+(.+)$/;
const ATTACK = /^(?:attack|hit|strike|stab|slash|swing at|shoot(?: at)?|fire at|punch|kick|smack|whack|thump|clobber|bash|cut|fight|unarmed strike|unarmed attack|headbutt|elbow|knee|jab|uppercut)\s+(.+?)(?:\s+with\s+(.+))?$/;
/** A blow with no weapon in it: the rules' Unarmed Strike. */
const FISTS = /^(?:punch|kick|unarmed|headbutt|elbow|knee|jab|uppercut)\b/;
/** A barbarian's Reckless Attack: declared, then the blow ("reckless attack the big porter", "attack him recklessly"). */
const RECKLESS = /^(?:reckless(?:ly)?\s+(?:attack|strike|swing at|hit)|swing wild(?:ly)? at|go reckless(?:ly)? at)\s+(.+?)(?:\s+with\s+(.+))?$|^(?:attack|hit|strike|swing at)\s+(.+?)\s+recklessly(?:\s+with\s+(.+))?$/;
const THROW = /^(?:throw|hurl|fling|toss|lob|chuck)\s+(.+?)\s+at\s+(.+)$/;
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
  if (/!\s*$/.test(text) && parts.some(p => SHOUTABLE.some(re => re.test(p)))) return undefined;
  const plan: Step[] = [];
  const warns: string[] = [];
  let last: Target | undefined;
  for (const part of parts) {
    const read = command(part, turn, last);
    if (!read || ("refusal" in read && read.unread && !strict)) return undefined;
    if ("refusal" in read) return { steps: [], refusal: read.refusal, by: "parser" };
    plan.push(...read.steps);
    if (read.warn) warns.push(read.warn);
    last = read.target ?? last;
  }
  return planned(plan, turn, { by: "parser", ...(warns.length ? { warn: warns.join(" ") } : {}) });
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

const KNOWN_VERBS = new Set(["attack", "hit", "strike", "stab", "slash", "shoot", "punch", "kick", "headbutt", "cast", "move", "walk", "run", "head", "shove", "push", "grab", "grapple", "tackle", "dash", "dodge", "disengage", "intimidate", "threaten", "persuade", "deceive", "approach", "charge", "knock", "topple", "trip", "smack", "whack", "bash", "throw", "hurl"]);

/** One command of a line: its steps (and what it was aimed at, for an "it" or a "him" after), a refusal, or undefined if it isn't one. */
function command(part: string, turn: Turn, last: Target | undefined): Read | undefined {
  if (END.test(part)) return { steps: [{ id: "end_turn", uses: "end" }] };
  let m = SIMPLE.exec(part);
  if (m) return simpleSteps(m[1] as "dash" | "dodge" | "disengage", turn);
  if (LEAVE.test(part)) return leaveSteps(turn);
  if (BACK.test(part)) return turn.actions.some(a => a.id === "back_off") ? { steps: [{ id: "back_off", uses: "move" }] } : { refusal: turn.o.movementLeft < 5 ? "You've no movement left this turn." : "There's nobody beside you to back away from." };
  m = STEP.exec(part);
  if (m) return turn.actions.some(a => a.id === `step_${m![1]}`) ? { steps: [{ id: `step_${m[1]}`, uses: "move" }] } : { refusal: `You can't step ${m[1]} from here this turn.` };
  m = MOVE.exec(part);
  if (m) {
    // "Dash to the door": the Dash action first (twice the movement), then the move.
    const moved = moveSteps(m[1] ?? m[2]!, turn, last);
    return /^dash\b/.test(part) && turn.o.dash && "steps" in moved ? { ...moved, steps: [{ id: "dash", uses: "action" }, ...moved.steps] } : moved;
  }
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
  m = THROW.exec(part);
  if (m) return throwSteps(m[1]!, target(m[2]!, turn, last, "unit"), turn, m[2]!);
  m = CAST.exec(part);
  if (m) return castCommand(m[1]!, turn, last);
  m = RECKLESS.exec(part);
  if (m) return recklessSteps(m[1] ?? m[3]!, m[2] ?? m[4], turn, last);
  m = ATTACK.exec(part);
  if (m) {
    const weapon = m[2] ?? (FISTS.test(part) ? "fists" : undefined);
    return attackSteps(target(m[1]!, turn, last, "unit"), weapon, turn, m[1]);
  }
  return undefined;
}

/** Reckless Attack, then the blow: or why not (it's a barbarian's, before their first attack of the turn). */
function recklessSteps(words: string, weapon: string | undefined, turn: Turn, last: Target | undefined): Read {
  if (!turn.o.reckless) return { refusal: turn.s.whyNotReckless(turn.me) ?? "You can't attack recklessly now." };
  const blow = attackSteps(target(words, turn, last, "unit"), weapon, turn, words);
  return "steps" in blow ? { ...blow, steps: [{ id: "reckless", uses: "free" }, ...blow.steps] } : blow;
}

/**
 * "Throw the dagger at sallow": a blow, from beside them (thrown from arm's length, it's the same
 * swing); further off, not yet: the engine's reach check refuses a thrown weapon past 5 ft.
 */
function throwSteps(thing: string, t: Target | undefined, turn: Turn, words: string): Read {
  // A spell hurled is a spell ("hurl a fire bolt at the crake").
  if (spellNamed(thing, turn)) return castCommand(`${thing} at ${words}`, turn, undefined);
  const near = t?.kind === "unit" && Math.max(Math.abs(t.u.at.x - turn.me.at.x), Math.abs(t.u.at.y - turn.me.at.y)) <= 1;
  if (near || t?.kind !== "unit") return attackSteps(t, thing, turn, words);
  const shot = turn.o.attacks.find(a => a.target === t.u.id && turn.s.t.item(a.weapon)?.attackKind === "ranged");
  return { refusal: `Throwing isn't part of a fight on the map yet (a thrown weapon only reaches 5 ft here)${shot ? `: your ${shot.weaponName} reaches ${t.u.called} from where you stand` : ""}.` };
}

/** What an urge asks for, by its words: give up (the default), go, or hold back. */
function urgeOf(words: string): Urge {
  if (/\b(run|leave|go|flee|clear off|get out|scarper|bugger off|push off)\b/.test(words)) return "go";
  if (/\b(wait|hold|stop|stay|back off|stand still|think)\b/.test(words)) return "hold";
  return "yield";
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
