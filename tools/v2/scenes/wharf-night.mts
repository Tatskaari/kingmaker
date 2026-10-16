/**
 * The night interlude's table for tools/v2/scene-files.mts (scenes/interludes.ts at 44c6d4a,
 * wharfNight): downtime standing in for the map, which the story skips (candidatesOf's
 * skipInterludes), so it has no place, no facts and an exit with no script; its words are installed
 * all the same, since the AI service loads every scene with them.
 */
import type { SceneTable } from "./table.mts";

export const wharfNight: SceneTable = {
  module: "scenes/interludes.ts", name: "wharfNight",
  facts: [],
  effects: { onward: [] },
};
