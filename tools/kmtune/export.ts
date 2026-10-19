/** Capture the procedural soundtrack as editable, deterministic music scores. */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from '../../client/sound/dsp.ts';
import { MOODS, Song, STYLES, type Mood } from '../../client/sound/music.ts';
import { DRUM_LANES, INSTRUMENT_LABELS, validateTune, writeTune, type Tune, type TuneInstrument, type TuneKey, type TuneSection, type TuneTrack } from '../../client/sound/tune.ts';

export interface ExportCatalog {
  version: 1;
  music: Record<Mood, string>;
  /** Sound effects keep their procedural recipes rather than being exported as music. */
  cues: Record<string, never>;
}
export interface ExportLibrary { catalog: ExportCatalog; tunes: Record<string, Tune> }

export const scoreSeed = (id: string): number => hashOf(`kingmaker:tunes:v1:${id}`);
const sectionNames = ['Intro', 'Theme', 'Bridge', 'Return'] as const;
const keys: Record<Mood, TuneKey['scale']> = { title: 'dorian', town: 'mixolydian', night: 'minor', scene: 'dorian', between: 'dorian', fight: 'phrygian', end: 'lydian' };
const titles: Record<Mood, string> = { title: 'The Kingmaker', town: 'Market Morning', night: 'Bells in the Dark', scene: 'Under the Conversation', between: 'The Road Between', fight: 'Steel and Sorcery', end: 'A Story Told' };

/** A representative A / A′ / B / A passage. The first section plays once, the other three loop. */
export function exportMusic(mood: Mood): Tune {
  const style = STYLES[mood], beatMs = 60000 / style.bpm;
  const bars = style.hold * 4, sectionBeats = bars * style.beats;
  const tune: Tune = {
    version: 1, title: titles[mood], bpm: style.bpm, beats: style.beats,
    key: { root: style.root % 12, scale: keys[mood] },
    sections: sectionNames.map((name, i) => ({ id: `section-${i + 1}`, name, bars, tracks: [] })),
    arrangement: sectionNames.map((_, i) => ({ section: `section-${i + 1}`, repeats: 1 })),
    loop: { from: 1, to: 3 },
  };
  // A 1000 Hz scheduling clock makes sample positions equal to milliseconds; no audio is rendered.
  const song = new Song(mood, scoreSeed(mood), 0, 1000, 'export');
  const events = song.notes(sectionBeats * sectionNames.length * beatMs - 0.01);
  for (const event of events) {
    const rawBeat = Math.max(0, event.at / beatMs);
    const beat = Math.abs(rawBeat - Math.round(rawBeat)) < 1e-8 ? Math.round(rawBeat) : rawBeat;
    const index = Math.min(sectionNames.length - 1, Math.floor(beat / sectionBeats));
    const section = tune.sections[index]!;
    const lane = DRUM_LANES.find(lane => lane.instrument === event.instrument);
    const kind = lane ? 'drums' : event.instrument;
    const track = getTrack(section, kind);
    const start = beat - index * sectionBeats;
    track.notes.push({ at: start, midi: event.midi,
      duration: Math.max(0.001, Math.min(event.duration, 64)),
      velocity: event.gain / (lane?.gain ?? 1), ...(event.pan ? { pan: event.pan } : {}),
    });
  }
  for (const section of tune.sections) for (const track of section.tracks) {
    track.gain = Math.max(...track.notes.map(n => n.velocity), 0.001);
    for (const note of track.notes) note.velocity /= track.gain;
    track.notes.sort((a, b) => a.at - b.at || a.midi - b.midi);
  }
  return validateTune(tune);
}

function getTrack(section: TuneSection, instrument: TuneInstrument): TuneTrack {
  let track = section.tracks.find(t => t.instrument === instrument);
  if (!track) { track = { name: INSTRUMENT_LABELS[instrument], instrument, gain: 1, pan: 0, notes: [] }; section.tracks.push(track); }
  return track;
}

export function exportLibrary(): ExportLibrary {
  const tunes: Record<string, Tune> = {};
  const catalog: ExportCatalog = { version: 1, music: {} as Record<Mood, string>, cues: {} };
  for (const mood of MOODS) { tunes[mood] = exportMusic(mood); catalog.music[mood] = mood; }
  for (const tune of Object.values(tunes)) validateTune(tune);
  return { catalog, tunes };
}

/** Refuse to replace a composer's saved score unless an explicit regeneration was requested. */
export async function writeLibrary(directory: string, force = false): Promise<number> {
  const { catalog, tunes } = exportLibrary();
  const files: Array<readonly [string, string]> = Object.entries(tunes).map(([id, tune]) => [`${id}.kmtune`, writeTune(tune)] as const);
  files.push(['catalog.json', JSON.stringify(catalog, null, 2) + '\n']);
  if (!force) for (const [name] of files) {
    const path = resolve(directory, name);
    let exists = false;
    try { await access(path); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (exists) throw new Error(`Refusing to replace ${path}. Use --force only to discard edits and regenerate the source capture.`);
  }
  for (const [name, contents] of files) { const path = resolve(directory, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, contents, { flag: force ? 'w' : 'wx' }); }
  return files.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), force = args.includes('--force');
  const directory = resolve(args.find(arg => arg !== '--force') ?? 'lore/Tunes');
  const count = await writeLibrary(directory, force);
  console.log(`Exported ${count - 1} scores and catalog.json to ${directory}`);
}
