import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOODS } from '../../client/sound/music.ts';
import { newTune, writeTune } from '../../client/sound/tune.ts';
import { EMPTY_LIBRARY } from '../../client/sound/library.ts';
import { readTuneLibrary } from './tunes.ts';

const authored = fileURLToPath(new URL('../../lore/Tunes/', import.meta.url));

function fixture(fn: (root: string, tunes: string, save: (name: string, value: unknown) => void) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'kingmaker-tune-loader-')), tunes = join(root, 'Tunes');
  mkdirSync(tunes);
  const save = (name: string, value: unknown) => { const path = join(root, name); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); };
  save('Tunes/day.kmtune', writeTune(newTune()));
  save('Tunes/night.kmtune', writeTune({ ...newTune(), title: 'Night' }));
  try { fn(root, tunes, save); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('build loads authored default music and leaves effects procedural', () => {
  const library = readTuneLibrary(authored);
  assert.deepEqual(library.cues, {});
  // Authors may add more scores for scene/map assignments alongside these defaults.
  for (const mood of MOODS) assert.ok(library.tunes[library.music[mood]!], mood);
  for (const tune of Object.values(library.tunes)) for (const section of tune.sections) for (const track of section.tracks) {
    assert.notEqual(track.instrument, 'custom', 'add shared instruments to the engine');
    assert.equal(track.patch, undefined, 'scores reference engine presets');
    assert.ok(track.notes.every(note => !note.patch), 'notes must not duplicate synth definitions');
  }
});

test('build extracts scene and map time-of-day assignments and ignores vault metadata', () => fixture((root, tunes, save) => {
  save('Places/Market.kmmap', { version: 2, id: 'market', music: { morning: 'day', night: 'night', combat: 'day' } });
  save('Scenes/Meeting.kmscene', { version: 2, id: 'meeting', music: { afternoon: 'day', night: 'night' } });
  save('.obsidian/backup.kmscene', '{broken internal metadata');
  const library = readTuneLibrary(tunes, root);
  assert.deepEqual(library.maps, { market: { morning: 'day', night: 'night', combat: 'day' } });
  assert.deepEqual(library.scenes, { meeting: { afternoon: 'day', night: 'night' } });
}));

test('vault assignments replace campaign defaults and an empty object clears earlier slots', () => fixture((root, tunes, save) => {
  save('Campaigns/Market.kmmap', { version: 2, id: 'market', music: { morning: 'day', night: 'night', combat: 'day' } });
  save('Campaigns/Meeting.kmscene', { version: 2, id: 'meeting', music: { morning: 'day', night: 'night' } });
  save('Game/Market.kmmap', { version: 2, id: 'market', music: { morning: 'night' } });
  save('Game/Meeting.kmscene', { version: 2, id: 'meeting', music: {} });
  const library = readTuneLibrary(tunes, [join(root, 'Campaigns'), join(root, 'Game')]);
  assert.deepEqual(library.maps, { market: { morning: 'night' } }, 'later files replace the whole assignment, not a merge with removed slots');
  assert.deepEqual(library.scenes, { meeting: {} }, 'an empty override restores the map or game defaults');
  const reversed = readTuneLibrary(tunes, [join(root, 'Game'), join(root, 'Campaigns')]);
  assert.deepEqual(reversed.maps?.market, { morning: 'day', night: 'night', combat: 'day' });
  assert.deepEqual(reversed.scenes?.meeting, { morning: 'day', night: 'night' });
  save('Game/Market.kmmap', { version: 2, id: 'market' });
  save('Game/Meeting.kmscene', { version: 2, id: 'meeting' });
  const removed = readTuneLibrary(tunes, [join(root, 'Campaigns'), join(root, 'Game')]);
  assert.deepEqual(removed.maps?.market, {}, 'removing the final map field in the editor also clears defaults');
  assert.deepEqual(removed.scenes?.meeting, {}, 'removing the final scene field in the editor also clears defaults');
}));

test('build rejects invalid or missing tune and section references before bundling', () => fixture((_root, tunes, save) => {
  const invalid = [
    { version: 2, music: {}, cues: {} },
    { version: 1, music: [], cues: {} },
    { version: 1, music: {}, cues: [] },
    { version: 1, music: { impossible: 'day' }, cues: {} },
    { version: 1, music: { town: 'missing' }, cues: {} },
    { version: 1, music: { town: '../escape' }, cues: {} },
    { version: 1, music: {}, cues: { 'ui.move': null } },
    { version: 1, music: {}, cues: { 'ui.move': { tune: 'day', section: 'missing' } } },
    { version: 1, music: {}, cues: { 'ui.move': { tune: 'missing', section: 'intro' } } },
    { version: 1, music: {}, cues: { 'ui.move': { tune: 'day', section: 'intro', source: { ms: -1 } } } },
  ];
  for (const catalog of invalid) { save('Tunes/catalog.json', catalog); assert.throws(() => readTuneLibrary(tunes), /catalog\.json/, JSON.stringify(catalog)); }
}));

test('broken scene/map assignments and ambiguous duplicate ids fail with file context', () => fixture((root, tunes, save) => {
  save('a.kmscene', { version: 2, id: 'scene', music: { night: 'absent' } });
  assert.throws(() => readTuneLibrary(tunes, root), /a\.kmscene.*missing tune absent/);
  save('a.kmscene', { version: 2, id: 'scene', music: { dawn: 'day' } });
  assert.throws(() => readTuneLibrary(tunes, root), /a\.kmscene.*music slot/);
  save('a.kmscene', { version: 2, id: 'scene', music: { night: 'night' } });
  save('b.kmscene', { version: 2, id: 'scene', music: { night: 'day' } });
  assert.throws(() => readTuneLibrary(tunes, root), /conflicting music assignments for scene/);
}));

test('invalid scores include their file path and missing library remains an empty fallback', () => fixture((root, tunes, save) => {
  save('Tunes/broken.kmtune', '{"version":999}');
  assert.throws(() => readTuneLibrary(tunes), /broken\.kmtune.*unsupported version/);
  assert.deepEqual(readTuneLibrary(join(root, 'absent')), EMPTY_LIBRARY);
}));
