import { positionOf, select, type Point, type SceneWorld } from "../../world/scene-world.ts";
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
 *   - and, given the rules' lines, floats the damage numbers ("12" in fire orange over the table).
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
  }

  /** Animate what changed since last time. Returns a line per thing it animated (for logs and tests). */
  observe(world: SceneWorld, t: number): string[] {
    const now = snapshot(world);
    const did: string[] = [];
    const fx = this.effects;
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
          if (burning) fx.effect("ignite", { at: { ...pos }, radius: e.radius ?? 3, flame: e.tags.includes("spirits") ? "blue" : "fire" }, t);
          else if (liquid) fx.effect("splash", { at: { ...pos }, radius: Math.min(5, e.radius ?? 3), color: liquid[1], amount: 0.7 }, t);
          did.push(`${e.name} spreads`);
          continue;
        }
        fx.effect(burning ? "ignite" : "poof", { at: { ...pos }, radius: 2 }, t);
        did.push(`${e.name} appears`);
        continue;
      }
      if (before.present && !cur.present) {
        if (before.at && e.kind !== "surface") fx.effect("poof", { at: { ...before.at }, radius: 2 }, t);
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
        if (before.hp !== undefined && cur.hp !== undefined && cur.hp < before.hp && pos) fx.float({ ...pos }, String(before.hp - cur.hp), { damage: "bludgeoning" }, t);
        continue;
      }
      const was = new Set(before.states.split("|")), is = new Set(cur.states.split("|"));
      const gained = [...is].filter(s => s && !was.has(s)), lost = [...was].filter(s => s && !is.has(s));
      if (!pos) continue;
      const at = { ...pos };
      const look = lookOf(e, {});
      const size = e.kind === "surface" ? e.radius ?? 3 : { tiny: 1.5, small: 2.5, medium: 3.5, large: 5, huge: 8, gargantuan: 12 }[e.size ?? "medium"] ?? 3;
      if (gained.includes("exploded")) { fx.effect("explosion", { at, radius: Math.max(10, size * 2) }, t); did.push(`${e.name} explodes`); }
      if (gained.includes("burning") && !gained.includes("exploded")) { fx.effect("ignite", { at, radius: size, flame: look.flame ?? "fire" }, t); did.push(`${e.name} catches fire`); }
      if (gained.includes("wet") || gained.includes("soaked")) {
        const doused = lost.includes("burning") || was.has("burning");
        fx.effect(doused ? "douse" : "splash", { at, radius: Math.max(3, size) }, t);
        did.push(doused ? `${e.name} is doused` : `${e.name} is soaked`);
      } else if (lost.includes("burning") && !is.has("destroyed")) {
        fx.effect("steam", { at, radius: size * 0.6 }, t);
        did.push(`${e.name} goes out`);
      }
      if (gained.includes("destroyed")) {
        fx.effect("debris", { at, radius: size, ...(is.has("burning") || is.has("smouldering") ? { color: "#3a2c24" } : {}) }, t);
        if (is.has("burning") || is.has("smouldering")) fx.effect("smoke", { at, radius: size * 0.7 }, t + 120);
        did.push(`${e.name} is destroyed`);
      }
      if (gained.includes("frozen")) { fx.effect("sparks", { at, color: "#cfefff" }, t); did.push(`${e.name} freezes`); }
      if (gained.includes("dead")) { fx.effect("splash", { at, radius: 2.5, color: "#a01818" }, t); did.push(`${e.name} falls dead`); }
      else if (gained.some(s => s === "unconscious" || s === "prone" || s === "down")) { fx.effect("poof", { at, radius: 1.5 }, t); did.push(`${e.name} goes down`); }
      if (gained.includes("hidden")) fx.effect("poof", { at, radius: 1.5 }, t);
      if (gained.includes("fallen")) fx.effect("poof", { at, radius: 2 }, t);
    }
    // The world's own log, for what states alone don't say (where a fire spread from).
    for (const entry of world.log.slice(this.logSeen)) {
      const spread = /^fire spread to (.+)$/.exec(entry.text);
      if (spread) {
        const target = select(world, spread[1]!)[0];
        const to = target ? positionOf(world, target.id) : undefined;
        const from = target ? nearestBurning(world, target.id) : undefined;
        if (to && from) fx.effect("throw", { from, to: { ...to }, glyph: "*", color: "#ffa030" }, t);
      }
    }
    this.logSeen = world.log.length;
    this.seen = now;
    return did;
  }

  /**
   * Float the numbers from the rules' lines ("The long table takes 7 fire damage", "...: unharmed
   * by the fire"). Returns how many it floated.
   */
  rulesLines(world: SceneWorld, lines: string[], t: number): number {
    let n = 0;
    for (const line of lines) {
      const dmg = /^(.+?) takes (\d+) (\w+) damage/i.exec(line);
      const immune = /^(.+?): unharmed by the (\w+)/i.exec(line);
      const name = dmg?.[1] ?? immune?.[1];
      if (!name) continue;
      const e = select(world, name.replace(/^the /i, ""))[0] ?? select(world, name)[0];
      const p = e ? positionOf(world, e.id) : undefined;
      if (!p) continue;
      if (dmg) this.effects.float({ ...p }, dmg[2]!, { damage: dmg[3]!.toLowerCase() }, t + n * 90);
      else this.effects.float({ ...p }, "unharmed", { style: "info", color: "#a8a49c" }, t + n * 90);
      n++;
    }
    return n;
  }

  /**
   * Barks from a GM reply: short quoted lines, put over whoever the reply says is speaking (the
   * nearest name before the quote). A heuristic: good enough for "Oi!" and "No credit."
   */
  barksFrom(world: SceneWorld, reply: string, t: number, maxChars = 60): Array<{ id: string; text: string }> {
    const people = Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !e.states.includes("gone"));
    const out: Array<{ id: string; text: string }> = [];
    const quote = /[“"]([^”"]{2,200})[”"]/g;
    let m: RegExpExecArray | null;
    while ((m = quote.exec(reply))) {
      const text = m[1]!.trim();
      if (text.length > maxChars) continue;
      const before = reply.slice(Math.max(0, m.index - 160), m.index).toLowerCase();
      const after = reply.slice(m.index + m[0].length, m.index + m[0].length + 60).toLowerCase();
      let best: { id: string; at: number } | undefined;
      for (const p of people) {
        const names = [p.name.toLowerCase(), ...p.name.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !/^(the|sergeant|corporal|master|mister|big)$/.test(w))];
        for (const n of names) {
          const i = before.lastIndexOf(n);
          if (i >= 0 && (!best || i > best.at)) best = { id: p.id, at: i };
          if (after.includes(n) && /\b(said|says|shouts|calls|mutters|snaps|adds|asks|cries|yells)\b/.test(after) && !best) best = { id: p.id, at: 0 };
        }
      }
      if (best && !out.some(o => o.id === best!.id)) out.push({ id: best.id, text });
    }
    out.forEach((b, i) => this.effects.bark(b.id, b.text, {}, t + i * 700));
    return out;
  }
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
