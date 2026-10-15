import { sceneById } from "../../../../scenes/index.ts";
import type { Rect } from "../../../world/scene-world.ts";
import { DRESSINGS } from "../../look/dressings.ts";
import { addPresence, getMap, registerPlace } from "../../map/index.ts";
import type { Tile2 } from "../../types.ts";
import { dressingFromMap } from "../dressing.ts";
import { installWing } from "../install.ts";
import type { Wing } from "../model.ts";
import { annexe, annexeByTheHour } from "./annexe.ts";
import { arena } from "./arena.ts";
import { ANNEXE_DOOR, chandlery } from "./chandlery.ts";
import { fire } from "./fire.ts";
import { hall, HALL_DOORS } from "./hall.ts";
import { kell, KELL_PLACES, KELL_ROOMS, kellWaiting } from "./kell.ts";
import { looks } from "./looks.ts";
import { rules } from "./rules.ts";
import { roomPreviews, theatre, THEATRE_PLACES, THEATRE_ROOMS } from "./theatre.ts";
import { works } from "./works.ts";

/**
 * The zoo's wings, in the order the hall's doors and the next-exhibit lead take them, each
 * installed in the game's maps as this module loads (the story's maps never lead to them), and the
 * places of the zoo's own scenes (the theatre's booths, Kell's desk).
 */

const WINGS_AFTER_HALL: Wing[] = [fire, works, looks, annexe, chandlery, theatre, rules, arena, kell];
export const WINGS: Wing[] = [hall, ...WINGS_AFTER_HALL];

// The hall's doors come out at each wing's way in.
hall.map.exits = HALL_DOORS.flatMap(d => {
  const wing = WINGS.find(w => w.id === d.wing);
  const door = hall.map.exits?.find(e => e.to.map === d.wing);
  return wing && door ? [{ ...door, to: { map: wing.id, at: { ...wing.entry } } }] : [];
});
// The chandlery is through the annexe's east door; its way out comes back to it.
annexe.map.exits = [...(annexe.map.exits ?? []), { at: { x: ANNEXE_DOOR.x + 1, y: ANNEXE_DOOR.y }, to: { map: chandlery.id, at: { ...chandlery.entry } }, label: "To Mother Tallow's chandlery (a place compiled from a plan)" }];
for (const w of WINGS) installWing(w);

export const HALL = hall;
export const wingOf = (mapId: string): Wing | undefined => WINGS.find(w => w.id === mapId);

/** One of the zoo's scenes' places: its map, and the rooms that open the scene when you step into them (tiles). */
export interface Room { sceneId: string; map: string; name: string; rooms: Rect[]; region: string; door: Tile2 }

export const ROOMS: Room[] = [...THEATRE_ROOMS, ...KELL_ROOMS];

// Each of the zoo's scenes is played on its room, framed on the map, its world lined up with it;
// from above, its dressing is read off the map (the belfry's arches let the rain in: under its
// roof, the ringing chamber is open to the weather, so the drizzle shows).
for (const p of [...THEATRE_PLACES, ...KELL_PLACES]) {
  const room = ROOMS.find(r => r.sceneId === p.sceneId)!;
  const scene = sceneById(p.sceneId);
  const map = getMap(room.map);
  const region = map.regions.find(r => r.id === p.region)!;
  registerPlace({
    sceneId: p.sceneId, map: room.map, region: p.region, world: scene.world!, present: scene.cast.filter(c => !c.enters).map(c => c.id),
    time: scene.time ?? "afternoon", lead: { map: room.map, at: p.door, label: room.name }, after: { map: room.map, at: p.outside },
  });
  DRESSINGS[p.sceneId] = dressingFromMap(map, region, scene.world!, p.sceneId === "zoo-belfry" ? { weather: "drizzle", wind: { dir: 0.5, strength: 0.7 }, indoor: [] } : {});
}

// Whoever's waiting in the rooms (and Kell in her corner, when she isn't walking with you); the annexe's people by the hour.
addPresence((story, mapId, overlay) => {
  if (mapId === annexe.id) return annexeByTheHour(story, mapId);
  if (!ROOMS.some(r => r.map === mapId) && mapId !== kell.id) return [];
  const map = getMap(mapId);
  const waiting = roomPreviews(ROOMS, mapId, map, overlay).filter(a => a.ref !== "kell");
  return [...waiting, ...kellWaiting(story, mapId)];
});
