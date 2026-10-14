import { buildWorld } from "../../world/scene-world.ts";
import type { Interaction, MapActor, StoryState, Tile2 } from "../types.ts";
import { CAST, TOWNSFOLK_COLOR } from "./looks.ts";
import { decorOf, getMap } from "./maps/index.ts";
import { PLACES, regionForScene } from "./places.ts";
import { actorsFromWorld, nearestTile } from "./reconcile.ts";
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

/** Everyone and everything the story puts on a map (not the player, not followers). */
export function presence(story: StoryState, mapId: string): MapActor[] {
  const out: MapActor[] = [];
  const lit = story.time === "evening" || story.time === "night";
  for (const d of decorOf(mapId)) {
    if (d.states?.includes("lamp") && lit) d.states = [...d.states, "lit"];
    out.push(d);
  }
  out.push(...places(story, mapId));
  if (mapId === "caerwyn") out.push(...town(story));
  return out;
}

/**
 * The places of the arc on this map before and after their scenes: the lead's place with its
 * people waiting, places to come with their things only. (Played places come from the overlay.)
 */
function places(story: StoryState, mapId: string): MapActor[] {
  const out: MapActor[] = [];
  for (const place of Object.values(PLACES)) {
    if (place.map !== mapId || story.played.includes(place.sceneId)) continue;
    const found = regionForScene(place.sceneId);
    if (!found) continue;
    const live = isLive(story, place.sceneId);
    const people = live ? place.present.map(id => ({ id, name: CAST[id]?.name ?? id })) : [];
    const world = buildWorld(place.sceneId, place.world, people, { name: "you" });
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

interface Extra { name: string; glyph: string; at: Tile2; color?: string; text: string; states?: string[]; kind?: MapActor["kind"] }

/** The town by time of day: the people who make it Caerwyn on the eve of the Assembly. */
function town(story: StoryState): MapActor[] {
  const map = getMap("caerwyn");
  const extras: Extra[] = [];
  const add = (e: Extra) => extras.push(e);
  // Always: the palace guards, and the pigeons, who are always.
  add({ name: "a palace guard", glyph: "g", color: "#c8ccd4", at: { x: 10, y: 13 }, text: "A palace guard in a breastplate polished for the Assembly. He has been told to look stern and is giving it everything." });
  add({ name: "a palace guard", glyph: "g", color: "#c8ccd4", at: { x: 12, y: 13 }, text: "The other palace guard, who is looking stern slightly better than the first and knows it." });
  add({ name: "pigeons", glyph: "v", color: "#9aa0a8", kind: "creature", at: { x: 33, y: 8 }, text: "Pigeons, watching the bunting go up with professional interest." });
  if (story.time === "morning" || story.time === "afternoon") {
    add({ name: "a sweeper", glyph: "p", at: { x: 20, y: 24 }, text: "A sweeper. 'Assembly tomorrow. Sweep it all up so they can drop it all again tomorrow. That's civic pride, that is.'" });
    add({ name: "a man up a ladder", glyph: "p", color: "#d9b38c", at: { x: 26, y: 7 }, text: "A man up a ladder with an armful of bunting and the expression of someone who has run out of rope and patience at the same time." });
    add({ name: "a goose", glyph: "ɞ", color: "#f0f0e8", kind: "creature", at: { x: 23, y: 27 }, text: "A goose. It belongs to nobody and fears nothing. It looks at you as if you owe it money." });
    add({ name: "a pie-seller", glyph: "p", color: "#e0a060", at: { x: 18, y: 22 }, text: "A pie-seller. 'Assembly pies! Commemorative! Mostly pork!' You decide not to ask about the rest." });
    add({ name: "a porter", glyph: "p", at: { x: 36, y: 9 }, text: "A granary porter with a sack on his shoulder. 'Shocking business, the clerk. Shocking. Mind your back.'" });
    add({ name: "a woman haggling over cabbages", glyph: "q", color: "#c4a484", at: { x: 30, y: 22 }, text: "'How much? For a cabbage? I could buy a goose for that.' Somewhere behind you, the goose takes this personally." });
    add({ name: "an official with a clipboard", glyph: "p", color: "#a8b4c4", at: { x: 27, y: 30 }, text: "An official of the Assembly Committee (Decorations Sub-Committee), measuring the bunting with a ruler. 'Seven inches between flags. SEVEN. Is that so very hard?'" });
    add({ name: "a boy selling programmes", glyph: "b", color: "#e0c070", at: { x: 16, y: 28 }, text: "'Programme! Order of procession! The Purveyor's grain cart! The King's speech!' Quieter: 'It's the same as last century's. They just change the date.'" });
  }
  if (story.time === "afternoon" || story.time === "evening") {
    add({ name: "a delegation's servant", glyph: "p", color: "#7ab8d8", at: { x: 29, y: 25 }, text: "A Saltmere servant in salt-gull livery, haggling for bread and losing. 'This is what you charge for a loaf?' 'It's the Assembly, love.'" });
    add({ name: "a stallholder", glyph: "p", color: "#d9a066", at: { x: 22, y: 21 }, text: "A stallholder selling commemorative mugs with the King's face on, the face slightly wrong. 'Two for a penny. Three for a penny if you take the one with the nose.'" });
  }
  if (story.time === "evening") {
    add({ name: "a lamplighter", glyph: "p", color: "#ffd27f", at: { x: 21, y: 32 }, states: ["lit"], text: "A lamplighter with a long pole and a short temper. 'Lamps at dusk, lamps at dusk. Nobody ever says thank you to a lamplighter.' Thank you. 'Don't push it.'" });
    add({ name: "porters going down to the Rat", glyph: "p", at: { x: 24, y: 33 }, text: "Big men going down the river stairs, paid off early and off to drink it, most of them bandaged somewhere. It's the docks." });
  }
  if (story.time === "night") {
    for (const at of [{ x: 10, y: 42 }, { x: 38, y: 42 }]) add({ name: "a barge lantern", glyph: "¤", color: "#ffd27f", kind: "object", states: ["lit"], at, text: "A lantern on a moored barge, swinging, making the dark darker everywhere else." });
    add({ name: "a watchman's brazier", glyph: "¥", color: "#ff8c00", kind: "object", states: ["lit"], at: { x: 51, y: 37 }, text: "A brazier glowing outside the Heron's land door, at the very end of the wharf where the lamps give out." });
    add({ name: "an eel-seller packing up", glyph: "p", color: "#a0b090", at: { x: 15, y: 38 }, text: "An eel-seller packing up. 'Last eels! Lively ones!' They are, alarmingly." });
  }
  if (story.time === "next-morning") {
    for (const [i, at] of [{ x: 17, y: 21 }, { x: 19, y: 21 }, { x: 24, y: 22 }, { x: 28, y: 21 }, { x: 33, y: 22 }, { x: 15, y: 26 }, { x: 30, y: 28 }, { x: 20, y: 30 }].entries()) {
      add({ name: "the crowd", glyph: "pqhd"[i % 4]!, color: ["#b8ad9c", "#c4a484", "#a8b4c4", "#c4b8a4"][i % 4], at, text: "The crowd, out early for the procession, holding flags, children and opinions." });
    }
    add({ name: "the Purveyor's grain cart", glyph: "▬", color: "#e8c070", kind: "object", at: { x: 25, y: 23 }, states: ["garlanded"], text: "The Royal Purveyor's grain cart, garlanded, waiting to walk fourth in the procession 'for the people's confidence'. It is mostly garland." });
    add({ name: "a Nine Furrows banner-bearer", glyph: "p", color: "#e8d070", at: { x: 15, y: 20 }, text: "A Nine Furrows delegate under a wheat-sheaf banner, discussing the weather with the authority of someone whose people make it." });
    add({ name: "a Kläggenheim axeman", glyph: "p", color: "#c06050", at: { x: 35, y: 24 }, text: "A Kläggenheim delegate with a ceremonial axe, which he assures you is ceremonial. He has assured several people. It is quite sharp." });
  }
  const out: MapActor[] = extras.map((e, i) => ({
    id: `town:${slugOf(e.name)}#${i}`, name: e.name, kind: e.kind ?? "person", glyph: e.glyph, color: e.color ?? TOWNSFOLK_COLOR, map: "caerwyn",
    at: freeSpot(map, e.at), ...(e.states ? { states: e.states } : {}), blocks: true,
    interaction: { kind: "examine", text: e.text, label: e.kind === "creature" || e.kind === "object" ? `Look at ${e.name}` : `Talk to ${e.name}` },
  }));
  // The palace page the next morning: the King will see the investigator now.
  if (isLive(story, "kings-morning")) {
    out.push({ id: "town:page", name: CAST.page!.name, kind: "person", glyph: CAST.page!.glyph, color: CAST.page!.color, map: "caerwyn", at: { x: 11, y: 14 }, blocks: true,
      interaction: sceneTrigger("kings-morning", "talk", "Talk to the palace page") });
  }
  return out;
}

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function freeSpot(map: ReturnType<typeof getMap>, at: Tile2): Tile2 {
  return nearestTile(map, at, p => inBounds(map, p) && !tileAt(map, p).blocks && !isStructure(tileAt(map, p)), 3) ?? at;
}
