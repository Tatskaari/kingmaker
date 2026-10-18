// Copied from the prototype's src/game/look/director.ts at 44c6d4a, less barksFrom and barkers (and so runtime/speakers.ts): every GM entry carries its speakers since V5, so barksFromSpeech does. New: what it plays is heard too (client/sound: a spell cast, flying and landing in its element, a blow's swing and thud, fire catching, water, things breaking, someone falling), each when its effect shows.
import { positionOf, select, type Entity, type Point, type SceneWorld } from "../../shared/world/scene-world.ts";
import { sfx } from "../sound/cues.ts";
import type { Sfx } from "../sound/patches.ts";
import type { Effects, Vec } from "./effects.ts";
import { lookOf } from "./appearance.ts";
import { smoothstep } from "./noise.ts";

/**
 * The director turns what changed in the world into motion on screen, so the story shows up in the
 * world without anyone scripting it. Call observe() after each turn (after the rules and the stage
 * manager have written to the world): it compares the world with what it saw last time and
 *
 *   - walks people (and slides things) from where they were to where they are now, instead of
 *     teleporting them;
 *   - lights what caught fire (sparks, a flash), douses what got wet while burning (a splash and a
 *     puff of steam), breaks what was destroyed (debris, smoke if it burned), blows up what
 *     exploded, puffs in what arrived and out what left;
 *   - and, given the rules' lines, floats the damage numbers ("12" in fire orange over the table):
 *     pass them to rulesLines() before observe(), which then floats only the hurt the lines didn't.
 *
 * The positions it's tweening are what renderers should draw (positionAt), falling back to the world.
 */

interface Seen { at?: Point; states: string; parent: string | null; present: boolean; hp?: number }

/** A spill's splash colour, by what it is. */
const SPLASH: Array<[string, string]> = [["water", "#7ab8e8"], ["oil", "#5a5040"], ["spirits", "#cfe0d8"], ["ale", "#e8b040"], ["blood", "#a01818"], ["grease", "#8a7a40"]];

export class Tweens {
  private moves = new Map<string, { from: Point; to: Point; start: number; dur: number; hop: number }>();
  /** Move id from one place to another over dur ms (hop: feet of arc, for things thrown). */
  add(id: string, from: Point, to: Point, start: number, dur: number, hop = 0): void { this.moves.set(id, { from, to, start, dur, hop }); }
  /** Where id is drawn at time t, while it's moving (undefined otherwise: use the world). */
  at(id: string, t: number): Point | undefined {
    const m = this.moves.get(id);
    if (!m) return undefined;
    if (t >= m.start + m.dur) { this.moves.delete(id); return undefined; }
    const f = t <= m.start ? 0 : smoothstep(0, 1, (t - m.start) / m.dur);
    return { x: m.from.x + (m.to.x - m.from.x) * f, y: m.from.y + (m.to.y - m.from.y) * f - m.hop * 4 * f * (1 - f) * 0.5 };
  }
  clear(): void { this.moves.clear(); }
}

export class Director {
  readonly effects: Effects;
  readonly tweens: Tweens;
  private seen = new Map<string, Seen>();
  private logSeen = 0;
  /** Whoever the rules' lines have floated damage over since the last observe (observe doesn't float it again). */
  private floated = new Set<string>();
  /** Feet per second people walk at on screen. */
  walk = 9;

  constructor(effects: Effects, tweens = new Tweens()) {
    this.effects = effects;
    this.tweens = tweens;
  }

  /** Where to draw an entity at time t (mid-walk, or where the world has it). */
  positionAt(world: SceneWorld, id: string, t: number): Point | undefined {
    return this.tweens.at(id, t) ?? positionOf(world, id);
  }

  /** Remember the world as it is (call once when a scene opens, so its first look isn't all news). */
  prime(world: SceneWorld): void {
    this.seen = snapshot(world);
    this.logSeen = world.log.length;
    this.floated.clear();
  }

  /** Animate what changed since last time. Returns a line per thing it animated (for logs and tests). */
  observe(world: SceneWorld, t: number): string[] {
    const now = snapshot(world);
    const did: string[] = [];
    const fx = this.effects;
    // What it sounds like: each kind of thing once, however many things it happened to.
    const heard = new Map<Sfx, { size?: number; delay: number }>();
    const hear = (name: Sfx, more: { size?: number; delay?: number } = {}) => { if (!heard.has(name)) heard.set(name, { delay: more.delay ?? 0, ...(more.size ? { size: more.size } : {}) }); };
    for (const [id, cur] of now) {
      const e = world.entities[id]!;
      const before = this.seen.get(id);
      const pos = cur.at;
      if (!before) {
        if (!pos || !cur.present) continue;
        const burning = e.states.includes("burning");
        if (e.kind === "surface") {
          // A spill lands with a splash of its own colour; clouds and scorch marks just are.
          const liquid = SPLASH.find(([tag]) => e.tags.includes(tag));
          if (burning) { fx.effect("ignite", { at: { ...pos }, radius: e.radius ?? 3, flame: e.tags.includes("spirits") ? "blue" : "fire" }, t); hear("world.ignite"); }
          else if (liquid) { fx.effect("splash", { at: { ...pos }, radius: Math.min(5, e.radius ?? 3), color: liquid[1], amount: 0.7 }, t); hear("world.splash"); }
          did.push(`${e.name} spreads`);
          continue;
        }
        fx.effect(burning ? "ignite" : "poof", { at: { ...pos }, radius: 2 }, t);
        hear(burning ? "world.ignite" : "world.poof");
        did.push(`${e.name} appears`);
        continue;
      }
      if (before.present && !cur.present) {
        if (before.at && e.kind !== "surface") { fx.effect("poof", { at: { ...before.at }, radius: 2 }, t); hear("world.poof"); }
        did.push(`${e.name} ${e.kind === "surface" ? "is gone" : "leaves"}`);
        continue;
      }
      // Moves: walk or slide from the old spot to the new one.
      if (before.at && pos && Math.hypot(before.at.x - pos.x, before.at.y - pos.y) > 1.5) {
        const being = e.kind === "person" || e.kind === "creature";
        const dist = Math.hypot(before.at.x - pos.x, before.at.y - pos.y);
        const dur = Math.max(300, Math.min(2200, (dist / (being ? this.walk : this.walk * 2)) * 1000));
        this.tweens.add(id, { ...(this.tweens.at(id, t) ?? before.at) }, { ...pos }, t, dur, being ? 0 : Math.min(6, dist / 3));
        did.push(`${e.name} moves`);
      }
      if (cur.states === before.states) {
        if (before.hp !== undefined && cur.hp !== undefined && cur.hp < before.hp && pos && !this.floated.has(id)) fx.float({ ...pos }, String(before.hp - cur.hp), { damage: "bludgeoning" }, t);
        continue;
      }
      const was = new Set(before.states.split("|")), is = new Set(cur.states.split("|"));
      const gained = [...is].filter(s => s && !was.has(s)), lost = [...was].filter(s => s && !is.has(s));
      if (!pos) continue;
      const at = { ...pos };
      const look = lookOf(e, {});
      const size = e.kind === "surface" ? e.radius ?? 3 : { tiny: 1.5, small: 2.5, medium: 3.5, large: 5, huge: 8, gargantuan: 12 }[e.size ?? "medium"] ?? 3;
      if (gained.includes("exploded")) { fx.effect("explosion", { at, radius: Math.max(10, size * 2) }, t); hear("world.explosion", { size: Math.max(10, size * 2) }); did.push(`${e.name} explodes`); }
      if (gained.includes("burning") && !gained.includes("exploded")) { fx.effect("ignite", { at, radius: size, flame: look.flame ?? "fire" }, t); hear("world.ignite"); did.push(`${e.name} catches fire`); }
      if (gained.includes("wet") || gained.includes("soaked")) {
        const doused = lost.includes("burning") || was.has("burning");
        fx.effect(doused ? "douse" : "splash", { at, radius: Math.max(3, size) }, t);
        hear(doused ? "world.douse" : "world.splash");
        did.push(doused ? `${e.name} is doused` : `${e.name} is soaked`);
      } else if (lost.includes("burning") && !is.has("destroyed")) {
        fx.effect("steam", { at, radius: size * 0.6 }, t);
        hear("world.steam");
        did.push(`${e.name} goes out`);
      }
      if (gained.includes("destroyed")) {
        fx.effect("debris", { at, radius: size, ...(is.has("burning") || is.has("smouldering") ? { color: "#3a2c24" } : {}) }, t);
        if (is.has("burning") || is.has("smouldering")) fx.effect("smoke", { at, radius: size * 0.7 }, t + 120);
        hear("world.debris");
        did.push(`${e.name} is destroyed`);
      }
      if (gained.includes("frozen")) { fx.effect("sparks", { at, color: "#cfefff" }, t); hear("world.freeze"); did.push(`${e.name} freezes`); }
      if (gained.includes("dead")) { fx.effect("splash", { at, radius: 2.5, color: "#a01818" }, t); hear("blow.fall"); did.push(`${e.name} falls dead`); }
      else if (gained.some(s => s === "unconscious" || s === "prone" || s === "down")) { fx.effect("poof", { at, radius: 1.5 }, t); hear("blow.fall"); did.push(`${e.name} goes down`); }
      if (gained.includes("hidden")) { fx.effect("poof", { at, radius: 1.5 }, t); hear("world.poof"); }
      if (gained.includes("fallen")) { fx.effect("poof", { at, radius: 2 }, t); hear("blow.fall"); }
    }
    // The world's own log, for what states alone don't say (where a fire spread from).
    for (const entry of world.log.slice(this.logSeen)) {
      const spread = /^fire spread to (.+)$/.exec(entry.text);
      if (spread) {
        const target = select(world, spread[1]!)[0];
        const to = target ? positionOf(world, target.id) : undefined;
        const from = target ? nearestBurning(world, target.id) : undefined;
        if (to && from) hear("world.ignite", { delay: fx.effect("throw", { from, to: { ...to }, glyph: "*", color: "#ffa030" }, t).lands - t });
      }
    }
    this.logSeen = world.log.length;
    this.seen = now;
    this.floated.clear();
    for (const [name, at] of heard) sfx(name, at.size ? { size: at.size } : {}, { delay: at.delay });
    return did;
  }

  /**
   * Float the numbers from the rules' lines ("The long table takes 7 fire damage", "the talking
   * Crake takes 7 damage", "You take 5 damage", "Odo regains 6 HP", "...: unharmed by the fire").
   * A blow's damage type comes from its "Damage: ..." line. People the player hasn't heard named
   * are in the lines by what the player calls them (aliases: id to that). Returns how many it floated.
   * The next observe() doesn't float the same hurt again (a fire burning on is one number a turn).
   */
  rulesLines(world: SceneWorld, lines: string[], t: number, aliases: Record<string, string> = {}): number {
    let n = 0, kind = "";
    // A blow's sound (a spell's is spellsFrom's): its swing, then each hurt it did, or a miss.
    const spell = lines.some(l => /^Cast /.test(l));
    const blows = spell ? [] : lines.map(l => /^(.+?): (?:your|.+?'s) attack on .+?: .* vs AC \d+: (hit|miss|critical hit!)/i.exec(l)).filter(m => !!m);
    const critical = blows.some(m => /critical/i.test(m[2]!));
    blows.forEach((m, i) => {
      sfx("blow.swing", { kind: m[1]! }, { delay: i * 160 });
      if (/miss/i.test(m[2]!)) sfx("blow.miss", {}, { delay: i * 160 + 120 });
    });
    const landed = blows.length ? 140 : 0;
    for (const line of lines) {
      const roll = /^Damage(?: to things in it)?: .* (\w+)(?: \(things don't dodge\))?$/i.exec(line);
      if (roll) { kind = roll[1]!.toLowerCase(); continue; }
      const dmg = /^(.+?) takes? (\d+)(?: (\w+))? damage/i.exec(line);
      const heal = /^(.+?) regains? (\d+) HP/i.exec(line);
      const immune = /^(.+?): unharmed by the (\w+)/i.exec(line);
      const name = dmg?.[1] ?? heal?.[1] ?? immune?.[1];
      const e = name ? whoIs(world, name, aliases) : undefined;
      const p = e ? positionOf(world, e.id) : undefined;
      if (!p) continue;
      if (dmg) {
        const type = (dmg[3] ?? (kind || "bludgeoning")).toLowerCase();
        this.effects.float({ ...p }, dmg[2]!, { damage: type }, t + n * 90);
        this.floated.add(e!.id);
        if (!spell) sfx("blow.hit", { kind: type, critical }, { delay: landed + n * 90 });
      }
      else if (heal) { this.effects.float({ ...p }, `+${heal[2]}`, { damage: "heal" }, t + n * 90); if (!spell) sfx("spell.heal", {}, { delay: n * 90 }); }
      else this.effects.float({ ...p }, "unharmed", { style: "info", color: "#a8a49c" }, t + n * 90);
      n++;
    }
    return n;
  }

  /**
   * The player's spells, from the rules' lines ("Cast Fireball (3rd-level slot): a 20-foot sphere
   * on the old elm, catching ...", "Cast Fire Bolt (cantrip) on the talking Crake"): an effect from
   * the caster to the aim, by the spell's shape and what it does (its damage line says the element).
   * A ball of fire for fire in an area, a bolt for a single target, lightning, a shockwave for
   * thunder, a sparkle for healing and for spells that do no damage. Returns how many it played.
   */
  spellsFrom(world: SceneWorld, lines: string[], t: number, aliases: Record<string, string> = {}): number {
    let n = 0;
    lines.forEach((line, i) => {
      const cast = /^Cast (.+?) \(([^)]*)\)(?::\s*a (\d+)-foot (\w+)(?: (on|towards) (.+?))?(?:, catching .*)?| on (.+))?$/.exec(line);
      const caster = positionOf(world, "player");
      if (!cast || !caster) return;
      const [, spell = "", , size, shape, way, aimName, targets] = cast;
      // What it did, from the lines that follow it (up to the next spell).
      const after: string[] = [];
      for (const l of lines.slice(i + 1)) { if (/^Cast /.test(l)) break; after.push(l); }
      const element = after.map(l => /^Damage(?: to things in it)?: .* (\w+)(?: \(things don't dodge\))?$/i.exec(l)?.[1]?.toLowerCase()).find(Boolean)
        ?? (after.some(l => /darts at /i.test(l)) ? "force" : spellElement(spell));
      const heals = element === "heal" || after.some(l => /regains? \d+ HP/i.test(l));
      const target = (aimName ?? targets?.split(", ")[0]) ? whoIs(world, (aimName ?? targets!.split(", ")[0])!, aliases) : undefined;
      const aim = target ? positionOf(world, target.id) : undefined;
      const color = ELEMENTS[element ?? ""] ?? "#c79bf2";
      const at = (p: Point | undefined) => (p ? { ...p } : { ...caster });
      const its = element ? { element } : {};
      sfx("spell.cast", its);
      if (size && shape) {
        const feet = Number(size);
        // From the caster (a cone, a cube, a line) it fills the space towards the aim; aimed, it lands there.
        const centre = way === "towards" && aim ? along(caster, aim, Math.min(feet / 2, Math.hypot(aim.x - caster.x, aim.y - caster.y))) : at(aim);
        if (element === "fire") {
          const flight = this.effects.effect("fireball", { ...(way === "towards" ? {} : { from: { ...caster } }), at: centre, radius: way === "towards" ? feet / 2 : feet }, t).lands - t;
          if (flight > 0) sfx("spell.bolt", { ...its, ms: flight });
          sfx("spell.area", { ...its, size: feet }, { delay: flight });
        }
        else if (element === "lightning") { this.effects.effect("lightning", { from: { ...caster }, to: at(aim) }, t); sfx("spell.hit", its); }
        else if (element === "thunder") { this.effects.effect("shockwave", { at: centre, radius: feet, color }, t); sfx("spell.area", { ...its, size: feet }); }
        else { this.effects.effect("shockwave", { at: centre, radius: feet, color }, t); this.effects.effect("flash", { at: centre, radius: feet / 2, color }, t); sfx("spell.area", { ...its, size: feet }); }
      } else if (heals) { this.effects.effect("sparks", { at: at(aim), color: ELEMENTS.heal! }, t); sfx("spell.heal"); }
      else if (aim && element === "lightning") { this.effects.effect("lightning", { from: { ...caster }, to: { ...aim } }, t); sfx("spell.hit", its); }
      else if (aim && element) {
        // Magic Missile is three darts; anything else one bolt.
        const darts = /missile/i.test(spell) ? 3 : 1;
        for (let k = 0; k < darts; k++) {
          const lands = this.effects.effect("bolt", { from: { ...caster }, to: { ...aim }, color, delay: k * 140 }, t).lands - t;
          sfx("spell.bolt", { ...its, ms: lands - k * 140 }, { delay: k * 140 });
          sfx("spell.hit", its, { delay: lands });
        }
      } else { this.effects.effect("sparks", { at: at(aim), color }, t); sfx("spell.hit", its); }
      n++;
    });
    return n;
  }

  /** A short line someone said, over their head (a cast member's line from a voiced reply). */
  barkLine(world: SceneWorld, id: string, text: string, t: number, maxChars = 60): boolean {
    const e = world.entities[id];
    if (!e || e.states.includes("gone")) return false;
    const quoted = /[“"]([^”"]{2,200})[”"]/.exec(text)?.[1];
    const line = (quoted ?? /^[^.!?]*[.!?]/.exec(text.trim())?.[0] ?? text).trim();
    if (!line || line.length > maxChars) return false;
    this.effects.bark(id, line, {}, t);
    return true;
  }

  /**
   * Barks from a reply whose speakers are known (the GM tagged them, or the transcript worked them
   * out: src/runtime/markup.ts): each short line over whoever said it, the first line of each.
   */
  barksFromSpeech(world: SceneWorld, lines: Array<{ speaker?: string | undefined; text: string }>, t: number, maxChars = 60): Array<{ id: string; text: string }> {
    const out: Array<{ id: string; text: string }> = [];
    for (const line of lines) {
      const id = line.speaker;
      const e = id ? world.entities[id] : undefined;
      if (!id || !e || e.player || e.states.includes("gone") || out.some(o => o.id === id)) continue;
      const text = line.text.replace(/^[“"]|[”"]$/g, "").trim().replace(/[,;:]+$/, "");
      if (text.length < 2 || text.length > maxChars) continue;
      out.push({ id, text });
    }
    out.forEach((b, i) => this.effects.bark(b.id, b.text, {}, t + i * 700));
    return out;
  }
}

/** A spell's colour by what it does (Cogmind and Brogue: colour carries the kind). */
export const ELEMENTS: Record<string, string> = {
  fire: "#ffa040", cold: "#bfefff", lightning: "#e8f0ff", thunder: "#a0a8ff", acid: "#b0f040", poison: "#8fdc3a",
  necrotic: "#9a7ab0", radiant: "#ffe680", force: "#d07aff", psychic: "#f08ad0", heal: "#6ae07a",
};

/** What a spell does by its name, for when the lines don't say (it missed, or does no damage). */
const SPELL_ELEMENTS: Array<[RegExp, string]> = [
  [/fire|flame|burning|scorching|hellish/i, "fire"], [/frost|cold|\bice\b|freez/i, "cold"], [/lightning|shock|witch bolt/i, "lightning"],
  [/thunder|shatter/i, "thunder"], [/acid/i, "acid"], [/poison/i, "poison"], [/chill touch|necrot|blight|inflict/i, "necrotic"],
  [/sacred|radiant|guiding|sunbeam/i, "radiant"], [/eldritch|missile/i, "force"], [/mockery|psychic/i, "psychic"], [/cure|heal/i, "heal"],
];
export const spellElement = (name: string): string | undefined => SPELL_ELEMENTS.find(([re]) => re.test(name))?.[1];

/** Someone or something named in the rules' lines: "You", what the player calls them (an alias), or by name. */
function whoIs(world: SceneWorld, name: string, aliases: Record<string, string>): Entity | undefined {
  const key = name.trim().toLowerCase().replace(/^the /, "");
  if (key === "you" || key === "your") return world.entities.player;
  for (const [id, alias] of Object.entries(aliases)) if (alias.toLowerCase().replace(/^the /, "") === key && world.entities[id]) return world.entities[id];
  return select(world, name.trim().replace(/^the /i, ""))[0] ?? select(world, name.trim())[0];
}

/** A point some feet along the way from one point towards another. */
function along(from: Point, to: Point, feet: number): Point {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / d) * feet, y: from.y + ((to.y - from.y) / d) * feet };
}

function snapshot(world: SceneWorld): Map<string, Seen> {
  const out = new Map<string, Seen>();
  for (const e of Object.values(world.entities)) {
    if (e.kind === "place") continue;
    const at = e.kind === "area" ? undefined : positionOf(world, e.id);
    out.set(e.id, { ...(at ? { at: { ...at } } : {}), states: [...e.states].sort().join("|"), parent: e.parent, present: !e.states.includes("gone"), ...(e.hp ? { hp: e.hp.current } : {}) });
  }
  // Areas: their centre, for explosions and fires in them.
  for (const e of Object.values(world.entities)) if (e.kind === "area" && e.rect) out.get(e.id)!.at = { x: e.rect.x + e.rect.w / 2, y: e.rect.y + e.rect.h / 2 };
  return out;
}

function nearestBurning(world: SceneWorld, id: string): Vec | undefined {
  const p = positionOf(world, id);
  if (!p) return undefined;
  let best: Vec | undefined, bd = Infinity;
  for (const e of Object.values(world.entities)) {
    if (e.id === id || !e.states.includes("burning") || e.kind === "area") continue;
    const q = positionOf(world, e.id);
    if (!q) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd && d > 0.5) { bd = d; best = { ...q }; }
  }
  return best;
}
