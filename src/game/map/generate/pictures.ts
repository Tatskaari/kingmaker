import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildWorld, type WorldSpec } from "../../../world/scene-world.ts";
import type { MapActor, StoryState, StyledLine, Tile2, TileMap } from "../../types.ts";
import { CAST } from "../looks.ts";
import { scenePlace, regionForScene } from "../places.ts";
import { actorsFromWorld } from "../reconcile.ts";
import { project, render } from "../render.ts";
import { isRoofed, isStructure, tileAt, type PlaceRegion } from "../tiles.ts";
import type { CompiledPlace } from "./compile.ts";

/**
 * Pictures of places, drawn by the game's own renderer (render.ts, as it is): the scene view (the
 * roof off, the rooms people are in opened up, as renderExplore draws a scene) and the view from
 * outside (roofs on, from the street), sized to show the whole map. A hand-made place and a
 * generated one go through the same calls, so they can be put side by side.
 *
 * PNGs: StyledLine JSON is drawn the way a terminal would by tools/preview.py (Adwaita Mono).
 */

export interface Staged {
  name: string;
  map: TileMap;
  region: PlaceRegion;
  actors: MapActor[];
  /** Where the player starts, and the street outside. */
  start: Tile2;
  street: Tile2;
}

const ROWS_UP = 6;

/** A generated place, its world built (people included) and drawn as map actors. */
export function stageCompiled(place: CompiledPlace): Staged {
  const world = buildWorld(place.region.sceneId ?? place.id, place.world, place.cast, { name: "you" });
  const actors = actorsFromWorld(place.region, world, { map: place.map });
  const street = place.site.entrance?.outside ?? place.furnished.start;
  return { name: place.plan.name, map: place.map, region: place.region, actors, start: place.furnished.start, street };
}

/** A hand-made scene place (the Rat, the Heron), its world drawn the same way. */
export function stageHandMade(sceneId: string): Staged {
  const found = regionForScene(sceneId);
  const place = scenePlace(sceneId);
  if (!found || !place) throw new Error(`No place for ${sceneId}`);
  const cast = place.present.map(id => ({ id, name: CAST[id]?.name ?? id }));
  const world = buildWorld(sceneId, place.world as WorldSpec, cast, { name: "you" });
  const actors = actorsFromWorld(found.region, world, { map: found.map });
  const player = actors.find(a => a.kind === "player");
  const start = player?.at ?? { x: found.region.rect.x, y: found.region.rect.y };
  return { name: found.map.name, map: found.map, region: found.region, actors, start, street: outdoors(found.map, start) };
}

/** The nearest square out from under the roof (the Rat's player starts in its doorway). */
function outdoors(map: TileMap, from: Tile2): Tile2 {
  const seen = new Set([`${from.x},${from.y}`]);
  const queue = [from];
  while (queue.length) {
    const p = queue.shift()!;
    const t = tileAt(map, p);
    if (!isRoofed(t) && !isStructure(t) && !t.blocks) return p;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      const k = `${n.x},${n.y}`;
      if (seen.has(k) || n.x < 0 || n.y < 0 || n.x >= map.width || n.y >= map.height) continue;
      const nt = tileAt(map, n);
      if (nt.blocks && nt.terrain !== "door") continue;
      if (nt.terrain === "wall" || nt.terrain === "window" || nt.terrain === "fence") continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return from;
}

/** A camera and viewport that show the whole map (its tallest walls included). */
export function fitView(map: TileMap): { camera: Tile2; viewport: { w: number; h: number } } {
  const camera = { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  const c = project(camera);
  const corners = [{ x: 0, y: 0 }, { x: map.width - 1, y: 0 }, { x: 0, y: map.height - 1 }, { x: map.width - 1, y: map.height - 1 }].map(project);
  const above = Math.max(...corners.map(p => c.row - p.row)) + ROWS_UP + 2, below = Math.max(...corners.map(p => p.row - c.row)) + 3;
  const left = Math.max(...corners.map(p => c.col - p.col)) + 3, right = Math.max(...corners.map(p => p.col - c.col)) + 3;
  const w = 2 * Math.max(left, right) + 2;
  let h = above + below;
  while (Math.floor(h * 0.56) < above || h - Math.floor(h * 0.56) < below) h++;
  return { camera, viewport: { w, h } };
}

export type View = "scene" | "outside";

/** The place as the game would draw it: in its scene (roof off), or from the street (roofs on). */
export function picture(staged: Staged, view: View, time: StoryState["time"], tick = 3): StyledLine[] {
  const { camera, viewport } = fitView(staged.map);
  if (view === "outside") {
    // From the street, where the player arrives: what's inside is under the roof.
    const actors = staged.actors.map(a => (a.kind === "player" ? { ...a, at: staged.street } : a));
    return render(staged.map, actors, camera, viewport, { time, focus: staged.street, tick });
  }
  const reveal = staged.actors.filter(a => a.kind === "person" || a.kind === "creature").map(a => a.at);
  return render(staged.map, staged.actors, camera, viewport, { time, roofs: false, focus: staged.start, ...(reveal.length ? { reveal } : {}), tick });
}

/** Write a picture as StyledLine JSON and a PNG beside it. */
export function writePicture(lines: StyledLine[], png: string, root = process.cwd()): string {
  mkdirSync(dirname(png), { recursive: true });
  const json = png.replace(/\.png$/, ".json");
  writeFileSync(json, JSON.stringify(lines));
  execFileSync("python3", [join(root, "tools", "preview.py"), json, png], { stdio: "pipe" });
  return png;
}
