// New (K): the map's stubs' one body. Package M replaces each stub with its copy from the prototype (v2/docs/map-design.md §2), and deletes this file with the last of them.

/** A stub's answer: what's called isn't copied yet. */
export function notBuilt(what: string): never {
  throw new Error(`shared/map: ${what} isn't built yet (package M copies it from the prototype)`);
}
