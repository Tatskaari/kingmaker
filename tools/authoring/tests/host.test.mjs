import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {build,transformSync} from 'esbuild';

// These tests exercise our host against a small implementation of the public
// Obsidian contract. They do not claim to launch or verify the Obsidian desktop UI.
const require = createRequire(import.meta.url);
const source = name => new URL(`../src/${name}`, import.meta.url).pathname;
const transpile = name => transformSync(readFileSync(source(name), 'utf8'), {
  loader:name.endsWith('tsx') ? 'tsx' : 'ts', format:'cjs', jsx:'automatic',
}).code;
/** A module of the plugin with what it imports (the game's shared code too) bundled in, but for the given packages and modules, which the test supplies. */
const bundled = async (name, external) => (await build({
  entryPoints:[source(name)], bundle:true, write:false, format:'cjs', platform:'node', jsx:'automatic',
  external:['obsidian','react','react/jsx-runtime','react-dom/client','@xyflow/react','lucide-react','pixi.js'],
  plugins:[{name:'mocked', setup(build) { build.onResolve({filter:new RegExp(`^(${external.map(m => m.replace(/[./]/g, '\\$&')).join('|')})$`)}, args => ({path:args.path, external:true})); }}],
  loader:{'.css':'empty'},
})).outputFiles[0].text;
const sceneCode = await bundled('scene/model.ts', []);
const mapCode = await bundled('map/model.ts', []);
const pluginCode = await bundled('plugin.tsx', ['./App']);

const CAMPAIGN = fileURLToPath(new URL('../../../campaigns/caerwyn/', import.meta.url));
/** Every file of the game's campaign folder, by its path there: the vault the plugin is installed in. */
const campaignFiles = readdirSync(CAMPAIGN, {recursive:true, withFileTypes:true}).filter(entry => entry.isFile())
  .map(entry => path.relative(CAMPAIGN, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  .filter(file => !file.split('/').some(part => part.startsWith('.')))
  .map(file => [file, readFileSync(path.join(CAMPAIGN, file), 'utf8')]);
/** A value made in the plugin's sandbox, as plain data here (deep equality compares prototypes, and the sandbox has its own). */
const plain = value => JSON.parse(JSON.stringify(value));
const V1_SCENE = readFileSync(new URL('fixtures/v1/Scenes/The Hanged Clerk.kmscene', import.meta.url), 'utf8');
const V1_SCENARIO = readFileSync(new URL('fixtures/v1/Scenarios/Caerwyn.kmscenario', import.meta.url), 'utf8');
const V1_STUDY = readFileSync(new URL('fixtures/v1-study/Harbour study.kmmap', import.meta.url), 'utf8');
const campaignText = file => campaignFiles.find(([path]) => path === file)[1];

function loadModule(code, resolver) {
  const module = {exports:{}};
  runInNewContext(code, {module, exports:module.exports, require:resolver, crypto:webcrypto});
  return module.exports;
}

function harness() {
  const roots = [], modals = [], notices = [], opened = [], writes = [], entries = new Map(), contents = new Map(), vaultEvents = [];
  const scene = loadModule(sceneCode, require);
  const maps = loadModule(mapCode, require);
  const normalizePath = path => path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  class Folder {
    constructor(path) { this.path = path; this.name = path.split('/').at(-1); this.parent = null; }
  }
  const rootFolder = new Folder('');
  entries.set('', rootFolder);
  class File {
    constructor(path) {
      this.path = path;
      this.name = path.split('/').at(-1);
      this.extension = this.name.split('.').at(-1);
      this.basename = this.name.replace(/\.[^.]+$/, '');
      this.parent = entries.get(path.split('/').slice(0,-1).join('/')) ?? rootFolder;
    }
  }
  const addFolder = path => { const folder = new Folder(path); entries.set(path, folder); return folder; };
  const addFile = (path, text = '') => { const file = new File(path); entries.set(path,file); contents.set(path,text); return file; };
  /** The game's campaign folder as the vault, as the plugin is installed in it. */
  const addCampaign = () => { for (const folder of ['scenes','places','lore']) addFolder(folder); for (const [file, text] of campaignFiles) addFile(file, text); };
  const element = () => ({
    style:{}, children:[], settings:[], text:'',
    createEl(tag, options = {}) { const child = element(); child.tag = tag; child.text = options.text ?? ''; this.children.push(child); return child; },
    setText(text) { this.text = text; }, empty() { this.children = []; this.text = ''; },
  });
  class Modal {
    constructor(app) { this.app = app; this.contentEl = element(); }
    setTitle(title) { this.title = title; return this; }
    setPlaceholder(text) { this.placeholder = text; return this; }
    open() { modals.push(this); this.onOpen?.(); }
    close() { this.onClose?.(); }
  }
  class Setting {
    constructor(container) { this.container = container; this.buttons = []; container.settings.push(this); }
    setName(name) { this.name = name; return this; }
    addText(callback) {
      const text = {
        inputEl:{focus(){}, addEventListener(){}},
        setPlaceholder(){return this;}, onChange(callback){this.change = callback; return this;},
      };
      this.text = text; callback(text); return this;
    }
    addButton(callback) {
      const button = {setButtonText(text){this.text=text;return this;}, setCta(){return this;}, onClick(fn){this.click=fn;return this;}};
      this.buttons.push(button); callback(button); return this;
    }
  }
  class TextFileView {
    constructor(leaf) {
      this.app = leaf.app; this.contentEl = element(); this.file = null; this.data = ''; this.saveRequests = 0;
      this.requestSave = () => { this.saveRequests += 1; };
    }
    async onLoadFile(file) { this.file = file; this.data = await this.app.vault.cachedRead(file); this.setViewData(this.data, true); }
    async save(clear = false) {
      const current = this.getViewData();
      if (this.file && current !== this.data) { await this.app.vault.modify(this.file, current); this.data = current; }
      if (clear) this.clear();
    }
    async onUnloadFile() { await this.save(true); this.file = null; }
    async onRename(file) { this.file = file; }
  }
  class Plugin {
    constructor(app) { this.app=app; this.views=[]; this.extensions=[]; this.commands=[]; this.events=[]; }
    registerView(...args){this.views.push(args);}
    registerExtensions(...args){this.extensions.push(args);}
    registerEvent(event){this.events.push(event);}
    addCommand(command){this.commands.push(command);}
    addRibbonIcon(){}
  }
  const app = {
    vault:{
      on:(name,callback) => { const event={name,callback}; vaultEvents.push(event); return event; },
      getRoot:() => rootFolder,
      getAbstractFileByPath:path => entries.get(path),
      getFiles:() => [...entries.values()].filter(file => file instanceof File),
      getMarkdownFiles:() => [...entries.values()].filter(file => file instanceof File && file.extension === 'md'),
      cachedRead:async file => contents.get(file.path),
      read:async file => contents.get(file.path),
      modify:async (file, text) => { writes.push({path:file.path, text}); contents.set(file.path,text); },
      process:async (file, callback) => {
        const text = callback(contents.get(file.path));
        if (text !== contents.get(file.path)) await app.vault.modify(file,text);
        return text;
      },
      create:async (path, text) => {
        if (entries.has(path)) throw Error('Already exists');
        writes.push({path, text});
        return addFile(path,text);
      },
      createFolder:async path => addFolder(path),
    },
    workspace:{
      on:(name,callback) => ({name,callback}),
      getActiveFile:() => null,
      getLeaf:() => ({openFile:async file => { opened.push(file.path); }}),
    },
    metadataCache:{getFileCache:() => null, getFirstLinkpathDest:path => entries.get(path)},
  };
  const obsidian = {
    Plugin, TextFileView, TFile:File, TFolder:Folder, Modal, FuzzySuggestModal:Modal, Setting, normalizePath,
    Notice:class {constructor(message){notices.push(message);}},
  };
  const editor = name => ({[name]:function() { return null; }})[name];
  const editors = Object.fromEntries(['SceneApp','LegacyScene','ScenarioApp','LegacyScenario','MapApp','MapMigration','PlaceApp'].map(name => [name, editor(name)]));
  const exports = loadModule(pluginCode, id => id === 'obsidian' ? obsidian
    : id === './App' ? editors
    : id === 'react-dom/client' ? {createRoot:element => {
      const root = {element,renders:[], render(value){this.renders.push(value);}, unmount(){this.unmounted=true;}};
      roots.push(root); return root;
    }} : require(id));
  const plugin = new exports.default(app);
  const view = new exports.KingmakerFileView({app},plugin);
  const createView = () => new exports.KingmakerFileView({app},plugin);
  const currentElement = () => roots.at(-1).renders.at(-1);
  const renderOf = view => roots.find(root => root.element === view.contentEl).renders.at(-1);
  const hostFor = view => renderOf(view).props.host;
  const submitName = name => {
    const modal = modals.at(-1);
    modal.contentEl.settings.find(setting => setting.text).text.change(name);
    modal.contentEl.settings.flatMap(setting => setting.buttons).find(button => button.text === 'Create').click();
    return modal;
  };
  /** A new scene of the game's format, and its file's text. */
  const newScene = (title = 'Arrival') => scene.skeletonScene(title);
  const sceneText = doc => scene.serializeScene(doc);
  /** A small map of the format (the default legend on grass, as the plugin makes one), and its file's text. */
  const newMap = (title = 'Market') => maps.newMap(title, undefined, 6, 4);
  const mapText = doc => maps.serializeMap(doc);
  return {app,plugin,view,scene,maps,editors,roots,modals,notices,opened,writes,contents,entries,addFile,addFolder,addCampaign,currentElement,renderOf,submitName,createView,vaultEvents,hostFor,newScene,sceneText,newMap,mapText};
}

test('registers custom extensions and native folder create actions', async () => {
  const h = harness();
  await h.plugin.onload();
  assert.deepEqual(Array.from(h.plugin.extensions[0][0]), ['kmscene','kmscenario','kmmap','kmplace']);
  assert.equal(h.plugin.views[0][0], 'kingmaker-authoring-file');
  assert.deepEqual(h.plugin.commands.map(command => command.id), ['new-scene','new-scenario','new-map','new-place','open-file']);
  const folder = h.addFolder('scenes');
  const titles = [];
  const menu = {addItem(callback){callback({setTitle(title){titles.push(title);return this;},setIcon(){return this;},onClick(){return this;}});}};
  h.plugin.events.find(event => event.name === 'file-menu').callback(menu,folder);
  assert.deepEqual(titles,['New Kingmaker scene','New Kingmaker scenario','New Kingmaker map','New Kingmaker place']);
});

test('every real scene opens in the scene editor with its exact bytes, and an unchanged scene is never written', async () => {
  const h = harness();
  h.addCampaign();
  const scenes = campaignFiles.filter(([file]) => file.startsWith('scenes/'));
  assert.equal(scenes.length, 10);
  for (const [file, raw] of scenes) {
    const view = h.createView();
    await view.onLoadFile(h.entries.get(file));
    const rendered = h.renderOf(view);
    assert.equal(rendered.type, h.editors.SceneApp, file);
    assert.equal(JSON.stringify(rendered.props.document, null, 2) + '\n', raw, file);
    assert.equal(rendered.props.host.filePath, file);
    assert.equal(view.getViewData(), raw);
    await view.onUnloadFile(h.entries.get(file));
  }
  assert.equal(h.writes.length, 0);
});

test('change updates save data immediately and unload flushes before the autosave debounce', async () => {
  const h = harness();
  const doc = h.newScene();
  const file = h.addFile('scenes/arrival.kmscene',h.sceneText(doc));
  await h.view.onLoadFile(file);
  h.hostFor(h.view).change({...doc,title:'Revised arrival'});
  assert.equal(h.view.getViewData(),h.sceneText({...doc,title:'Revised arrival'}));
  assert.equal(h.view.saveRequests,1);
  assert.equal(h.writes.length,0);
  await h.view.onUnloadFile(file);
  assert.equal(JSON.parse(h.contents.get(file.path)).title,'Revised arrival');
  assert.equal(h.writes.length,1);
});

test('late callbacks cannot write during unload or overwrite the next file', async () => {
  const h = harness();
  const first = h.newScene('First');
  const second = h.newScene('Second');
  const firstFile = h.addFile('scenes/first.kmscene',h.sceneText(first));
  const secondFile = h.addFile('scenes/second.kmscene',h.sceneText(second));
  await h.view.onLoadFile(firstFile);
  const stale = h.hostFor(h.view);
  stale.change({...first,title:'Saved before close'});
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const originalModify = h.app.vault.modify;
  h.app.vault.modify = async (...args) => { await gate; await originalModify(...args); };
  const unloading = h.view.onUnloadFile(firstFile);
  stale.change({...first,title:'Late modal result'});
  assert.equal(JSON.parse(h.view.getViewData()).title,'Saved before close');
  release(); await unloading;
  await h.view.onLoadFile(secondFile);
  stale.change({...first,title:'Still late'});
  assert.equal(JSON.parse(h.view.getViewData()).title,'Second');
  assert.equal(JSON.parse(h.contents.get(firstFile.path)).title,'Saved before close');
  await h.view.onUnloadFile(secondFile);
  assert.equal(JSON.parse(h.contents.get(secondFile.path)).title,'Second');
});

test('own-save echoes preserve undo key while external updates reset it', async () => {
  const h = harness();
  const doc = h.newScene();
  await h.view.onLoadFile(h.addFile('scenes/arrival.kmscene',h.sceneText(doc)));
  const original = h.currentElement();
  original.props.host.change({...doc,title:'Local edit'});
  const renderCount = h.roots[0].renders.length;
  h.view.setViewData(h.view.getViewData(),false);
  assert.equal(h.roots[0].renders.length,renderCount);
  h.view.setViewData(h.sceneText({...doc,title:'External edit'}),false);
  assert.notEqual(h.currentElement().key,original.key);
  original.props.host.change({...doc,title:'Obsolete callback'});
  assert.equal(JSON.parse(h.view.getViewData()).title,'External edit');
});

test('what isn\'t a scene of the format opens as an error and its bytes are never replaced', async () => {
  const h0 = harness();
  const dangling = JSON.parse(h0.sceneText(h0.newScene()));
  dangling.edges[0].target = 'the-moon';
  for (const [name, raw] of [['broken.kmscene','{ invalid'],['unknown.kmscene',JSON.stringify({format:'unknown'})],['scenario.kmscene',V1_SCENARIO],['dangling.kmscene',JSON.stringify(dangling)],['scene.kmmap',h0.sceneText(h0.newScene())]]) {
    const h = harness();
    const file = h.addFile(name,raw);
    await h.view.onLoadFile(file);
    assert.equal(h.currentElement().props.className,'km-file-error',name);
    assert.equal(h.view.getViewData(),raw);
    await h.view.onUnloadFile(file);
    assert.equal(h.contents.get(file.path),raw);
    assert.equal(h.writes.length,0);
  }
  const h = harness();
  await h.view.onLoadFile(h.addFile('dangling.kmscene',JSON.stringify(dangling)));
  assert.match(JSON.stringify(h.currentElement().props.children),/target \\"the-moon\\" isn't a node of the scene/);
});

test('a version 1 scene opens read-only with a note that the format has moved on, and is never written', async () => {
  const h = harness();
  const file = h.addFile('Scenes/The Hanged Clerk.kmscene',V1_SCENE);
  await h.view.onLoadFile(file);
  const rendered = h.currentElement();
  assert.equal(rendered.type,h.editors.LegacyScene);
  assert.deepEqual(plain(rendered.props),{path:file.path,title:'The Hanged Clerk',nodes:10,routes:51});
  assert.equal(h.view.saveRequests,0);
  await h.view.onUnloadFile(file);
  assert.equal(h.contents.get(file.path),V1_SCENE);
  assert.equal(h.writes.length,0);
});

test('closing invalidates outstanding callbacks and unmounts the React view', async () => {
  const h = harness();
  const doc = h.newScene();
  await h.view.onLoadFile(h.addFile('scenes/arrival.kmscene',h.sceneText(doc)));
  const host = h.currentElement().props.host;
  const raw = h.view.getViewData();
  await h.view.onClose();
  host.change({...doc,title:'Too late'});
  assert.equal(h.view.getViewData(),raw);
  assert.equal(h.roots[0].unmounted,true);
});

test('a new scene is the format\'s skeleton, its file named for the slug of its title in the campaign\'s scenes/, and it opens', async () => {
  const h = harness();
  const pending = h.plugin.createDocument('scene',h.addFolder('scenes'));
  h.submitName('The New Arrival');
  const file = await pending;
  assert.equal(file.path,'scenes/the-new-arrival.kmscene');
  const opened = h.scene.openSceneFile(h.contents.get(file.path));
  assert.equal(opened.kind,'scene');
  assert.deepEqual([opened.doc.id,opened.doc.title],['the-new-arrival','The New Arrival']);
  assert.equal(h.contents.get(file.path),h.sceneText(h.scene.skeletonScene('The New Arrival')));
  assert.deepEqual(h.opened,[file.path]);
});

test('a new map, place or scenario is its format\'s skeleton, its file named for the slug of its title in the campaign\'s folder for it', async () => {
  const h = harness();
  h.addFolder('maps'); h.addFolder('places');
  let pending = h.plugin.createDocument('map',h.plugin.folderFor('map',h.app.vault.getRoot()));
  h.submitName('The Cooperage');
  let file = await pending;
  assert.equal(file.path,'maps/the-cooperage.kmmap');
  const map = h.maps.openMapFile(h.contents.get(file.path));
  assert.deepEqual([map.id,map.title,map.grid.length,Object.keys(map.legend).length],['the-cooperage','The Cooperage',24,20]);
  pending = h.plugin.createDocument('place',h.plugin.folderFor('place',h.app.vault.getRoot()));
  h.submitName('The Cellar');
  file = await pending;
  assert.equal(file.path,'places/the-cellar.kmplace');
  assert.equal(JSON.parse(h.contents.get(file.path)).kind,'place');
  pending = h.plugin.createDocument('scenario',h.app.vault.getRoot());
  h.submitName('Saltmere');
  file = await pending;
  assert.equal(file.path,'saltmere.kmscenario');
  assert.deepEqual(Object.keys(JSON.parse(h.contents.get(file.path))).slice(0,7),['format','version','kind','id','title','description','campaignVersion']);
  // A campaign folder has one scenario: a second is refused, naming the first.
  pending = h.plugin.createDocument('scenario',h.app.vault.getRoot());
  const modal = h.submitName('Another');
  assert.match(modal.contentEl.children.find(child => /scenario already/.test(child.text)).text,/This folder has a scenario already \(saltmere\.kmscenario\)/);
  modal.close();
  assert.equal(await pending,null);
  assert.deepEqual(h.opened,['maps/the-cooperage.kmmap','places/the-cellar.kmplace','saltmere.kmscenario']);
});

test('failed unload keeps the draft and restores an editable host', async () => {
  const h = harness();
  const doc = h.newScene();
  const file = h.addFile('scenes/arrival.kmscene',h.sceneText(doc));
  await h.view.onLoadFile(file);
  h.currentElement().props.host.change({...doc,title:'Unsaved draft'});
  h.app.vault.modify = async () => {throw Error('Disk unavailable');};
  await assert.rejects(h.view.onUnloadFile(file),/Disk unavailable/);
  assert.equal(JSON.parse(h.view.getViewData()).title,'Unsaved draft');
  h.currentElement().props.host.change({...doc,title:'Still editable'});
  assert.equal(JSON.parse(h.view.getViewData()).title,'Still editable');
});

test('creation rejects a title whose file exists, or that has no slug, and cancellation leaves the vault untouched', async () => {
  const h = harness();
  const folder = h.addFolder('scenes');
  h.addFile('scenes/existing.kmscene','original bytes');
  const pending = h.plugin.createDocument('scene',folder);
  const modal = h.submitName('Existing');
  assert.match(modal.contentEl.children.find(child => child.text.includes('already exists')).text,/already exists \(scenes\/existing\.kmscene\)/);
  h.submitName('***');
  assert.ok(modal.contentEl.children.some(child => /letters or digits/.test(child.text)));
  modal.close();
  assert.equal(await pending,null);
  assert.equal(h.contents.get('scenes/existing.kmscene'),'original bytes');
  assert.equal(h.opened.length,0);
});

test('a failure to open an already-created file reports the true result', async () => {
  const h = harness();
  h.app.workspace.getLeaf = () => ({openFile:async () => {throw Error('View unavailable');}});
  const pending = h.plugin.createDocument('scenario',h.addFolder('campaigns'));
  h.submitName('Caerwyn');
  const file = await pending;
  assert.equal(file.path,'campaigns/caerwyn.kmscenario');
  assert.ok(h.contents.has(file.path));
  assert.match(h.notices[0],/^Created campaigns\/caerwyn.kmscenario, but could not open it/);
});

test('the scene host reads the campaign around the file, offers lore by the game\'s paths and opens it in Obsidian', async () => {
  const h = harness();
  h.addCampaign();
  await h.view.onLoadFile(h.entries.get('scenes/hanged-clerk.kmscene'));
  const host = h.hostFor(h.view);
  const campaign = await host.campaign();
  assert.equal(campaign.root,'');
  assert.equal(campaign.error,undefined);
  assert.deepEqual(plain(campaign.scenes.map(scene => scene.id)),['kings-road','toll-bridge','kings-thanks','hanged-clerk','caerwyn-afternoon','drowned-rat','wharf-night','heron-warehouse','kings-morning','talk']);
  assert.deepEqual(plain(campaign.places.map(place => place.key)),['kings-road','toll-bridge','kings-parlour','granary-yard','drowned-rat','heron','dressing-room']);
  assert.equal(campaign.loreFiles.size,174);
  assert.deepEqual(plain(campaign.lore.filter(note => note.path.startsWith('Cast/Cob/')).map(note => [note.path,note.name,note.kind])),[['Cast/Cob/public.md','Cob','character']]);
  await host.openLore('Cast/Cob/public.md');
  await host.openScene('drowned-rat');
  assert.deepEqual(h.opened,['lore/Cast/Cob/public.md','scenes/drowned-rat.kmscene']);
  await assert.rejects(host.openLore('Cast/Nobody/public.md'),/not found/);

  // Another scene open in an editor is read as its draft.
  const rat = h.createView();
  await rat.onLoadFile(h.entries.get('scenes/drowned-rat.kmscene'));
  const ratDoc = JSON.parse(h.contents.get('scenes/drowned-rat.kmscene'));
  h.hostFor(rat).change({...ratDoc,title:'The Drowned Rat, redrafted'});
  assert.equal((await host.campaign()).scenes.find(scene => scene.id === 'drowned-rat').title,'The Drowned Rat, redrafted');
  assert.equal(h.writes.length,0);
});

test('a scene in a campaign folder deeper in the vault finds its campaign there', async () => {
  const h = harness();
  for (const [file, text] of campaignFiles) h.addFile(`campaigns/caerwyn/${file}`, text);
  await h.view.onLoadFile(h.entries.get('campaigns/caerwyn/scenes/kings-morning.kmscene'));
  const campaign = await h.hostFor(h.view).campaign();
  assert.equal(campaign.root,'campaigns/caerwyn/');
  assert.equal(campaign.scenes.length,10);
  assert.equal(campaign.loreFiles.size,174);
  await h.hostFor(h.view).openLore('World/Fronts.md');
  assert.deepEqual(h.opened,['campaigns/caerwyn/lore/World/Fronts.md']);
});

test('a vault with no scenario says so, and still offers its lore', async () => {
  const h = harness();
  h.addFile('lore/Places/Somewhere.md','# Somewhere');
  await h.view.onLoadFile(h.addFile('scenes/draft.kmscene',h.sceneText(h.newScene('Draft'))));
  const campaign = await h.hostFor(h.view).campaign();
  assert.match(campaign.error,/the campaign has no scenario beside scenes\/ \(<id>\.kmscenario\)/);
  assert.deepEqual(plain(campaign.lore.map(note => note.path)),['Places/Somewhere.md']);
});

test('the real scenario, maps and places open in their editors with their exact bytes, and nothing is written', async () => {
  const h = harness();
  h.addCampaign();
  const files = campaignFiles.filter(([file]) => /^([^/]+\.kmscenario|maps\/.*\.kmmap|places\/.*\.kmplace)$/.test(file));
  assert.equal(files.length, 13);
  for (const [file, raw] of files) {
    const view = h.createView();
    await view.onLoadFile(h.entries.get(file));
    const rendered = h.renderOf(view);
    const expected = file.endsWith('.kmscenario') ? h.editors.ScenarioApp : file.endsWith('.kmmap') ? h.editors.MapApp : h.editors.PlaceApp;
    assert.equal(rendered.type, expected, file);
    assert.equal(JSON.stringify(rendered.props.document, null, 2) + '\n', raw, file);
    assert.equal(rendered.props.host.filePath, file);
    assert.equal(view.getViewData(), raw);
    await view.onUnloadFile(h.entries.get(file));
  }
  assert.equal(h.writes.length, 0);
});

test('a version 1 map opens with the offer to migrate it; the migration replaces it with a map of the format, then opened in the map editor', async () => {
  const h = harness();
  const file = h.addFile('maps/harbour-study.kmmap', V1_STUDY);
  await h.view.onLoadFile(file);
  let rendered = h.currentElement();
  assert.equal(rendered.type, h.editors.MapMigration);
  assert.equal(rendered.props.text, V1_STUDY);
  assert.equal(h.view.saveRequests, 0);
  const migrated = h.mapText(h.newMap('Harbour study'));
  rendered.props.host.replace(migrated);
  rendered = h.currentElement();
  assert.equal(rendered.type, h.editors.MapApp);
  assert.equal(h.view.getViewData(), migrated);
  assert.equal(h.view.saveRequests, 1);
  await h.view.save();
  assert.equal(h.contents.get(file.path), migrated);
  // A version 1 map that isn't one (its terrain broken) opens as an error, its bytes kept.
  const broken = JSON.stringify({...JSON.parse(V1_STUDY), terrain:{version:1,width:2,height:2,tiles:['lava','grass','grass','grass']}});
  const h2 = harness();
  const bad = h2.addFile('maps/bad.kmmap', broken);
  await h2.view.onLoadFile(bad);
  assert.equal(h2.currentElement().props.className, 'km-file-error');
  await h2.view.onUnloadFile(bad);
  assert.equal(h2.contents.get(bad.path), broken);
});

test('a version 1 scenario opens read-only with a note that the format has moved on, and is never written', async () => {
  const h = harness();
  const file = h.addFile('Scenarios/Caerwyn.kmscenario', V1_SCENARIO);
  await h.view.onLoadFile(file);
  const rendered = h.currentElement();
  assert.equal(rendered.type, h.editors.LegacyScenario);
  assert.equal(rendered.props.title, 'Caerwyn');
  await h.view.onUnloadFile(file);
  assert.equal(h.contents.get(file.path), V1_SCENARIO);
  assert.equal(h.writes.length, 0);
});

test('an edit from another editor updates an open editor\'s draft, invalidates its old callbacks and remains saveable', async () => {
  const h = harness();
  const map = h.newMap();
  const file = h.addFile('maps/market.kmmap', h.mapText(map));
  await h.view.onLoadFile(file);
  const stale = h.hostFor(h.view);
  stale.change({...map, description:'Unsaved map work'});
  const before = await h.plugin.vaultFiles().read(file.path);
  assert.equal(JSON.parse(before).description, 'Unsaved map work', 'a read gives the open editor\'s draft');
  const after = h.mapText({...JSON.parse(before), title:'Updated from the scenario'});
  await h.plugin.writeFile(file.path, before, after);
  assert.equal(h.view.getViewData(), after);
  assert.equal(h.currentElement().type, h.editors.MapApp);
  assert.equal(h.view.saveRequests, 2);
  stale.change({...map, title:'Obsolete map editor'});
  assert.equal(JSON.parse(h.view.getViewData()).title, 'Updated from the scenario');
  await h.view.save();
  assert.equal(JSON.parse(h.contents.get(file.path)).title, 'Updated from the scenario');
});

test('an edit from elsewhere refuses a stale before and disagreeing open editors', async () => {
  const h = harness();
  const map = h.newMap();
  const file = h.addFile('maps/market.kmmap', h.mapText(map));
  await h.view.onLoadFile(file);
  h.hostFor(h.view).change({...map, title:'Current draft'});
  await assert.rejects(h.plugin.writeFile(file.path, h.mapText(map), h.mapText({...map, title:'Overwrite'})), /conflict/i);
  const other = h.createView();
  await other.onLoadFile(file);
  await assert.rejects(h.plugin.vaultFiles().read(file.path), /Conflicting open editors/);
  assert.equal(JSON.parse(h.view.getViewData()).title, 'Current draft');
  assert.equal(h.writes.length, 0);
});

test('matching open editors of a file receive the same edit from elsewhere', async () => {
  const h = harness();
  const map = h.newMap();
  const file = h.addFile('maps/market.kmmap', h.mapText(map));
  await h.view.onLoadFile(file);
  const other = h.createView();
  await other.onLoadFile(file);
  const next = h.mapText({...map, title:'Both updated'});
  await h.plugin.writeFile(file.path, h.mapText(map), next);
  assert.equal(h.view.getViewData(), other.getViewData());
  await Promise.all([h.view.save(), other.save()]);
  assert.equal(JSON.parse(h.contents.get(file.path)).title, 'Both updated');
});

test('outside disk edits cannot be overwritten by an edit from another editor or a delayed autosave', async () => {
  const h = harness();
  const map = h.newMap();
  const file = h.addFile('maps/market.kmmap', h.mapText(map));
  await h.view.onLoadFile(file);
  h.hostFor(h.view).change({...map, title:'Local unsaved draft'});
  const before = h.view.getViewData();
  const external = h.mapText({...map, title:'External change'});
  h.contents.set(file.path, external);
  await assert.rejects(h.plugin.writeFile(file.path, before, h.mapText({...map, title:'Scenario update'})), /changed outside/);
  await assert.rejects(h.view.save(), /Save conflict/);
  assert.equal(h.contents.get(file.path), external);
  assert.equal(JSON.parse(h.view.getViewData()).title, 'Local unsaved draft');
  assert.equal(h.writes.length, 0);
});

test('a write to a closed file compares atomically, and only to the game\'s files, and only with what the game can load', async () => {
  const h = harness();
  const map = h.newMap();
  const file = h.addFile('maps/market.kmmap', h.mapText(map));
  await h.plugin.writeFile(file.path, h.mapText(map), h.mapText({...map, title:'Market ports'}));
  assert.equal(JSON.parse(h.contents.get(file.path)).title, 'Market ports');
  await assert.rejects(h.plugin.writeFile(file.path, h.mapText(map), h.mapText({...map, title:'Stale'})), /conflict/i);
  await assert.rejects(h.plugin.writeFile(file.path, h.contents.get(file.path), h.mapText({...map, grid:[]})), /its grid isn't a list of rows/);
  h.addFile('Lore.md', '# Lore');
  await assert.rejects(h.plugin.writeFile('Lore.md', '# Lore', '# Changed'), /not found/);
  await assert.rejects(h.plugin.writeFile('maps/missing.kmmap', '', h.mapText(map)), /not found/);
  assert.deepEqual(h.writes.map(write => write.path), ['maps/market.kmmap']);
});

test('an external edit during a pending closed-file write wins the atomic comparison', async () => {
  const h = harness();
  const map = h.newMap();
  const file = h.addFile('maps/market.kmmap', h.mapText(map));
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const process = h.app.vault.process;
  h.app.vault.process = async (...args) => {await gate; return process(...args);};
  const pending = h.plugin.writeFile(file.path, h.mapText(map), h.mapText({...map, title:'Scenario edit'}));
  const external = h.mapText({...map, title:'External edit'});
  h.contents.set(file.path, external);
  release();
  await assert.rejects(pending, /conflict/i);
  assert.equal(h.contents.get(file.path), external);
  assert.equal(h.writes.length, 0);
});

test('closing the editor that asked cancels its pending writes, and a file it would create is still made only when it asks in time', async () => {
  const h = harness();
  h.addCampaign();
  await h.view.onLoadFile(h.entries.get('caerwyn.kmscenario'));
  const host = h.hostFor(h.view);
  const map = h.newMap();
  const source = h.addFile('maps/market.kmmap', h.mapText(map));
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const process = h.app.vault.process;
  h.app.vault.process = async (...args) => {await gate; return process(...args);};
  const writing = host.write(source.path, h.mapText(map), h.mapText({...map, title:'Too late'}));
  await h.view.onClose();
  release();
  await assert.rejects(writing, /changed or closed/);
  await assert.rejects(host.create('maps/late.kmmap', h.mapText(map)), /changed or closed/);
  assert.equal(JSON.parse(h.contents.get(source.path)).title, 'Market');
  assert.equal(h.entries.has('maps/late.kmmap'), false);
  assert.equal(h.writes.length, 0);
});

test('an editor\'s subscribers hear of local edits and vault events, not reads, and unsubscribe safely', async () => {
  const h = harness();
  await h.plugin.onload();
  h.addCampaign();
  await h.view.onLoadFile(h.entries.get('maps/palace.kmmap'));
  const host = h.hostFor(h.view);
  let changes = 0;
  const unsubscribe = host.subscribe(() => {changes++;});
  await host.files.read('maps/caerwyn.kmmap');
  assert.equal(changes, 0);
  host.change({...h.currentElement().props.document, title:'The Palace, redrawn'});
  assert.equal(changes, 1);
  for (const name of ['modify','create','delete','rename']) h.vaultEvents.find(event => event.name===name).callback();
  assert.equal(changes, 5);
  unsubscribe();
  h.plugin.documentsChanged();
  assert.equal(changes, 5);
  host.subscribe(() => {changes++;});
  await h.view.onClose();
  h.plugin.documentsChanged();
  assert.equal(changes, 5);
});

test('the scene editor hears of other files\' changes until its file closes', async () => {
  const h = harness();
  await h.plugin.onload();
  await h.view.onLoadFile(h.addFile('scenes/arrival.kmscene',h.sceneText(h.newScene())));
  let changes = 0;
  h.hostFor(h.view).subscribe(() => {changes++;});
  h.vaultEvents.find(event => event.name==='modify').callback();
  assert.equal(changes,1);
  await h.view.onClose();
  h.plugin.documentsChanged();
  assert.equal(changes,1);
});

test('a file opened during a read is read from its newest unsaved draft', async () => {
  const h = harness();
  const map = h.newMap();
  const source = h.addFile('maps/market.kmmap', h.mapText(map));
  await h.view.onLoadFile(source);
  h.hostFor(h.view).change({...map, title:'Opened and edited'});
  assert.equal(JSON.parse(await h.plugin.vaultFiles().read(source.path)).title, 'Opened and edited');
  // A closed file is read from the vault.
  await h.view.onUnloadFile(source);
  assert.equal(JSON.parse(await h.plugin.vaultFiles().read(source.path)).title, 'Opened and edited');
});

test('a file opened during an atomic write is not silently changed underneath its editor', async () => {
  const h = harness();
  const map = h.newMap();
  const source = h.addFile('maps/market.kmmap', h.mapText(map));
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const process = h.app.vault.process;
  h.app.vault.process = async (...args) => {await gate; return process(...args);};
  const pending = h.plugin.writeFile(source.path, h.mapText(map), h.mapText({...map, title:'Scenario edit'}));
  await h.view.onLoadFile(source);
  h.hostFor(h.view).change({...map, title:'New local draft'});
  release();
  await assert.rejects(pending, /editor opened/);
  assert.equal(JSON.parse(h.contents.get(source.path)).title, 'Market');
  assert.equal(JSON.parse(h.view.getViewData()).title, 'New local draft');
  assert.equal(h.writes.length, 0);
});

test('an open file edited while a write checks the disk refuses the outdated write', async () => {
  const h = harness();
  const map = h.newMap();
  const source = h.addFile('maps/market.kmmap', h.mapText(map));
  await h.view.onLoadFile(source);
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const read = h.app.vault.read;
  h.app.vault.read = async (...args) => {await gate; return read(...args);};
  const pending = h.plugin.writeFile(source.path, h.mapText(map), h.mapText({...map, title:'Scenario edit'}));
  h.hostFor(h.view).change({...map, title:'New local draft'});
  release();
  await assert.rejects(pending, /conflict/i);
  assert.equal(JSON.parse(h.view.getViewData()).title, 'New local draft');
  assert.equal(h.writes.length, 0);
});

test('an editor that can\'t take an edit from elsewhere (a version 1 map, an error) refuses one, and the scene and map hosts read every file of the campaign', async () => {
  const h = harness();
  const file = h.addFile('maps/old.kmmap', V1_STUDY);
  await h.view.onLoadFile(file);
  await assert.rejects(h.plugin.writeFile(file.path, V1_STUDY, h.mapText(h.newMap('Old'))), /can't take an edit from elsewhere/);
  assert.equal(h.view.getViewData(), V1_STUDY);
  const h2 = harness();
  h2.addCampaign();
  await h2.view.onLoadFile(h2.entries.get('places/heron.kmplace'));
  const host = h2.hostFor(h2.view);
  assert.equal(await host.files.read('maps/heron.kmmap'), campaignText('maps/heron.kmmap'));
  assert.ok(host.files.list('').includes('looks.json'));
  await host.open('maps/heron.kmmap');
  assert.deepEqual(h2.opened, ['maps/heron.kmmap']);
});

test('a save queued before an external reload cannot overwrite the newly loaded content', async () => {
  const h = harness();
  const scene = h.newScene();
  const source = h.addFile('scenes/arrival.kmscene',h.sceneText(scene));
  await h.view.onLoadFile(source);
  h.hostFor(h.view).change({...scene,title:'Earlier draft'});
  let release,entered;
  const gate = new Promise(resolve => {release=resolve;});
  const started = new Promise(resolve => {entered=resolve;});
  const process = h.app.vault.process;
  h.app.vault.process = async (...args) => {entered(); await gate; return process(...args);};
  const pending = h.view.save();
  await started;
  const external = h.sceneText({...scene,title:'New external version'});
  h.contents.set(source.path,external);
  h.view.setViewData(external,false);
  release();
  await assert.rejects(pending,/Save conflict|changed|reload/i);
  assert.equal(h.contents.get(source.path),external);
  assert.equal(h.view.getViewData(),external);
  assert.equal(h.view.getDiskData(),external);
  assert.equal(h.writes.length,0);
});

test('local edits during a pending save keep their draft and flush safely in the next save', async () => {
  const h = harness();
  const scene = h.newScene();
  const source = h.addFile('scenes/arrival.kmscene',h.sceneText(scene));
  await h.view.onLoadFile(source);
  const host=h.hostFor(h.view);
  host.change({...scene,title:'First local draft'});
  let release,entered;
  const gate = new Promise(resolve => {release=resolve;});
  const started = new Promise(resolve => {entered=resolve;});
  const process = h.app.vault.process;
  h.app.vault.process = async (...args) => {entered(); await gate; return process(...args);};
  const first=h.view.save();
  await started;
  host.change({...scene,title:'Newer local draft'});
  const second=h.view.save();
  release();
  await Promise.all([first,second]);
  assert.equal(JSON.parse(h.contents.get(source.path)).title,'Newer local draft');
  assert.equal(h.view.getViewData(),h.contents.get(source.path));
  assert.equal(h.view.getDiskData(),h.contents.get(source.path));
  assert.deepEqual(h.writes.map(write=>JSON.parse(write.text).title),['First local draft','Newer local draft']);
});

test('a reload after the atomic save completes is not cleared or replaced by the older completion', async () => {
  const h = harness();
  const scene = h.newScene();
  const source = h.addFile('scenes/arrival.kmscene',h.sceneText(scene));
  await h.view.onLoadFile(source);
  h.hostFor(h.view).change({...scene,title:'Earlier draft'});
  let release,entered;
  const gate = new Promise(resolve => {release=resolve;});
  const committed = new Promise(resolve => {entered=resolve;});
  const process = h.app.vault.process;
  h.app.vault.process = async (...args) => {const result=await process(...args); entered(); await gate; return result;};
  const pending=h.view.save(true);
  await committed;
  const external=h.sceneText({...scene,title:'New external version'});
  h.contents.set(source.path,external);
  h.view.setViewData(external,false);
  release();
  await pending;
  assert.equal(h.contents.get(source.path),external);
  assert.equal(h.view.getViewData(),external);
  assert.equal(h.view.getDiskData(),external);
  assert.equal(h.view.data,external);
  assert.equal(h.hostFor(h.view).filePath,source.path);
});

test('an own-save echo preserves a newer local draft and its editable undo identity', async () => {
  const h = harness();
  const scene = h.newScene();
  const source = h.addFile('scenes/arrival.kmscene',h.sceneText(scene));
  await h.view.onLoadFile(source);
  const original=h.currentElement(),host=h.hostFor(h.view);
  host.change({...scene,title:'First local draft'});
  let release,entered;
  const gate = new Promise(resolve => {release=resolve;});
  const started = new Promise(resolve => {entered=resolve;});
  const process = h.app.vault.process;
  h.app.vault.process = async (...args) => {
    entered(); await gate;
    const saved=await process(...args);
    h.view.setViewData(saved,false);
    return saved;
  };
  const pending=h.view.save();
  await started;
  host.change({...scene,title:'Newer local draft'});
  release();
  await pending;
  assert.equal(JSON.parse(h.view.getViewData()).title,'Newer local draft');
  assert.equal(h.currentElement().key,original.key);
  assert.equal(JSON.parse(h.view.getDiskData()).title,'First local draft');
  await h.view.save();
  assert.equal(JSON.parse(h.contents.get(source.path)).title,'Newer local draft');
});

test('a late echo of the saved baseline preserves a newer draft but genuine external content reloads', async () => {
  const h = harness();
  const scene = h.newScene();
  const source = h.addFile('scenes/arrival.kmscene',h.sceneText(scene));
  await h.view.onLoadFile(source);
  const original=h.currentElement(),host=h.hostFor(h.view);
  host.change({...scene,title:'Saved draft'});
  await h.view.save();
  const saved=h.contents.get(source.path);
  host.change({...scene,title:'New local draft'});
  h.view.setViewData(saved,false);
  assert.equal(JSON.parse(h.view.getViewData()).title,'New local draft');
  assert.equal(h.currentElement().key,original.key);
  const external=h.sceneText({...scene,title:'Genuine external content'});
  h.contents.set(source.path,external);
  h.view.setViewData(external,false);
  assert.equal(h.view.getViewData(),external);
  assert.notEqual(h.currentElement().key,original.key);
  host.change({...scene,title:'Stale callback'});
  assert.equal(h.view.getViewData(),external);
});
