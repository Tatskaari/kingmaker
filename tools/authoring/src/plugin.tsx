import React from 'react';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {FuzzySuggestModal,Menu,Modal,normalizePath,Notice,Plugin,Setting,TextFileView,TFile,TFolder} from 'obsidian';
import type {App as ObsidianApp,WorkspaceLeaf,MenuItem} from 'obsidian';
import {LegacyScenario,LegacyScene,MapApp,MapMigration,PlaceApp,ScenarioApp,SceneApp} from './App';
import {openSceneFile,serializeScene,skeletonScene} from './scene/model.ts';
import type {SceneDocument} from './scene/model.ts';
import {campaignRootOf as sceneRootOf,lorePathOf,readCampaign,scenePathOf} from './scene/campaign.ts';
import type {SceneHost} from './scene/host.ts';
import {EXTENSIONS as BY_KIND,kindOfPath} from './campaign/files.ts';
import type {FileKind,VaultFiles} from './campaign/files.ts';
import type {FileHost,MigrationHost} from './campaign/host.ts';
import {serializeJson,slugOf} from './campaign/json.ts';
import {openScenarioFile,newScenario} from './scenario/model.ts';
import type {ScenarioDocument} from './scenario/model.ts';
import {mapFileKind,newMap,openMapFile} from './map/model.ts';
import type {MapDocument} from './map/model.ts';
import {readV1Map} from './map/migrate.ts';
import {newPlace,openPlaceFile} from './place/model.ts';
import type {PlaceDocument} from './place/model.ts';

import {newTune,writeTune} from '../../../client/sound/tune.ts';

const VIEW='kingmaker-authoring-file';
const KINDS:FileKind[]=['scene','scenario','map','place'];
const EXTENSIONS=KINDS.map(kind=>BY_KIND[kind]);
const kindFor=(file:TFile):FileKind=>kindOfPath(file.path)??'scene';
const isDocument=(file:TFile)=>EXTENSIONS.includes(file.extension.toLowerCase());
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
/** Where new files of a kind go when the vault has the folder: a campaign's scenes/, maps/ and places/. A scenario goes at the campaign folder's root. */
const FOLDERS:Record<FileKind,string[]>={scene:['scenes','Scenes'],scenario:[],map:['maps','Maps'],place:['places','Places']};

/**
 * What a file view holds: one of the game's files to edit (a scene, the scenario, a map, a place), or
 * one of the plugin's version 1 files: a scene or a scenario shown read-only, a map with the offer to
 * migrate it.
 */
type Held=
  |{kind:'scene';scene:SceneDocument}
  |{kind:'legacy';title:string;nodes:number;routes:number}
  |{kind:'scenario';doc:ScenarioDocument}
  |{kind:'legacyScenario';title:string;files:number}
  |{kind:'map';doc:MapDocument}
  |{kind:'v1map';text:string}
  |{kind:'place';doc:PlaceDocument};

/** The file, not plugin data or a browser cache, is the editor's source of truth. */
export class KingmakerFileView extends TextFileView {
  private root: Root|null = null;
  private raw = '';
  private held: Held|null = null;
  private revision = 0;
  private parseError: string|null = null;
  private diskRaw = '';
  private saving: Promise<void> = Promise.resolve();
  private activeSave: {file:TFile;raw:string;expected:string}|null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: WorkshopPlugin) {
    super(leaf);
    this.contentEl.style.padding = '0';
    this.contentEl.style.overflow = 'hidden';
    this.plugin.attachView(this);
  }

  getViewType() { return VIEW; }
  getIcon() { return 'git-branch'; }
  canAcceptExtension(extension: string) { return EXTENSIONS.includes(extension.toLowerCase()); }

  getViewData() { return this.raw; }
  getDiskData() { return this.diskRaw; }

  /** Does this view hold a file it can take an edit of from elsewhere (one of the game's files, opened)? */
  holdsEditable() { return !this.parseError && !!this.held && ['scene','scenario','map','place'].includes(this.held.kind); }

  /** The scene this view is editing, as it is now (its unsaved draft too), if it holds one. */
  sceneDraft(): SceneDocument|undefined { return this.held?.kind === 'scene' ? this.held.scene : undefined; }

  /** Another editor's edit of this file: taken as if the file changed outside it (the editor starts again from it), and saved. */
  applyExternalText(text: string) {
    const held = heldOf(text, this.file ? kindFor(this.file) : 'scene');
    this.held = held;
    this.raw = text;
    this.parseError = null;
    this.revision += 1;
    this.renderEditor();
    this.requestSave();
  }

  setViewData(data: string, clear: boolean) {
    // A write can echo after the user has already typed a newer draft. Known
    // saved bytes acknowledge the write; they do not replace that newer draft.
    if (!clear && this.held) {
      if (data === this.raw || data === this.diskRaw) {
        this.diskRaw = data;
        this.data = data;
        return;
      }
      const pending = this.activeSave;
      if (pending?.file === this.file && data === pending.raw) {
        if (this.diskRaw === pending.expected || this.diskRaw === pending.raw) {
          this.diskRaw = data;
          this.data = data;
        }
        return;
      }
    }
    this.diskRaw = data;
    this.data = data;
    this.raw = data;
    this.revision += 1;
    try {
      this.held = heldOf(data, this.file ? kindFor(this.file) : 'scene');
      this.parseError = null;
    } catch (error) {
      // Retain the exact bytes so closing an invalid file cannot replace it.
      this.held = null;
      this.parseError = message(error);
    }
    this.renderEditor();
    this.plugin.documentsChanged();
  }

  /** A delayed autosave must not overwrite an external edit that arrived meanwhile. */
  async save(clear = false) {
    const pending = this.saving.then(async () => {
      const file = this.file;
      const raw = this.raw;
      const expected = this.diskRaw;
      const revision = this.revision;
      if (file && raw !== expected) {
        const active = {file,raw,expected};
        this.activeSave = active;
        try { await this.app.vault.process(file, disk => {
          // Both the baseline and this document's identity belong to this save.
          // An external reload must not make an older queued draft look current.
          if (this.file !== file || this.revision !== revision) throw new Error(`Save conflict: ${file.path} changed or reloaded while saving. The current editor content has been kept.`);
          if (disk !== expected && disk !== raw) throw new Error(`Save conflict: ${file.path} changed outside this editor. Your draft has been kept.`);
          return raw;
        }); } finally { if (this.activeSave === active) this.activeSave = null; }
        // A later reload may complete after the atomic write but before its
        // promise settles. Never replace that new baseline or clear its view.
        if (this.file === file && this.revision === revision && (this.diskRaw === expected || this.diskRaw === raw)) {
          this.diskRaw = raw;
          this.data = raw;
        }
      }
      if (clear && this.file === file && this.revision === revision && this.raw === raw) this.clear();
    });
    this.saving = pending.catch(() => {});
    await pending;
  }

  clear() {
    this.raw = '';
    this.held = null;
    this.parseError = null;
    this.revision += 1;
    this.renderEditor();
    this.plugin.documentsChanged();
  }

  async onOpen() { this.renderEditor(); }

  async onRename(file: TFile) {
    this.revision += 1;
    await super.onRename(file);
    this.renderEditor();
    this.plugin.documentsChanged();
  }

  async onUnloadFile(file: TFile) {
    // A modal or other async action from this editor can finish after navigation.
    // Invalidate its callbacks before TextFileView takes the final save snapshot.
    this.revision += 1;
    try {
      await super.onUnloadFile(file);
    } catch (error) {
      this.renderEditor();
      throw error;
    }
  }

  async onClose() {
    // TextFileView.onUnloadFile flushes getViewData before this teardown.
    this.revision += 1;
    this.root?.unmount();
    this.root = null;
    this.plugin.detachView(this);
  }

  private renderEditor() {
    this.root ??= createRoot(this.contentEl);
    if (this.parseError) {
      this.root.render(<div className="km-file-error" style={{padding:24}}>
        <h3>Cannot open this Kingmaker file</h3>
        <p>{this.parseError}</p>
        <p>The file has been left unchanged. Fix it in a text editor and reopen it.</p>
      </div>);
      return;
    }
    const held = this.held;
    if (!held) { this.root.render(null); return; }
    const revision = this.revision, path = this.file?.path ?? '';
    const key = this.revision;
    if (held.kind === 'legacy') { this.root.render(<LegacyScene path={path} title={held.title} nodes={held.nodes} routes={held.routes}/>); return; }
    if (held.kind === 'legacyScenario') { this.root.render(<LegacyScenario path={path} title={held.title} files={held.files}/>); return; }
    if (held.kind === 'scene') { this.root.render(<SceneApp key={key} document={held.scene} host={this.sceneHost(revision)}/>); return; }
    if (held.kind === 'scenario') { this.root.render(<ScenarioApp key={key} document={held.doc} host={this.fileHost<ScenarioDocument>(revision, 'scenario')}/>); return; }
    if (held.kind === 'map') { this.root.render(<MapApp key={key} document={held.doc} host={this.fileHost<MapDocument>(revision, 'map')}/>); return; }
    if (held.kind === 'place') { this.root.render(<PlaceApp key={key} document={held.doc} host={this.fileHost<PlaceDocument>(revision, 'place')}/>); return; }
    this.root.render(<MapMigration key={key} text={held.text} host={this.migrationHost(revision)}/>);
  }

  /** Is a callback from the editor of `revision` still this view's (the same file, opened once, and readable)? */
  private live(revision: number) { return revision === this.revision && !!this.file && !this.parseError; }
  private assertLive(revision: number) { if (!this.live(revision)) throw new Error('This editor has changed or closed. Reopen it and try again.'); }

  /** What the scene editor asks of Obsidian: the file saved, the campaign around it read, and lore and scenes opened. */
  private sceneHost(revision: number): SceneHost {
    const path = this.file?.path ?? '';
    const root = sceneRootOf(path);
    return {
      filePath: path,
      change: scene => {
        if (!this.live(revision) || this.held?.kind !== 'scene') return;
        const raw = serializeScene(scene);
        if (raw === this.raw) return;
        this.held = {kind:'scene', scene};
        // Update immediately; closing the tab before the debounce still saves.
        this.raw = raw;
        this.requestSave();
        this.plugin.documentsChanged();
      },
      campaign: () => readCampaign(path, this.plugin.vaultFiles(), draft => this.plugin.sceneDraft(draft)),
      subscribe: listener => this.plugin.subscribeDocuments(() => { if (revision === this.revision && this.file) listener(); }),
      openLore: lore => this.plugin.openVaultFile(lorePathOf(root, lore), path),
      openScene: id => this.plugin.openVaultFile(scenePathOf(root, id), path),
      openPlace: key => this.plugin.openVaultFile(`${root}places/${key}.kmplace`, path),
    };
  }

  /** What the scenario, map and place editors ask of Obsidian: the file saved, the vault's other files read and written, safely. */
  private fileHost<T>(revision: number, kind: 'scenario'|'map'|'place'): FileHost<T> {
    const path = this.file?.path ?? '';
    return {
      filePath: path,
      change: doc => {
        if (!this.live(revision) || this.held?.kind !== kind) return;
        const raw = serializeJson(doc);
        if (raw === this.raw) return;
        this.held = {kind, doc} as Held;
        this.raw = raw;
        this.requestSave();
        this.plugin.documentsChanged();
      },
      files: this.plugin.vaultFiles(),
      write: async (other, before, after) => {
        this.assertLive(revision);
        await this.plugin.writeFile(other, before, after, () => this.assertLive(revision));
        this.assertLive(revision);
      },
      create: async (other, text) => {
        this.assertLive(revision);
        await this.plugin.createFile(other, text);
      },
      subscribe: listener => this.plugin.subscribeDocuments(() => { if (this.live(revision)) listener(); }),
      open: other => this.plugin.openVaultFile(other, path),
    };
  }

  /** A version 1 map's: its own file replaced by its migration, then opened as a map of the format. */
  private migrationHost(revision: number): MigrationHost {
    return {
      ...this.fileHost<unknown>(revision, 'map'),
      replace: text => {
        if (!this.live(revision) || this.held?.kind !== 'v1map') return;
        const held = heldOf(text, 'map');
        if (held.kind !== 'map') throw new Error('The migration didn\'t make a map of the format.');
        this.held = held;
        this.raw = text;
        this.revision += 1;
        this.renderEditor();
        this.requestSave();
        this.plugin.documentsChanged();
      },
    };
  }
}

/** A file's text as what its view holds. What isn't a file the plugin can show throws, naming why. */
function heldOf(raw: string, kind: FileKind): Held {
  if (kind === 'scene') {
    const file = openSceneFile(raw);
    return file.kind === 'scene' ? {kind:'scene', scene:file.doc} : {kind:'legacy', title:file.title, nodes:file.nodes, routes:file.routes};
  }
  if (kind === 'scenario') {
    const legacy = version1(raw, 'scenario');
    if (legacy) return {kind:'legacyScenario', title:typeof legacy.title === 'string' ? legacy.title : '', files:Array.isArray((legacy.scenario as {files?:unknown}|undefined)?.files) ? ((legacy.scenario as {files:unknown[]}).files.length) : 0};
    return {kind:'scenario', doc:openScenarioFile(raw)};
  }
  if (kind === 'map') {
    if (mapFileKind(raw) === 'v1') { readV1Map(raw); return {kind:'v1map', text:raw}; }
    return {kind:'map', doc:openMapFile(raw)};
  }
  return {kind:'place', doc:openPlaceFile(raw)};
}

/** A file of the plugin's version 1 of a kind, as JSON, or nothing. */
function version1(raw: string, kind: string): Record<string, unknown>|undefined {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return value && value.format === 'kingmaker' && value.version === 1 && value.kind === kind ? value : undefined;
  } catch { return undefined; }
}

/** The name of a new file: its title, and its file is named for the slug of it, its id (scenes/<id>.kmscene, maps/<id>.kmmap…). */
class NameDocumentModal extends Modal {
  private resolve: (name: string|null) => void;
  private submitted = false;
  constructor(app: ObsidianApp, private kind: FileKind|'tune', private folder: TFolder, resolve: (name: string|null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    const extension = this.kind === 'tune' ? 'kmtune' : BY_KIND[this.kind];
    this.setTitle(`New Kingmaker ${this.kind}`);
    this.contentEl.createEl('p', {text: `Create a ${this.kind} in ${this.folder.path || 'the vault root'}. Its title can be anything; its file is named for its id, a slug of the title (The Hanged Clerk is hanged-clerk.${extension}), which game state keys on.`});
    let name = '';
    let input: HTMLInputElement;
    const error = this.contentEl.createEl('p', {cls:'mod-warning'});
    const submit = () => {
      const cleaned = name.trim().replace(/\.(kmscene|kmscenario|kmmap|kmplace|kmtune)$/i, '').trim();
      const file = slugOf(cleaned);
      if (!file) {
        error.setText(`Give the ${this.kind} a title with letters or digits in it.`);
        return;
      }
      const path = normalizePath(`${this.folder.path}/${file}.${extension}`);
      if (this.app.vault.getAbstractFileByPath(path)) {
        error.setText(`A file with that name already exists (${path}). Choose another title.`);
        return;
      }
      if (this.kind === 'scenario') {
        const other = this.app.vault.getFiles().find(f => f.extension === 'kmscenario' && (f.parent?.path ?? '') === this.folder.path);
        if (other) { error.setText(`This folder has a scenario already (${other.path}): a campaign folder has one.`); return; }
      }
      this.submitted = true;
      this.resolve(cleaned);
      this.close();
    };
    new Setting(this.contentEl).setName('Title').addText(text => {
      input = text.inputEl;
      text.setPlaceholder(this.kind === 'scene' ? 'The Hanged Clerk' : this.kind === 'map' ? 'The Cooperage' : this.kind === 'place' ? 'The Granary Yard' : this.kind === 'tune' ? 'Lanterns' : 'Caerwyn');
      text.onChange(value => { name = value; error.empty(); });
      text.inputEl.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
      });
    });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Create').setCta().onClick(submit));
    input!.focus();
  }

  onClose() {
    if (!this.submitted) this.resolve(null);
    this.contentEl.empty();
  }
}

class OpenDocumentModal extends FuzzySuggestModal<TFile> {
  constructor(app: ObsidianApp, private files: TFile[]) {
    super(app);
    this.setPlaceholder('Open a Kingmaker scene, scenario, map or place…');
  }
  getItems() { return this.files; }
  getItemText(file: TFile) { return file.path; }
  onChooseItem(file: TFile) { void this.app.workspace.getLeaf('tab').openFile(file); }
}

/** A new file's text, by its kind: the format's skeleton (a scene's graph, a map's default legend, a place's one area, a scenario with nothing in it). */
function skeletonOf(kind: FileKind, title: string, id: string): string {
  if (kind === 'scene') return serializeScene(skeletonScene(title, id));
  if (kind === 'map') return serializeJson(newMap(title, id));
  if (kind === 'place') return serializeJson(newPlace(title, id));
  return serializeJson(newScenario(title, id));
}

export default class WorkshopPlugin extends Plugin {
  private fileViews = new Set<KingmakerFileView>();
  private documentListeners = new Set<() => void>();

  attachView(view: KingmakerFileView) { this.fileViews.add(view); }
  detachView(view: KingmakerFileView) { this.fileViews.delete(view); this.documentsChanged(); }
  documentsChanged() { for (const listener of this.documentListeners) listener(); }
  subscribeDocuments(listener: () => void) {
    this.documentListeners.add(listener);
    return () => { this.documentListeners.delete(listener); };
  }

  async onload() {
    this.registerView(VIEW, leaf => new KingmakerFileView(leaf, this));
    this.registerExtensions(EXTENSIONS, VIEW);
    this.registerEvent(this.app.vault.on('modify', () => this.documentsChanged()));
    this.registerEvent(this.app.vault.on('create', () => this.documentsChanged()));
    this.registerEvent(this.app.vault.on('delete', () => this.documentsChanged()));
    this.registerEvent(this.app.vault.on('rename', () => this.documentsChanged()));

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      const parent = file instanceof TFolder ? file : file.parent;
      if (!parent) return;
      const populate = (target: Menu) => {
        for (const kind of KINDS) {
          target.addItem(item => item.setTitle(`New ${kind}`).setIcon({scene:'git-branch',scenario:'book-open',map:'map',place:'map-pin'}[kind])
            .onClick(() => { void this.createDocument(kind, parent); }));
        }
        target.addItem(item => item.setTitle('New tune').setIcon('music').onClick(() => { void this.createTune(parent); }));
      };
      menu.addItem(item => {
        item.setTitle('Kingmaker').setIcon('crown');
        // Obsidian's native submenu method isn't in the public typings. Keep a
        // click-open menu fallback so this entry still works if it is absent.
        const native = item as MenuItem & {setSubmenu?: () => Menu};
        if (native.setSubmenu) populate(native.setSubmenu());
        else item.onClick(event => { const child = new Menu(); populate(child); child.showAtPosition({x:'clientX' in event ? event.clientX : window.innerWidth / 2, y:'clientY' in event ? event.clientY : window.innerHeight / 2}); });
      });
    }));
    for (const kind of KINDS) {
      this.addCommand({
        id:`new-${kind}`, name:`Create new ${kind}`,
        callback:() => { void this.createDocument(kind, this.folderFor(kind, this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot())); },
      });
    }
    const open = () => {
      const files = this.app.vault.getFiles().filter(isDocument).sort((a,b) => a.path.localeCompare(b.path));
      if (!files.length) { new Notice('No Kingmaker files yet. Right-click a folder to create a scene, map, place or scenario.'); return; }
      new OpenDocumentModal(this.app, files).open();
    };
    this.addRibbonIcon('git-branch', 'Open Kingmaker scene, scenario, map or place', open);
    this.addCommand({id:'open-file', name:'Open scene, scenario, map or place', callback:open});
  }

  /** New music uses the shared score format and opens in Kingmaker Tunes. */
  async createTune(parent: TFolder): Promise<TFile|null> {
    const name = await new Promise<string|null>(resolve => new NameDocumentModal(this.app, 'tune', parent, resolve).open());
    if (!name) return null;
    let file: TFile;
    try {
      const tune = newTune(); tune.title = name;
      file = await this.app.vault.create(normalizePath(`${parent.path}/${slugOf(name)}.kmtune`), writeTune(tune));
    } catch (error) { new Notice(`Could not create tune: ${message(error)}`); return null; }
    try { await this.app.workspace.getLeaf('tab').openFile(file); }
    catch (error) { new Notice(`Created ${file.path}, but could not open it: ${message(error)}`); }
    return file;
  }

  /** The folder new files of a kind go in: the vault's folder for them when it has one (a campaign's scenes/), else `fallback`. */
  folderFor(kind: FileKind, fallback: TFolder): TFolder {
    for (const name of FOLDERS[kind]) {
      const folder = this.app.vault.getAbstractFileByPath(name);
      if (folder instanceof TFolder) return folder;
    }
    return fallback;
  }

  async createDocument(kind: FileKind, parent: TFolder, open = true): Promise<TFile|null> {
    const name = await new Promise<string|null>(resolve => new NameDocumentModal(this.app, kind, parent, resolve).open());
    if (!name) return null;
    let file: TFile;
    try {
      const id = slugOf(name);
      const path = normalizePath(`${parent.path}/${id}.${BY_KIND[kind]}`);
      file = await this.app.vault.create(path, skeletonOf(kind, name, id));
    } catch (error) {
      new Notice(`Could not create ${kind}: ${message(error)}`);
      return null;
    }
    this.documentsChanged();
    if (open) {
      try {
        await this.app.workspace.getLeaf('tab').openFile(file);
      } catch (error) {
        new Notice(`Created ${file.path}, but could not open it: ${message(error)}`);
      }
    }
    return file;
  }

  /** The views open on a file. */
  private viewsOf(path: string) { return [...this.fileViews].filter(view => view.file?.path === path); }

  /** A file's text as it is now: what the editors that have it open hold (refused when they disagree), else what's on disk. */
  private async textNow(path: string, cached: boolean): Promise<string|undefined> {
    const open = this.viewsOf(path).filter(view => view.holdsEditable() || view.getViewData());
    if (open.length) {
      if (open.some(view => view.getViewData() !== open[0].getViewData())) throw new Error(`Conflicting open editors for ${path}. Save or close one of them first.`);
      return open[0].getViewData();
    }
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (file instanceof TFile) return cached ? this.app.vault.cachedRead(file) : this.app.vault.read(file);
    // A file of a kind Obsidian doesn't list (it lists every file it can see, but be sure).
    const adapter = (this.app.vault as {adapter?: {exists:(path:string)=>Promise<boolean>; read:(path:string)=>Promise<string>}}).adapter;
    return adapter && await adapter.exists(path) ? adapter.read(path) : undefined;
  }

  /** The vault's files as the editors read their campaign: the paths under a folder, and a file's text (an open editor's draft first). */
  vaultFiles(): VaultFiles {
    const vault = this.app.vault;
    return {
      list: folder => vault.getFiles().map(file => file.path).filter(path => path.startsWith(folder)),
      read: path => this.textNow(path, true),
    };
  }

  /** The draft of a scene an open editor holds, by its path: what the campaign's other scenes see of it. */
  sceneDraft(path: string): SceneDocument|undefined {
    for (const view of this.fileViews) if (view.file?.path === path) { const draft = view.sceneDraft(); if (draft) return draft; }
    return undefined;
  }

  /**
   * Another of the game's files written by an editor (a scene's ending set from the scenario, a place
   * from its map): refused unless it's `before` now. An editor that has it open is given the new
   * text, which it saves; otherwise the vault writes it, comparing atomically.
   */
  async writeFile(path: string, before: string, after: string, assertActive: () => void = () => {}) {
    assertActive();
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile) || !isDocument(file)) throw new Error(`Kingmaker file not found: ${path}`);
    heldOf(after, kindFor(file));
    const checkOpen = () => {
      const open = this.viewsOf(file.path);
      if (open.some(view => !view.holdsEditable())) throw new Error(`${path} is open in an editor that can't take an edit from elsewhere. Close it and try again.`);
      if (open.some(view => view.getViewData() !== before)) throw new Error(`Edit conflict: ${path} changed. Nothing was overwritten: try again.`);
      return open;
    };
    let open = checkOpen();
    if (open.length) {
      const disk = await this.app.vault.read(file);
      assertActive();
      open = checkOpen();
      if (open.length) {
        if (open.some(view => disk !== view.getDiskData() && disk !== view.getViewData())) throw new Error(`Edit conflict: ${path} changed outside its open editor. Reload it, then try again.`);
        for (const view of open) view.applyExternalText(after);
        this.documentsChanged();
        return;
      }
    }
    // Vault.process holds the file operation atomically, including the comparison.
    await this.app.vault.process(file, raw => {
      assertActive();
      if (this.viewsOf(file.path).length) throw new Error(`An editor opened ${path} during this edit. Try again.`);
      if (raw !== before) throw new Error(`Edit conflict: ${path} changed. Nothing was overwritten: try again.`);
      return after;
    });
    this.documentsChanged();
  }

  /** A new file of the game's (made by an editor: a scene, map or place it lists), refused when there's one there. */
  async createFile(path: string, text: string) {
    const target = normalizePath(path);
    if (this.app.vault.getAbstractFileByPath(target)) throw new Error(`There's a file at ${target} already.`);
    const folder = target.split('/').slice(0, -1).join('/');
    const vault = this.app.vault as typeof this.app.vault & {createFolder?: (path: string) => Promise<unknown>};
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await vault.createFolder?.(folder);
    await this.app.vault.create(target, text);
    this.documentsChanged();
  }

  async openVaultFile(path: string, sourcePath = '') {
    // Store exact vault-relative paths. The cache also resolves ordinary wiki links.
    const direct = this.app.vault.getAbstractFileByPath(normalizePath(path));
    const file = direct instanceof TFile ? direct : this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (!file) {
      new Notice(`Linked file not found: ${path}`);
      throw new Error(`Linked file not found: ${path}`);
    }
    await this.app.workspace.getLeaf('tab').openFile(file);
  }
}
