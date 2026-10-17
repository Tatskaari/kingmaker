// Copied from the prototype's src/game/map/presence.ts at 44c6d4a. Imports from v2/shared. Two seams: places() draws a waiting place from its rows (ExploreState.waiting, passed to presence) where the prototype built its world afresh, and only those (a place to come has no rows yet: V3 builds the next lead's); town() takes who's about at each hour from the map's file (maps/<key>.json's people, now maps/<key>.kmmap's, peopleOf) where the prototype wrote them in it, the palace page as it was.
import type { SceneWorld } from "../world/scene-world.ts";
import type { Interaction, MapActor, StoryState, Tile2 } from "./types.ts";
import { CAST, TOWNSFOLK_COLOR } from "./looks.ts";
import { decorOf, getMap, peopleOf } from "./maps.ts";
import { PLACES, regionForScene } from "./places.ts";
import { actorsFromWorld, nearestTile, type MapOverlay } from "./reconcile.ts";
import { inBounds, isStructure, tileAt, type PlaceRegion } from "./tiles.ts";

/**
 * Who is about, from the story: the town by time of day (sweepers in the morning, the market busy,
 * lamplighters at dusk, lanterns on the wharves at night, crowds and a palace page the next
 * morning), the lead scene's place with its people waiting (Kell inside the granary gate), places
 * still to come with their things but nobody in them yet, and the lead marker.
 */

/** Scenes that can open now: the one the story is heading for, if it hasn't been played. */
export function liveScenes(story: StoryState): string[] {
  if (story.lead && !story.played.includes(story.lead)) return [story.lead];
  // A fresh story with no lead yet starts at the granary.
  if (!story.lead && !story.played.length) return ["hanged-clerk"];
  return [];
}

export const isLive = (story: StoryState, sceneId: string | undefined) => !!sceneId && liveScenes(story).includes(sceneId);

/** A region with a door that opens at its scene's time: open while that scene is live, and after. */
export function regionOpen(story: StoryState, region: PlaceRegion | undefined): boolean {
  if (!region?.shut) return true;
  const scene = region.opensFor ?? region.sceneId;
  return !scene || isLive(story, scene) || story.played.includes(scene);
}

/** The scene trigger for talking to someone or stepping somewhere, when its scene is live. */
export function sceneTrigger(sceneId: string, verb: "talk" | "enter" | "open" | "examine", label: string): Extract<Interaction, { kind: "scene" }> {
  return { kind: "scene", sceneId, verb, label };
}

/** The lead marker on a map: the lead scene's spot in the town, or its door on its own map. */
export function leadMarker(story: StoryState, mapId: string): { at: Tile2; label: string } | undefined {
  const [lead] = liveScenes(story);
  const place = lead ? PLACES[lead] : undefined;
  if (!place) return undefined;
  if (place.lead.map === mapId) return { at: place.lead.at, label: place.lead.label };
  if (place.map === mapId) {
    const found = regionForScene(lead!);
    if (!found) return undefined;
    const r = found.region.rect;
    // Its way in: a door on the place's edge, or else its middle.
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
      const edge = x === r.x - 1 || y === r.y - 1 || x === r.x + r.w || y === r.y + r.h;
      if (edge && inBounds(found.map, { x, y }) && tileAt(found.map, { x, y }).terrain === "door" && !tileAt(found.map, { x, y }).blocks) return { at: { x, y }, label: place.lead.label };
    }
    return { at: { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) }, label: place.lead.label };
  }
  return undefined;
}

/**
 * Who and what else is about on the maps that aren't the story's (the zoo's scene rooms, with their
 * people waiting): given the story, the map and what scenes have left on their places.
 */
export type Presence = (story: StoryState, mapId: string, overlay?: MapOverlay) => MapActor[];
const OTHERS: Presence[] = [];

export function addPresence(p: Presence): void { if (!OTHERS.includes(p)) OTHERS.push(p); }

/** Everyone and everything the story puts on a map (not the player, not followers). v2: `waiting`, the places built for scenes not yet played (their worlds from rows, by scene id). */
export function presence(story: StoryState, mapId: string, overlay?: MapOverlay, waiting?: Record<string, SceneWorld>): MapActor[] {
  const out: MapActor[] = [];
  const lit = story.time === "evening" || story.time === "night";
  for (const d of decorOf(mapId)) {
    if (d.states?.includes("lamp") && lit) d.states = [...d.states, "lit"];
    out.push(d);
  }
  out.push(...places(story, mapId, waiting));
  out.push(...town(story, mapId));
  for (const p of OTHERS) out.push(...p(story, mapId, overlay));
  return out;
}

/**
 * The places of the arc on this map before and after their scenes: the lead's place with its
 * people waiting, places to come with their things only. (Played places come from the overlay.)
 * v2: a place is drawn from its rows, once it's built (the lead's, with its people waiting).
 */
function places(story: StoryState, mapId: string, waiting: Record<string, SceneWorld> = {}): MapActor[] {
  const out: MapActor[] = [];
  for (const place of Object.values(PLACES)) {
    if (place.map !== mapId || story.played.includes(place.sceneId)) continue;
    const found = regionForScene(place.sceneId);
    if (!found) continue;
    const live = isLive(story, place.sceneId);
    const world = waiting[place.sceneId];
    if (!world) continue;
    const actors = actorsFromWorld(found.region, world, { map: found.map, player: false, people: live });
    for (const a of actors) {
      // People waiting for the player open the scene when spoken to.
      if (live && (a.kind === "person" || a.kind === "creature") && CAST[a.ref ?? ""]) {
        a.interaction = sceneTrigger(place.sceneId, "talk", `Talk to ${a.name}`);
      }
      out.push({ ...a, id: `${place.sceneId}:${a.id}` });
    }
  }
  return out;
}

interface Extra { name: string; glyph: string; at: Tile2; color?: string; text: string; states?: string[]; kind?: MapActor["kind"]; blocks?: boolean }

/** The town by time of day: the people who make it Caerwyn on the eve of the Assembly. v2: who they are and when is the map file's (peopleOf). */
function town(story: StoryState, mapId: string): MapActor[] {
  const map = getMap(mapId);
  const extras: Extra[] = peopleOf(mapId).filter(p => p.times.includes(story.time));
  const out: MapActor[] = extras.map((e, i) => ({
    id: `town:${slugOf(e.name)}#${i}`, name: e.name, kind: e.kind ?? "person", glyph: e.glyph, color: e.color ?? TOWNSFOLK_COLOR, map: mapId,
    at: freeSpot(map, e.at), ...(e.states ? { states: e.states } : {}), blocks: e.blocks ?? true,
    interaction: { kind: "examine", text: e.text, label: e.kind === "creature" || e.kind === "object" ? `Look at ${e.name}` : `Talk to ${e.name}` },
  }));
  // The palace page the next morning: the King will see the investigator now.
  if (mapId === "caerwyn" && isLive(story, "kings-morning")) {
    out.push({ id: "town:page", name: CAST.page!.name, kind: "person", glyph: CAST.page!.glyph, color: CAST.page!.color, map: "caerwyn", at: { x: 11, y: 14 }, blocks: true,
      interaction: sceneTrigger("kings-morning", "talk", "Talk to the palace page") });
  }
  return out;
}

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function freeSpot(map: ReturnType<typeof getMap>, at: Tile2): Tile2 {
  return nearestTile(map, at, p => inBounds(map, p) && !tileAt(map, p).blocks && !isStructure(tileAt(map, p)), 3) ?? at;
}
