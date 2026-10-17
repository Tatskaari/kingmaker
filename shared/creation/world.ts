import type { CreationWorld } from "./types.ts";

/**
 * The lore a backstory is checked against, by path (v1-design §3.8): what anyone in the world could
 * know, and only that. Every World doc but those the world says aren't canon, every cast member's
 * public face, and the places the story touches, by their words; in that order, once each, and only
 * those the lore has. The AI service reads them (ai/docs/backstory.ts canonFor, which also drops
 * any that isn't public); this is the choosing, a plain function of the paths, so it's tested on the
 * campaign's own lore.
 */
export function canonPaths(paths: readonly string[], story: string, world: CreationWorld): string[] {
  const always = paths.filter(p => (/^World\/[^/]+\.md$/.test(p) && !world.notCanon.includes(p)) || /^Cast\/[^/]+\/public\.md$/.test(p));
  const touched = world.places.filter(place => new RegExp(place.words, "i").test(story)).map(place => place.doc);
  return [...new Set([...always, ...touched])].filter(p => paths.includes(p));
}
