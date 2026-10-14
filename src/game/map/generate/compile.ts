import type { ThingSpec, WorldSpec } from "../../../world/scene-world.ts";
import type { Tile2, TileMap } from "../../types.ts";
import type { MapDef, PlaceRegion } from "../tiles.ts";
import { furnish, type Furnished } from "./furnish.ts";
import { layout, type Rect, type Site } from "./layout.ts";
import { normalizePlan, type Problem } from "./normalize.ts";
import { chooseTurn, sayBack, turnPlan, type Turn } from "./orient.ts";
import type { PlacePlan } from "./plan.ts";

/**
 * The compiler: a semantic plan in, a place out, deterministically. The plan is cleaned
 * (normalize.ts), turned to face the camera (orient.ts), laid out (layout.ts) and furnished
 * (furnish.ts); out come a TileMap (what buildMap makes from a hand-drawn grid), a WorldSpec lined
 * up with it (the world's (0, 0) feet is the map's tile (0, 0), 5 ft to a tile) and the scene's
 * region, so the rest of the game can use it like a hand-made place (install.ts puts it in play).
 */

export interface CompileOptions {
  /** The map's id: unique among the game's maps (and the scene region's id). */
  id: string;
  /** The scene played here, if any. */
  sceneId?: string;
  /** Where the street leads: exits on the street's edge squares. */
  exitTo?: { map: string; at: Tile2; label?: string };
}

export interface CompiledPlace {
  id: string;
  /** The plan as the model wrote it, cleaned (its compass). */
  plan: PlacePlan;
  /** The plan turned to face the camera: the compass of the map. */
  laid: PlacePlan;
  turn: Turn;
  def: MapDef;
  map: TileMap;
  region: PlaceRegion;
  world: WorldSpec;
  /** The plan's people, as a cast for buildWorld. */
  cast: Array<{ id: string; name: string }>;
  site: Site;
  furnished: Furnished;
  /** What compiling found wrong with the plan (in the plan's compass). */
  problems: Problem[];
  /** What the compiler fixed by itself. */
  notes: string[];
}

export const FEET = 5;
/** A tile's spot in the world's feet (near its middle; whole feet, as the authored worlds use). */
export const feetOf = (p: Tile2): [number, number] => [p.x * FEET + 2, p.y * FEET + 2];
const feetRect = (r: Rect) => ({ x: r.x * FEET, y: r.y * FEET, w: r.w * FEET, h: r.h * FEET });

export function compilePlan(raw: PlacePlan, options: CompileOptions): CompiledPlace {
  const { plan, problems: planProblems } = normalizePlan(raw);
  const entrance = plan.doors.find(d => plan.outside.some(o => o.id === d.to) && (d.to === plan.start || d.from === plan.start))?.to
    ?? plan.doors.find(d => plan.outside.some(o => o.id === d.to))?.to ?? plan.start;
  const turn = chooseTurn(plan, entrance);
  const laid = turnPlan(plan, turn);
  const site = layout(laid);
  const furnished = furnish(site, laid);
  const { width, height } = site;

  // The map: the scene's region over the whole place, then each room and outside area.
  const id = options.id;
  const regions: PlaceRegion[] = [
    {
      id, name: plan.name, rect: { x: 0, y: 0, w: width, h: height }, worldOrigin: { x: 0, y: 0 },
      ...(options.sceneId ? { sceneId: options.sceneId } : {}), trigger: "enter", label: `Go into ${plan.name}`, description: plan.description,
    },
    ...[...site.areas.values()].map(a => ({ id: `${id}-${a.id}`, name: a.name, rect: a.rect, ...(a.description ? { description: a.description } : {}) })),
  ];
  const exits = options.exitTo ? site.exits.map(at => ({ at, to: { map: options.exitTo!.map, at: options.exitTo!.at }, label: options.exitTo!.label ?? "Back the way you came" })) : [];
  const map: TileMap = { id, name: plan.name, width, height, tiles: site.tiles, regions, exits };
  const region = regions[0]!;

  // The world, in feet from the map's corner.
  const things: ThingSpec[] = [];
  for (const d of site.doors) {
    things.push({
      id: d.id, name: d.plan.name, kind: "feature", in: d.from, at: feetOf(d.at), size: "large", material: "wood", tags: ["door"],
      states: [...d.plan.states], ...(d.plan.description ? { description: d.plan.description } : {}),
    });
  }
  for (const t of laid.things) {
    const p = furnished.things.get(t.id);
    if (!p) continue;
    // The world says what the map should draw: a long fixture or the ground is a feature (drawn as
    // terrain); a huge thing is spread over its three squares only if it was given three.
    const big = t.size === "huge" || t.size === "gargantuan";
    const kind = t.kind === "crowd" ? "person" as const : p.run || p.terrain ? "feature" as const : p.spread ? "object" as const : t.kind;
    const size = p.spread ? "huge" as const : big && !p.run && !p.terrain ? "large" as const : t.size;
    const tags = [...new Set([...t.tags, ...(p.aloft ? ["overhead"] : [])])];
    const states = p.states ?? t.states;
    things.push({
      id: t.id, name: t.name, kind, in: p.heldBy ?? p.area, ...(p.anchor && !p.heldBy ? { at: feetOf(p.anchor) } : {}),
      size, material: t.material, ...(tags.length ? { tags } : {}), ...(states.length ? { states: [...states] } : {}),
      ...(t.description ? { description: t.description } : {}),
    });
  }
  const people: WorldSpec["people"] = { player: { in: furnished.startArea, at: feetOf(furnished.start) } };
  for (const person of laid.people) {
    const p = furnished.people.get(person.id);
    if (p?.anchor) people[person.id] = { in: p.area, at: feetOf(p.anchor), ...(person.note ? { note: person.note } : {}) };
  }
  const world: WorldSpec = {
    name: plan.name,
    description: plan.description,
    size: { w: width * FEET, h: height * FEET },
    areas: [...site.areas.values()].map(a => ({
      id: a.id, name: a.name, rect: feetRect(a.rect), ...(a.description ? { description: a.description } : {}),
      ...(a.room ? {} : { tags: ["outside"] }),
    })),
    things,
    people,
  };

  const problems = [...planProblems, ...site.problems, ...furnished.problems].map(p => ({ ...p, message: sayBack(turn, p.message) }));
  return {
    id, plan, laid, turn, def: { map, decor: [] }, map, region, world,
    cast: laid.people.map(p => ({ id: p.id, name: p.name })),
    site, furnished, problems, notes: [...site.notes, ...furnished.notes].map(n => sayBack(turn, n)),
  };
}
