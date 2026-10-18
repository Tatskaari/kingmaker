// New (M6, docs/combat-design.md §2): each moment's caption, one line in the house style ("The talking Crake swings at you: 7 damage."), from what the moment says happened.
import { listing } from "../../../shared/fight/flavour.ts";
import { steps } from "../../../shared/fight/grid.ts";
import type { FightBoard, FightEvent, FightHit, FightRoll, Unit } from "../../../shared/fight/types.ts";

/**
 * A moment's caption, written from its details (the path walked, the rolls, the hits), so it says
 * exactly what the dice did: who did what to whom, the damage, and who went down. The house style
 * is the flavour lines' (shared/fight/flavour.ts), which go in the moment's lines beside it.
 */
export function captionOf(m: Omit<FightEvent, "seq">, G: FightBoard): string {
  const c = new Caption(m, G);
  switch (m.kind) {
    case "start": return c.start();
    case "turn": return c.turn();
    case "move": return c.move();
    case "attack": return c.attack();
    case "cast": return c.cast();
    case "dash": return `${c.Who} ${c.s("dash", "dashes")}: double movement this turn.`;
    case "dodge": return `${c.Who} ${c.s("dodge")}: attacks on ${c.them} have disadvantage until ${c.their} next turn.`;
    case "disengage": return `${c.Who} ${c.s("disengage")}: no swings as ${c.they} ${c.s("move")} away.`;
    case "wrestle": return c.wrestle();
    case "feature": return c.feature();
    case "use": return `${c.Who} ${/brazier/i.test(m.detail.with ?? "") ? `${c.s("kick")} over` : `${c.s("bring")} down`} the ${m.detail.with ?? "thing"}.${c.lit()}`;
    case "yield": return c.you ? "You put your hands up." : `${c.Who} puts ${c.their} hands up.`;
    case "flee": return `${c.Who} ${c.s("go", "goes")} out through ${m.detail.with ?? "the way out"} and ${c.s("are", "is")} gone.`;
    case "walk-off": return m.detail.lines[0] ?? `${c.Who} walks off: nobody's paying for the rest of this.`;
    case "arrest": return `${c.Who} ${c.s("put")} the irons on ${c.name(m.target)}.`;
    case "over": return c.over();
    case "pass": return `${c.Who} ${c.s("have", "has")} nothing left this turn.`;
    default: return m.detail.lines[0] ?? "";
  }
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const possessive = (name: string) => (name === "you" ? "your" : name.endsWith("s") ? `${name}'` : `${name}'s`);
/** A weapon shot rather than swung, by its name. */
const isShot = (weapon: string) => /bow|crossbow|sling|dart|javelin/i.test(weapon);
/** A beast's natural weapon, by its name. */
const isBite = (weapon: string) => /bite|claw|fang|talon/i.test(weapon);

class Caption {
  readonly m: Omit<FightEvent, "seq">;
  readonly G: FightBoard;
  readonly actor: Unit | undefined;
  readonly you: boolean;

  constructor(m: Omit<FightEvent, "seq">, G: FightBoard) {
    this.m = m;
    this.G = G;
    this.actor = m.actor ? G.units[m.actor] : undefined;
    this.you = !!this.actor && this.actor.id === G.pc;
  }

  /** What someone (or a thing) is called mid-sentence: "you", "the wolf", "the lantern". */
  name(id: string | undefined): string {
    const u = id ? this.G.units[id] : undefined;
    if (u) return u.id === this.G.pc ? "you" : u.called;
    const prop = id ? this.G.props[id] : undefined;
    return prop ? `the ${prop.name}` : "someone";
  }
  get Who(): string { return cap(this.name(this.m.actor)); }
  get them(): string { return this.you ? "you" : "them"; }
  get they(): string { return this.you ? "you" : "they"; }
  get their(): string { return this.you ? "your" : "their"; }
  /** A verb agreeing with the actor: "you swing", "the wolf swings". */
  s(base: string, third = `${base}s`): string { return this.you ? base : third; }
  /** The same for anyone. */
  private sFor(id: string, base: string, third = `${base}s`): string { return id === this.G.pc ? base : third; }

  start(): string {
    const order = (this.m.detail.initiative ?? []).map(r => this.name(r.unit));
    if (!order.length) return "Roll for initiative!";
    const [first, ...rest] = order;
    return `Roll for initiative! ${cap(first!)} ${first === "you" ? "go" : "goes"} first${rest.length ? `, then ${listing(rest)}` : ""}.`;
  }

  turn(): string {
    const u = this.actor;
    const whose = this.you ? "your" : possessive(this.name(this.m.actor));
    const how = u && u.state === "down" ? ", on the floor" : u && u.state === "fighting" && u.conditions.includes("unconscious") ? `, and ${this.you ? "you're" : "they're"} asleep` : "";
    return `Round ${this.m.round}: ${whose} turn${how}.`;
  }

  move(): string {
    const path = this.m.detail.path ?? [];
    const from = this.m.detail.from;
    const to = path[path.length - 1];
    const feet = path.length * 5;
    if (!to || !from || !this.actor) return `${this.Who} ${this.s("stay")} put.`;
    const foes = Object.values(this.G.units).filter(v => v.state === "fighting" && this.hostile(this.actor!, v));
    const near = (at: { x: number; y: number }) => foes.filter(v => steps(v.at, at) <= 1);
    const exit = this.G.exits.find(e => e.at.x === to.x && e.at.y === to.y);
    if (exit) return `${this.Who} ${this.s("make")} for ${exit.label}, ${feet} ft.`;
    const now = near(to), was = near(from);
    const closed = listing(now.filter(v => !was.includes(v)).map(v => this.name(v.id)));
    if (closed) return feet <= 10 ? `${this.Who} ${this.s("step")} in on ${closed}.` : `${this.Who} ${this.s("close")} in on ${closed}, ${feet} ft.`;
    if (was.length && !now.length) return `${this.Who} ${this.s("back")} off ${feet} ft.`;
    return `${this.Who} ${this.s("move")} ${feet} ft.`;
  }

  attack(): string {
    const rolls = this.m.detail.rolls;
    const roll = rolls[0];
    const target = this.m.target ?? roll?.target;
    const weapon = this.m.detail.with ?? roll?.with ?? "";
    const them = this.name(target);
    if (!roll) return `${this.Who} ${this.s("attack")} ${them}.`;
    if (roll.opportunity) return `${this.Who} ${this.s("take")} a swing as ${them} ${this.sFor(target ?? "", "go", "goes")} past${this.landed(rolls, target)}`;
    if (this.G.props[target ?? ""]) return `${this.Who} ${this.s(isShot(weapon) ? "shoot" : "swing")} at ${them}${roll.hit ? `: it comes down.${this.lit()}` : `, and ${this.s("miss", "misses")}.`}`;
    if (rolls.every(r => r.parried)) return `${cap(them)} ${this.sFor(target ?? "", "parry", "parries")} ${possessive(this.name(this.m.actor))} blow.`;
    const twice = rolls.length === 2 ? " twice" : rolls.length > 2 ? ` ${rolls.length} times` : "";
    const verb = isShot(weapon) ? (rolls.some(r => r.hit) ? this.s("shoot") : `${this.s("shoot")} at`) : isBite(weapon) ? (rolls.some(r => r.hit) ? this.s("bite") : `${this.s("snap")} at`) : `${this.s("swing")}${twice} at`;
    return `${this.Who} ${verb} ${them}${this.landed(rolls, target)}`;
  }

  /** How a blow (or several) landed: ": 7 damage.", ": a critical hit, 14 damage!", ", and misses.", with a fall. */
  private landed(rolls: FightRoll[], target: string | undefined): string {
    if (!rolls.some(r => r.hit)) return rolls.some(r => r.parried) ? ", and it's parried." : `, and ${this.s("miss", "misses")}.`;
    const hit = this.hitOn(target);
    const dmg = hit ? total(hit) : 0;
    const crit = rolls.some(r => r.critical);
    return `: ${crit ? "a critical hit, " : ""}${dmg} damage${crit ? "!" : "."}${this.fall(hit)}${this.woke(hit)}`;
  }

  /** " The talking Crake wakes up." when a blow woke a sleeper (Sleep ends with a hurt). */
  private woke(hit: FightHit | undefined): string {
    if (!hit || hit.fell || hit.state !== "fighting" || !hit.lost.includes("unconscious")) return "";
    const who = this.name(hit.unit);
    return ` ${cap(who)} ${who === "you" ? "wake" : "wakes"} up.`;
  }

  cast(): string {
    const spell = this.m.detail.with ?? "a spell";
    const hits = this.m.detail.hits.filter(h => h.damage.length || h.healed || h.saved !== undefined);
    const rolls = this.m.detail.rolls;
    const cast = `${this.Who} ${this.s("cast")} ${spell}`;
    if (this.m.detail.area) {
      // Who it caught: their damage (and a save), or what it did to them (asleep, prone).
      const caught = this.m.detail.hits.filter(h => h.damage.length || h.healed || h.saved !== undefined || h.gained.some(c => CONDITION[c]));
      if (!caught.length) {
        const there = this.inArea();
        return there.length ? `${cast} over ${listing(there.map(id => this.name(id)))}, to no effect.${this.lit()}` : `${cast}, catching nobody.${this.lit()}`;
      }
      const each = caught.map(h => {
        const what = [...(h.damage.length ? [`${total(h)}`] : []), ...(h.saved ? ["saved"] : []), ...h.gained.flatMap(c => (CONDITION[c] && !(c === "unconscious" && h.fell) ? [CONDITION[c]!] : []))];
        return `${this.name(h.unit)}${what.length ? ` (${what.join(", ")})` : ""}`;
      });
      return `${cast}, catching ${listing(each)}.${caught.filter(h => h.fell).map(h => this.fall(h)).join("")}${this.lit()}`;
    }
    const target = this.m.target;
    const hit = this.hitOn(target);
    if (hit?.healed) return `${cast}: ${this.name(target)} ${this.sFor(hit.unit, "regain")} ${hit.healed} HP.`;
    if (!target) return `${cast}.`;
    const them = this.name(target);
    if (rolls.length && !rolls.some(r => r.hit)) return `${cast} at ${them}, and ${this.s("miss", "misses")}.${this.lit()}`;
    if (!hit || !hit.damage.length) return `${cast} at ${them}${hit?.saved ? `, and ${them} ${this.sFor(hit.unit, "shake")} it off` : ""}.${this.lit()}`;
    const type = hit.damage[0]?.type;
    const saved = hit.saved ? ` (${them} ${this.sFor(hit.unit, "save")}, and ${this.sFor(hit.unit, "take")} half)` : "";
    return `${cast} at ${them}: ${total(hit)}${type ? ` ${type}` : ""} damage${saved}.${this.fall(hit)}${this.woke(hit)}${this.lit()}`;
  }

  /** A class feature used: who, which, on whom, and what it did (hit points back, a condition taken up, a dash's feet). "You use Second Wind: 11 hit points back." */
  feature(): string {
    const m = this.m;
    const on = m.target ? ` on ${this.name(m.target)}` : "";
    const healed = m.detail.hits.find(h => h.healed > 0);
    const gained = m.detail.hits.flatMap(h => h.gained.map(c => (h.unit === this.G.pc ? `you're ${c}` : `${this.name(h.unit)} is ${c}`)));
    const what = healed ? `: ${healed.healed} hit point${healed.healed === 1 ? "" : "s"} back${healed.unit === m.actor ? "" : ` for ${this.name(healed.unit)}`}` : gained.length ? `: ${listing(gained)}` : "";
    return `${this.Who} ${this.s("use")} ${m.detail.with ?? "a feature"}${on}${what}.`;
  }

  wrestle(): string {
    const target = this.m.target;
    const them = this.name(target);
    const hit = this.hitOn(target);
    if (this.m.detail.with === "Grapple") return hit?.gained.includes("grappled") ? `${this.Who} ${this.s("grab")} hold of ${them}.` : `${this.Who} ${this.s("try", "tries")} to grab ${them}, who ${this.sFor(target ?? "", "slip", "slips")} free.`;
    if (hit?.gained.includes("prone")) return `${this.Who} ${this.s("shove")} ${them} over.`;
    if (hit?.movedTo) return `${this.Who} ${this.s("shove")} ${them} back.`;
    return `${this.Who} ${this.s("shove")} at ${them}, who ${this.sFor(target ?? "", "keep", "keeps")} ${target === this.G.pc ? "your" : "their"} feet.`;
  }

  over(): string {
    switch (this.m.detail.outcome) {
      case "victory": return "It's over: you won.";
      case "surrender": return "It's over: they gave up.";
      case "defeat": return "It's over: you lost.";
      case "fled": return "It's over: you got away.";
      case "yielded": return "It's over: you yielded.";
      default: return "It's over.";
    }
  }

  /** ", and the wolf goes down." when they fell in it. */
  private fall(hit: FightHit | undefined): string {
    if (!hit?.fell) return "";
    const who = this.name(hit.unit);
    return ` ${cap(who)} ${hit.state === "dead" ? (who === "you" ? "die" : "dies") : who === "you" ? "go down" : "goes down"}.`;
  }

  /** " Fire catches." when the moment set something alight (its lines say so). */
  lit(): string {
    const lines = this.m.detail.lines.join(" ");
    if (/Grain dust explosion/.test(lines)) return " The grain dust goes up!";
    return /sets the sacks alight/.test(lines) ? " The sacks catch fire." : "";
  }

  /** Who stands in the moment's area (an area spell's tiles), up and about. */
  private inArea(): string[] {
    const area = this.m.detail.area ?? [];
    return Object.values(this.G.units).filter(u => u.state === "fighting" && area.some(t => t.x === u.at.x && t.y === u.at.y)).map(u => u.id);
  }

  private hitOn(id: string | undefined): FightHit | undefined {
    return this.m.detail.hits.find(h => h.unit === id);
  }

  private hostile(a: Unit, b: Unit): boolean {
    const team = (u: Unit) => (u.side === "player" || u.side === "ally" ? 1 : u.side === "enemy" ? 2 : 0);
    return team(a) !== 0 && team(b) !== 0 && team(a) !== team(b);
  }
}

/** What a spell's conditions do to someone, in a word for a caption ("asleep"): the ones a caption names. */
const CONDITION: Record<string, string> = { unconscious: "asleep", prone: "knocked down", restrained: "held fast", grappled: "held", blinded: "blinded", frightened: "frightened", charmed: "charmed", stunned: "stunned", paralyzed: "paralysed", incapacitated: "reeling", poisoned: "poisoned" };

/** A hit's damage, all types together. */
const total = (h: FightHit) => h.damage.reduce((n, d) => n + d.amount, 0);
