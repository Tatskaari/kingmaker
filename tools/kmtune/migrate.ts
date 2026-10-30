/** Convert early exported synth recipes back to engine instruments without regenerating a score. */
import { instrumentParts, type MusicInstrument } from '../../client/sound/music.ts';
import type { PartSpec } from '../../client/sound/parts.ts';
import { DRUM_LANES, drumKind, noteParts, validateTune, type Tune } from '../../client/sound/tune.ts';

function gate(kind: MusicInstrument, part: PartSpec, beatMs: number, fallback: number): number {
  const hold = part.env.hold;
  if (hold === undefined) return fallback;
  switch (kind) {
    case 'pad': return (hold + 200) / beatMs;
    case 'drone': return (hold + 400) / beatMs;
    case 'bass': case 'pulse-bass': return hold / beatMs / 0.9;
    case 'flute': return hold / beatMs / 0.92;
    case 'chip': return hold / beatMs / 0.85;
    default: return fallback;
  }
}

function canonical(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
  return value;
}

/** Fail on a genuinely custom voice rather than silently replacing it with a preset. */
export function useEngineInstruments(source: Tune): Tune {
  const tune = structuredClone(validateTune(source)), beatMs = 60000 / tune.bpm;
  for (const section of tune.sections) for (const track of section.tracks) {
    if (track.instrument === 'custom') throw new Error(`${section.name} / ${track.name}: custom instrument needs an engine preset`);
    if (!track.patch && track.notes.every(note => !note.patch)) continue;
    const levels: number[] = [];
    for (const note of track.notes) {
      const kind = track.instrument === 'drums' ? drumKind(note.midi) : track.instrument;
      const patch = note.patch ?? track.patch;
      const active = patch && (track.instrument !== 'drums' || drumKind(note.midi) === drumKind(patch.midi));
      if (active) {
        const refBeat = patch.beatMs ?? beatMs;
        const duration = gate(kind, patch.parts[0]!, refBeat, patch.duration);
        const expected = instrumentParts(kind, patch.midi, duration, 1, 0, refBeat);
        const scale = patch.parts[0]!.gain / expected[0]!.gain;
        const normal = (parts: PartSpec[], gain: number) => canonical(parts.map(part => {
          const { at: _at, pan: _pan, ...voice } = part;
          return { ...voice, gain: part.gain / (gain || 1) };
        }));
        const samePan = patch.parts.every(part => (part.pan ?? 0) === (patch.parts[0]!.pan ?? 0));
        const sameStart = patch.parts.every(part => (part.at ?? 0) === (patch.parts[0]!.at ?? 0));
        if (!samePan || !sameStart || JSON.stringify(normal(patch.parts, scale)) !== JSON.stringify(normal(expected, 1))) {
          throw new Error(`${section.name} / ${track.name}: a note has a custom ${kind} recipe; its file was not replaced`);
        }
      }
      // Resolve the old mixer before removing recipes. Note velocities absorb baked dynamics;
      // panning is musical expression, so it stays in the score as a single optional number.
      const sounding = noteParts(track, note, beatMs), first = sounding[0]!;
      const unit = instrumentParts(kind, note.midi, note.duration, 1, 0, beatMs)[0]!.gain;
      const laneGain = track.instrument === 'drums' ? DRUM_LANES.find(lane => lane.instrument === kind)!.gain : 1;
      levels.push(first.gain / unit / laneGain);
      const pan = Math.max(-1, Math.min(1, first.pan ?? 0));
      if (pan) note.pan = pan; else delete note.pan;
      if (active) {
        // Undo the old exporter's section-edge clipping, but keep deliberate length edits.
        if (note.duration === patch.duration) note.duration = gate(kind, patch.parts[0]!, patch.beatMs ?? beatMs, note.duration);
        const offset = first.at ?? 0;
        note.at = Math.min(section.bars * tune.beats - 1e-10, note.at + offset / beatMs);
      }
      delete note.patch;
    }
    track.gain = Math.min(1, Math.max(...levels, 0.001)); track.pan = 0;
    track.notes.forEach((note, i) => { note.velocity = levels[i]! / track.gain; });
    delete track.patch;
  }
  return validateTune(tune);
}
