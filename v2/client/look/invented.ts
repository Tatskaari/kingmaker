// New (town-design §3.7, §3.9): a look the AI service invented for something the story made up (look.invent, "a disgruntled swan"), as its look row brings it (role `invented`, its `invention`), put in the look layer's cache by the key of the thing's name (parseName), where appearance.ts finds it as the prototype found its own inventions: the copied look layer draws it, and the client asks no model.
import type { InventedLook } from "../module_bindings/types.ts";
import type { ColorName } from "./color.ts";
import { lookCache, setLookCache, type CachedInvention } from "./invent.ts";
import { parseName } from "./names.ts";
import type { Motion } from "./roles.ts";

/** What the AI service's inventions are kept as, for the cache's `model`. */
export const INVENTED_BY = "look.invent";

/** A look row's invention as the cache keeps it: by the key of the thing's name, with its name and kind. */
export function inventionOf(name: string, look: InventedLook, kind?: string): [key: string, invention: CachedInvention] {
  const invention: CachedInvention = {
    glyph: look.glyph, ...(look.nerd ? { nerd: look.nerd } : {}), color: look.color as ColorName, motion: look.motion as Motion,
    light: look.light, being: look.being, group: look.group, ...(look.material ? { material: look.material } : {}),
    name, ...(kind ? { kind } : {}), model: INVENTED_BY, at: "",
  };
  return [parseName(name).key, invention];
}

/**
 * Keep an invented look in the look layer's cache, when it's new there: from now on the thing (and
 * anything else of its name) is drawn by it, not guessed. The look layer looks again at its guesses
 * when an invention lands (inventionVersion): setting the cache again moves that on. True when kept.
 */
export function keepInvented(name: string | undefined, look: InventedLook | undefined, kind?: string): boolean {
  if (!name || !look) return false;
  const [key, invention] = inventionOf(name, look, kind);
  const had = lookCache().get(key);
  if (had && had.model === INVENTED_BY && had.glyph === invention.glyph && had.color === invention.color && had.motion === invention.motion && had.nerd === invention.nerd) return false;
  lookCache().set(key, invention);
  setLookCache(lookCache());
  return true;
}
