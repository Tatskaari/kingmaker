// New (M4): the scenario format's rules beyond each file's shape (docs/scenario-format.md, "What the game and the check do"): the campaign check's checks of the scenario, its maps and its places, moved out of hosts/dev/campaign.ts with the format's new ones, so the Obsidian plugin can run them as the files are edited.
import { FEET_PER_TILE } from "../map/reconcile.ts";
import { inBounds, isStructure, mapOf, TERRAINS, tileAt, type PlaceRegion } from "../map/tiles.ts";
import type { Tile2, TileMap } from "../map/types.ts";
import type { SceneDocument } from "./document.ts";
import { asMapFile, mapPath, placePath, SCENARIO_EXTENSION, type MapDocument, type PlaceDocument, type ScenarioDocument } from "./scenario.ts";

/**
 * The rules a campaign's scenario, maps and places are held to once each file has the format's shape
 * (scenario.ts's parses): their ids are their files' names and they have their prose; the scenario's
 * first scene, start place and level; each map's legend defines every character its grid uses, each
 * a terrain the game knows, and the map builds as the game builds it, no bigger than 160 by 120; its
 * people stand on it at times of day; its regions are inside it, their ids unique across the maps,
 * and name scenes the scenario has; a region with a scene lays the scene's place (a worldOrigin, the
 * place fitting on the map from there) or opens it (a trigger, the place laid by another region); its
 * exits go to the scenario's maps, onto ground a person can stand on; each place's ids are unique and
 * its things and people are somewhere that exists; and the story starts on a map, on ground a person
 * can stand on, from where every scene of the story can be reached: a region of a map the player
 * can walk to plays it, or a scene that can be reached goes on to it. (That everyone a place starts
 * is in its scene's cast, or is the player, is the scene's rule: rules.ts says it at the scene.)
 * Each problem says which file it's in and where in it, so an editor can take the author there.
 */

/** Where in its file a problem is: the scenario (a field of it), or a map's or a place's part. */
export type ScenarioProblemAt =
  | { kind: "scenario"; field?: string }
  | { kind: "map"; map: string; field?: string; region?: string; exit?: number; legend?: string; person?: number }
  | { kind: "place"; place: string; field?: string; area?: string; thing?: string; person?: string };

/** What's wrong (a sentence, as the campaign check prints it after the file), which file it's in, and where in it. */
export interface ScenarioProblem { file: string; message: string; at: ScenarioProblemAt }

/** A campaign's files as the rules need them, each of the format's shape. */
export interface ScenarioCampaign {
  /** The scenario's path in the campaign folder ("caerwyn.kmscenario"). */
  path: string;
  scenario: ScenarioDocument;
  /** The maps the scenario lists, by their keys (maps/<key>.kmmap), as their files have them. */
  maps: Array<{ key: string; doc: MapDocument }>;
  /** The places the scenario lists, by their keys (places/<key>.kmplace). */
  places: Array<{ key: string; doc: PlaceDocument }>;
  /** The campaign's scenes (the story's and the talk template), by their keys (scenes/<key>.kmscene), as their files have them: where the story goes is read from those of any shape. */
  scenes: Array<{ key: string; doc: SceneDocument }>;
}

/** The largest map: 160 tiles across, 120 down (the town is 64 by 46). */
export const MAP_LIMIT = { w: 160, h: 120 } as const;

const TIMES: string[] = ["morning", "afternoon", "evening", "night", "next-morning"];

/** The scenario's own: its id and prose, the campaign's version where the format has it, what it lists, its first scene, start place and level. */
export function scenarioRuleProblems(c: ScenarioCampaign): ScenarioProblem[] {
  const s = c.scenario, problems: ScenarioProblem[] = [];
  const p = (message: string, field?: string) => problems.push({ file: c.path, message, at: field === undefined ? { kind: "scenario" } : { kind: "scenario", field } });
  const name = c.path.slice(c.path.lastIndexOf("/") + 1).replace(new RegExp(`\\${SCENARIO_EXTENSION}$`), "");
  if (s.id !== name) p(`its id ${s.id} isn't its file's name`, "id");
  for (const k of ["title", "description"] as const) if (!s[k].trim()) p(`it has no ${k}`, k);
  if (s.campaignVersion === undefined) p(`the campaign's version is in version, which is the format's: move it to campaignVersion, and make version 2`, "campaignVersion");
  for (const k of ["firstScene", "startPlace"] as const) if (!s[k]) p(`no ${k}`, k);
  for (const [k, list] of [["scenes", s.scenes], ["places", s.places], ["maps", s.maps]] as const) {
    for (const id of new Set(list.filter((id, i) => list.indexOf(id) !== i))) p(`its ${k} list ${id} twice`, k);
  }
  if (s.talk !== undefined && s.scenes.includes(s.talk)) p(`its talk template ${s.talk} is one of its scenes too (a talk is never on the story's way)`, "talk");
  if (s.firstScene && !s.scenes.includes(s.firstScene)) p(`the first scene ${s.firstScene} isn't one of its scenes`, "firstScene");
  if (s.startPlace && !s.places.includes(s.startPlace)) p(`the start place ${s.startPlace} isn't one of its places`, "startPlace");
  if (!Number.isInteger(s.level) || s.level < 1) p(`level ${s.level} isn't a level`, "level");
  return problems;
}

/**
 * The maps: each listed map's file named for its id, every character of its grid in its legend and
 * every entry a terrain, building as the game builds it (mapOf), within the size limit; its people
 * on it at times of day; its regions inside it, their ids unique across the maps, the scenes they
 * name the scenario's, each with a scene laying its place (and the place fitting on the map) or
 * opening it; its ways out to the scenario's maps, onto tiles there a person can stand on.
 */
export function mapRuleProblems(c: ScenarioCampaign): ScenarioProblem[] {
  const problems: ScenarioProblem[] = [];
  const p = (key: string, message: string, at: Omit<Extract<ScenarioProblemAt, { kind: "map" }>, "kind" | "map"> = {}) => problems.push({ file: mapPath(key), message, at: { kind: "map", map: key, ...at } });
  const stories = new Set(c.scenario.scenes);
  const ids = new Set(c.maps.map(m => m.doc.id));
  const built = builtMaps(c);

  for (const { key, doc } of c.maps) {
    if (doc.id !== key) p(key, `its id ${doc.id} isn't its file's name`, { field: "id" });
    for (const k of ["title", "description"] as const) if (!doc[k].trim()) p(key, `it has no ${k}`, { field: k });
    for (const [ch, where] of unknownCharacters(doc)) p(key, `${JSON.stringify(ch)} isn't in its legend (at (${where.at.x}, ${where.at.y})${where.count > 1 ? `, and ${where.count - 1} more` : ""})`, { legend: ch });
    for (const [ch, entry] of Object.entries(doc.legend)) if (!TERRAINS.includes(entry.terrain)) p(key, `legend ${JSON.stringify(ch)}: ${entry.terrain} isn't a terrain (${TERRAINS.join(", ")})`, { legend: ch });
    const map = built.get(key);
    if (map === undefined) continue;
    if (typeof map === "string") { p(key, `it doesn't build (${map})`); continue; }
    if (map.width > MAP_LIMIT.w || map.height > MAP_LIMIT.h) p(key, `it's ${map.width} by ${map.height} tiles: a map is ${MAP_LIMIT.w} by ${MAP_LIMIT.h} at most`, { field: "grid" });
    (doc.people ?? []).forEach((person, i) => {
      if (!inBounds(map, person.at)) p(key, `${person.name} at (${person.at.x}, ${person.at.y}) is off the map`, { person: i });
      const odd = (person.times ?? []).filter(t => !TIMES.includes(t));
      if (!person.times?.length || odd.length) p(key, `${person.name}'s times ${JSON.stringify(person.times)} aren't times of day`, { person: i });
    });
  }

  const scenes = new Map(c.scenes.map(scene => [scene.key, scene.doc]));
  const places = new Map(c.places.map(place => [place.key, place.doc]));
  const regionIds = new Map<string, string>();
  const laid = new Set<string>();
  const opening: Array<{ key: string; region: PlaceRegion }> = [];
  for (const { key, doc } of c.maps) {
    const map = built.get(key);
    if (map === undefined || typeof map === "string") continue;
    for (const r of map.regions as PlaceRegion[]) {
      const inside = r.rect.x >= 0 && r.rect.y >= 0 && r.rect.w > 0 && r.rect.h > 0 && r.rect.x + r.rect.w <= map.width && r.rect.y + r.rect.h <= map.height;
      if (!inside) p(key, `region ${r.id} isn't inside the map`, { region: r.id });
      if (regionIds.has(r.id)) p(key, `region ${r.id} is ${regionIds.get(r.id)}'s too`, { region: r.id });
      else regionIds.set(r.id, doc.id);
      for (const field of ["sceneId", "opensFor", "exteriorOf"] as const) {
        const scene = r[field];
        if (scene !== undefined && !stories.has(scene)) p(key, `region ${r.id}'s ${field} ${scene} isn't one of the scenario's scenes`, { region: r.id });
      }
      if (r.sceneId === undefined || !stories.has(r.sceneId)) continue;
      if (r.worldOrigin) {
        // Where its scene's place is laid: the place, in tiles of five feet from the origin, on the map.
        laid.add(r.sceneId);
        const placeKey = scenes.get(r.sceneId)?.place, place = placeKey === undefined ? undefined : places.get(placeKey);
        if (place) {
          const o = r.worldOrigin, w = Math.ceil(place.size.w / FEET_PER_TILE), h = Math.ceil(place.size.h / FEET_PER_TILE);
          if (o.x < 0 || o.y < 0 || o.x + w > map.width || o.y + h > map.height) p(key, `region ${r.id} lays ${placeKey} (${w} by ${h} tiles) at (${o.x}, ${o.y}), past the map's edge (${map.width} by ${map.height})`, { region: r.id });
        }
      } else if (r.trigger) opening.push({ key, region: r });
      else p(key, `region ${r.id} names the scene ${r.sceneId}, but neither lays its place there (worldOrigin) nor opens it (trigger)`, { region: r.id });
    }
    map.exits.forEach((e, i) => {
      const to = built.get(c.maps.find(m => m.doc.id === e.to.map)?.key ?? "");
      if (!inBounds(map, e.at)) p(key, `"${e.label}" at (${e.at.x}, ${e.at.y}) is off the map`, { exit: i });
      if (!ids.has(e.to.map)) p(key, `"${e.label}" goes to ${e.to.map}, which isn't one of the campaign's maps`, { exit: i });
      else if (to && typeof to !== "string" && !standable(to, e.to.at)) p(key, `"${e.label}" lands on (${e.to.at.x}, ${e.to.at.y}) in ${e.to.map}, where nobody can stand`, { exit: i });
    });
  }
  // A region that opens a scene laid on another map (the wharf's end opening the Heron): it's laid somewhere, if it has a place.
  for (const { key, region } of opening) {
    if (!laid.has(region.sceneId!) && scenes.get(region.sceneId!)?.place !== undefined) p(key, `region ${region.id} opens ${region.sceneId}, but no region lays its place (one with its sceneId and a worldOrigin)`, { region: region.id });
  }
  return problems;
}

/** The places: each listed place's file named for its id, with its prose; unique ids, and every thing and person in an area, a thing or a person that exists. */
export function placeRuleProblems(c: ScenarioCampaign): ScenarioProblem[] {
  const problems: ScenarioProblem[] = [];
  for (const { key, doc } of c.places) {
    const p = (message: string, at: Omit<Extract<ScenarioProblemAt, { kind: "place" }>, "kind" | "place"> = {}) => problems.push({ file: placePath(key), message, at: { kind: "place", place: key, ...at } });
    if (doc.id !== key) p(`its id ${doc.id} isn't its file's name`, { field: "id" });
    for (const k of ["title", "description"] as const) if (!doc[k].trim()) p(`it has no ${k}`, { field: k });
    const ids = [...doc.areas.map(a => a.id), ...doc.things.map(t => t.id), ...Object.keys(doc.people)];
    for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) p(`${id} is there twice`);
    const known = new Set(ids), areas = new Set(doc.areas.map(a => a.id));
    for (const t of doc.things) if (!known.has(t.in)) p(`thing ${t.id} is in unknown ${t.in}`, { thing: t.id });
    for (const [id, person] of Object.entries(doc.people)) if (!areas.has(person.in)) p(`${id} starts in unknown area ${person.in}`, { person: id });
  }
  return problems;
}

/**
 * Where the story goes on the maps: it starts on one of the scenario's maps, on ground a person can
 * stand on (or with no map, its first scene opens at once); and every scene of the story can be
 * reached from there, by a region that plays it on a map the player can walk to from the start
 * (through the maps' exits), or by the story's flow from a scene that can be reached (an ending's
 * next: the interludes, the King's summons).
 */
export function flowProblems(c: ScenarioCampaign): ScenarioProblem[] {
  const problems: ScenarioProblem[] = [];
  const p = (message: string, field: string) => problems.push({ file: c.path, message, at: { kind: "scenario", field } });
  const start = c.scenario.start;
  const built = builtMaps(c);
  const byId = new Map(c.maps.map(({ key, doc }) => [doc.id, built.get(key)]));
  // With a start on a map the scenario hasn't got, that's the problem: what's reached from it is moot.
  if (start.map !== undefined && !byId.has(start.map)) {
    p(`it starts on the map ${start.map}, which isn't one of its maps`, "start");
    return problems;
  }
  if (start.map !== undefined) {
    const map = byId.get(start.map);
    const tile = start.at ? { x: start.at[0], y: start.at[1] } : undefined;
    if (!tile) p(`it starts on ${start.map} but doesn't say where (start.at)`, "start");
    else if (map && typeof map !== "string" && !standable(map, tile)) p(`it starts at (${tile.x}, ${tile.y}) on ${start.map}, where nobody can stand`, "start");
  } else if (start.at) p("it says where to start (start.at) but not on which map", "start");

  // The maps the player can walk to from the start, and the scenes their regions play. A map on the
  // way that doesn't build says so itself, and what's beyond it can't be told: nothing more is said.
  const walked = new Set<string>();
  const queue = start.map !== undefined ? [start.map] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (walked.has(id)) continue;
    walked.add(id);
    const map = byId.get(id);
    if (map === undefined || typeof map === "string") return problems;
    for (const e of map.exits) if (!walked.has(e.to.map) && byId.has(e.to.map)) queue.push(e.to.map);
  }
  const reached = new Set<string>(start.map === undefined ? [c.scenario.firstScene] : []);
  for (const id of walked) for (const r of (byId.get(id) as TileMap).regions) if (r.sceneId) reached.add(r.sceneId);
  // And the story's flow from what's reached: each ending's next.
  const nexts = new Map(c.scenes.map(scene => [scene.key, nextsOf(scene.doc)]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const id of [...reached]) for (const next of nexts.get(id) ?? []) if (!reached.has(next)) { reached.add(next); grew = true; }
  }
  for (const id of c.scenario.scenes) {
    if (!reached.has(id)) p(`the scene ${id} can't be reached from the start: no region plays it on a map the player can walk to, and no scene that can be reached goes on to it`, "scenes");
  }
  return problems;
}

/** Where a scene's endings go on to (its endings' next), read from a scene file of any shape. */
function nextsOf(scene: SceneDocument): string[] {
  const nodes: unknown[] = Array.isArray(scene?.nodes) ? scene.nodes : [];
  return nodes.flatMap(n => {
    const data = (n as { data?: { kind?: unknown; next?: unknown } } | null)?.data;
    return data?.kind === "exit" && typeof data.next === "string" ? [data.next] : [];
  });
}

/** Each map as the game builds it, by its key: its TileMap, or why it doesn't build; none for a map whose legend is wanting (the legend's problems say why). */
function builtMaps(c: ScenarioCampaign): Map<string, TileMap | string> {
  const built = new Map<string, TileMap | string>();
  for (const { key, doc } of c.maps) {
    if (unknownCharacters(doc).size || Object.values(doc.legend).some(entry => !TERRAINS.includes(entry.terrain))) continue;
    try {
      built.set(key, mapOf(asMapFile(doc)).map);
    } catch (e) {
      built.set(key, (e as Error).message);
    }
  }
  return built;
}

/** The characters a map's grid uses that its legend hasn't got (a space is open ground's absence: void), each with where it's first used and how often. */
function unknownCharacters(doc: MapDocument): Map<string, { at: Tile2; count: number }> {
  const unknown = new Map<string, { at: Tile2; count: number }>();
  doc.grid.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === " " || ch in doc.legend) return;
    const found = unknown.get(ch);
    if (found) found.count++;
    else unknown.set(ch, { at: { x, y }, count: 1 });
  }));
  return unknown;
}

/** Somewhere a person can stand: open ground, or a doorway that isn't locked (explore.ts's walkable). */
export function standable(map: TileMap, at: Tile2): boolean {
  if (!inBounds(map, at)) return false;
  const t = tileAt(map, at);
  return !t.blocks && (!isStructure(t) || t.terrain === "door");
}
