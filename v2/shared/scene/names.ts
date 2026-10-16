// Copied from the prototype's src/runtime/brief.ts:108-162 at 44c6d4a (not asHeard or strangers); they read the transcript they're handed (the scene's), and TITLES and namedIn are exported.

import type { Character, Scene } from "./types.ts";

/**
 * Whose names the player has heard. The simulation keeps the controller's in `heard` rows (the
 * client's `my_names`); the AI service tells the GM what to call the rest.
 */

/** What these read of the play so far: its entries' kinds and words. */
export interface Heard { transcript: ReadonlyArray<{ kind: string; text: string }> }

export const TITLES = new Set(["the", "a", "an", "big", "old", "young", "little", "master", "mister", "mr", "mrs", "miss", "sergeant", "corporal", "captain", "marshal", "king", "queen", "sir", "lady", "lord", "dame"]);

/** Everything the player has been told or shown: these hooks, and every line of play but the dice (their own turns too). */
export const heardIn = (state: Heard, hooks: string[]) => [...hooks, ...state.transcript.filter(e => e.kind !== "roll").map(e => e.text)].join("\n");
export const namedIn = (c: Pick<Character, "name" | "aka">, heard: string) => nameTokens(c).some(t => new RegExp(`\\b${t}\\b`).test(heard));

/**
 * The cast the player has heard named: in anything said or shown so far (the hook, every reply,
 * their own turns), by any part of the name that isn't a title. People without a `called` aren't
 * tracked: they count as known.
 */
export function knownCast(scene: Scene, state: Heard): Set<string> {
  const heard = heardIn(state, [scene.hook]);
  return new Set(scene.cast.filter(c => !c.called || namedIn(c, heard)).map(c => c.id));
}

/** The parts of someone's names that mean them in text ("Kell", "Agnes"; not "Sergeant"). */
export function nameTokens(c: Pick<Character, "name" | "aka">): string[] {
  return [...c.name.split(/[\s-]+/), ...(c.aka ?? [])].map(t => t.replace(/[^\w']/g, "")).filter(t => t.length >= 3 && !TITLES.has(t.toLowerCase()));
}

/** What to call the cast whose names the player hasn't heard yet. */
export function unnamed(scene: Scene, state: Heard): Record<string, string> {
  const known = knownCast(scene, state);
  return Object.fromEntries(scene.cast.filter(c => c.called && !known.has(c.id)).map(c => [c.id, c.called!]));
}
