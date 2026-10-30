import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MOODS } from '../../client/sound/music.ts';
import { parseTune } from '../../client/sound/tune.ts';
import { EMPTY_LIBRARY, type SoundCatalog, type SoundLibrary } from '../../client/sound/library.ts';
import { isTuneId, musicAssignmentProblems, type MusicAssignments } from '../../shared/music/assignments.ts';

/** Load authored scores, rejecting broken references before the audio thread sees them. */
export function readTuneLibrary(directory: string, bindingsRoots?: string | string[]): SoundLibrary {
  const library: SoundLibrary = structuredClone(EMPTY_LIBRARY);
  if (!existsSync(directory)) return library;
  const files = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.kmtune'));
  for (const file of files) {
    const path = join(file.parentPath, file.name), id = relative(directory, path).replaceAll('\\', '/').slice(0, -7);
    if (!isTuneId(id) || id.split('/').some(part => part.startsWith('.'))) continue;
    try { library.tunes[id] = parseTune(readFileSync(path, 'utf8')); }
    catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : error}`); }
  }
  const catalogPath = join(directory, 'catalog.json');
  const catalog: SoundCatalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : { version: 1, music: Object.fromEntries(MOODS.filter(m => library.tunes[m]).map(m => [m, m])), cues: {} };
  if (!catalog || catalog.version !== 1 || !catalog.music || typeof catalog.music !== 'object' || Array.isArray(catalog.music) || !catalog.cues || typeof catalog.cues !== 'object' || Array.isArray(catalog.cues)) throw new Error(`${catalogPath}: invalid catalog`);
  for (const [mood, id] of Object.entries(catalog.music)) {
    if (!MOODS.includes(mood as typeof MOODS[number]) || !isTuneId(id) || !library.tunes[id]) throw new Error(`${catalogPath}: missing or invalid mood tune ${mood}: ${id}`);
  }
  for (const [key, ref] of Object.entries(catalog.cues)) {
    if (!ref || !isTuneId(ref.tune) || !library.tunes[ref.tune]?.sections.some(s => s.id === ref.section)) throw new Error(`${catalogPath}: missing cue section ${key}`);
    if (ref.source) for (const field of ['ms', 'count', 'size'] as const) {
      const n = ref.source[field]; if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n <= 0)) throw new Error(`${catalogPath}: invalid cue source ${key}.${field}`);
    }
  }
  library.music = catalog.music; library.cues = catalog.cues;
  // Later roots (the vault's Game folder) override campaign defaults. Conflicts within a root fail.
  for (const bindingsRoot of typeof bindingsRoots === 'string' ? [bindingsRoots] : bindingsRoots ?? []) {
    if (!existsSync(bindingsRoot)) continue;
    const seen = new Map<string, string>();
    for (const file of readdirSync(bindingsRoot, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.(kmscene|kmmap)$/.test(e.name))) {
      const path = join(file.parentPath, file.name);
      if (relative(bindingsRoot, path).split(/[\\/]/).some(p => p.startsWith('.'))) continue;
      const doc = JSON.parse(readFileSync(path, 'utf8')) as { version?: number; id?: string; kind?: string; music?: MusicAssignments };
      if (doc.version !== 2 || !doc.id) continue;
      const problems = musicAssignmentProblems(doc.music);
      if (problems.length) throw new Error(`${path}: ${problems.join('; ')}`);
      const music = doc.music ?? {};
      for (const id of Object.values(music)) if (!library.tunes[id!]) throw new Error(`${path}: missing tune ${id}`);
      const target = file.name.endsWith('.kmscene') ? library.scenes ??= {} : library.maps ??= {};
      const key = `${file.name.endsWith('.kmscene') ? 'scene' : 'map'}:${doc.id}`, value = JSON.stringify(music);
      if (seen.has(key) && seen.get(key) !== value) throw new Error(`${path}: conflicting music assignments for ${doc.id}`);
      seen.set(key, value);
      target[doc.id] = music;
    }
  }
  return library;
}
