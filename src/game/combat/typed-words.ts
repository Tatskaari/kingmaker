import { steps as tilesBetween } from "./grid.ts";
import type { Unit } from "./model.ts";
import { besideThem, cap, IMPROVISED, norm, slugOf, type Step, type Turn } from "./typed-turn.ts";

/**
 * The line's own words against the decider's read of a blow or a shot (typed-decider.ts). The
 * words are the player's: a weapon they name is the weapon (the dagger they said, not the shortbow
 * the decider took it for; their staff, not something to hand), or why not; and a throw, which a
 * fight on the map doesn't do yet beyond arm's length, says so rather than becoming a shot.
 */

/** Weapons by what people call them, and what that is among the rules' names ("knife": a dagger). */
const NOUNS = ["dagger", "knife", "shortsword", "longsword", "greatsword", "sword", "rapier", "scimitar", "sabre", "saber", "cutlass", "mace", "greatclub", "club", "cudgel", "quarterstaff", "staff", "spear", "javelin", "handaxe", "greataxe", "battleaxe", "axe", "warhammer", "hammer", "maul", "flail", "glaive", "halberd", "lance", "morningstar", "pike", "trident", "whip", "sickle", "dart", "sling", "shortbow", "longbow", "crossbow", "bow", "blowgun", "musket", "pistol"];
const ALIAS: Record<string, string> = { knife: "dagger", sabre: "scimitar", saber: "scimitar", cutlass: "scimitar", cudgel: "club" };
/** A weapon named as one: after "my", "a", "the", "with" (and a word or two: "my trusty old dagger"), so "I club him" names no club. */
const NAMED = new RegExp(`\\b(?:my|a|an|the|his|her|their|your|this|that|with)\\s+(?:[a-z]+\\s+){0,2}?(${NOUNS.join("|")})s?\\b`, "g");
/** Thrown: what's thrown is the word after the verb (a punch thrown is a blow; a fire bolt hurled is a spell). */
const THROWN = /\b(?:throw|throws|threw|hurl|hurls|hurled|fling|flings|flung|toss|tosses|tossed|lob|lobs|lobbed|chuck|chucks|chucked)\s+(?:(?:my|a|an|the|his|her|this|that|some|another|one of my)\s+)?([a-z-]+)/;
const NOT_THROWN = /^(?:punch|punches|kick|kicks|jab|hook|haymaker|uppercut|glance|look|insult|insults|curse|word|words|fire|firebolt|bolt|spell|ray|glare|fit|tantrum|myself|himself|herself|caution|shade|light|shadow)$/;

export function asWorded(text: string, plan: Step[], turn: Turn): { steps: Step[]; note?: string } | { refusal: string } {
  const at = plan.findIndex(s => /^attack_/.test(s.id));
  const m = at >= 0 ? /^attack_(.+?)(?:_with_(.+))?$/.exec(plan[at]!.id) : undefined;
  const u = m ? turn.s.unit(m[1]!) : undefined;
  if (!m || !u) return { steps: plan };
  const words = norm(text.replace(/[*()]/g, " "));
  const thrown = thrownAt(words, u, turn);
  if (thrown) return thrown;
  return weaponWorded(words, plan, at, u, m[2], turn);
}

/** A throw at someone out of arm's reach: not yet (the engine's reach check refuses a thrown weapon past 5 ft), and what reaches them instead. */
function thrownAt(words: string, u: Unit, turn: Turn): { refusal: string } | undefined {
  const t = THROWN.exec(words);
  if (!t || NOT_THROWN.test(t[1]!) || tilesBetween(turn.me.at, u.at) <= 1) return undefined;
  const shot = turn.o.attacks.find(a => a.target === u.id && turn.s.t.item(a.weapon)?.attackKind === "ranged");
  return { refusal: `Throwing isn't part of a fight on the map yet (a thrown weapon only reaches 5 ft here)${shot ? `: your ${shot.weaponName} reaches ${u.called} from where you stand` : ""}.` };
}

/** A weapon the words name: the act's own, the one of theirs it is (as a blow or a shot that can be made), or why not. */
function weaponWorded(words: string, plan: Step[], at: number, u: Unit, with_: string | undefined, turn: Turn): { steps: Step[] } | { refusal: string } {
  const named = [...words.matchAll(NAMED)].map(x => ALIAS[x[1]!] ?? x[1]!);
  if (!named.length) return { steps: plan };
  const nameOf = (w: string) => norm(turn.s.namer().weapon(w)).replace(/ /g, "");
  const theirs = turn.me.weapons.filter(w => named.some(n => nameOf(w).includes(n)));
  const chosen = with_ === "improvised" ? undefined : with_ ? turn.me.weapons.find(w => slugOf(turn.s.namer().weapon(w)) === with_) : turn.o.attacks.find(a => a.target === u.id)?.weapon;
  if (chosen && theirs.includes(chosen)) return { steps: plan };
  // Something they haven't got, swung as something to hand: that's what an improvised weapon is.
  if (!theirs.length) return with_ === "improvised" || IMPROVISED.test(words) ? { steps: plan } : { refusal: `You haven't got ${/^[aeiou]/.test(named[0]!) ? "an" : "a"} ${named[0]}: you've ${turn.me.weapons.map(w => turn.s.namer().weapon(w).toLowerCase()).join(" and ") || "your fists"}.` };
  const w = theirs[0]!;
  const attack: Step = { id: `attack_${u.id}_with_${slugOf(turn.s.namer().weapon(w))}`, uses: "attack" };
  // The blow in the act's place, closing in first only if this weapon needs it.
  const before = plan.slice(0, at).filter(s => s.id !== `close_${u.id}`);
  const after = plan.slice(at + 1);
  if (turn.o.attacks.some(a => a.target === u.id && a.weapon === w)) return { steps: [...before, attack, ...after] };
  const melee = turn.s.t.item(w)?.attackKind !== "ranged";
  if (melee && !turn.o.actionUsed && besideThem(u.at, turn)) return { steps: [...before, { id: `close_${u.id}`, uses: "move" }, attack, ...after] };
  return { refusal: `${(turn.s.attackCheck(turn.me, u, w).error ?? `${cap(u.called)} is out of reach of your ${turn.s.namer().weapon(w).toLowerCase()}`).replace(/\.$/, "")}.` };
}
