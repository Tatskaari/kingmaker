/**
 * The King's morning's table for tools/v2/scene-files.mts: what the converter can't infer from
 * scenes/kings-morning.ts at 44c6d4a. Its one fact's id (kings-morning.ts:24); its exits have no
 * scripts (the story's last scene: what became of everyone is the GM's closing), so no effects.
 */
import type { SceneTable } from "./table.mts";

export const kingsMorning: SceneTable = {
  module: "scenes/kings-morning.ts", name: "kingsMorning",
  place: "dressing-room",
  facts: [
    ["In front of the King, Master Sallow has given himself away", "sallow-slipped"], // SLIPPED, kings-morning.ts:24
  ],
  effects: {
    "justice": [],
    "after-the-assembly": [],
  },
};
