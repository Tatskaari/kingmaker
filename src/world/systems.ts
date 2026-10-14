import { rng } from "../runtime/dice.ts";
import { areaAt, damageThing, distance, heldBy, positionOf, type Entity, type Point, type SceneWorld } from "./scene-world.ts";

/**
 * The world's physics, BG3-style (docs/Kingmaker gameplay.txt): a few verbs that work everywhere
 * (ignite, douse, spill, chill, bleed, break open) and the rules for how materials and surfaces
 * answer them. The rules call them (a Fireball ignites what's in its sphere, oil slicks included),
 * the stage manager calls them for what the story did (a bucket of water over a burning table), and
 * the map draws what they leave. Small on purpose: fire, water, oil, spirits, ale, blood, grease,
 * ice, smoke and steam, on wood, cloth, paper, leather, metal, stone and glass.
 *
 * Surfaces are entities too (kind "surface"): a patch on the ground with a radius, in an area.
 */

export type Liquid = "water" | "oil" | "spirits" | "ale" | "blood" | "grease";
const LIQUIDS: Liquid[] = ["water", "oil", "spirits", "ale", "blood", "grease"];
const FLAMMABLE = new Set<string>(["oil", "spirits", "grease"]);
/** How many turns a burning patch burns before it's burned away. */
const BURNS_FOR: Record<string, number> = { oil: 4, spirits: 2, grease: 3 };
const NAMES: Record<string, string> = {
  water: "a puddle of water", oil: "a slick of oil", spirits: "a pool of spilled spirits", ale: "a puddle of ale",
  blood: "a pool of blood", grease: "a patch of grease", ice: "a sheet of ice", ash: "a scorch mark", smoke: "a cloud of smoke", steam: "a cloud of steam",
};
const NONBURNING = new Set(["iron", "steel", "brass", "silver", "stone", "glass", "crystal", "ice", "liquid"]);

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const live = (e: Entity) => !e.states.includes("gone");
const isSurface = (e: Entity) => e.kind === "surface";
const log = (world: SceneWorld, turn: number, text: string) => world.log.push({ turn, text, by: "rules" });
const freshId = (world: SceneWorld, base: string) => { let id = base; for (let n = 2; world.entities[id]; n++) id = `${base}-${n}`; return id; };

export function surfacesAt(world: SceneWorld, p: Point, pad = 0): Entity[] {
  return Object.values(world.entities).filter(e => isSurface(e) && live(e) && e.at && distance(e.at, p) <= (e.radius ?? 2) + pad);
}

/** The liquid a surface or container is (by its tags). */
export function liquidOf(e: Entity): Liquid | undefined {
  return LIQUIDS.find(l => e.tags.includes(l)) ?? (e.tags.includes("liquid") ? (/(ale|beer|stout)/i.test(e.name) ? "ale" : /(gin|brandy|rum|spirit|whisk)/i.test(e.name) ? "spirits" : /oil|lamp/i.test(e.name) ? "oil" : "water") : undefined);
}

/** Pour or spill a liquid at a spot: it joins a like puddle there, or makes one, and meets what's already there. */
export function spill(world: SceneWorld, liquid: Liquid | "ice" | "ash" | "smoke" | "steam", at: Point, radius: number, turn: number): { lines: string[]; surface: Entity } {
  const lines: string[] = [];
  const same = surfacesAt(world, at, 2).find(s => s.tags.includes(liquid));
  let surface: Entity;
  if (same) {
    same.radius = Math.min(15, Math.max(same.radius ?? 2, radius) + 1);
    surface = same;
  } else {
    const id = freshId(world, liquid === "smoke" || liquid === "steam" ? `${liquid}-cloud` : `${liquid}-${liquid === "ash" ? "mark" : "pool"}`);
    surface = {
      id, name: NAMES[liquid] ?? `a patch of ${liquid}`, kind: "surface", parent: areaAt(world, at).id, at: { ...at }, radius, material: "liquid",
      tags: [liquid, ...(FLAMMABLE.has(liquid) ? ["flammable"] : []), ...(liquid === "ice" || liquid === "grease" ? ["slick"] : []), ...(liquid === "smoke" || liquid === "steam" ? ["cloud"] : [])],
      states: [], notes: [], created: turn,
      ...(liquid === "water" ? { ttl: 20 } : liquid === "smoke" ? { ttl: 3 } : liquid === "steam" ? { ttl: 2 } : {}),
    };
    world.entities[id] = surface;
  }
  log(world, turn, `${surface.name} spreads at ${areaAt(world, at).name}`);
  // What it meets: water puts out what's burning; oil or spirits onto a fire catch.
  const burningHere = [...surfacesAt(world, at, radius).filter(s => s !== surface && s.states.includes("burning")),
    ...Object.values(world.entities).filter(e => !isSurface(e) && live(e) && e.states.includes("burning") && positionOf(world, e.id) && distance(positionOf(world, e.id)!, at) <= radius && !heldBy(world, e))];
  if (liquid === "water" && burningHere.length) for (const b of burningHere) lines.push(...douse(world, b, turn, { puddle: false }));
  if (FLAMMABLE.has(liquid) && burningHere.length && !surface.states.includes("burning")) lines.push(...ignite(world, surface, turn));
  return { lines, surface };
}

/** Set something alight, if it can burn: wet things steam, metal and stone take a scorch, oil and spirits go up. */
export function ignite(world: SceneWorld, target: Entity, turn: number): string[] {
  if (!live(target) || target.states.includes("burning")) return [];
  if (isSurface(target)) {
    if (!target.tags.some(t => FLAMMABLE.has(t))) {
      if (target.tags.includes("water") || target.tags.includes("ice")) return [`${capital(target.name)} hisses`];
      return [];
    }
    target.states.push("burning");
    target.ttl = BURNS_FOR[target.tags.find(t => FLAMMABLE.has(t))!] ?? 3;
    log(world, turn, `${target.name} catches fire`);
    return [`${capital(target.name)} catches fire`];
  }
  if (target.kind === "person" || target.kind === "creature") return [];
  if (target.states.includes("wet")) return [`${capital(target.name)} steams, but it's too wet to catch`];
  if (target.states.includes("oiled")) {
    // Oil burns on anything, even metal, until it's burned off.
    target.states = [...target.states.filter(s => s !== "oiled"), "burning"];
    target.ttl = 2;
    log(world, turn, `the oil on ${target.name} catches fire`);
    return [`The oil on ${target.name} catches fire`];
  }
  if (!target.tags.includes("flammable") || (target.material && NONBURNING.has(target.material))) {
    if (!target.states.includes("scorched")) target.states.push("scorched");
    return [`The flames lick ${target.name} and die: it's scorched, not burning`];
  }
  target.states.push("burning");
  log(world, turn, `${target.name} catches fire`);
  return [`${capital(target.name)} catches fire`];
}

/** Water over something (a bucket, a spell, the river): fire out, wet and scorched, a puddle underneath and a puff of steam. */
export function douse(world: SceneWorld, target: Entity, turn: number, options: { puddle?: boolean } = {}): string[] {
  const lines: string[] = [];
  const at = positionOf(world, target.id);
  if (isSurface(target)) {
    if (target.states.includes("burning") && target.tags.includes("oil")) {
      // Water on an oil fire spreads it: the oil floats and keeps burning.
      target.radius = Math.min(15, (target.radius ?? 2) + 3);
      log(world, turn, `water on ${target.name} spreads the burning oil`);
      return [`Water on the burning oil spreads it: ${target.name} is wider, and still burning`];
    }
    if (target.states.includes("burning")) {
      target.states = target.states.filter(s => s !== "burning");
      delete target.ttl;
      lines.push(`${capital(target.name)} is put out in a hiss of steam`);
      if (at) spill(world, "steam", at, 4, turn);
    }
    return lines;
  }
  if (target.states.includes("burning")) {
    target.states = target.states.filter(s => s !== "burning");
    if (!target.states.includes("scorched") && !target.states.includes("destroyed")) target.states.push("scorched");
    lines.push(`${capital(target.name)} is put out in a hiss of steam: scorched and dripping`);
    log(world, turn, `${target.name} was put out`);
    if (at) spill(world, "steam", at, 4, turn);
  }
  if (!target.states.includes("wet")) target.states.push("wet");
  if (options.puddle !== false && at && !heldBy(world, target)) spill(world, "water", at, Math.max(2, Math.round(((target.size === "large" || target.size === "huge") ? 5 : 3))), turn);
  return lines.length ? lines : [`${capital(target.name)} is soaked`];
}

/** Cold: water freezes to ice, fires go out, liquids frost over. */
export function chill(world: SceneWorld, target: Entity, turn: number): string[] {
  if (isSurface(target) && target.tags.includes("water")) {
    target.tags = [...target.tags.filter(t => t !== "water"), "ice", "slick"];
    target.name = NAMES.ice!;
    delete target.ttl;
    log(world, turn, `a puddle froze to ice`);
    return ["The water freezes to a sheet of ice"];
  }
  if (target.states.includes("burning")) { target.states = target.states.filter(s => s !== "burning"); return [`${capital(target.name)} is put out by the cold`]; }
  if (target.material === "liquid" && !target.states.includes("frozen")) { target.states.push("frozen"); return [`${capital(target.name)} freezes`]; }
  return [];
}

/** Someone hurt badly or killed: blood on the ground where they are. */
export function bleed(world: SceneWorld, who: Entity, turn: number, heavy = true): string[] {
  const at = positionOf(world, who.id);
  if (!at) return [];
  if (!who.states.includes("bloodied")) who.states.push("bloodied");
  spill(world, "blood", at, heavy ? 3 : 1, turn);
  return [];
}

/** A broken container spills what was in it (fire sets a flammable spill alight). */
export function breakOpen(world: SceneWorld, target: Entity, turn: number, cause?: string): string[] {
  const liquid = liquidOf(target);
  const at = positionOf(world, target.id);
  if (!liquid || !at) return [];
  const radius = target.size === "large" || target.size === "huge" ? 6 : target.size === "medium" ? 4 : 2;
  const { lines, surface } = spill(world, liquid, at, radius, turn);
  lines.unshift(`${capital(target.name)} breaks open: ${surface.name} spreads across the floor`);
  if (cause === "fire" && FLAMMABLE.has(liquid)) lines.push(...ignite(world, surface, turn));
  return lines;
}

/** A spell's or a blast's element meeting the surfaces it reaches (damage to things is the rules' job). */
export function elemental(world: SceneWorld, caught: Entity[], type: string, turn: number): string[] {
  const lines: string[] = [];
  for (const e of caught.filter(isSurface)) {
    if (type === "fire" || type === "lightning") lines.push(...ignite(world, e, turn));
    else if (type === "cold") lines.push(...chill(world, e, turn));
  }
  return lines;
}

/** A turn of story time for surfaces: burning patches burn what's on them and spread, puddles put fires out, clouds drift off. */
export function surfaceTick(world: SceneWorld, turn: number, seed: number): string[] {
  const lines: string[] = [];
  const random = rng(seed);
  const d6 = () => 1 + Math.floor(random() * 6);
  for (const s of Object.values(world.entities).filter(e => isSurface(e) && live(e))) {
    const at = s.at!;
    if (s.states.includes("burning")) {
      // What stands in a burning patch burns; flammable patches touching it catch.
      for (const t of Object.values(world.entities).filter(e => !isSurface(e) && live(e) && (e.kind === "object" || e.kind === "item" || e.kind === "feature") && !heldBy(world, e) && positionOf(world, e.id) && distance(positionOf(world, e.id)!, at) <= (s.radius ?? 2))) {
        lines.push(...damageThing(world, t, d6(), "fire", turn));
        if (live(t) && !t.states.includes("destroyed")) lines.push(...ignite(world, t, turn).filter(l => !/scorched, not burning/.test(l)));
      }
      for (const n of surfacesAt(world, at, (s.radius ?? 2) + 2).filter(n => n !== s && n.tags.some(t => FLAMMABLE.has(t)) && !n.states.includes("burning"))) lines.push(...ignite(world, n, turn));
      s.ttl = (s.ttl ?? 3) - 1;
      if (s.ttl <= 0) {
        // Burned away: a scorch mark and some smoke.
        s.states = [...s.states.filter(x => x !== "burning"), "gone"];
        spill(world, "ash", at, s.radius ?? 2, turn);
        spill(world, "smoke", at, (s.radius ?? 2) + 2, turn);
        lines.push(`${capital(s.name)} burns itself out`);
      }
      continue;
    }
    if (s.tags.includes("water")) {
      for (const t of Object.values(world.entities).filter(e => !isSurface(e) && live(e) && e.states.includes("burning") && !heldBy(world, e) && positionOf(world, e.id) && distance(positionOf(world, e.id)!, at) <= (s.radius ?? 2))) lines.push(...douse(world, t, turn, { puddle: false }));
    }
    if (s.ttl !== undefined) {
      s.ttl -= 1;
      if (s.ttl <= 0) { s.states = [...s.states, "gone"]; if (s.tags.includes("cloud")) lines.push(`${capital(s.name)} drifts away`); }
    }
  }
  // Something on fire makes smoke where it stands.
  for (const e of Object.values(world.entities).filter(x => !isSurface(x) && live(x) && x.states.includes("burning"))) {
    const at = positionOf(world, e.id);
    if (at && !surfacesAt(world, at, 1).some(s => s.tags.includes("smoke"))) spill(world, "smoke", at, 3, turn);
  }
  return lines;
}

/** For the GM's brief: what the world can show, so narration stays within it. */
export const PHYSICS = "The world's physics: wood, cloth, paper, rope, leather, oil, grease and spirits burn (fire spreads to what burns nearby, and wrecks smoulder); metal, stone and glass only scorch; wet things won't catch. Water puts fire out and leaves things wet and scorched in a puddle (water on burning oil spreads it). Broken containers spill what they held. Cold freezes water to ice. Serious wounds leave blood. Fire makes smoke. Stay within this: what you narrate happening is what the world will show.";
