/**
 * What tools/v2/scene-files.mts can't infer from a prototype scene, one table per scene in this
 * folder (story-design §4.6; v3-design §3.10's mapping). The effects are hand translations of the
 * scene's exit scripts, which the converter checks against the scripts for every set of the facts.
 */

/** A condition on facts by id: `if` all of them established, `unless` none of them (shared/scene/files.ts Cond). */
export type Cond = { if?: { established: string | string[] }; unless?: { established: string | string[] } };
/** An effect as scene.json holds it (shared/scene/files.ts Effect): its op and fields, and maybe a condition. */
export type Effect = Cond & { op: string } & Record<string, unknown>;

export interface SceneTable {
  /** The prototype's module (from the repo root) and the export that is the scene. */
  module: string;
  name: string;
  /** Its place's key (places/<key>.json, the map unit's names: shared/map/places.ts), when it has a world; an interlude has none. */
  place?: string;
  /** Each fact the scene establishes, by the start of its sentence, and the id scene.json gives it. */
  facts: Array<[string, string]>;
  /** Each exit's effects, by exit id, in the order the script does them. */
  effects: Record<string, Effect[]>;
  /** Effects of every ending, before the exit's own. */
  onEnd?: Effect[];
  /** Items a script gives the player that are things of a world: the item's id, the thing's key ("prout-ledger-page" is the yard's "ledger-page"). */
  items?: Record<string, string>;
  /** The scene's anchors as the place's keys, for what a script puts at one ("heron-floor" is the Heron's "floor"). */
  anchors?: Record<string, string>;
  /** What a script says the world can't show (world.unsupported), as a note on a thing of the place: the description's start, the thing's key. */
  unsupported?: Array<[string, string]>;
}
