/** Browser smoke test of the actual editor and audio worklet, independent of an Obsidian install. */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { checkGestures } from './gestures.test.mjs';
const root = new URL('../../', import.meta.url).pathname;
const editor = await build({ stdin: { contents: `import { TuneEditor } from './tools/kmtune/editor.ts'; import { newTune, parseTune } from './client/sound/tune.ts'; window.saved=newTune(); window.loadTune=text=>{ window.editor?.destroy(); window.saved=parseTune(text); window.editor=new TuneEditor(document.querySelector('main'), structuredClone(window.saved), '/worklet.js', t=>window.saved=t); }; window.loadTune(JSON.stringify(window.saved));`, resolveDir: root }, bundle: true, format: 'esm', write: false });
const worklet = await build({ entryPoints: [root + 'web/page/sound-worklet.ts'], bundle: true, format: 'esm', write: false });
const plugin = await build({ entryPoints: [root + 'tools/kmtune/main.ts'], bundle: true, format: 'cjs', external: ['obsidian'], write: false });
const css = await readFile(new URL('styles.css', import.meta.url));
const server = createServer((req, res) => {
  const routes = { '/editor.js': ['text/javascript', editor.outputFiles[0].contents], '/worklet.js': ['text/javascript', worklet.outputFiles[0].contents], '/styles.css': ['text/css', css] };
  const route = routes[req.url] ?? ['text/html', '<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body style="margin:0;height:100vh"><main style="height:100%"></main><script type="module" src="/editor.js"></script></body></html>'];
  res.writeHead(200, { 'Content-Type': route[0] }); res.end(route[1]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    window.audioInstances = 0; window.audioCloses = 0; window.workletErrors = []; window.workletMessages = [];
    const NativeAudioWorkletNode = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeAudioWorkletNode {
      constructor(...args) { super(...args); this.addEventListener('processorerror', () => window.workletErrors.push('Audio worklet processor failed'));
        const send = this.port.postMessage.bind(this.port); this.port.postMessage = messages => { window.workletMessages.push(...structuredClone(messages)); send(messages); };
      }
    };
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.audioInstances++; }
      close() { window.audioCloses++; return super.close(); }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await checkGestures(page);
  await page.reload();
  // Clicking Undo commits and reverts a focused field in one click, even for the first edit.
  await page.getByLabel('Title', { exact: true }).fill('Pending title');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'New tune');
  assert.equal(await page.evaluate(() => window.saved.title), 'New tune');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal(await page.evaluate(() => window.saved.title), 'Pending title');
  await page.reload();
  // Keyboard history stays on the edited section/track. Selection clicks are not undo steps.
  await page.getByRole('button', { name: '+ Section', exact: true }).click();
  await page.getByRole('button', { name: '+ Track', exact: true }).click();
  await page.getByRole('button', { name: 'Add Bell track', exact: true }).click();
  await page.locator('.km-roll-scroll').evaluate(el => { el.scrollTop = 0; });
  await page.getByLabel('Piano roll').click({ position: { x: 90, y: 100 } });
  await page.getByLabel('Piano roll').click({ position: { x: 180, y: 120 } });
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[1].notes.length), 1);
  assert.equal(await page.getByRole('heading', { level: 2 }).textContent(), 'Section 2');
  assert.equal(await page.getByLabel('Instrument', { exact: true }).inputValue(), 'bell');
  await page.getByLabel('Piano roll').click({ position: { x: 90, y: 100 } });
  assert.equal(await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled(), true);
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[1].notes.length), 2);
  await page.keyboard.press('Meta+z');
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[1].notes.length), 1);
  await page.keyboard.press('Control+y');
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[1].notes.length), 2);
  const notesBeforeTyping = await page.evaluate(() => JSON.stringify(window.saved));
  await page.getByLabel('Title', { exact: true }).focus(); await page.keyboard.press('End'); await page.keyboard.type(' draft'); await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => JSON.stringify(window.saved)), notesBeforeTyping, 'text undo leaves score history alone');
  await page.reload();
  // Live note movement, resize and undo use the same audio context and transport position.
  await page.getByRole('button', { name: '+ Track', exact: true }).click();
  await page.getByRole('button', { name: 'Add Bell track', exact: true }).click();
  await page.locator('.km-roll-scroll').evaluate(el => { el.scrollTop = 0; });
  await page.getByLabel('Piano roll').click({ position: { x: 90, y: 100 } });
  await page.getByRole('button', { name: 'Play arrangement', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await page.waitForFunction(() => parseFloat(document.querySelector('.km-playhead').style.left) > 72);
  const liveAudio = await page.evaluate(() => [window.audioInstances, window.audioCloses]);
  const livePosition = await page.locator('.km-playhead').evaluate(el => parseFloat(el.style.left));
  let liveBox = await page.getByLabel('Piano roll').boundingBox();
  await page.mouse.move(liveBox.x + 80, liveBox.y + 94); await page.mouse.down(); await page.mouse.move(liveBox.x + 152, liveBox.y + 114); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[1].notes[0].at), 1);
  await page.waitForFunction(before => parseFloat(document.querySelector('.km-playhead').style.left) >= before, livePosition);
  assert.deepEqual(await page.evaluate(() => [window.audioInstances, window.audioCloses]), liveAudio);
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.workletMessages.at(-1).type), 'tune-update');
  assert.equal(await page.evaluate(() => window.workletMessages.at(-1).tune.sections[0].tracks[1].notes[0].at), 1);
  liveBox = await page.getByLabel('Piano roll').boundingBox();
  await page.mouse.move(liveBox.x + 169, liveBox.y + 114); await page.mouse.down(); await page.mouse.move(liveBox.x + 205, liveBox.y + 114); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[1].notes[0].duration), 1);
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[1].notes[0].duration), 0.5);
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
  assert.deepEqual(await page.evaluate(() => [window.audioInstances, window.audioCloses]), liveAudio);
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => window.workletErrors), []);
  await page.reload();
  await page.getByRole('button', { name: '+ Section', exact: true }).click();
  await page.getByLabel('Section name', { exact: true }).fill('Chorus'); await page.getByLabel('Section name', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '+ Add selected section', exact: true }).click();
  await page.getByLabel('Repeats 2', { exact: true }).fill('3'); await page.getByLabel('Repeats 2', { exact: true }).press('Tab');
  assert.equal(await page.evaluate(() => window.saved.arrangement[1].repeats), 3);
  await page.getByRole('button', { name: 'Loop arrangement', exact: true }).click();
  await page.getByLabel('Loop from row', { exact: true }).fill('2'); await page.getByLabel('Loop from row', { exact: true }).press('Tab');
  assert.deepEqual(await page.evaluate(() => window.saved.loop), { from: 1, to: 1 });
  await page.getByLabel('Zoom', { exact: true }).selectOption('48');
  await page.locator('.km-roll-scroll').evaluate(el => { el.scrollTop = 0; });
  const canvas = page.getByLabel('Piano roll');
  await canvas.click({ position: { x: 80, y: 100 } });
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[0].notes.length), 1);
  // Drag the note one beat later and a semitone lower.
  let box = await canvas.boundingBox();
  await page.mouse.move(box.x + 74, box.y + 94); await page.mouse.down(); await page.mouse.move(box.x + 122, box.y + 114); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[0].notes[0].at), 1);
  // Resize from half a beat to one beat using the right edge.
  box = await canvas.boundingBox();
  await page.mouse.move(box.x + 133, box.y + 114); await page.mouse.down(); await page.mouse.move(box.x + 157, box.y + 114); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[0].notes[0].duration), 1);
  await page.getByRole('button', { name: 'Copy note', exact: true }).click(); await page.getByRole('button', { name: 'Paste note', exact: true }).click();
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[0].notes.length), 2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[0].notes.length), 1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[0].notes.length), 2);
  // Invalid repeats are rejected without overwriting the score.
  await page.getByLabel('Repeats 2', { exact: true }).fill('0'); await page.getByLabel('Repeats 2', { exact: true }).press('Tab');
  assert.equal(await page.evaluate(() => window.saved.arrangement[1].repeats), 3);
  assert.match(await page.getByRole('status').textContent(), /Invalid/);
  await page.getByRole('button', { name: 'Chorus', exact: true }).click();
  await page.getByLabel('Repeats 2', { exact: true }).fill('2'); await page.getByLabel('Repeats 2', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Play section', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.km-playhead').style.left !== '64px');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  assert.equal(await page.locator('.km-playhead').isVisible(), false);
  // Snapshot the real editor, and preserve a composed file for a reload check.
  const saved = await page.evaluate(() => JSON.stringify(window.saved));
  await page.evaluate(text => window.loadTune(text), saved);
  assert.equal(await page.getByLabel('Repeats 2', { exact: true }).inputValue(), '2');
  assert.equal(await page.evaluate(() => window.saved.sections[1].tracks[0].notes.length), 2);
  // Arrangement blocks select the actual section; names and references are distinct controls.
  await page.getByRole('button', { name: 'Edit section in row 2', exact: true }).click();
  assert.equal(await page.getByRole('heading', { level: 2 }).textContent(), 'Chorus');
  assert.equal(await page.getByLabel('Section name', { exact: true }).inputValue(), 'Chorus');
  assert.equal(await page.getByRole('button', { name: 'Edit section in row 2', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '+ Add selected section', exact: true }).click();
  await page.getByLabel('Name 2', { exact: true }).fill('Refrain'); await page.getByLabel('Name 2', { exact: true }).press('Tab');
  assert.equal(await page.getByLabel('Name 3', { exact: true }).inputValue(), 'Refrain');
  assert.equal(await page.getByRole('heading', { level: 2 }).textContent(), 'Refrain');
  assert.equal(await page.evaluate(() => window.saved.sections[1].name), 'Refrain');
  await page.getByLabel('Use section 2', { exact: true }).selectOption('intro');
  assert.equal(await page.getByRole('heading', { level: 2 }).textContent(), 'Intro');
  assert.equal(await page.getByLabel('Name 2', { exact: true }).inputValue(), 'Intro');
  assert.equal(await page.evaluate(() => window.saved.arrangement[1].section), 'intro');
  assert.equal(await page.evaluate(() => window.saved.arrangement[1].repeats), 2);
  // Clicking the block background selects it as well, with no accidental replacement.
  await page.getByRole('group', { name: 'Arrangement row 3: Refrain', exact: true }).locator('.km-index').click();
  assert.equal(await page.getByRole('heading', { level: 2 }).textContent(), 'Refrain');
  // Focusing another block's name selects that section and still lets text editing work.
  await page.getByLabel('Name 1', { exact: true }).fill('Opening'); await page.getByLabel('Name 1', { exact: true }).press('Tab');
  assert.equal(await page.getByRole('heading', { level: 2 }).textContent(), 'Opening');
  assert.equal(await page.getByLabel('Name 2', { exact: true }).inputValue(), 'Opening');
  assert.equal(await page.evaluate(() => window.saved.sections[1].name), 'Refrain');
  const renamed = await page.evaluate(() => JSON.stringify(window.saved));
  await page.evaluate(text => window.loadTune(text), renamed);
  assert.equal(await page.getByLabel('Name 1', { exact: true }).inputValue(), 'Opening');
  await page.evaluate(text => window.loadTune(text), saved);
  // Page teardown must be silent, including if a preview is still starting.
  await page.reload(); await page.getByRole('button', { name: 'Play section', exact: true }).click();
  await page.evaluate(() => window.editor.destroy());
  assert.deepEqual(errors, []);
  await page.reload();
  // Adding a chosen instrument selects it without closing or restarting the live arrangement.
  await page.getByRole('button', { name: 'Play arrangement', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  const audioBefore = await page.evaluate(() => [window.audioInstances, window.audioCloses]);
  await page.getByRole('button', { name: '+ Track', exact: true }).click();
  await page.getByRole('button', { name: 'Add Bell track', exact: true }).click();
  assert.equal(await page.getByLabel('Instrument', { exact: true }).inputValue(), 'bell');
  assert.equal(await page.getByRole('button', { name: 'Bell', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
  assert.deepEqual(await page.evaluate(() => [window.audioInstances, window.audioCloses]), audioBefore);
  await page.waitForFunction(() => parseFloat(document.querySelector('.km-playhead').style.left) > 64);
  // Space works immediately after a redraw, without re-clicking the roll.
  await page.keyboard.press('Space');
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0);
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  // Spaces in names are text, not transport commands.
  const title = page.getByLabel('Title', { exact: true }); await title.focus(); await title.press('End');
  const titleBefore = await title.inputValue(); await title.press('Space');
  assert.equal(await title.inputValue(), titleBefore + ' ');
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
  await title.fill(titleBefore); await page.getByRole('button', { name: 'Stop', exact: true }).click();
  // Inline track instrument changes the selected track and survives a save/reload.
  const notesBeforeInstrumentChange = await page.evaluate(() => JSON.stringify(window.saved.sections[0].tracks[0].notes));
  await page.getByLabel('Instrument for Harp', { exact: true }).selectOption('lute');
  assert.equal(await page.getByLabel('Instrument', { exact: true }).inputValue(), 'lute');
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[0].instrument), 'lute');
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[1].instrument), 'bell');
  assert.equal(await page.evaluate(() => JSON.stringify(window.saved.sections[0].tracks[0].notes)), notesBeforeInstrumentChange);
  const instrumentSave = await page.evaluate(() => JSON.stringify(window.saved));
  await page.evaluate(text => window.loadTune(text), instrumentSave);
  assert.equal(await page.getByLabel('Instrument for Harp', { exact: true }).inputValue(), 'lute');
  // The obvious sidebar action deletes exactly that track; Undo restores it.
  await page.getByRole('button', { name: 'Delete track Bell', exact: true }).click();
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks.length), 1);
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[0].notes.length), 4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[1].instrument), 'bell');
  await page.getByRole('button', { name: 'Delete track Bell', exact: true }).click();
  // Pressing Space on a button must toggle once, rather than also activating that button.
  await page.getByRole('button', { name: 'Play section', exact: true }).focus();
  await page.keyboard.down('Space'); await page.keyboard.down('Space'); await page.keyboard.up('Space');
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await page.keyboard.press('Space');
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Duplicate section', exact: true }).click();
  await page.getByLabel('Section name', { exact: true }).fill('Chorus'); await page.getByLabel('Section name', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '+ Add selected section', exact: true }).click();
  await page.getByLabel('Repeats 2', { exact: true }).fill('3'); await page.getByLabel('Repeats 2', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Loop arrangement', exact: true }).click();
  await mkdir(root + 'dist/kmtune-check', { recursive: true });
  await page.screenshot({ path: root + 'dist/kmtune-check/editor.png', fullPage: true });
  await page.setViewportSize({ width: 650, height: 900 });
  assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: root + 'dist/kmtune-check/editor-narrow.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.body.style.cssText += ';--background-primary:#faf9fc;--background-secondary:#efecf2;--background-modifier-border:#d5cddf;--text-normal:#332b3c;--text-muted:#766780;--interactive-accent:#8866ab'; });
  await page.screenshot({ path: root + 'dist/kmtune-check/editor-light.png', fullPage: true });
  // Root + scale are persisted, constrain new notes and numeric edits, and leave existing notes intact.
  await page.reload();
  const originalPitches = await page.evaluate(() => window.saved.sections[0].tracks[0].notes.map(n => n.midi));
  await page.getByLabel('Root note', { exact: true }).selectOption('0');
  await page.getByLabel('Scale', { exact: true }).selectOption('major');
  assert.deepEqual(await page.evaluate(() => window.saved.sections[0].tracks[0].notes.map(n => n.midi)), originalPitches);
  await page.locator('.km-roll-scroll').evaluate(el => { el.scrollTop = 0; });
  const bottom = +(await page.getByLabel('Lowest MIDI pitch', { exact: true }).inputValue());
  await page.getByLabel('Piano roll', { exact: true }).click({ position: { x: 156, y: 34 + (bottom + 35 - 73) * 20 } });
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[0].notes.at(-1).midi), 72);
  await page.getByLabel('Note MIDI', { exact: true }).fill('75'); await page.getByLabel('Note MIDI', { exact: true }).press('Tab');
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[0].notes.at(-1).midi), 74);
  const scaleSaved = await page.evaluate(() => JSON.stringify(window.saved)); await page.evaluate(text => window.loadTune(text), scaleSaved);
  assert.equal(await page.getByLabel('Scale', { exact: true }).inputValue(), 'major');
  assert.equal(await page.getByLabel('Root note', { exact: true }).inputValue(), '0');
  await page.screenshot({ path: root + 'dist/kmtune-check/editor-scale.png', fullPage: true });
  // Full instrument palette, with a labelled percussion lane and no misleading pitch controls.
  const palette = await page.getByLabel('Instrument', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value));
  for (const kind of ['bass', 'pulse-bass', 'pad', 'drone', 'kick', 'snare', 'hat', 'custom']) assert.ok(palette.includes(kind));
  await page.getByRole('button', { name: '+ Track', exact: true }).click();
  await page.getByRole('button', { name: 'Add Drum kit track', exact: true }).click();
  assert.equal(await page.getByLabel('Lowest MIDI pitch', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Scale', { exact: true }).count(), 0);
  await page.getByLabel('Drum kit sequencer', { exact: true }).click({ position: { x: 90, y: 54 } });
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[1].notes.length), 1);
  assert.equal(await page.getByLabel('Note MIDI', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Play section', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.screenshot({ path: root + 'dist/kmtune-check/editor-drums.png', fullPage: true });
  // Custom sounds expose every synth parameter and support new notes and worklet playback.
  await page.getByRole('button', { name: '+ Track', exact: true }).click();
  await page.getByRole('button', { name: 'Add Custom synth track', exact: true }).click();
  await page.locator('.km-roll-scroll').evaluate(el => { el.scrollTop = 0; });
  await page.getByLabel('Piano roll', { exact: true }).click({ position: { x: 90, y: 354 } });
  await page.locator('details[data-sound="Track sound"] > summary').click();
  await page.locator('details[data-sound="Track sound raw"] > summary').click();
  const recipe = page.getByLabel('Track sound recipe JSON', { exact: true });
  const patch = JSON.parse(await recipe.inputValue()); patch.parts[0].fm = { ratio: 2.5, index: 0.8, fall: 150 };
  await recipe.fill(JSON.stringify(patch)); await page.getByRole('button', { name: 'Apply track sound recipe', exact: true }).click();
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[2].patch.parts[0].fm.ratio), 2.5);
  assert.equal(await page.locator('details[data-sound="Track sound"]').getAttribute('open'), '');
  await page.getByRole('button', { name: 'Play section', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await page.waitForTimeout(700);
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.screenshot({ path: root + 'dist/kmtune-check/editor-patch.png', fullPage: true });
  assert.deepEqual(await page.evaluate(() => window.workletErrors), []);
  // Replacing an imported/custom recipe with a preset really changes the sound, preserving notes.
  const customNotes = await page.evaluate(() => window.saved.sections[0].tracks[2].notes.length);
  await page.getByLabel('Instrument', { exact: true }).selectOption('flute');
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[2].patch), undefined);
  assert.equal(await page.evaluate(() => window.saved.sections[0].tracks[2].notes.length), customNotes);
  // An Obsidian autosave echo must retain the editor instance, focus and transport.
  await page.evaluate(({ code, score }) => {
    const container = document.createElement('div'); document.body.append(container);
    class Scope { register() {} }
    const app = { scope: new Scope(), vault: { adapter: { getResourcePath: () => '/worklet.js' }, configDir: '.obsidian' } };
    class Plugin { constructor() { this.app = app; this.manifest = { id: 'kingmaker-tunes' }; } registerView(_id, factory) { this.factory = factory; } registerExtensions() {} addCommand() {} }
    class TextFileView { constructor() { this.app = app; this.contentEl = container; } requestSave() {} }
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, () => ({ Plugin, TextFileView, Scope, Notice: class {}, normalizePath: value => value }));
    const plugin = new module.exports.default(); plugin.onload(); const view = plugin.factory({});
    view.setViewData(score, true); const canvas = container.querySelector('canvas');
    view.setViewData(score, false);
    if (container.querySelector('canvas') !== canvas) throw new Error('Autosave echo rebuilt the editor');
    view.clear(); container.remove();
  }, { code: plugin.outputFiles[0].text, score: saved });
  assert.deepEqual(errors, []);
  console.log('Sequencer browser checks passed: sections, repeats, loops, piano-roll editing, undo/redo, validation, worklet playback and teardown.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
