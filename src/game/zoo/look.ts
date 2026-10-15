import type { SceneWorld } from "../../world/scene-world.ts";
import { Director } from "../look/director.ts";
import { Effects, type EffectKind, type EffectOptions } from "../look/effects.ts";
import type { Anchor, Cue, News } from "./model.ts";

/**
 * Playing what the zoo's exhibits do, on a view's effects: the rules' lines go to the director as
 * a scene's do (spells from the caster, damage numbers over the hurt), what changed in the wing's
 * world is animated by it (fires catching, splashes, debris, puffs), and the cues are played as
 * they are (a goose's "!", a thrown ball). The app plays each piece of news once; the tour plays it
 * on effects that remember what they played, to say what each exhibit showed.
 */

export interface Look { fx: Effects; director: Director; world: SceneWorld }

/** Effects that keep a list of what they were asked to play (for the tour's report). */
export class RecordingEffects extends Effects {
  played: Array<{ kind: string; t: number }> = [];
  effect(kind: EffectKind, opts: EffectOptions = {}, when?: number): { duration: number; endsAt: number } {
    this.played.push({ kind, t: when ?? this.now() });
    return super.effect(kind, opts, when);
  }
  float(at: Parameters<Effects["float"]>[0], text: string, opts: Parameters<Effects["float"]>[2] = {}, when?: number): void {
    this.played.push({ kind: `float:${opts.damage === "heal" || text.startsWith("+") ? "heal" : text === "unharmed" ? "unharmed" : opts.damage ? "damage" : "text"}`, t: when ?? this.now() });
    super.float(at, text, opts, when);
  }
  bark(id: string, text: string, opts: Parameters<Effects["bark"]>[2] = {}, when?: number): void {
    this.played.push({ kind: "bark", t: when ?? this.now() });
    super.bark(id, text, opts, when);
  }
  alert(id: string, opts: Parameters<Effects["alert"]>[1] = {}, when?: number): void {
    this.played.push({ kind: "alert", t: when ?? this.now() });
    super.alert(id, opts, when);
  }
}

/** A look for a wing's world: one Effects and one Director, primed on the world as it is (what's there isn't news). */
export function lookFor(world: SceneWorld, fx: Effects = new Effects()): Look {
  const director = new Director(fx);
  director.prime(world);
  return { fx, director, world };
}

const anchor = (a: Anchor | undefined) => (a ? ("id" in a ? { id: a.id } : { x: a.x, y: a.y }) : undefined);

/** Play a piece of news at time t: the spells and numbers its lines say, what changed in the world, then its cues. */
export function playNews(look: Look, news: Pick<News, "lines" | "cues">, t: number): string[] {
  const { fx, director, world } = look;
  director.spellsFrom(world, news.lines, t);
  director.rulesLines(world, news.lines, t);
  const did = director.observe(world, t);
  for (const cue of news.cues) did.push(...playCue(fx, director, world, cue, t));
  return did;
}

function playCue(fx: Effects, director: Director, world: SceneWorld, cue: Cue, t: number): string[] {
  switch (cue.kind) {
    case "effect": {
      const o: EffectOptions = {
        ...(cue.at ? { at: anchor(cue.at)! } : {}), ...(cue.from ? { from: anchor(cue.from)! } : {}), ...(cue.to ? { to: anchor(cue.to)! } : {}),
        ...(cue.radius !== undefined ? { radius: cue.radius } : {}), ...(cue.color ? { color: cue.color } : {}), ...(cue.glyph ? { glyph: cue.glyph } : {}),
        ...(cue.amount !== undefined ? { amount: cue.amount } : {}), ...(cue.delay !== undefined ? { delay: cue.delay } : {}),
      };
      // Effects follow ids in their paths, but a projectile needs places: look them up now.
      for (const k of ["from", "to"] as const) { const a = o[k]; if (a && "id" in a) { const p = director.positionAt(world, a.id, t); if (p) o[k] = { ...p }; } }
      fx.effect(cue.effect, o, t);
      return [cue.effect];
    }
    case "float": fx.float(anchor(cue.at)!, cue.text, { ...(cue.damage ? { damage: cue.damage } : {}), ...(cue.style ? { style: cue.style } : {}), ...(cue.color ? { color: cue.color } : {}), ...(cue.delay !== undefined ? { delay: cue.delay } : {}) }, t); return [`float ${cue.text}`];
    case "bark": fx.bark(cue.id, cue.text, cue.delay !== undefined ? { delay: cue.delay } : {}, t); return [`bark ${cue.text}`];
    case "alert": fx.alert(cue.id, cue.delay !== undefined ? { delay: cue.delay } : {}, t); return ["alert"];
    case "narration": return director.barksFrom(world, cue.text, t, cue.called ?? {}).map(b => `bark ${b.text}`);
    case "line": return director.barkLine(world, cue.id, cue.text, t) ? [`bark ${cue.text}`] : [];
  }
}
