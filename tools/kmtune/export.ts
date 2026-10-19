/** Capture the procedural soundtrack as editable, deterministic music scores. */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from '../../client/sound/dsp.ts';
import { MOODS, Song, STYLES, type Mood } from '../../client/sound/music.ts';
import type { PartSpec } from '../../client/sound/parts.ts';
import { INSTRUMENT_LABELS, mergeDrumTracks, validateTune, writeTune, type Tune, type TuneInstrument, type TuneKey, type TuneNote, type TuneSection, type TuneTrack } from '../../client/sound/tune.ts';

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
  const events = song.bars(sectionBeats * sectionNames.length * beatMs - 0.01);
  for (const { at, spec } of events) {
    const beat = Math.max(0, at / beatMs);
    const index = Math.min(sectionNames.length - 1, Math.floor(beat / sectionBeats));
    const section = tune.sections[index]!;
    const kind = musicInstrument(spec);
    const track = getTrack(section, kind, INSTRUMENT_LABELS[kind]);
    // The kick's click and thump share one editable note, preserving its two synth layers.
    const start = beat - index * sectionBeats;
    const previous = kind === 'kick' ? track.notes.find(n => Math.abs(n.at + (n.patch?.parts[0]?.at ?? 0) / beatMs - start) < 1e-8) : undefined;
    if (previous) {
      const part = structuredClone(spec);
      const offset = (start - previous.at) * beatMs;
      if (offset) part.at = (part.at ?? 0) + offset;
      previous.patch!.parts.push(part);
    } else track.notes.push(exactNote(start, visualDuration(kind, spec, style.bpm), spec, beatMs, sectionBeats, kind));
  }
  for (const section of tune.sections) normalizeTracks(section);
  return validateTune(mergeDrumTracks(tune));
}

function musicInstrument(spec: PartSpec): TuneInstrument {
  if (spec.kind === 'pluck') return spec.decay === 2.2 ? 'harp' : 'lute';
  if (spec.kind === 'noise') return spec.freq === 7000 ? 'hat' : spec.freq === 2500 ? 'kick' : 'snare';
  if (spec.wave === 'sine' && spec.to === 45) return 'kick';
  if (spec.detune === 7) return 'pad';
  if (spec.detune === 4) return 'drone';
  if (spec.fm) return 'bell';
  if (spec.vib) return spec.wave === 'pulse' ? 'chip' : 'flute';
  return spec.wave === 'pulse' ? 'pulse-bass' : 'bass';
}

function visualDuration(kind: TuneInstrument, spec: PartSpec, bpm: number): number {
  const beatMs = 60000 / bpm;
  switch (kind) {
    case 'pad': return ((spec.env.hold ?? 200) + 200) / beatMs;
    case 'drone': return ((spec.env.hold ?? 400) + 400) / beatMs;
    case 'bass': case 'pulse-bass': return (spec.env.hold ?? 100) / beatMs / 0.9;
    case 'flute': return (spec.env.hold ?? 100) / beatMs / 0.92;
    case 'chip': return (spec.env.hold ?? 100) / beatMs / 0.85;
    case 'bell': return 1;
    case 'kick': case 'snare': case 'hat': return 0.25;
    default: return 0.5;
  }
}

function getTrack(section: TuneSection, instrument: TuneInstrument, name: string): TuneTrack {
  let track = section.tracks.find(t => t.instrument === instrument && t.name === name);
  if (!track) { track = { name, instrument, gain: 1, pan: 0, notes: [] }; section.tracks.push(track); }
  return track;
}

/** Keep precise onset inside the patch when a humanised note nearly touches a section boundary. */
function exactNote(at: number, duration: number, source: PartSpec, beatMs: number, sectionBeats: number, instrument: TuneInstrument): TuneNote {
  const start = Math.min(at, sectionBeats - 0.001);
  const length = Math.max(0.001, Math.min(duration, sectionBeats - start, 64));
  const midi = instrument === 'kick' ? 36 : instrument === 'snare' ? 38 : instrument === 'hat' ? 42 : source.kind === 'noise' ? 60 : Math.max(21, Math.min(108, Math.round(69 + 12 * Math.log2(source.freq / 440))));
  const part = structuredClone(source);
  if (start !== at) part.at = (part.at ?? 0) + (at - start) * beatMs;
  return { at: start, midi, duration: length, velocity: 1, patch: { midi, duration: length, beatMs, parts: [part] } };
}

/** Store useful mixer levels, with per-note patches normalised so editing the gain is predictable. */
function normalizeTracks(section: TuneSection): void {
  for (const track of section.tracks) {
    const peak = Math.max(...track.notes.flatMap(n => n.patch!.parts.map(p => p.gain)), 0.001);
    track.gain = Math.min(1, peak);
    for (const n of track.notes) for (const part of n.patch!.parts) part.gain /= track.gain;
    track.notes.sort((a, b) => a.at - b.at || a.midi - b.midi);
    if (track.instrument === 'custom' && track.notes[0]?.patch) track.patch = structuredClone(track.notes[0].patch);
  }
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
