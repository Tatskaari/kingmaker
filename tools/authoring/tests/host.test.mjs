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
const modelCode = transpile('model.ts');
const mapModelCode = transpile('map-model.ts');
const sceneCode = await bundled('scene/model.ts', []);
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

function loadModule(code, resolver) {
  const module = {exports:{}};
  runInNewContext(code, {module, exports:module.exports, require:resolver, crypto:webcrypto});
  return module.exports;
}

function harness() {
  const roots = [], modals = [], notices = [], opened = [], writes = [], entries = new Map(), contents = new Map(), vaultEvents = [];
  const model = loadModule(modelCode, name => name === './map-model.ts' ? loadModule(mapModelCode, require) : require(name));
  const scene = loadModule(sceneCode, require);
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
        return addFile(path,text);
      },
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
  const editors = {App:function App() { return null; }, SceneApp:function SceneApp() { return null; }, LegacyScene:function LegacyScene() { return null; }};
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
  return {app,plugin,view,model,scene,editors,roots,modals,notices,opened,writes,contents,entries,addFile,addFolder,addCampaign,currentElement,renderOf,submitName,createView,vaultEvents,hostFor,newScene,sceneText};
}

test('registers custom extensions and native folder create actions', async () => {
  const h = harness();
  await h.plugin.onload();
  assert.deepEqual(Array.from(h.plugin.extensions[0][0]), ['kmscene','kmscenario','kmmap']);
  assert.equal(h.plugin.views[0][0], 'kingmaker-authoring-file');
  assert.deepEqual(h.plugin.commands.map(command => command.id), ['new-scene','new-scenario','new-map','open-file']);
  const folder = h.addFolder('scenes');
  const titles = [];
  const menu = {addItem(callback){callback({setTitle(title){titles.push(title);return this;},setIcon(){return this;},onClick(){return this;}});}};
  h.plugin.events.find(event => event.name === 'file-menu').callback(menu,folder);
  assert.deepEqual(titles,['New Kingmaker scene','New Kingmaker scenario','New Kingmaker map']);
});

test('every real scene opens in the scene editor with its exact bytes, and an unchanged scene is never written', async () => {
  const h = harness();
  h.addCampaign();
  const scenes = campaignFiles.filter(([file]) => file.startsWith('scenes/'));
  assert.equal(scenes.length, 7);
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
  for (const [name, raw] of [['broken.kmscene','{ invalid'],['unknown.kmscene',JSON.stringify({format:'unknown'})],['scenario.kmscene',JSON.stringify(h0.model.emptyDocument('scenario','Wrong kind'))],['dangling.kmscene',JSON.stringify(dangling)],['scene.kmmap',h0.sceneText(h0.newScene())]]) {
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

test('creating a scene from a scenario returns its real path and title without switching tabs', async () => {
  const h = harness();
  h.addFolder('Scenes'); h.addFolder('Scenarios');
  const doc = h.model.emptyDocument('scenario','Caerwyn');
  await h.view.onLoadFile(h.addFile('Scenarios/Caerwyn.kmscenario',h.model.serializeDocument(doc)));
  const pending = h.currentElement().props.host.createScene();
  h.submitName('The dock');
  const result = await pending;
  assert.deepEqual(plain(result),{path:'Scenes/the-dock.kmscene',title:'The dock'});
  assert.equal(h.scene.openSceneFile(h.contents.get(result.path)).doc.title,'The dock');
  assert.equal(h.opened.length,0);
  assert.equal(JSON.parse(h.view.getViewData()).title,'Caerwyn');
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
  const pending = h.plugin.createDocument('scenario',h.addFolder('Scenarios'));
  h.submitName('Caerwyn');
  const file = await pending;
  assert.equal(file.path,'Scenarios/Caerwyn.kmscenario');
  assert.ok(h.contents.has(file.path));
  assert.match(h.notices[0],/^Created Scenarios\/Caerwyn.kmscenario, but could not open it/);
});

test('the scene host reads the campaign around the file, offers lore by the game\'s paths and opens it in Obsidian', async () => {
  const h = harness();
  h.addCampaign();
  await h.view.onLoadFile(h.entries.get('scenes/hanged-clerk.kmscene'));
  const host = h.hostFor(h.view);
  const campaign = await host.campaign();
  assert.equal(campaign.root,'');
  assert.equal(campaign.error,undefined);
  assert.deepEqual(plain(campaign.scenes.map(scene => scene.id)),['hanged-clerk','caerwyn-afternoon','drowned-rat','wharf-night','heron-warehouse','kings-morning','talk']);
  assert.deepEqual(plain(campaign.places.map(place => place.key)),['granary-yard','drowned-rat','heron','dressing-room']);
  assert.equal(campaign.loreFiles.size,154);
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
  assert.equal(campaign.scenes.length,7);
  assert.equal(campaign.loreFiles.size,154);
  await h.hostFor(h.view).openLore('World/Fronts.md');
  assert.deepEqual(h.opened,['campaigns/caerwyn/lore/World/Fronts.md']);
});

test('a vault with no campaign.json says so, and still offers its lore', async () => {
  const h = harness();
  h.addFile('lore/Places/Somewhere.md','# Somewhere');
  await h.view.onLoadFile(h.addFile('scenes/draft.kmscene',h.sceneText(h.newScene('Draft'))));
  const campaign = await h.hostFor(h.view).campaign();
  assert.match(campaign.error,/campaign\.json isn't there/);
  assert.deepEqual(plain(campaign.lore.map(note => note.path)),['Places/Somewhere.md']);
});

test('maps are real flow files created from a scenario without switching tabs', async () => {
  const h = harness();
  h.addFolder('Maps');
  const doc = h.model.emptyDocument('scenario','Caerwyn');
  await h.view.onLoadFile(h.addFile('Caerwyn.kmscenario',h.model.serializeDocument(doc)));
  const pending = h.hostFor(h.view).createMap();
  h.submitName('Market Square.kmmap');
  const result = await pending;
  assert.equal(result.path,'Maps/Market Square.kmmap');
  assert.equal(h.model.parseDocument(h.contents.get(result.path),'map').title,'Market Square');
  assert.equal(h.opened.length,0);
});

test('the scenario editor\'s listing reads version 1 files and live map buffers, and says it doesn\'t read the game\'s scenes', async () => {
  const h = harness();
  const map = h.model.emptyDocument('map','Market');
  await h.view.onLoadFile(h.addFile('Market.kmmap',h.model.serializeDocument(map)));
  h.hostFor(h.view).change({...map,title:'Unsaved market'});
  const scene = h.createView();
  await scene.onLoadFile(h.addFile('scenes/arrival.kmscene',h.sceneText(h.newScene())));
  h.addFile('Scenes/The Hanged Clerk.kmscene',V1_SCENE);
  h.addFile('Broken.kmscene','{ invalid');
  const files = await h.plugin.listDocuments();
  assert.equal(files.find(file => file.path==='Market.kmmap').document.title,'Unsaved market');
  assert.match(files.find(file => file.path==='scenes/arrival.kmscene').error,/version 1|scene of the game's format/);
  assert.equal(files.find(file => file.path==='Scenes/The Hanged Clerk.kmscene').document.nodes.length,10);
  assert.match(files.find(file => file.path==='Broken.kmscene').error,/JSON|property|Expected|invalid/i);
  assert.equal(h.writes.length,0);
});

test('a scenario still wires a closed version 1 scene\'s exits, and an open one shown read-only reloads them', async () => {
  const h = harness();
  const file = h.addFile('Scenes/The Hanged Clerk.kmscene',V1_SCENE);
  await h.view.onLoadFile(file);
  const before = await h.plugin.readDocument(file.path);
  const exit = before.nodes.find(node => node.data.kind === 'exit');
  const after = {...before,nodes:before.nodes.map(node => node === exit ? {...node,data:{...node.data,next:'drowned-rat'}} : node)};
  await h.plugin.writeDocument(file.path,before,after);
  assert.equal(JSON.parse(h.contents.get(file.path)).nodes.find(node => node.id === exit.id).data.next,'drowned-rat');
  h.view.setViewData(h.contents.get(file.path),false);
  assert.equal(h.currentElement().type,h.editors.LegacyScene);
  assert.equal(h.view.saveRequests,0);
});

test('port edits update an open source buffer, invalidate old callbacks and remain saveable', async () => {
  const h = harness();
  const map = h.model.emptyDocument('map','Market');
  const file = h.addFile('Market.kmmap',h.model.serializeDocument(map));
  await h.view.onLoadFile(file);
  const stale = h.hostFor(h.view);
  stale.change({...map,description:'Unsaved map work'});
  const before = await h.plugin.readDocument(file.path);
  const after = {...before,title:'Updated from overview'};
  await h.plugin.writeDocument(file.path,before,after);
  assert.equal(JSON.parse(h.view.getViewData()).description,'Unsaved map work');
  assert.equal(JSON.parse(h.view.getViewData()).title,'Updated from overview');
  assert.equal(h.view.saveRequests,2);
  stale.change({...map,title:'Obsolete source editor'});
  assert.equal(JSON.parse(h.view.getViewData()).title,'Updated from overview');
  await h.view.save();
  assert.equal(JSON.parse(h.contents.get(file.path)).title,'Updated from overview');
});

test('open-source conflict refuses stale snapshots and disagreeing editors', async () => {
  const h = harness();
  const map = h.model.emptyDocument('map','Market');
  const file = h.addFile('Market.kmmap',h.model.serializeDocument(map));
  await h.view.onLoadFile(file);
  h.hostFor(h.view).change({...map,title:'Current draft'});
  await assert.rejects(h.plugin.writeDocument(file.path,map,{...map,title:'Overwrite'}),/conflict/i);
  const other = h.createView();
  await other.onLoadFile(file);
  await assert.rejects(h.plugin.readDocument(file.path),/Conflicting open editors/);
  await assert.rejects(h.plugin.writeDocument(file.path,map,map),/Conflicting open editors/);
  assert.equal(JSON.parse(h.view.getViewData()).title,'Current draft');
  assert.equal(h.writes.length,0);
});

test('matching open source views receive the same external port edit', async () => {
  const h = harness();
  const map = h.model.emptyDocument('map','Market');
  const file = h.addFile('Market.kmmap',h.model.serializeDocument(map));
  await h.view.onLoadFile(file);
  const other = h.createView();
  await other.onLoadFile(file);
  const next = {...map,title:'Both updated'};
  await h.plugin.writeDocument(file.path,map,next);
  assert.equal(h.view.getViewData(),other.getViewData());
  await Promise.all([h.view.save(),other.save()]);
  assert.equal(JSON.parse(h.contents.get(file.path)).title,'Both updated');
});

test('outside disk edits cannot be overwritten by an overview edit or a delayed autosave', async () => {
  const h = harness();
  const map = h.model.emptyDocument('map','Market');
  const file = h.addFile('Market.kmmap',h.model.serializeDocument(map));
  await h.view.onLoadFile(file);
  h.hostFor(h.view).change({...map,title:'Local unsaved draft'});
  const before = await h.plugin.readDocument(file.path);
  const external = h.model.serializeDocument({...map,title:'External change'});
  h.contents.set(file.path,external);
  await assert.rejects(h.plugin.writeDocument(file.path,before,{...before,title:'Overview update'}),/changed outside/);
  await assert.rejects(h.view.save(),/Save conflict/);
  assert.equal(h.contents.get(file.path),external);
  assert.equal(JSON.parse(h.view.getViewData()).title,'Local unsaved draft');
  assert.equal(h.writes.length,0);
});

test('closed-source write compares atomically and only allows existing scene or map files', async () => {
  const h = harness();
  const map = h.model.emptyDocument('map','Market');
  const file = h.addFile('Market.kmmap',h.model.serializeDocument(map));
  await h.plugin.writeDocument(file.path,map,{...map,title:'Market ports'});
  assert.equal(JSON.parse(h.contents.get(file.path)).title,'Market ports');
  await assert.rejects(h.plugin.writeDocument(file.path,map,{...map,title:'Stale'}),/conflict/i);
  const scenario = h.model.emptyDocument('scenario','Campaign');
  h.addFile('Campaign.kmscenario',h.model.serializeDocument(scenario));
  await assert.rejects(h.plugin.writeDocument('Campaign.kmscenario',scenario,scenario),/scene or map files only/);
  h.addFile('Lore.md','# Lore');
  await assert.rejects(h.plugin.writeDocument('Lore.md',map,map),/not found/);
  await assert.rejects(h.plugin.writeDocument('Missing.kmmap',map,map),/not found/);
});

test('an external edit during a pending closed-source write wins the atomic comparison', async () => {
  const h = harness();
  const map = h.model.emptyDocument('map','Market');
  const file = h.addFile('Market.kmmap',h.model.serializeDocument(map));
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const process = h.app.vault.process;
  h.app.vault.process = async (...args) => {await gate; return process(...args);};
  const pending = h.plugin.writeDocument(file.path,map,{...map,title:'Overview edit'});
  const external = h.model.serializeDocument({...map,title:'External edit'});
  h.contents.set(file.path,external);
  release();
  await assert.rejects(pending,/conflict/i);
  assert.equal(h.contents.get(file.path),external);
  assert.equal(h.writes.length,0);
});

test('closing the originating scenario cancels pending reads, writes and file creation', async () => {
  const h = harness();
  const scenario = h.model.emptyDocument('scenario','Campaign');
  await h.view.onLoadFile(h.addFile('Campaign.kmscenario',h.model.serializeDocument(scenario)));
  const host = h.hostFor(h.view);
  const map = h.model.emptyDocument('map','Market');
  const source = h.addFile('Market.kmmap',h.model.serializeDocument(map));
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const read = h.app.vault.read, process = h.app.vault.process;
  h.app.vault.read = async (...args) => {await gate; return read(...args);};
  h.app.vault.process = async (...args) => {await gate; return process(...args);};
  const reading = host.readDocument(source.path);
  const listing = host.listDocuments();
  const writing = host.writeDocument(source.path,map,{...map,title:'Too late'});
  const creating = host.createMap();
  await h.view.onClose();
  h.submitName('Too late map');
  release();
  for (const pending of [reading,listing,writing,creating]) await assert.rejects(pending,/changed or closed/);
  assert.equal(JSON.parse(h.contents.get(source.path)).title,'Market');
  assert.equal(h.entries.has('Too late map.kmmap'),false);
  assert.equal(h.writes.length,0);
});

test('document subscribers see local edits and vault events, not reads, and unsubscribe safely', async () => {
  const h = harness();
  await h.plugin.onload();
  const scenario = h.model.emptyDocument('scenario','Campaign');
  await h.view.onLoadFile(h.addFile('Campaign.kmscenario',h.model.serializeDocument(scenario)));
  const host = h.hostFor(h.view);
  let changes=0;
  const unsubscribe = host.subscribeDocuments(() => {changes++;});
  await host.listDocuments();
  assert.equal(changes,0);
  host.change({...scenario,title:'Revised campaign'});
  assert.equal(changes,1);
  for (const name of ['modify','create','delete','rename']) h.vaultEvents.find(event => event.name===name).callback();
  assert.equal(changes,5);
  unsubscribe();
  h.plugin.documentsChanged();
  assert.equal(changes,5);
  host.subscribeDocuments(() => {changes++;});
  await h.view.onClose();
  h.plugin.documentsChanged();
  assert.equal(changes,5);
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

test('a source opened during a disk read is returned from its newest unsaved buffer', async () => {
  const h = harness();
  const map = h.model.emptyDocument('map','Market');
  const source = h.addFile('Market.kmmap',h.model.serializeDocument(map));
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const read = h.app.vault.read;
  h.app.vault.read = async (...args) => {await gate; return read(...args);};
  const pending = h.plugin.readDocument(source.path);
  await h.view.onLoadFile(source);
  h.hostFor(h.view).change({...map,title:'Opened and edited'});
  release();
  assert.equal((await pending).title,'Opened and edited');
});

test('a source opened during an atomic write is not silently changed underneath its editor', async () => {
  const h = harness();
  const map = h.model.emptyDocument('map','Market');
  const source = h.addFile('Market.kmmap',h.model.serializeDocument(map));
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const process = h.app.vault.process;
  h.app.vault.process = async (...args) => {await gate; return process(...args);};
  const pending = h.plugin.writeDocument(source.path,map,{...map,title:'Overview edit'});
  await h.view.onLoadFile(source);
  h.hostFor(h.view).change({...map,title:'New local draft'});
  release();
  await assert.rejects(pending,/editor opened/);
  assert.equal(JSON.parse(h.contents.get(source.path)).title,'Market');
  assert.equal(JSON.parse(h.view.getViewData()).title,'New local draft');
  assert.equal(h.writes.length,0);
});

test('an open source edited during validation rejects the outdated overview update', async () => {
  const h = harness();
  const map = h.model.emptyDocument('map','Market');
  const source = h.addFile('Market.kmmap',h.model.serializeDocument(map));
  await h.view.onLoadFile(source);
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const read = h.app.vault.read;
  h.app.vault.read = async (...args) => {await gate; return read(...args);};
  const pending = h.plugin.writeDocument(source.path,map,{...map,title:'Overview edit'});
  h.hostFor(h.view).change({...map,title:'New local draft'});
  release();
  await assert.rejects(pending,/conflict/i);
  assert.equal(JSON.parse(h.view.getViewData()).title,'New local draft');
  assert.equal(h.writes.length,0);
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
