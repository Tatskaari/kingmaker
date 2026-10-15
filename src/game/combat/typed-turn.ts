import { sceneById } from "../../../scenes/index.ts";
import { inFights } from "../../rules/spells.ts";
import type { Action } from "../play.ts";
import type { TacticalFight } from "./fights.ts";
import { clearShot, FEET, feetBetween, steps } from "./grid.ts";
import type { InfluenceSkill, Mood, PlayerOptions, Prop, Unit, Urge } from "./model.ts";
import type { Skirmish } from "./skirmish.ts";

/**
 * The player's turn as a typed line is read onto it (typed.ts): who and what the words name, what
 * each kind of act comes to in the fight's own action ids, from this turn's own options, and the
 * action economy. Used by the plain commands and by the decider's reading alike.
 */

/** One of the fight's action ids, and what of the turn it uses ("both": a bonus-action spell whose first swing wants the action too, Spiritual Weapon). */
export interface Step { id: string; uses: "action" | "attack" | "bonus" | "both" | "move" | "end" }

/**
 * What a reading of a command can come to. `unread`: its words didn't name anything the parser
 * knows (a name, a spell, a weapon), which the decider may yet make out ("the big lad"). `warn`:
 * it can be done, but it's worth a second thought first (a Fireball that catches a friend).
 */
export type Read = { steps: Step[]; target?: Target; warn?: string } | { refusal: string; unread?: boolean };

export type Target = { kind: "unit"; u: Unit } | { kind: "prop"; p: Prop } | { kind: "self" } | { kind: "door" };

/** The player's turn as a reading needs it: the board as the rules see it, and what can be done now. */
export interface Turn {
  s: Skirmish;
  me: Unit;
  o: PlayerOptions;
  actions: Action[];
  /** Everyone on the board but the player (the fallen too: they can be named, if not hit). */
  others: Unit[];
  props: Prop[];
  /** What else people go by, by unit id: what the scene says the player calls them ("the big porter"), and their other names ("Hep"). */
  aliases?: Record<string, string[]>;
}

export function turnOf(fight: TacticalFight): Turn {
  const c = fight.controller;
  const s = c.look();
  const me = s.pc();
  const others = s.units.filter(u => u.id !== me.id && u.state !== "fled");
  return { s, me, o: c.options(), actions: fight.actions(), others, props: Object.values(c.state().props).filter(p => !p.carriedBy), aliases: aliasesOf(c.session.sceneId, others) };
}

/** What the scene calls its people besides their names (a ring's fighters have none: they're the arena's). */
function aliasesOf(sceneId: string, units: Unit[]): Record<string, string[]> {
  let cast: Array<{ id: string; called?: string; aka?: string[] }> = [];
  try { cast = sceneById(sceneId).cast; } catch { /* a zoo ring's world isn't a scene */ }
  return Object.fromEntries(units.map(u => { const c = cast.find(x => x.id === (u.castId ?? u.id)); return [u.id, [...(c?.called ? [c.called] : []), ...(c?.aka ?? [])]]; }));
}

// ---------------------------------------------------------------------------------------------
// Who and what the words mean.

const STOP = new Set(["the", "a", "an", "that", "this", "nearest", "closest", "near", "other", "one", "my", "your", "his", "her", "their", "of", "on", "in", "at", "over", "there", "here", "guy", "fellow", "chap", "bloke", "mister", "mr", "poor", "old", "dear"]);
export const norm = (t: string) => t.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
export const wordsOf = (t: string) => norm(t).split(" ").filter(w => w && !STOP.has(w)).map(singular);
/** The word a name is about ("a porter with a sack-needle": porter; "the talking Crake": crake; "Master Josiah Sallow": sallow). */
export const headOf = (name: string) => { const ws = norm(name.split(/\b(?:with|from|of|in|on|at|by|who|that|hung|hanging)\b/i)[0] ?? name).split(" ").filter(Boolean); return singular(ws.at(-1) ?? ""); };

function namesOfUnit(u: Unit, aliases: string[] = []): { words: string[]; heads: string[] } {
  return {
    words: [...wordsOf(u.name), ...wordsOf(u.called), ...wordsOf(u.id.replace(/-/g, " ")), ...(u.castId ? wordsOf(u.castId.replace(/-/g, " ")) : []), ...aliases.flatMap(wordsOf)],
    heads: [headOf(u.name), headOf(u.called), ...wordsOf(u.id.replace(/-\d+$/, "").replace(/-/g, " ")).slice(-1), ...aliases.map(headOf)],
  };
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

/** "the crake by the door": who (the crake), and where (by the door), when the words say where. */
const WHERE = /^(.+?)\s+(?:by|near|next to|beside|at|over by|in front of|behind)\s+(.+)$/;
const EXIT = /\b(?:door|doors|gate|exit|way out|doorway)\b/;

/**
 * Who or what the words name: yourself, the way out, someone on the board, or a thing (a lantern,
 * the brazier), the best named first and then the nearest ("the nearest crake": the nearest of the
 * Crakes). "The crake by the door" is the Crake nearest the door; "the door" alone is the way out.
 * `prefer` breaks a tie between someone and something. An "it" or a "him" is the last one named.
 */
export function target(words: string, turn: Turn, last: Target | undefined, prefer: "unit" | "prop"): Target | undefined {
  const w = norm(words);
  if (/^(?:it|him|her|them|that|this one|that one)$/.test(w)) return last;
  if (/^(?:me|myself|self|yourself)$/.test(w)) return { kind: "self" };
  const named = bestNamed(words, turn, prefer, turn.me.at);
  if (named) return named;
  const where = WHERE.exec(w);
  if (where) {
    const near = EXIT.test(where[2]!) ? exitNear(turn, turn.me.at) : placeOf(target(where[2]!, turn, last, "prop"), turn);
    const who = bestNamed(where[1]!, turn, prefer, near ?? turn.me.at, true);
    if (who) return who;
  }
  if (EXIT.test(w)) return { kind: "door" };
  const query = wordsOf(words);
  return query.length && wordsOf(turn.me.name).some(n => query.includes(n)) ? { kind: "self" } : undefined;
}

/** Someone or something on the board the words name, the nearest to `from` among the best named (or among all named, for "the nearest"). */
function bestNamed(words: string, turn: Turn, prefer: "unit" | "prop", from: { x: number; y: number }, nearest = false): Target | undefined {
  const query = wordsOf(words);
  const units = turn.others.map(u => ({ t: { kind: "unit" as const, u }, at: u.at, s: score(query, namesOfUnit(u, turn.aliases?.[u.id])) }));
  const props = turn.props.map(p => ({ t: { kind: "prop" as const, p }, at: p.at, s: score(query, namesOfProp(p)) }));
  const found = [...units, ...props].filter(c => c.s > 0);
  if (!found.length) return undefined;
  const best = Math.max(...found.map(c => c.s));
  const close = nearest || /\b(?:nearest|closest)\b/.test(norm(words));
  return found.filter(c => close || c.s === best)
    .sort((a, b) => steps(from, a.at) - steps(from, b.at) || Number(b.t.kind === prefer) - Number(a.t.kind === prefer))[0]!.t;
}

const placeOf = (t: Target | undefined, turn: Turn) => (t?.kind === "unit" ? t.u.at : t?.kind === "prop" ? t.p.at : t?.kind === "self" ? turn.me.at : undefined);
const exitNear = (turn: Turn, from: { x: number; y: number }) => [...turn.s.G.exits].sort((a, b) => steps(a.at, from) - steps(b.at, from))[0]?.at;

export const nameOf = (t: Target): string => (t.kind === "unit" ? t.u.called : t.kind === "prop" ? `the ${t.p.name}` : t.kind === "self" ? "yourself" : "the way out");
export const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export const unknown = (words: string | undefined): { refusal: string; unread: true } => ({ refusal: `There's nobody and nothing here called "${(words ?? "that").trim()}".`, unread: true });

/** A tile beside them the player can still get to this turn (or none). */
export function besideThem(at: { x: number; y: number }, turn: Turn): boolean {
  return turn.o.movementLeft >= FEET && turn.o.moves.some(t => steps(t, at) === 1);
}

/** Can the player make an attack now: their action free, or attacks left in the one they've begun. */
export function attacksLeft(turn: Turn): number {
  const use = turn.s.usage(turn.me);
  if (!use || !turn.o.ready) return 0;
  const per = turn.s.attacksPerAction(turn.me);
  if (!use.actionUsed) return per;
  return use.attacksMadeThisTurn > 0 ? Math.max(0, per - use.attacksMadeThisTurn) : 0;
}

/** Someone the player could hit at all this turn: standing, on the other side, and in the fight (not a child running for the door). */
export function foeOrWhyNot(t: Target | undefined, turn: Turn, words?: string): { u: Unit } | { refusal: string; unread?: boolean } {
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

/** A few plain commands that fit this fight (its people, its things, the player's own spells), for the offline word and a hint. */
export function examplesFor(turn: Turn): string {
  const foes = turn.others.filter(u => u.side === "enemy" && u.state === "fighting" && u.role !== "coward")
    .sort((a, b) => steps(turn.me.at, a.at) - steps(turn.me.at, b.at));
  // What they're called for short, by their id ("the crake", "the goblin boss"; a name as it is: "sallow", "hep").
  const head = (u: Unit) => u.id.replace(/-\d+$/, "").replace(/-/g, " ");
  const call = (u: Unit) => (/^(?:the|a|an) /i.test(u.called) ? `the ${head(u)}` : head(u));
  const first = foes[0];
  const twin = first && foes.some(u => u !== first && head(u) === head(first));
  const spell = turn.o.spells.find(sp => sp.targeting !== "self" && !sp.area);
  const thing = turn.props.find(p => p.state === "standing" && p.lit && p.kind !== "object");
  return [
    first ? `attack ${call(first)}` : undefined,
    spell && first ? `cast ${spell.name.toLowerCase()} at ${twin ? `the nearest ${head(first)}` : call(first)}` : undefined,
    thing ? `move to the ${thing.kind}` : undefined,
    first ? `shove ${call(first)} over` : undefined,
    "end turn",
  ].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------------------------
// What each kind of act comes to, by the fight's own options.

export function simpleSteps(kind: "dash" | "dodge" | "disengage", turn: Turn): Read {
  return turn.o[kind] ? { steps: [{ id: kind, uses: "action" }] } : { refusal: turn.o.actionUsed ? `You've already used your action this turn: no ${kind === "dodge" ? "dodging" : kind === "dash" ? "dashing" : "disengaging"}.` : `You can't ${kind} again this turn.` };
}

/** Out through the way out: from where they stand, or by making for it first (whether it's in reach is the plan's to say: typed-plan.ts). */
export function leaveSteps(turn: Turn): Read {
  if (turn.o.leave) return { steps: [{ id: "leave", uses: "move" }] };
  if (!turn.s.G.exits.length) return { refusal: "There's no way out of here." };
  if (turn.o.movementLeft < FEET && !turn.o.dash) return { refusal: "You've no movement left to get out with this turn." };
  return { steps: [{ id: "make_for_the_door", uses: "move" }, { id: "leave", uses: "move" }], target: { kind: "door" } };
}

export function moveSteps(words: string, turn: Turn, last: Target | undefined): Read {
  const t = target(words, turn, last, "prop");
  if (!t) return unknown(words);
  if (turn.o.movementLeft < FEET) return { refusal: "You've no movement left this turn." };
  if (t.kind === "self") return { refusal: "You're already where you are." };
  if (t.kind === "door") return turn.o.leave ? { refusal: "You're standing in the way out already: leave, if you're going." } : { steps: [{ id: "make_for_the_door", uses: "move" }], target: t };
  const at = t.kind === "unit" ? t.u.at : t.p.at;
  if (steps(turn.me.at, at) <= 1) return { refusal: `You're right beside ${nameOf(t)} already.` };
  if (!besideThem(at, turn)) return { refusal: `You can't get next to ${nameOf(t)} this turn (${feetBetween(turn.me.at, at)} ft off, ${turn.o.movementLeft} ft of movement left): try the blue tiles nearer it.` };
  return { steps: [{ id: `close_${t.kind === "unit" ? t.u.id : t.p.id}`, uses: "move" }], target: t };
}

export function useSteps(t: Target | undefined, words: string, turn: Turn): Read {
  if (!t) return unknown(words);
  if (t.kind !== "prop") return { refusal: `${cap(nameOf(t))} isn't something to knock over.` };
  const p = t.p;
  if (p.state !== "standing") return { refusal: `The ${p.name} is down already.` };
  if (turn.o.props.some(x => x.id === p.id)) return { steps: [{ id: `use_${p.id}`, uses: "action" }], target: t };
  if (turn.o.actionUsed) return { refusal: "You've already used your action this turn." };
  if (besideThem(p.at, turn)) return { steps: [{ id: `close_${p.id}`, uses: "move" }, { id: `use_${p.id}`, uses: "action" }], target: t };
  return { refusal: `The ${p.name} is out of reach (${feetBetween(turn.me.at, p.at)} ft), and you can't get to it this turn.` };
}

export function wrestleSteps(t: Target | undefined, how: "grapple" | "prone" | "push", turn: Turn, words?: string): Read {
  const foe = foeOrWhyNot(t, turn, words);
  if ("refusal" in foe) return foe;
  const id = `${how === "grapple" ? "grapple" : how === "prone" ? "shove" : "push"}_${foe.u.id}`;
  if (turn.o.wrestle.some(w => w.id === foe.u.id)) return { steps: [{ id, uses: "action" }], target: t };
  if (turn.o.actionUsed) return { refusal: "You've already used your action this turn." };
  if (besideThem(foe.u.at, turn)) return { steps: [{ id: `close_${foe.u.id}`, uses: "move" }, { id, uses: "action" }], target: t };
  return { refusal: `${cap(foe.u.called)} is out of reach (${feetBetween(turn.me.at, foe.u.at)} ft), and you can't get beside them this turn.` };
}

/**
 * Urging someone on the other side to stop (the Influence action). How they take it is the
 * fight's (Skirmish.moodOf): never, and it's refused with why; `mood`, a read of who they are,
 * goes in the id to make it harder still.
 */
export function urgeSteps(t: Target | undefined, skill: InfluenceSkill, urge: Urge, turn: Turn, words?: string, mood?: Mood): Read {
  const foe = foeOrWhyNot(t, turn, words);
  if ("refusal" in foe) return foe;
  const heard = turn.o.hear.find(h => h.id === foe.u.id);
  if (turn.o.actionUsed) return { refusal: "Urging them takes your action, and you've used it this turn." };
  if (!heard) return { refusal: `${cap(foe.u.called)} is too far off to hear it (${feetBetween(turn.me.at, foe.u.at)} ft).` };
  if (skill !== "intimidation" && !heard.understands) return { refusal: `${cap(foe.u.called)} doesn't understand a word of it: only a threat gets through.` };
  if (heard.mood === "unwilling") return { refusal: `${cap(heard.why)}: it's just words.` };
  return { steps: [{ id: `urge_${skill}_${urge}_${mood ? `${mood}_` : ""}${foe.u.id}`, uses: "action" }], target: t };
}

export const IMPROVISED = /\b(?:improvis\w*|bottle|stool|chair|bench|plank|stick|fists?|hands?|bare|tankard|mug|jug|anything|elbow|head|knee|boot|foot|feet|chain|pole|brick|stone|rock|candlestick|pan|poker)\b/;

export function attackSteps(t: Target | undefined, weaponWords: string | undefined, turn: Turn, words?: string): Read {
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

export const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** One of the player's weapons by its name ("sword", "the longbow", "bow"). */
export function weaponNamed(words: string, turn: Turn): string | undefined {
  const q = wordsOf(words).filter(w => !["weapon", "trusty", "good", "own"].includes(w));
  if (!q.length) return undefined;
  return turn.me.weapons.find(w => { const name = norm(turn.s.namer().weapon(w)).replace(/ /g, ""); return q.every(x => name.includes(x)); });
}

// ---------------------------------------------------------------------------------------------
// Spells.

/** "fire bolt at the nearest crake with a 2nd-level slot": the spell, at whom, and from which slot. */
export function castCommand(rest: string, turn: Turn, last: Target | undefined): Read {
  let words = rest;
  let slot: number | undefined;
  const upcast = /\s+(?:with|using|from|in|at)\s+(?:a |an |my )?(\d)(?:st|nd|rd|th)?(?:[- ]level)?(?:\s+slot)?$|\s+(?:upcast(?:\s+to)?|at level)\s+(\d)$/.exec(words);
  if (upcast) { slot = Number(upcast[1] ?? upcast[2]); words = words.slice(0, upcast.index); }
  const aimed = /^(.+?)\s+(?:at|on|into|towards?|against|upon)\s+(.+)$/.exec(words);
  const spellWords = aimed ? aimed[1]! : words;
  // The spell first: one they haven't got is the reason, whoever it was meant for.
  const spell = spellNamed(spellWords, turn);
  if (spell && !turn.o.spells.some(s => s.id === spell.id)) return { refusal: whyNotCast(spell.id, turn) };
  const t = aimed ? target(aimed[2]!, turn, last, "unit") : undefined;
  if (aimed && !t) return unknown(aimed[2]);
  return castSteps(spellWords, t, slot, turn, aimed ? namedMany(aimed[2]!, turn) : undefined);
}

/** Everyone a plural names ("the crakes", "the wolves"), when it names more than one; otherwise nobody. */
function namedMany(words: string, turn: Turn): Unit[] | undefined {
  const last = norm(words).split(" ").at(-1) ?? "";
  if (singular(last) === last) return undefined;
  const query = wordsOf(words);
  const many = turn.others.filter(u => u.state === "fighting" && score(query, namesOfUnit(u, turn.aliases?.[u.id])) > 0);
  return many.length > 1 ? many : undefined;
}

/** A spell by its name, whoever's it is: the engine's own list. */
export function spellNamed(words: string, turn: Turn): { id: string; name: string; level: number } | undefined {
  const key = (t: string) => norm(t).replace(/^(?:a|an|the|my|some|another) /, "").replace(/ /g, "");
  const q = key(words);
  if (q.length < 3) return undefined;
  const all = [...turn.s.t.kit.engine.content.spells.values()];
  return all.find(sp => key(sp.name) === q) ?? all.find(sp => key(sp.name).startsWith(q) && q.length >= 5);
}

/** Why a spell of the player's can't be cast now (it isn't ready, the fight doesn't play it, no slot, no action). */
export function whyNotCast(id: string, turn: Turn): string {
  const sheet = turn.s.t.sheet(turn.me.engineId);
  const def = turn.s.t.kit.engine.content.spells.get(id)!;
  const theirs = (sheet.spellcasting?.spellsByLevel ?? []).flatMap(g => g.spells).find(sp => sp.spellId === id);
  if (!theirs) return `${def.name} isn't one of your spells: the sheet (s) shows what you have.`;
  if (def.level > 0 && !theirs.prepared && !theirs.alwaysPrepared) return `${def.name} isn't one of the spells you have prepared today.`;
  if (!inFights(def)) return `${def.name} isn't a spell a fight on the map can play out (its page on the sheet says so).`;
  if (def.level > 0 && ![1, 2, 3, 4, 5, 6, 7, 8, 9].some(l => l >= def.level && turn.s.freeSlots(turn.me, l) > 0)) return `You've no slot left for ${def.name}: a long rest brings them back.`;
  const bonus = /bonus/i.test(def.castingTime);
  if (bonus ? turn.o.bonusActionUsed : turn.o.actionUsed) return `You've already used your ${bonus ? "bonus action" : "action"} this turn.`;
  if (bonus && hurls(def) && turn.o.actionUsed) return `${def.name} takes your action as well as your bonus action (its first swing), and your action's spent this turn.`;
  return `${def.name} can't be cast just now.`;
}

/** A bonus-action spell that swings as it's cast and lasts (Spiritual Weapon): the engine wants the action for that swing too. */
const hurls = (def: { castingTime: string; duration: string; mechanicalEffects?: Array<{ kind: string }> }) =>
  /bonus/i.test(def.castingTime) && !!def.mechanicalEffects?.some(m => m.kind === "attack") && def.duration.trim().toLowerCase() !== "instantaneous";

export function usesOf(spellId: string, turn: Turn): Step["uses"] {
  const def = turn.s.t.kit.engine.content.spells.get(spellId);
  if (!def || !/bonus/i.test(def.castingTime)) return "action";
  return hurls(def) ? "both" : "bonus";
}

export function castSteps(spellWords: string, t: Target | undefined, slot: number | undefined, turn: Turn, many?: Unit[]): Read {
  const spell = spellNamed(spellWords, turn);
  if (!spell) return { refusal: `There's no spell called "${spellWords.trim()}".`, unread: true };
  const choice = turn.o.spells.find(s => s.id === spell.id);
  if (!choice) return { refusal: whyNotCast(spell.id, turn) };
  const uses = usesOf(spell.id, turn);
  const suffix = slotSuffix(choice, slot, turn);
  if (typeof suffix === "object") return suffix;
  const step = (id: string): Step => ({ id: `${id}${suffix}`, uses });
  if (choice.targeting === "self") {
    if (t && t.kind !== "self") return { refusal: `${choice.name} is only for yourself.` };
    return { steps: [step(`cast_${choice.id}`)], target: { kind: "self" } };
  }
  if (t?.kind === "door") return { refusal: `${choice.name} at the way out would only frighten the hinges.` };
  if (choice.targeting === "area") return many ? areaUnsaid(choice, step, turn, many) : areaSteps(choice, t, step, turn);
  // A fire spell at a thing (a lantern in the beams, the brazier): it comes down, burning.
  if (t?.kind === "prop") return propSpell(choice, t, step, turn);
  // At someone: one of the spell's targets this turn (the nearest, unsaid: yourself, for a heal); in close first for a touch.
  const nearest = nearestOf(choice.targets, turn);
  const aim = t ?? (nearest ? (nearest.id === turn.me.id ? { kind: "self" as const } : { kind: "unit" as const, u: nearest }) : undefined);
  if (!aim) return { refusal: `There's nobody ${choice.name} can reach from here.` };
  const who = aim.kind === "self" ? turn.me : aim.kind === "unit" ? aim.u : undefined;
  if (!who) return { refusal: `${choice.name} is cast at someone.` };
  if (choice.targets.some(x => x.id === who.id)) return { steps: [step(`cast_${choice.id}_${who.id}`)], target: aim };
  if (choice.range <= FEET && who.id !== turn.me.id && besideThem(who.at, turn) && who.state === "fighting") return { steps: [{ id: `close_${who.id}`, uses: "move" }, step(`cast_${choice.id}_${who.id}`)], target: aim };
  return { refusal: spellReachWhy(choice, who, turn) };
}

type SpellOption = PlayerOptions["spells"][number];

/** A spell at a thing: a fire spell brings it down burning (the rules break and light it); anything else does nothing the fight can show. */
function propSpell(choice: SpellOption, t: { kind: "prop"; p: Prop }, step: (id: string) => Step, turn: Turn): Read {
  const p = t.p;
  if (!choice.fire) return { refusal: `${choice.name} at the ${p.name} would do nothing the fight can show: hit it with a weapon, or knock it over from beside it.` };
  if (p.state !== "standing") return { refusal: `The ${p.name} is down already.` };
  const far = feetBetween(turn.me.at, p.at);
  if (far > Math.max(choice.range, FEET)) return { refusal: `The ${p.name} is ${far} ft away; ${choice.name} reaches ${Math.max(choice.range, FEET)} ft.` };
  if (!clearShot(turn.s.G.map, turn.me.at, p.at)) return { refusal: `There's no clear line to the ${p.name} from here.` };
  return { steps: [step(`cast_${choice.id}_${p.id}`)], target: t };
}

/** The nearest of a spell's targets this turn. */
export function nearestOf(targets: Array<{ id: string }>, turn: Turn): Unit | undefined {
  return targets.map(x => turn.s.unit(x.id)).filter((u): u is Unit => !!u).sort((a, b) => steps(turn.me.at, a.at) - steps(turn.me.at, b.at))[0];
}

/**
 * An area: at whoever or whatever it's aimed at, as the fight lays it on the tiles. Unsaid, at
 * whoever it catches most of the other side with and none of yours (none such, and it asks where);
 * aimed where it catches the player or a friend, it says so first (a warning, to say again).
 */
function areaSteps(choice: SpellOption, t: Target | undefined, step: (id: string) => Step, turn: Turn): Read {
  if (t?.kind === "self") return { refusal: `${choice.name} is aimed somewhere: at whom?` };
  if (!t || (t.kind !== "unit" && t.kind !== "prop")) return areaUnsaid(choice, step, turn);
  const at = t.kind === "unit" ? t.u : t.p;
  const fromSelf = !!choice.area && choice.range === 0;
  const far = feetBetween(turn.me.at, at.at);
  if (!fromSelf && far > choice.range) return { refusal: `That's ${far} ft away; ${choice.name} reaches ${choice.range} ft.` };
  if (!fromSelf && !clearShot(turn.s.G.map, turn.me.at, at.at)) return { refusal: `There's no clear line to ${nameOf(t)} from here.` };
  if (fromSelf && far > (choice.area?.size ?? FEET)) return { refusal: `${choice.name} goes out ${choice.area?.size ?? FEET} ft from you; ${nameOf(t)} is ${far} ft off.` };
  const caught = areaCatch(choice, at.at, turn);
  return { steps: [step(`cast_${choice.id}_at_${at.id}`)], target: t, ...(caught.friends.length ? { warn: `${choice.name} at ${nameOf(t)} would catch ${listOf(caught.friends)} too.` } : {}) };
}

/** An area with no aim said (or aimed at several: "the crakes"): the best of its aims this turn for the other side (those named) and none of yours. */
function areaUnsaid(choice: SpellOption, step: (id: string) => Step, turn: Turn, wanted?: Unit[]): Read {
  const aims = choice.targets.map(x => turn.s.unit(x.id)).filter((u): u is Unit => !!u)
    .map(u => ({ u, ...areaCatch(choice, u.at, turn, wanted) }))
    .sort((a, b) => a.friends.length - b.friends.length || b.foes - a.foes || steps(turn.me.at, a.u.at) - steps(turn.me.at, b.u.at));
  const best = aims[0];
  if (!best) return { refusal: `There's nobody ${choice.name} can reach from here.` };
  if (best.friends.length) return { refusal: `${choice.name} would catch ${listOf(best.friends)} wherever it's aimed from here: say at whom, if you mean it.` };
  return { steps: [step(`cast_${choice.id}_at_${best.u.id}`)], target: { kind: "unit", u: best.u } };
}

/** Who an area aimed at a tile would catch: how many on the other side (of those wanted, if said), and which of yours (you among them) by name. */
export function areaCatch(choice: SpellOption, at: { x: number; y: number }, turn: Turn, wanted?: Unit[]): { foes: number; friends: string[] } {
  const def = turn.s.t.kit.engine.content.spells.get(choice.id);
  if (!def) return { foes: 0, friends: [] };
  const tiles = turn.s.spellArea(turn.me, def, at);
  const fromSelf = /^self/i.test(def.range);
  const inside = [turn.me, ...turn.others].filter(u => u.state !== "fled" && u.state !== "dead" && tiles.some(t => t.x === u.at.x && t.y === u.at.y) && !(fromSelf && u.id === turn.me.id));
  return {
    foes: inside.filter(u => u.side === "enemy" && u.state === "fighting" && (!wanted || wanted.some(w => w.id === u.id))).length,
    friends: inside.filter(u => u.id === turn.me.id || u.side === "ally").map(u => (u.id === turn.me.id ? "you" : u.called)),
  };
}

export const listOf = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";

export function spellReachWhy(choice: SpellOption, who: Unit, turn: Turn): string {
  if (who.side === "ally" && !choice.targets.some(x => x.id === who.id)) return `${choice.name} isn't for ${who.called}: ${cap(who.called)}'s on your side.`;
  if (who.state !== "fighting") return `${cap(who.called)} ${who.state === "surrendered" ? "has given up" : "is down"}: ${choice.name} can wait.`;
  if (who.role === "coward") return `${cap(who.called)} isn't fighting anyone: there's no call for ${choice.name}.`;
  const far = feetBetween(turn.me.at, who.at);
  if (far > Math.max(choice.range, FEET)) return `${cap(who.called)} is ${far} ft away; ${choice.name} reaches ${Math.max(choice.range, FEET)} ft.`;
  if (!clearShot(turn.s.G.map, turn.me.at, who.at)) return `There's no clear line to ${who.called} from here.`;
  return `${choice.name} can't be aimed at ${who.called} this turn.`;
}

/** "_slot3" for a slot above the lowest, "" for the lowest, or why not (a slot it can't take, or one that's gone). */
function slotSuffix(choice: SpellOption, slot: number | undefined, turn: Turn): string | { refusal: string } {
  if (slot === undefined || choice.level === 0 || slot === choice.slot) return "";
  if (slot < choice.level) return { refusal: `${choice.name} takes a ${ORDINAL[choice.level]}-level slot at the least.` };
  if (slot > 9 || turn.s.freeSlots(turn.me, slot) <= 0) return { refusal: `You've no ${ORDINAL[slot] ?? `${slot}th`}-level slot left.` };
  return `_slot${slot}`;
}

export const ORDINAL = ["cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

// ---------------------------------------------------------------------------------------------
// The action economy: an action (its attacks), a bonus action, and moving, in order.

/**
 * The steps as one turn: nothing after the end of it, the same move twice running once, and no
 * more than the turn has (one action, however many attacks it gives; one bonus action). More than
 * that is refused, with why, before anything's done.
 */
export function economy(plan: Step[], turn: Turn): { steps: Step[] } | { refusal: string } {
  const end = plan.findIndex(s => s.uses === "end");
  const kept = (end >= 0 ? plan.slice(0, end + 1) : plan).filter((s, i, all) => i === 0 || s.uses !== "move" || s.id !== all[i - 1]!.id);
  const actions = kept.filter(s => s.uses === "action" || s.uses === "both").length;
  const attacks = kept.filter(s => s.uses === "attack").length;
  const bonus = kept.filter(s => s.uses === "bonus" || s.uses === "both").length;
  const left = attacksLeft(turn);
  if (actions + (attacks ? 1 : 0) > 1) return { refusal: "That's more than one thing that takes your action: you've one action a turn." };
  if (actions && turn.o.actionUsed) return { refusal: "You've already used your action this turn." };
  if (attacks > left) return { refusal: left ? `You've ${left} attack${left === 1 ? "" : "s"} left this turn.` : "Your attack's spent this turn." };
  if (bonus > 1 || (bonus && turn.o.bonusActionUsed)) return { refusal: bonus > 1 ? "That's two bonus actions: you've one." : "You've already used your bonus action this turn." };
  return { steps: kept };
}
