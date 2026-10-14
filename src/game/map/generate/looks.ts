import { buildWorld } from "../../../world/scene-world.ts";
import { baseLook } from "../../look/appearance.ts";
import { inventNow, type InventRequest, type InventSpend } from "../../look/invent.ts";
import { castOf } from "../looks.ts";
import { actorsFromWorld } from "../reconcile.ts";
import type { CompiledPlace } from "./compile.ts";

/**
 * The look layer's looks for a generated place. The look layer draws a thing by the rules for its
 * name, else by what the model said about that kind of thing before (cached on disk), else by a
 * guess while it asks the model in the background. A place made at runtime asks for its unknowns up
 * front, in one call, and counts that call in its own time and cost: the place is drawn right the
 * first time it's shown.
 */

export interface LookSpend extends InventSpend {
  /** The names that had no look yet. */
  names: string[];
}

/** What the map will draw in a place that the look layer only has a guess for. */
export function unknownNames(place: CompiledPlace): InventRequest[] {
  const world = buildWorld(place.region.sceneId ?? place.id, place.world, place.cast, { name: "you" });
  const actors = actorsFromWorld(place.region, world, { map: place.map });
  const out = new Map<string, InventRequest>();
  for (const a of actors) {
    if (!a.ref || a.kind === "player") continue;
    // People with a letter of their own (the cast table's, or the place's) are drawn by it.
    if (place.looks[a.ref] || castOf(a.ref)) continue;
    // As the map's actorLook asks: by name and kind (a door is drawn as its door tile).
    const base = baseLook({ name: a.name, kind: a.kind, id: a.ref, ...(a.states ? { states: a.states } : {}) });
    if (base.source === "guess" && !out.has(base.parsed.key)) out.set(base.parsed.key, { key: base.parsed.key, name: a.name, kind: a.kind });
  }
  return [...out.values()];
}

/** Ask the model for the looks a place still needs, now, and say what it cost. */
export async function inventLooks(place: CompiledPlace): Promise<LookSpend> {
  const names = unknownNames(place);
  const spend = await inventNow(names);
  return { ...spend, names: names.map(n => n.name) };
}
