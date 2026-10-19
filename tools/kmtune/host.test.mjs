import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

// Exercise the public Obsidian file-view contract without launching Obsidian.
const code = (await build({
  entryPoints: [new URL('./main.ts', import.meta.url).pathname], bundle: true, write: false,
  format: 'cjs', platform: 'node', external: ['obsidian', './editor.ts'],
})).outputFiles[0].text;
const example = JSON.parse(readFileSync(new URL('../../assets/music/lanterns.example.kmtune', import.meta.url), 'utf8'));
const text = title => JSON.stringify({ ...example, title }, null, 2) + '\n';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness() {
  const editors = [], contents = new Map(), writes = [];
  const element = () => ({ children: [], replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } });
  class Scope {
    constructor(parent) { this.parent = parent; this.handlers = []; }
    register(modifiers, key, callback) { const handler = { modifiers, key, callback }; this.handlers.push(handler); return handler; }
  }
  const app = { scope: new Scope(), vault: {
    configDir: '.obsidian', adapter: { getResourcePath: value => value },
    async cachedRead(file) { return contents.get(file.path); },
    async process(file, change) { const next = change(contents.get(file.path)); contents.set(file.path, next); writes.push(next); return next; },
  } };
  class TextFileView {
    constructor(leaf) { this.app = leaf.app; this.contentEl = element(); this.file = null; this.data = ''; this.saveRequests = 0; this.requestSave = () => this.saveRequests++; }
    async onLoadFile(file) { this.file = file; this.data = await app.vault.cachedRead(file); this.setViewData(this.data, true); }
    async onUnloadFile() { await this.save(true); this.file = null; }
    async onClose() {}
  }
  class Plugin {
    constructor() { this.app = app; this.manifest = { id: 'kingmaker-tunes' }; }
    registerView(_name, factory) { this.factory = factory; }
    registerExtensions() {}
    addCommand() {}
  }
  class TuneEditor {
    constructor(root, tune, _worklet, save) { this.root = root; this.tune = tune; this.save = save; this.destroyed = false; this.historyCalls = 0; editors.push(this); }
    destroy() { this.destroyed = true; }
    handleHistoryKey(event) {
      if (event.defaultPrevented) return true;
      if (event.target?.editable) return false;
      this.historyCalls++; event.preventDefault(); return true;
    }
  }
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, structuredClone, document: { createElement: element }, require: name => {
    if (name === 'obsidian') return { Plugin, TextFileView, Scope, Notice: class {}, normalizePath: value => value };
    if (name === './editor.ts') return { TuneEditor };
    throw new Error(`Unexpected module: ${name}`);
  } });
  const plugin = new module.exports.default(); plugin.onload(); const view = plugin.factory({ app });
  const add = (path, title) => { const file = { path, basename: path.replace(/.*\//, '').replace(/\.kmtune$/, '') }; contents.set(path, text(title)); return file; };
  const current = () => editors.at(-1);
  const edit = (title, editor = current()) => { const next = structuredClone(editor.tune); next.title = title; editor.tune = next; editor.save(next); };
  return { app, plugin, view, editors, contents, writes, add, current, edit };
}

for (const [name, modifiers, key] of [
  ['undo', ['Mod'], 'z'], ['shift redo', ['Mod', 'Shift'], 'z'], ['Y redo', ['Mod'], 'y'],
]) test(`focused Obsidian scope routes ${name} once and leaves native input undo alone`, async () => {
  const h = harness(); await h.view.onLoadFile(h.add('a.kmtune', 'A'));
  assert.equal(h.view.scope.parent, h.app.scope);
  const handler = h.view.scope.handlers.find(handler => handler.key === key && JSON.stringify(handler.modifiers) === JSON.stringify(modifiers));
  assert.ok(handler);
  const event = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  const fromScope = event(); assert.equal(handler.callback(fromScope), false);
  h.current().handleHistoryKey(fromScope); assert.equal(h.current().historyCalls, 1);
  const fromRoot = event(); h.current().handleHistoryKey(fromRoot); assert.equal(handler.callback(fromRoot), false);
  assert.equal(h.current().historyCalls, 2);
  const input = { ...event(), target: { editable: true } };
  assert.equal(handler.callback(input), undefined); assert.equal(input.defaultPrevented, false);
  assert.equal(h.current().historyCalls, 2);
});

test('current autosave echo keeps the same editor and undo state', async () => {
  const h = harness(); await h.view.onLoadFile(h.add('a.kmtune', 'A')); const editor = h.current();
  h.edit('B'); const saved = h.view.getViewData(); h.view.setViewData(saved, false);
  assert.equal(h.current(), editor); assert.equal(editor.destroyed, false); assert.equal(h.editors.length, 1);
  assert.equal(h.view.data, saved);
});

test('an in-flight own-save echo preserves a newer draft and its undo state', async () => {
  const h = harness(), file = h.add('a.kmtune', 'A'); await h.view.onLoadFile(file); const editor = h.current();
  h.edit('B'); const first = h.view.getViewData(), gate = deferred(), started = deferred(), process = h.app.vault.process;
  h.app.vault.process = async (...args) => { started.resolve(); await gate.promise; const saved = await process(...args); h.view.setViewData(saved, false); return saved; };
  const pending = h.view.save(); await started.promise;
  h.edit('C'); gate.resolve(); await pending;
  assert.equal(h.contents.get(file.path), first); assert.equal(JSON.parse(h.view.getViewData()).title, 'C');
  assert.equal(h.current(), editor); assert.equal(editor.destroyed, false);
  await h.view.save(); assert.equal(JSON.parse(h.contents.get(file.path)).title, 'C');
});

test('late saved-baseline echoes retain history while real external edits replace the editor', async () => {
  const h = harness(), file = h.add('a.kmtune', 'A'); await h.view.onLoadFile(file); const editor = h.current();
  h.edit('B'); await h.view.save(); const saved = h.contents.get(file.path);
  h.edit('C'); h.view.setViewData(saved, false);
  assert.equal(JSON.parse(h.view.getViewData()).title, 'C'); assert.equal(h.current(), editor);
  const external = text('Outside'); h.contents.set(file.path, external); h.view.setViewData(external, false);
  assert.equal(h.view.getViewData(), external); assert.notEqual(h.current(), editor); assert.equal(editor.destroyed, true);
  h.edit('Stale editor callback', editor); assert.equal(h.view.getViewData(), external);
});

test('opening a different file clears history even when its contents are identical', async () => {
  const h = harness(); await h.view.onLoadFile(h.add('a.kmtune', 'A')); const editor = h.current();
  await h.view.onLoadFile(h.add('b.kmtune', 'A'));
  assert.notEqual(h.current(), editor); assert.equal(editor.destroyed, true);
  h.edit('Old file callback', editor); assert.equal(JSON.parse(h.view.getViewData()).title, 'A');
});

test('a delayed save cannot overwrite an externally reloaded file or clear its new editor', async () => {
  const h = harness(), file = h.add('a.kmtune', 'A'); await h.view.onLoadFile(file); h.edit('B');
  const gate = deferred(), started = deferred(), process = h.app.vault.process;
  h.app.vault.process = async (...args) => { started.resolve(); await gate.promise; return process(...args); };
  const pending = h.view.save(true); await started.promise;
  const external = text('Outside'); h.contents.set(file.path, external); h.view.setViewData(external, false); const editor = h.current();
  gate.resolve(); await assert.rejects(pending, /Save conflict/);
  assert.equal(h.contents.get(file.path), external); assert.equal(h.view.getViewData(), external); assert.equal(editor.destroyed, false);
  h.edit('After conflict'); await h.view.save(); assert.equal(JSON.parse(h.contents.get(file.path)).title, 'After conflict');
});

test('unload flushes the draft and invalid original bytes are preserved', async () => {
  const h = harness(), file = h.add('a.kmtune', 'A'); await h.view.onLoadFile(file); h.edit('B'); const editor = h.current();
  await h.view.onUnloadFile(); assert.equal(JSON.parse(h.contents.get(file.path)).title, 'B'); assert.equal(editor.destroyed, true);
  assert.equal(h.view.getViewData(), '');
  h.contents.set(file.path, 'invalid original bytes'); await h.view.onLoadFile(file); await h.view.save();
  assert.equal(h.contents.get(file.path), 'invalid original bytes'); assert.equal(h.view.getViewData(), 'invalid original bytes');
});
