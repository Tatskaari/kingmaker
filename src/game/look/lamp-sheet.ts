import { buildWorld, type SceneWorld } from "../../world/scene-world.ts";
import { buildMap, T } from "../map/tiles.ts";
import type { MapActor, Tile2, TileMap } from "../types.ts";
import { isNight, type LampLook } from "./lamp-art.ts";

/**
 * Every look a lamp post has, in a row along a cobbled street: on a little map of its own (as the
 * town has its lamps: the map's "lamp" and "post", and what the world says of each), and on a little
 * place from above (as a scene's world has a lamp post). For the lamps' tests and pictures
 * (src/game/look/lamps.test.ts, src/web/static/shoot.ts), as door-sheet.ts has the doors.
 *
 *   by the hour   nothing said of it: pale by day, lit after dark (the town lights its lamps at dusk)
 *   lit           lit, whatever the hour (the Light cantrip, or a scene's lamp lit for the night)
 *   put out       unlit, whatever the hour
 *   soaked        lit, but wet: a wet flame goes out
 *   broken        its glass smashed: no light
 */

export const LAMP_LOOKS: Array<{ name: string; states: string[]; day: LampLook; night: LampLook }> = [
  { name: "by the hour", states: [], day: "out", night: "lit" },
  { name: "lit", states: ["lit"], day: "lit", night: "lit" },
  { name: "put out", states: ["unlit"], day: "out", night: "out" },
  { name: "soaked", states: ["lit", "wet"], day: "out", night: "out" },
  { name: "broken", states: ["broken"], day: "broken", night: "broken" },
];

export const LAMP_SHEET_CAMERA: Tile2 = { x: 7, y: 4 };

const idOf = (name: string) => name.replace(/\W+/g, "-");

/**
 * The street: cobbles 15 x 9, a lamp post in each look along row 4, two tiles apart (up and to the
 * right on screen). At dusk the one nothing's been said of is lit, as the town lights its own (the
 * map's presence: src/game/map/presence.ts).
 */
export function lampSheet(time?: string): { map: TileMap; lamps: MapActor[]; at: (name: string) => Tile2 } {
  const grid = Array.from({ length: 9 }, () => ".".repeat(15));
  const at = (name: string): Tile2 => ({ x: 3 + 2 * LAMP_LOOKS.findIndex(l => l.name === name), y: 4 });
  const { map } = buildMap({
    id: "lamp-sheet", name: "The lamp sheet", grid: `\n${grid.join("\n")}\n`,
    legend: { ".": T("cobbles") },
    regions: [{ id: "street", name: "the street", rect: { x: 0, y: 0, w: 15, h: 9 }, description: "" }],
  });
  const lamps: MapActor[] = LAMP_LOOKS.map(l => ({
    id: `lamp-sheet:${idOf(l.name)}`, name: "a lamp post", kind: "object" as const, glyph: "¤", color: "#e8c070", map: "lamp-sheet", at: at(l.name),
    states: ["lamp", "post", ...l.states, ...(!l.states.length && isNight(time) ? ["lit"] : [])],
  }));
  return { map, lamps, at };
}

/** The same lamps on a place from above: a lamp post in each look along a street 76 x 20 feet, lit by their own states, or (by the hour) by being lamps. */
export function lampStage(): SceneWorld {
  return buildWorld("lamp-sheet", {
    name: "The lamp sheet", description: "A street of lamp posts.",
    size: { w: 76, h: 20 },
    areas: [{ id: "street", name: "the street", rect: { x: 0, y: 0, w: 76, h: 20 } }],
    things: LAMP_LOOKS.map((l, i) => ({
      id: idOf(l.name), name: "a lamp post", kind: "feature" as const, in: "street", at: [10 + 14 * i, 10] as [number, number],
      size: "medium" as const, material: "iron" as const, tags: ["light"], states: l.states,
    })),
    people: {},
  }, [], { name: "you" });
}
