import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const root = new URL('../../', import.meta.url).pathname;
const patch = { midi: 80, duration: 1, beatMs: 500, parts: [{ kind: 'tone', wave: 'triangle', freq: 830.609395, gain: 0.2, bus: 'music', env: { a: 2, d: 180 } }] };
const notes = [
  { at: 1, midi: 80, duration: 1, velocity: 0.8, patch },
  { at: 3, midi: 78, duration: 0.5, velocity: 0.6 },
  { at: 5, midi: 76, duration: 1, velocity: 0.7 },
];
const fixture = (entries = notes, instrument = 'harp', key) => ({ version: 1, title: 'Gesture checks', bpm: 120, beats: 4,
  sections: [{ id: 'intro', name: 'Intro', bars: 4, tracks: [{ name: 'Gesture track', instrument, gain: 0.1, pan: 0, notes: structuredClone(entries) }] }],
  arrangement: [{ section: 'intro', repeats: 1 }], ...(key ? { key } : {}) });

/** Shared by the real editor's browser harness; leaves its fixture loaded for inspection. */
export async function checkGestures(page) {
  const button = name => page.getByRole('button', { name, exact: true });
  const savedNotes = () => page.evaluate(() => structuredClone(window.saved.sections[0].tracks[0].notes));
  const score = () => page.evaluate(() => JSON.stringify(window.saved));
  const count = async expected => assert.equal(await page.locator('.km-selection-count').textContent(), expected);
  async function load(tune = fixture()) {
    await page.evaluate(text => window.loadTune(text), JSON.stringify(tune));
    if (await page.getByLabel('Lowest MIDI pitch', { exact: true }).count()) {
      const lowest = page.getByLabel('Lowest MIDI pitch', { exact: true });
      await lowest.fill('48'); await lowest.press('Tab');
    }
    await page.locator('.km-roll-scroll').evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0; });
  }
  async function point(beat, midi = 80, drums = false) {
    const canvas = page.locator('.km-roll canvas');
    const box = await canvas.boundingBox();
    const metrics = await canvas.evaluate(el => ({ width: el.width, height: el.height, beatWidth: +el.dataset.beatWidth }));
    return { x: box.x + (64 + beat * metrics.beatWidth) * box.width / metrics.width,
      y: box.y + (typeof drums === 'number' ? drums : drums ? 84 : 34 + (83 - midi) * 20) * box.height / metrics.height };
  }
  async function drag(from, to, { shift = false, beforeRelease } = {}) {
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    if (beforeRelease) await beforeRelease();
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  }
  async function selectFirstTwo() {
    await button('Box select').click();
    // Both notes only partly overlap the rectangle; intersection must suffice.
    await drag(await point(1.5, 81), await point(3.25, 77));
    await count('2 notes selected');
  }

  await load(fixture([], 'harp', { root: 0, scale: 'major' }));
  assert.equal(await button('Draw notes').getAttribute('aria-pressed'), 'true');
  assert.equal(await button('Box select').getAttribute('aria-pressed'), 'false');
  await count('No notes selected');
  const empty = await score();
  await drag(await point(0.05, 80), await point(2, 77), {
    beforeRelease: async () => assert.equal(await score(), empty, 'drawing stays a preview until release'),
  });
  assert.deepEqual((await savedNotes()).map(({ at, duration, midi }) => ({ at, duration, midi })), [{ at: 0, duration: 2, midi: 79 }], 'draw fixes the starting pitch, snaps to scale and uses the dragged length');
  await button('Undo').click();
  assert.deepEqual(await savedNotes(), [], 'one undo removes the entire drawn note');
  assert.equal(await button('Undo').isEnabled(), false);
  await button('Redo').click();
  await drag(await point(6, 80), await point(4, 76));
  assert.deepEqual((await savedNotes()).at(-1), { at: 4, midi: 79, duration: 2, velocity: 0.8 }, 'leftward drawing retains the starting pitch');
  const click = await point(3.05, 80); await page.mouse.click(click.x, click.y);
  assert.equal((await savedNotes()).at(-1).duration, 0.5, 'a click still creates a minimum snap-length note');
  const beforeCancel = await score();
  await drag(await point(7, 80), await point(8.5, 78), { beforeRelease: async () => { await page.keyboard.press('Escape'); } });
  assert.equal(await score(), beforeCancel, 'Escape discards a drawn preview');
  await button('Undo').click();
  assert.equal((await savedNotes()).length, 2, 'cancelled drawing adds no history entry');

  await load();
  const original = await score();
  await selectFirstTwo();
  assert.equal(await button('Box select').getAttribute('aria-pressed'), 'true');
  assert.equal(await score(), original);
  assert.equal(await button('Undo').isEnabled(), false, 'box selection is not an edit');
  const first = await point(1.1, 80); await page.mouse.click(first.x, first.y);
  await count('2 notes selected');
  const second = await point(3.1, 78); await page.keyboard.down('Shift'); await page.mouse.click(second.x, second.y); await page.keyboard.up('Shift');
  await count('1 note selected');
  await drag(await point(2.75, 79), await point(3.6, 77), { shift: true });
  await count('2 notes selected');
  await drag(await point(4.5, 77), await point(6.25, 75), { shift: true });
  await count('3 notes selected');
  await selectFirstTwo();
  const beforeMove = await score();
  await drag(await point(1.1, 80), await point(2.1, 79), {
    beforeRelease: async () => assert.equal(await score(), beforeMove, 'group moves stay previews until release'),
  });
  assert.deepEqual((await savedNotes()).map(({ at, midi, duration }) => ({ at, midi, duration })), [
    { at: 2, midi: 79, duration: 1 }, { at: 4, midi: 77, duration: 0.5 }, { at: 5, midi: 76, duration: 1 },
  ]);
  await count('2 notes selected');
  await button('Undo').click();
  assert.deepEqual(await savedNotes(), notes, 'a group move is one undo entry');
  await selectFirstTwo();
  assert.equal(await button('Redo').isEnabled(), true, 'selection-only gestures preserve redo');
  await button('Redo').click();
  await count('2 notes selected');
  // The right edge applies a shared duration delta to the group.
  await drag(await point(2.95, 79), await point(3.45, 79));
  assert.deepEqual((await savedNotes()).map(n => n.duration), [1.5, 1, 1]);
  await button('Undo').click();
  assert.deepEqual((await savedNotes()).map(n => n.duration), [1, 0.5, 1]);
  const beforeMoveCancel = await score();
  await drag(await point(2.1, 79), await point(3.1, 78), { beforeRelease: async () => { await page.keyboard.press('Escape'); } });
  assert.equal(await score(), beforeMoveCancel, 'Escape discards every note in a group move');
  assert.equal(await button('Redo').isEnabled(), true);
  await button('Copy notes').click(); await button('Paste notes').click();
  const copied = await savedNotes();
  assert.equal(copied.length, 5);
  assert.deepEqual(copied.slice(3).map(({ at, ...note }) => note), copied.slice(0, 2).map(({ at, ...note }) => note), 'group paste preserves pitches, lengths, velocities and custom recipes');
  assert.equal(copied[4].at - copied[3].at, copied[1].at - copied[0].at, 'group paste preserves relative timing');
  await count('2 notes selected');
  await mkdir(root + 'dist/kmtune-check', { recursive: true });
  await page.screenshot({ path: root + 'dist/kmtune-check/editor-selection.png', fullPage: true });
  await page.keyboard.press('Delete');
  assert.equal((await savedNotes()).length, 3, 'Delete removes the selected group after toolbar actions');
  await button('Undo').click();
  assert.equal((await savedNotes()).length, 5);
  await button('Delete notes').click();
  assert.equal((await savedNotes()).length, 3);

  await load(); await selectFirstTwo();
  await drag(await point(1.1, 80), await point(-1.9, 80));
  assert.deepEqual((await savedNotes()).map(n => n.at), [0, 2, 5], 'group movement clamps at the section edge without collapsing relative timing');
  await button('Undo').click();
  assert.deepEqual(await savedNotes(), notes);

  await load(fixture([], 'kick', { root: 0, scale: 'major' }));
  await drag(await point(1, 60, true), await point(3, 60, true));
  assert.deepEqual((await savedNotes()).map(({ at, duration, midi }) => ({ at, duration, midi })), [{ at: 1, duration: 2, midi: 60 }], 'drum drawing supports lengths without scale transposition');

  await load(fixture([]));
  await button('+ Track').click(); await button('Add Drum kit track').click();
  assert.equal(await page.getByLabel('Instrument', { exact: true }).inputValue(), 'drums');
  assert.equal(await page.getByLabel('Drum kit sequencer', { exact: true }).count(), 1);
  for (const [beat, y] of [[1, 54], [2, 114], [3, 174]]) {
    const hit = await point(beat, 60, y); await page.mouse.click(hit.x, hit.y);
  }
  await drag(await point(4, 60, 114), await point(5, 60, 114));
  assert.deepEqual(await page.evaluate(() => window.saved.sections[0].tracks[1].notes.map(({ at, midi, duration }) => ({ at, midi, duration }))), [
    { at: 1, midi: 36, duration: 0.5 }, { at: 2, midi: 38, duration: 0.5 }, { at: 3, midi: 42, duration: 0.5 }, { at: 4, midi: 38, duration: 1 },
  ], 'one drum-kit track authors kick, snare and hat rows');
  await button('Box select').click();
  await drag(await point(0.5, 60, 40), await point(5.5, 60, 190));
  await count('4 notes selected');
  await page.keyboard.press('Delete');
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[1].notes.length), 0);
  await button('Undo').click();
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[1].notes.length), 4);

  await load(fixture([]));
  await button('Play arrangement').click(); await button('Stop').waitFor();
  await page.waitForFunction(() => parseFloat(document.querySelector('.km-playhead').style.left) > 72);
  const live = await page.evaluate(() => ({ audio: [window.audioInstances, window.audioCloses], updates: window.workletMessages.filter(m => m.type === 'tune-update').length,
    position: parseFloat(document.querySelector('.km-playhead').style.left) }));
  await drag(await point(0.05, 80), await point(2, 80), {
    beforeRelease: async () => assert.equal(await page.evaluate(() => window.workletMessages.filter(m => m.type === 'tune-update').length), live.updates, 'no audio edits are sent while drawing'),
  });
  assert.deepEqual(await page.evaluate(() => [window.audioInstances, window.audioCloses]), live.audio);
  assert.equal(await page.evaluate(() => window.workletMessages.filter(m => m.type === 'tune-update').length), live.updates + 1);
  assert.equal(await button('Stop').count(), 1);
  await page.waitForFunction(before => parseFloat(document.querySelector('.km-playhead').style.left) >= before, live.position);
  await button('Undo').click();
  assert.deepEqual(await page.evaluate(() => [window.audioInstances, window.audioCloses]), live.audio, 'undoing a drawn note keeps the same transport');
  assert.equal(await button('Stop').count(), 1);
  await button('Stop').click();
}
