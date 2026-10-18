// New (QA round qa3-1018): what the player can see of the scene's place, for the headless map's legend (client/headless.ts map).
import { areaOf, positionOf, type Entity, type Point, type SceneWorld } from "../../shared/world/scene-world.ts";
import { dressingFor } from "../look/dressings.ts";

/**
 * What the player can see of the place right now, as the headless map lists it (QA round qa3-1018:
 * its legend named everyone in full from the first turn, and listed what the player couldn't see,
 * from the loose board behind the water butt to the shut loft's tally desk and the Heron's
 * re-sacking gang). Someone or something is in sight when it's in the player's own area, or both are
 * out of doors (over a low wall, through a gate), or a straight line to it crosses no wall of the
 * place (its dressing's) but glass, or crosses one at an open door; and when it isn't hidden (nor
 * inside something hidden), nor carried by someone else. A passage (a loose board, a gap) is a way
 * found, not seen: it's in sight only once the narration has mentioned it. `said`: the narration so
 * far, and the hook.
 */
export function inSight(world: SceneWorld, said: string): (e: Entity) => boolean {
  const sight = sightOf(world);
  return e => {
    if (e.player) return true;
    if (hidden(world, e) || carriedByOthers(world, e)) return false;
    if (e.tags.includes("passage") && !mentioned(e, said)) return false;
    return seen(world, sight, e);
  };
}

/** What sight is stopped by in the place, from its dressing: the walls but glass, the doors standing open in them, and which areas are indoors. */
interface Sight { walls: Array<{ from: [number, number]; to: [number, number] }>; open: Point[]; indoor: Set<string> }

function sightOf(world: SceneWorld): Sight {
  const dressing = dressingFor(world.scene);
  const open = Object.values(world.entities).filter(e => e.tags.includes("door") && e.states.includes("open") && e.at).map(e => e.at!);
  return { walls: (dressing.walls ?? []).filter(w => w.style !== "glass"), open, indoor: new Set(dressing.indoor ?? []) };
}

/** The player's eye reaches it: the same area, both out of doors, or a line to it that no wall stops (a wall it crosses at an open door doesn't). */
function seen(world: SceneWorld, sight: Sight, e: Entity): boolean {
  const from = positionOf(world, "player"), to = positionOf(world, e.id);
  const here = areaOf(world, "player")?.id ?? "", there = areaOf(world, e.id)?.id ?? "";
  if (!from || !to || here === there) return true;
  if (!sight.indoor.has(here) && !sight.indoor.has(there)) return true;
  return sight.walls.every(w => {
    const at = crossing(from, to, w.from, w.to);
    return !at || sight.open.some(door => Math.hypot(door.x - at.x, door.y - at.y) <= 3);
  });
}

/** Where the line from `p` to `q` crosses a wall from `a` to `b`, strictly between its ends (something standing on a wall, a door, isn't behind it). */
function crossing(p: Point, q: Point, [ax, ay]: [number, number], [bx, by]: [number, number]): Point | undefined {
  const d = (q.x - p.x) * (by - ay) - (q.y - p.y) * (bx - ax);
  if (d === 0) return undefined;
  const t = ((ax - p.x) * (by - ay) - (ay - p.y) * (bx - ax)) / d;
  const u = ((ax - p.x) * (q.y - p.y) - (ay - p.y) * (q.x - p.x)) / d;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) } : undefined;
}

/** Hidden, or inside something that is (the page sewn into a boot's lining). */
function hidden(world: SceneWorld, e: Entity): boolean {
  for (let x: Entity | undefined = e, n = 0; x && n < 12 && x.kind !== "area" && x.kind !== "place"; x = x.parent ? world.entities[x.parent] : undefined, n++) {
    if (x.tags.includes("hidden") || x.states.includes("hidden")) return true;
  }
  return false;
}

/** On someone, or in something on someone, who isn't the player (Cob's boots, the crown in Moll's fist). */
function carriedByOthers(world: SceneWorld, e: Entity): boolean {
  for (let x = e.parent ? world.entities[e.parent] : undefined, n = 0; x && n < 12 && x.kind !== "area" && x.kind !== "place"; x = x.parent ? world.entities[x.parent] : undefined, n++) {
    if ((x.kind === "person" || x.kind === "creature") && !x.player) return true;
  }
  return false;
}

/** The narration has named it by what it is: "a loose board behind the water butt" is a board, and "one board sits proud of the others" has it. */
function mentioned(e: Entity, said: string): boolean {
  const head = e.name.replace(/\s+(?:with|in|by|from|at|on|of|behind|beside|under|near|over)\s.*$/i, "").split(/\s+/).at(-1)!.replace(/[^\p{L}-]/gu, "");
  return !!head && new RegExp(`\\b${head}s?\\b`, "i").test(said);
}
