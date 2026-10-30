/**
 * Caerwyn as the tests from before the prologue know it: the hanged clerk the first scene and the
 * player in the granary lane in the morning (the scenario's start before the King's Road), with the
 * prologue left out: its three scenes, their places and the road's map, the King's parlour on the
 * palace's map, its people's looks, and what it added to the clerk (the night's rest, the road).
 * The tests of the town, the clerk and everything after them start there, as they always have; the
 * prologue's own tests take the campaign as it is.
 */

/** What the prologue adds to Caerwyn: the King's Road, the toll bridge and the King's thanks. */
export const PROLOGUE = {
  scenes: ["kings-road", "toll-bridge", "kings-thanks"],
  places: ["kings-road", "toll-bridge", "kings-parlour"],
  maps: ["kings-road"],
  /** Its people with looks of their own (the King and the Marshal are the King's morning's too). */
  cast: ["fitch", "tansy", "haskett", "tob", "garrow", "nabber", "rearguard", "grisk"],
};

/** Where Caerwyn started before the prologue: the granary lane, the morning of the eve. */
export const GRANARY_START = { day: 1, time: "morning" as const, map: "caerwyn", at: [42, 9] as [number, number] };

interface ScenarioLike { firstScene: string; start: object; scenes: string[]; places: string[]; maps?: string[] }

/** The scenario from the granary: the clerk first, the old start, and none of the prologue's scenes, places or map. */
export function scenarioFromTheGranary<S extends ScenarioLike>(scenario: S): S {
  return {
    ...scenario,
    firstScene: "hanged-clerk",
    start: { ...GRANARY_START, at: [...GRANARY_START.at] },
    scenes: scenario.scenes.filter(key => !PROLOGUE.scenes.includes(key)),
    places: scenario.places.filter(key => !PROLOGUE.places.includes(key)),
    ...(scenario.maps ? { maps: scenario.maps.filter(key => !PROLOGUE.maps.includes(key)) } : {}),
  };
}

/** A map without the prologue's regions (the King's parlour on the palace's). */
export function mapFromTheGranary<M extends { regions: Array<{ sceneId?: string }> }>(map: M): M {
  return { ...map, regions: map.regions.filter(region => !region.sceneId || !PROLOGUE.scenes.includes(region.sceneId)) };
}

/** A scene as it was before the prologue: the hanged clerk without the night's rest before it or the road in its background (the rest draws a roll as it opens). */
export function sceneFromTheGranary<D extends { id: string; rest?: unknown; background?: unknown }>(doc: D): D {
  if (doc.id !== "hanged-clerk") return doc;
  const { rest: _rest, background: _background, ...before } = doc;
  return before as D;
}

/** Looks without the prologue's people. */
export function looksFromTheGranary<L extends Record<string, unknown>>(looks: L): L {
  return Object.fromEntries(Object.entries(looks).filter(([id]) => !PROLOGUE.cast.includes(id))) as L;
}

/** A campaign folder's files from the granary: the scenario, the maps and the looks rewritten, the prologue's own files left out. */
export function filesFromTheGranary(files: Record<string, string>): Record<string, string> {
  const prologue = new Set([
    ...PROLOGUE.scenes.map(key => `scenes/${key}.kmscene`),
    ...PROLOGUE.places.map(key => `places/${key}.kmplace`),
    ...PROLOGUE.maps.map(key => `maps/${key}.kmmap`),
  ]);
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const out: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    if (prologue.has(path)) continue;
    if (!path.includes("/") && path.endsWith(".kmscenario")) out[path] = json(scenarioFromTheGranary(JSON.parse(text)));
    else if (path.startsWith("maps/") && path.endsWith(".kmmap")) out[path] = json(mapFromTheGranary(JSON.parse(text)));
    else if (path === "looks.json") out[path] = json(looksFromTheGranary(JSON.parse(text)));
    else if (path === "scenes/hanged-clerk.kmscene") out[path] = json(sceneFromTheGranary(JSON.parse(text)));
    else out[path] = text;
  }
  return out;
}
