import { sceneById } from "../../../scenes/index.ts";
import { direction, newExploration, steps } from "../map/index.ts";
import { FIRST_SCENE, type GameState } from "../play.ts";
import { leadTarget } from "../town.ts";

/**
 * The window onto the story's first morning (the hall's exhibit): a new game of the story as it
 * stands before anyone has played it, made the way Game.create makes one (the first scene's time,
 * its lead, the town's explorer started on it), to look at and not to play. Nothing is saved.
 */
export function firstMorning(): GameState {
  const first = sceneById(FIRST_SCENE);
  const story = { time: first.time ?? "morning", played: [], lead: FIRST_SCENE, flags: {} } satisfies GameState["story"];
  return { version: 1, id: "first-morning", mode: "explore", story, explore: { ex: newExploration(structuredClone(story)), log: [] }, recent: [first.hook] };
}

/** What the window shows, in words: where a new game starts, its hook, and where the lead is. */
export function firstMorningText(): string {
  const game = firstMorning();
  const first = sceneById(FIRST_SCENE);
  const lead = leadTarget(game);
  const ex = (game.explore as { ex: { at: { x: number; y: number } } }).ex;
  const way = lead ? ` The lead is ${lead.label}, ${steps(ex.at, lead.at)} paces ${direction(ex.at, lead.at)}, gold, with a !.` : "";
  return `Through the window: Caerwyn on the morning of the eve of the Assembly, from the lane by the granary gate, where a new game of the story starts (after "Who are you?"). ${first.hook}${way} The zoo can only look: New game on the title screen is the way in.`;
}
