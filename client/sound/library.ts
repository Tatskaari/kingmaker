import type { Mood } from './music.ts';
import type { Cue } from './patches.ts';
import type { Tune } from './tune.ts';
import type { MusicAssignments } from '../../shared/music/assignments.ts';

/** The score library embedded by the web build from lore/Tunes. */
export interface CueReference { tune: string; section: string; source?: Partial<Cue> }
export interface SoundCatalog {
  version: 1;
  music: Partial<Record<Mood, string>>;
  cues: Record<string, CueReference>;
}
export interface SoundLibrary extends SoundCatalog {
  tunes: Record<string, Tune>;
  scenes?: Record<string, MusicAssignments>;
  maps?: Record<string, MusicAssignments>;
}
export const EMPTY_LIBRARY: SoundLibrary = { version: 1, music: {}, cues: {}, tunes: {} };
/** Variant keys parallel the game's spell elements and weapon families. */
export function cueReference(library: SoundLibrary, cue: Cue): CueReference | undefined {
  let variant = (cue.element ?? cue.kind)?.toLowerCase();
  if (cue.sfx === 'blow.swing') {
    const kind = cue.kind?.toLowerCase() ?? '';
    variant = /bite|claw|fang|talon|jaw|maw/.test(kind) ? 'bite' : /shove|unarmed|fist|punch|kick|grapple/.test(kind) ? 'shove' : /blunt|club|mace|hammer|staff|cudgel|maul|flail/.test(kind) ? 'blunt' : 'blade';
  }
  if (cue.sfx === 'blow.shot') variant = /bow/i.test(cue.kind ?? '') ? 'bow' : 'throw';
  const keys = [
    ...(cue.critical && variant ? [`${cue.sfx}:${variant}:critical`] : []),
    ...(cue.critical ? [`${cue.sfx}:critical`] : []),
    ...(variant ? [`${cue.sfx}:${variant}`] : []), cue.sfx,
  ];
  for (const key of keys) if (library.cues[key]) return library.cues[key];
  return undefined;
}
