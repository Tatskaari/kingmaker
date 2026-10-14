import type { SceneWorld } from "../../world/scene-world.ts";
import { parseName } from "./names.ts";
import { seedOf } from "./noise.ts";
import { surfaceKindOf, type CloudKind, type SurfaceKind } from "./terrain.ts";

/**
 * Surfaces in the world, as the look layer draws them: patches on the ground (water, oil, spirits,
 * blood, ash, char, ice...) under everything, and clouds (smoke, steam, dust) over everything,
 * either of them possibly burning. The world's own model of surfaces (src/world/systems.ts, being
 * written on the PoC branch) may keep them as a list or as entities; this reads both, tolerantly:
 *
 * - world.surfaces: an array of { kind|type|material, at|x,y, radius|size, states } objects;
 * - entities tagged "surface" or "cloud", or named like one ("a pool of blood", "an oil slick",
 *   "spilled gin", "a cloud of steam"), placed where they are, sized by their size.
 */

export interface SurfacePatch {
  id: string;
  kind: SurfaceKind;
  /** Feet. */
  x: number;
  y: number;
  radius: number;
  states: string[];
  seed: number;
}

export interface CloudPatch {
  id: string;
  kind: CloudKind;
  x: number;
  y: number;
  radius: number;
  /** 0..1. */
  density: number;
  seed: number;
}

const SIZE_RADIUS: Record<string, number> = { tiny: 1.5, small: 3, medium: 5, large: 8, huge: 12, gargantuan: 20 };
const CLOUD_WORDS: Array<[RegExp, CloudKind]> = [[/steam|vapou?r/, "steam"], [/smoke|fume|reek|smog/, "smoke"], [/dust|flour|chaff|powder/, "dust"], [/fog|mist|haze/, "fog"], [/poison|gas|miasma|spores/, "poison"]];

export function cloudKindOf(word: string | undefined): CloudKind | undefined {
  if (!word) return undefined;
  for (const [re, kind] of CLOUD_WORDS) if (re.test(word.toLowerCase())) return kind;
  return undefined;
}

interface Loose { [k: string]: unknown }
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** The surfaces and clouds in a world (both kinds of record), with positions in feet. */
export function surfacesOf(world: SceneWorld, locate?: (id: string) => { x: number; y: number } | undefined): { surfaces: SurfacePatch[]; clouds: CloudPatch[] } {
  const surfaces: SurfacePatch[] = [];
  const clouds: CloudPatch[] = [];
  const add = (id: string, name: string, x: number, y: number, radius: number, states: string[], density?: number) => {
    const parsed = parseName(name);
    const cloudy = parsed.surface === "cloud" || parsed.surface === "plume" || parsed.surface === "puff" || parsed.surface === "column" || parsed.surface === "wisp" || parsed.surface === "haze" || parsed.surface === "pall";
    const cloud = cloudy ? cloudKindOf(parsed.head) ?? cloudKindOf(name) ?? "smoke" : cloudKindOf(parsed.head);
    if (cloud && (cloudy || !surfaceKindOf(parsed.head))) { clouds.push({ id, kind: cloud, x, y, radius, density: density ?? 0.85, seed: seedOf(id) }); return; }
    const kind = surfaceKindOf(parsed.contents) ?? surfaceKindOf(parsed.head) ?? surfaceKindOf(name);
    if (kind) surfaces.push({ id, kind, x, y, radius, states: [...new Set([...states, ...parsed.states.filter(s => s === "burning" || s === "frozen")])], seed: seedOf(id) });
  };

  const list = (world as unknown as { surfaces?: unknown }).surfaces;
  if (Array.isArray(list)) {
    list.forEach((raw, i) => {
      const s = raw as Loose;
      const at = (s.at ?? s.position ?? s.centre ?? s.center) as Loose | undefined;
      const x = num(at?.x) ?? num(s.x), y = num(at?.y) ?? num(s.y);
      if (x === undefined || y === undefined) return;
      const name = str(s.kind) ?? str(s.type) ?? str(s.material) ?? str(s.name) ?? "water";
      const radius = num(s.radius) ?? num(s.r) ?? (str(s.size) ? SIZE_RADIUS[str(s.size)!] : undefined) ?? num(s.feet) ?? 4;
      const states = Array.isArray(s.states) ? (s.states as unknown[]).filter((v): v is string => typeof v === "string") : str(s.state) ? [str(s.state)!] : s.burning ? ["burning"] : [];
      add(str(s.id) ?? `surface-${i}`, name, x, y, radius, states, num(s.density));
    });
  }

  for (const e of Object.values(world.entities)) {
    if (e.kind === "place" || e.kind === "area" || e.kind === "person" || e.kind === "creature" || e.states.includes("gone")) continue;
    const name = e.name.toLowerCase();
    const tagged = e.tags.includes("surface") || e.tags.includes("cloud");
    const named = /\b(puddle|pool|slick|spill|spilled|spilt|stain|smear|spatter|splatter|trail|patch|film|sheet of|cloud|plume|puff|column of|wisp|haze|pall)\b/.test(name);
    if (!tagged && !named) continue;
    const p = locate?.(e.id) ?? e.at;
    if (!p) continue;
    const loose = e as unknown as Loose;
    const radius = num(loose.radius) ?? SIZE_RADIUS[e.size ?? "medium"] ?? 5;
    add(e.id, e.name, p.x, p.y, radius, e.states);
  }
  return { surfaces, clouds };
}
