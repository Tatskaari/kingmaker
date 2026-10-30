/** Music attached to a scene or map. Tune ids are paths below lore/Tunes/, without .kmtune. */
export const MUSIC_SLOTS = ["morning", "afternoon", "evening", "night", "next-morning", "combat"] as const;
export type MusicSlot = typeof MUSIC_SLOTS[number];
export type MusicAssignments = Partial<Record<MusicSlot, string>>;

/** A portable relative tune id: nested folders are allowed; escaping the Tunes folder is not. */
export function isTuneId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && !/[:\\\u0000-\u001f\u007f]/.test(value) && !/\.kmtune$/i.test(value)
    && value.split("/").every(part => part.length > 0 && part !== "." && part !== "..");
}

export function musicAssignmentProblems(value: unknown): string[] {
  if (value === undefined) return [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return ["its music isn't an object of time-of-day and combat tune ids"];
  return Object.entries(value).flatMap(([slot, id]) => {
    if (!MUSIC_SLOTS.includes(slot as MusicSlot)) return [`its music slot ${JSON.stringify(slot)} isn't one of ${MUSIC_SLOTS.join(", ")}`];
    return isTuneId(id) ? [] : [`its music.${slot} isn't a relative tune id below Tunes/ (without .kmtune)`];
  });
}

/** Remove an empty assignment instead of saving an unusable tune id. */
export function withMusicAssignment(music: MusicAssignments | undefined, slot: MusicSlot, id: string): MusicAssignments | undefined {
  const next = { ...music };
  if (id) next[slot] = id;
  else delete next[slot];
  return Object.keys(next).length ? next : undefined;
}
